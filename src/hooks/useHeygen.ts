// Клиентская обёртка над edge-функцией heygen-proxy.
// Ключ HeyGen живёт в секретах Supabase — сюда приходят только данные.
import { supabase } from "@/integrations/supabase/client";
import { supabaseUrl } from "@/lib/supabaseConfig";

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

/** Диагностика: доступ к API и остаток кредитов на плане. */
export async function fetchQuota(): Promise<HeygenQuota> {
  const res = await call<{ data?: HeygenQuota } & Partial<HeygenQuota>>({ action: "quota" });
  return (res.data ?? (res as HeygenQuota));
}

interface RawAvatar {
  avatar_id: string;
  avatar_name?: string;
  gender?: string;
  preview_image_url?: string;
  preview_video_url?: string;
  is_public?: boolean; // false → ваш собственный (кастомный) аватар/скин
  premium?: boolean;
}
interface RawTalkingPhoto {
  talking_photo_id: string;
  talking_photo_name?: string;
  preview_image_url?: string;
}

export async function fetchAvatars(): Promise<HeygenAvatar[]> {
  const res = await call<{ data?: { avatars?: RawAvatar[]; talking_photos?: RawTalkingPhoto[] } }>({
    action: "list_avatars",
  });
  const avatars: HeygenAvatar[] = (res.data?.avatars ?? []).map((a) => ({
    id: a.avatar_id,
    name: a.avatar_name ?? "Аватар",
    kind: "avatar",
    // is_public === false → ваш кастомный аватар (скин), созданный в аккаунте.
    mine: a.is_public === false,
    gender: a.gender,
    preview_image_url: a.preview_image_url,
    preview_video_url: a.preview_video_url,
  }));
  // Talking photos — всегда ваши собственные (загруженные/созданные) аватары.
  const talkingPhotos: HeygenAvatar[] = (res.data?.talking_photos ?? []).map((t) => ({
    id: t.talking_photo_id,
    name: t.talking_photo_name ?? "Мой аватар",
    kind: "talking_photo",
    mine: true,
    preview_image_url: t.preview_image_url,
  }));
  return [...avatars, ...talkingPhotos];
}

export async function fetchVoices(): Promise<HeygenVoice[]> {
  const res = await call<{ data?: { voices?: HeygenVoice[] } }>({ action: "list_voices" });
  return res.data?.voices ?? [];
}

export async function fetchTemplates(): Promise<HeygenTemplate[]> {
  const res = await call<{ data?: { templates?: HeygenTemplate[] } }>({ action: "list_templates" });
  return res.data?.templates ?? [];
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
}

export interface VideoAgentInput {
  prompt: string;
  avatar?: AvatarRef;
  voiceId?: string;
}

/** Быстрое создание (Video Agent v3): промпт/сценарий → session_id.
 *  avatar/voice — необязательные подсказки; без них агент подбирает сам. */
export async function generateVideoAgent(input: VideoAgentInput): Promise<string> {
  const agent: Record<string, unknown> = { prompt: input.prompt };
  if (input.avatar) agent.avatar_id = input.avatar.id;
  if (input.voiceId) agent.voice_id = input.voiceId;
  const res = await call<{ data?: { session_id?: string } }>({ action: "video_agent", agent });
  const id = res.data?.session_id;
  if (!id) throw new Error("HeyGen не вернул session_id");
  return id;
}

/** Опрос статуса Video Agent по session_id. */
export async function fetchAgentStatus(sessionId: string): Promise<AgentStatus> {
  const res = await call<{ data?: AgentStatus }>({ action: "video_agent_status", session_id: sessionId });
  const d = res.data ?? {};
  return {
    status: d.status ?? "generating",
    video_url: d.video_url,
    video_id: d.video_id,
    thumbnail_url: d.thumbnail_url,
  };
}

/** Опрос статуса рендера. */
export async function fetchVideoStatus(videoId: string): Promise<HeygenVideoStatus> {
  const res = await call<{ data?: HeygenVideoStatus }>({ action: "status", video_id: videoId });
  const d = res.data ?? {};
  return {
    status: d.status ?? "pending",
    video_url: d.video_url,
    thumbnail_url: d.thumbnail_url,
    error: d.error,
  };
}
