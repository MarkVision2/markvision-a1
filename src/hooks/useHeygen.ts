// Клиентская обёртка над edge-функцией heygen-proxy.
// Ключ HeyGen живёт в секретах Supabase — сюда приходят только данные.
import { supabase } from "@/integrations/supabase/client";

export interface HeygenAvatar {
  avatar_id: string;
  avatar_name: string;
  gender?: string;
  preview_image_url?: string;
  preview_video_url?: string;
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

export async function fetchAvatars(): Promise<HeygenAvatar[]> {
  const res = await call<{ data?: { avatars?: HeygenAvatar[] } }>({ action: "list_avatars" });
  return res.data?.avatars ?? [];
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
  avatarId: string;
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
          character: { type: "avatar", avatar_id: input.avatarId, avatar_style: "normal" },
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
