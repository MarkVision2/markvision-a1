// Клиентская обёртка над edge-функцией heygen-proxy.
// Ключ HeyGen живёт в секретах Supabase — сюда приходят только данные.
import { supabase } from "@/integrations/supabase/client";
import { supabaseUrl } from "@/lib/supabaseConfig";
import {
  estimateHeygenVideoCost,
  parseHeygenAccount,
  type HeygenAccountStats,
  type HeygenVideoRow,
  type RawUserProfile,
} from "@/lib/heygenAccount";

export type { HeygenAccountStats, HeygenVideoRow };

// Нормализованный аватар: обычный HeyGen-аватар или ваш собственный
// видео-аватар (talking photo). kind нужен, чтобы правильно собрать character.
export interface HeygenAvatar {
  id: string;
  name: string;
  kind: "avatar" | "talking_photo";
  mine?: boolean; // ваш собственный аватар/скин (не публичный аватар HeyGen)
  gender?: string;
  preview_image_url?: string;
  preview_video_url?: string;
}

export type AvatarRef = { kind: "avatar" | "talking_photo"; id: string };

function buildCharacter(ref: AvatarRef) {
  return ref.kind === "talking_photo"
    ? { type: "talking_photo" as const, talking_photo_id: ref.id }
    : { type: "avatar" as const, avatar_id: ref.id, avatar_style: "normal" };
}

export interface HeygenVoice {
  voice_id: string;
  name: string;
  language?: string;
  gender?: string;
  preview_audio?: string;
  mine?: boolean; // ваш кастомный/загруженный голос (если HeyGen помечает)
}

export interface HeygenTemplate {
  template_id: string;
  name: string;
  thumbnail_image_url?: string;
}

export interface HeygenQuota {
  remaining_quota: number;
  details?: Record<string, unknown>;
}

export type RenderStatus = "pending" | "processing" | "completed" | "failed" | string;

export interface HeygenVideoStatus {
  status: RenderStatus;
  video_url?: string;
  thumbnail_url?: string;
  duration_sec?: number;
  error?: unknown;
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("heygen-proxy", { body });
  if (error) {
    // Тело ошибки edge-функции лежит в error.context (Response) — достаём текст.
    let detail = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.text === "function") {
        const parsed = JSON.parse(await ctx.text());
        if (parsed?.error) detail = parsed.error;
      }
    } catch {
      /* оставляем error.message */
    }
    throw new Error(detail);
  }
  if (data && typeof data === "object" && "error" in data && (data as { error?: unknown }).error) {
    throw new Error(String((data as { error: unknown }).error));
  }
  return data as T;
}

/** Диагностика: доступ к API и остаток кредитов на плане (legacy v2). */
export async function fetchQuota(): Promise<HeygenQuota> {
  const res = await call<{ data?: HeygenQuota } & Partial<HeygenQuota>>({ action: "quota" });
  return (res.data ?? (res as HeygenQuota));
}

/** Баланс и расход аккаунта HeyGen (v3/users/me). */
export async function fetchAccountStats(): Promise<HeygenAccountStats> {
  const res = await call<{ data?: RawUserProfile }>({ action: "user_profile" });
  return parseHeygenAccount(res.data ?? {});
}

/** Последние ролики аккаунта HeyGen — для истории и оценки расхода. */
export async function fetchRecentVideos(limit = 50): Promise<HeygenVideoRow[]> {
  const res = await call<{ data?: RawObj[] }>({ action: "list_videos", limit });
  const list = Array.isArray(res.data) ? res.data : [];
  return list.map((v) => {
    const durationSec = typeof v.duration === "number" ? v.duration : null;
    return {
      id: String(v.id ?? ""),
      title: typeof v.title === "string" ? v.title : null,
      status: String(v.status ?? ""),
      createdAt: typeof v.created_at === "number" ? v.created_at : null,
      durationSec,
      costUsd: estimateHeygenVideoCost(durationSec, "agent"),
    };
  }).filter((v) => v.id.length > 0);
}

type RawObj = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
// Ищем массив по нескольким возможным именам полей.
function pickArray(obj: RawObj | undefined, keys: string[]): RawObj[] {
  if (!obj) return [];
  for (const k of keys) {
    if (Array.isArray(obj[k])) return obj[k] as RawObj[];
  }
  return [];
}

/**
 * Только СВОИ аватары. Показываем ВСЕ looks (скины) из ваших групп
 * («Юрий Кат за микрофоном», «Юрий Кат in brown jacket», …) — как в HeyGen,
 * без публичных аватаров. Каждый look — свой avatar_id для генерации.
 * Парсинг устойчив к разным именам полей в ответе HeyGen.
 */
export async function fetchAvatars(): Promise<HeygenAvatar[]> {
  const res = await call<{ data?: RawObj }>({ action: "list_avatar_groups" });
  const groups = pickArray(res.data, ["avatar_group_list", "avatar_groups", "groups", "list"]);

  const perGroup = await Promise.all(
    groups.map(async (g): Promise<HeygenAvatar[]> => {
      const groupId = str(g.id) ?? str(g.group_id) ?? "";
      const groupName = str(g.name) ?? str(g.group_name) ?? "Мой аватар";
      const groupPreview = str(g.preview_image_url) ?? str(g.preview_image) ?? str(g.image_url);
      try {
        const looks = await call<{ data?: RawObj }>({ action: "list_group_avatars", group_id: groupId });
        const list = pickArray(looks.data, ["avatar_list", "avatars", "looks", "list", "avatar_group_looks"]);
        if (list.length > 0) {
          return list.map((lk) => ({
            id: str(lk.id) ?? str(lk.avatar_id) ?? str(lk.talking_photo_id) ?? groupId,
            name: str(lk.name) ?? str(lk.avatar_name) ?? groupName,
            kind: "avatar" as const,
            mine: true,
            preview_image_url: str(lk.preview_image_url) ?? str(lk.image_url) ?? str(lk.normal_preview) ?? groupPreview,
            preview_video_url: str(lk.preview_video_url) ?? str(lk.motion_preview),
          }));
        }
      } catch {
        /* нет доступа к looks — покажем группу одной карточкой */
      }
      return [{ id: groupId, name: groupName, kind: "avatar" as const, mine: true, preview_image_url: groupPreview }];
    }),
  );
  return perGroup.flat().filter((a) => a.id);
}

export async function fetchVoices(): Promise<HeygenVoice[]> {
  const res = await call<{ data?: { voices?: RawObj[] } }>({ action: "list_voices" });
  return (res.data?.voices ?? []).map((v) => ({
    voice_id: str(v.voice_id) ?? str(v.id) ?? "",
    name: str(v.name) ?? str(v.voice_name) ?? "Голос",
    language: str(v.language),
    gender: str(v.gender),
    preview_audio: str(v.preview_audio) ?? str(v.preview_url) ?? str(v.sample_url),
    // Кастомные/загруженные голоса HeyGen помечает по-разному — берём несколько сигналов.
    mine: v.is_public === false || v.category === "cloned" || v.is_cloned === true || v.type === "cloned",
  })).filter((v) => v.voice_id);
}

export async function fetchTemplates(): Promise<HeygenTemplate[]> {
  const res = await call<{ data?: { templates?: HeygenTemplate[] } }>({ action: "list_templates" });
  return res.data?.templates ?? [];
}

// Поле шаблона, которое пользователь заполняет перед сборкой.
export interface TemplateVariable {
  name: string;
  type: string; // text | image | video | audio | character | voice …
}

/** Детали шаблона: список переменных (полей) для подстановки. Парсинг устойчив
 *  к тому, что HeyGen отдаёт variables объектом {name: {...}} или массивом. */
export async function fetchTemplateDetail(templateId: string): Promise<TemplateVariable[]> {
  const res = await call<{ data?: { variables?: unknown } }>({ action: "template_detail", template_id: templateId });
  const raw = res.data?.variables;
  if (!raw || typeof raw !== "object") return [];
  const list = Array.isArray(raw)
    ? (raw as RawObj[])
    : Object.entries(raw as RawObj).map(([k, v]) => ({ name: (v as RawObj)?.name ?? k, type: (v as RawObj)?.type }));
  return list
    .map((v) => ({ name: String((v as RawObj).name ?? ""), type: String((v as RawObj).type ?? "text") }))
    .filter((v) => v.name.length > 0);
}

export interface GenerateAvatarInput {
  avatar: AvatarRef;
  voiceId: string;
  script: string;
  width: number;
  height: number;
  title?: string;
}

/** Аватар + сценарий (talking head) → video_id. */
export async function generateAvatarVideo(input: GenerateAvatarInput): Promise<string> {
  const res = await call<{ data?: { video_id?: string } }>({
    action: "generate_avatar",
    video: {
      title: input.title ?? "MarkVision AI монтаж",
      video_inputs: [
        {
          character: buildCharacter(input.avatar),
          voice: { type: "text", input_text: input.script, voice_id: input.voiceId },
        },
      ],
      dimension: { width: input.width, height: input.height },
    },
  });
  const id = res.data?.video_id;
  if (!id) throw new Error("HeyGen не вернул video_id");
  return id;
}

export interface GenerateTemplateInput {
  templateId: string;
  title?: string;
  variables?: Record<string, unknown>;
  width: number;
  height: number;
}

/** Монтаж по шаблону → video_id. */
export async function generateTemplateVideo(input: GenerateTemplateInput): Promise<string> {
  const res = await call<{ data?: { video_id?: string } }>({
    action: "generate_template",
    template_id: input.templateId,
    template: {
      test: false,
      title: input.title ?? "MarkVision AI монтаж",
      variables: input.variables ?? {},
      dimension: { width: input.width, height: input.height },
    },
  });
  const id = res.data?.video_id;
  if (!id) throw new Error("HeyGen не вернул video_id");
  return id;
}

export interface UploadedClip {
  id: string;
  url: string;
}

/** Загрузка готового клипа в HeyGen как ассета (бинарный passthrough). */
export async function uploadClip(file: File): Promise<UploadedClip> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Нет активной сессии");

  const res = await fetch(`${supabaseUrl}/functions/v1/heygen-proxy?action=upload_asset`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });
  const parsed = await res.json().catch(() => ({}));
  if (!res.ok || parsed?.error) {
    throw new Error(parsed?.error || `Загрузка не удалась (${res.status})`);
  }
  const d = parsed.data ?? parsed;
  const url = d.url as string | undefined;
  const id = (d.id ?? d.asset_id) as string | undefined;
  if (!url) throw new Error("HeyGen не вернул ссылку на клип");
  return { id: id ?? "", url };
}

export interface ClipScene {
  clipUrl: string;
  script: string;
}

export interface GenerateFromClipsInput {
  avatar: AvatarRef;
  voiceId: string;
  scenes: ClipScene[];
  width: number;
  height: number;
  title?: string;
}

/** Монтаж из готовых клипов: каждый клип — фон сцены, аватар проговаривает текст. */
export async function generateFromClips(input: GenerateFromClipsInput): Promise<string> {
  const character = buildCharacter(input.avatar);
  const res = await call<{ data?: { video_id?: string } }>({
    action: "generate_avatar",
    video: {
      title: input.title ?? "MarkVision AI монтаж",
      video_inputs: input.scenes.map((s) => ({
        character,
        voice: { type: "text", input_text: s.script, voice_id: input.voiceId },
        background: { type: "video", url: s.clipUrl, play_style: "fit_to_scene" },
      })),
      dimension: { width: input.width, height: input.height },
    },
  });
  const id = res.data?.video_id;
  if (!id) throw new Error("HeyGen не вернул video_id");
  return id;
}

export interface AgentStatus {
  status: string;
  video_url?: string;
  video_id?: string;
  thumbnail_url?: string;
  duration_sec?: number;
}

export interface VideoAgentInput {
  prompt: string;
  avatar?: AvatarRef;
  voiceId?: string;
  aspect?: string; // "9:16" | "16:9"
}

/** Быстрое создание (Video Agent v3): промпт/сценарий → session_id.
 *  avatar/voice — необязательные подсказки; без них агент подбирает сам.
 *  Формат передаём и явным полем aspect_ratio, и директивой в промпт — у v3 нет
 *  отдельного параметра раскладки, поэтому дублируем, чтобы агент его учёл. */
export async function generateVideoAgent(input: VideoAgentInput): Promise<string> {
  const orient = input.aspect === "16:9" ? "горизонтальное" : input.aspect === "9:16" ? "вертикальное" : "";
  const prompt = input.aspect ? `${input.prompt}\n\nФормат ролика: ${input.aspect} (${orient}).` : input.prompt;
  const agent: Record<string, unknown> = { prompt };
  // avatar_id имеет смысл только для обычного аватара; talking_photo агент не примет.
  if (input.avatar && input.avatar.kind === "avatar") agent.avatar_id = input.avatar.id;
  if (input.voiceId) agent.voice_id = input.voiceId;
  if (input.aspect) agent.aspect_ratio = input.aspect;
  const res = await call<{ data?: { session_id?: string } }>({ action: "video_agent", agent });
  const id = res.data?.session_id;
  if (!id) throw new Error("HeyGen не вернул session_id");
  return id;
}

// HeyGen может вернуть ссылку на видео по-разному — читаем несколько вариантов.
function pickString(...vals: unknown[]): string | undefined {
  return vals.find((v) => typeof v === "string" && v.length > 0) as string | undefined;
}
function nested(obj: Record<string, unknown>, key: string, sub: string): unknown {
  const v = obj[key];
  return v && typeof v === "object" ? (v as Record<string, unknown>)[sub] : undefined;
}

/** Опрос статуса Video Agent по session_id. */
export async function fetchAgentStatus(sessionId: string): Promise<AgentStatus> {
  const res = await call<{ data?: Record<string, unknown> }>({
    action: "video_agent_status",
    session_id: sessionId,
  });
  const d = res.data ?? {};
  const dur = d.duration ?? d.duration_sec ?? nested(d, "video", "duration");
  return {
    status: (d.status as string) ?? "generating",
    video_url: pickString(
      d.video_url,
      nested(d, "video", "url"),
      nested(d, "output", "video_url"),
      nested(d, "result", "video_url"),
    ),
    video_id: d.video_id as string | undefined,
    thumbnail_url: pickString(d.thumbnail_url, nested(d, "video", "thumbnail_url")),
    duration_sec: typeof dur === "number" ? dur : undefined,
  };
}

/** Опрос статуса рендера. */
export async function fetchVideoStatus(videoId: string): Promise<HeygenVideoStatus> {
  const res = await call<{ data?: HeygenVideoStatus }>({ action: "status", video_id: videoId });
  const d = (res.data ?? {}) as Partial<HeygenVideoStatus> & { duration?: number };
  return {
    status: d.status ?? "pending",
    video_url: d.video_url,
    thumbnail_url: d.thumbnail_url,
    duration_sec: typeof (d as { duration?: number }).duration === "number"
      ? (d as { duration?: number }).duration
      : d.duration_sec,
    error: d.error,
  };
}
