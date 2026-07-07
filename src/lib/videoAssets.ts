// Обложка + описание для видео — через генератор «Контент-завода» (n8n Clony).
// n8n-workflow должен принять payload с type:"video_assets" и вернуть
// { cover_url, description } (по сценарию видео).
import { supabase } from "@/integrations/supabase/client";

export interface VideoAssets {
  cover_url?: string;
  description?: string;
}

export async function generateVideoAssets(input: {
  script: string;
  aspect: string;
  projectId: string;
}): Promise<VideoAssets> {
  const { data, error } = await supabase.functions.invoke("content-factory-proxy", {
    body: {
      source: "heygen_montage",
      type: "video_assets",
      script: input.script,
      aspect: input.aspect,
      project_id: input.projectId,
    },
  });
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    cover_url: (d.cover_url ?? d.coverUrl ?? d.image_url ?? d.thumbnail_url) as string | undefined,
    description: (d.description ?? d.caption ?? d.text) as string | undefined,
  };
}
