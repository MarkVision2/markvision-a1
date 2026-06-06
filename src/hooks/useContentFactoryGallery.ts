import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProjectsStore } from "@/hooks/useProjectsStore";

export interface GalleryItem {
  id: string;
  project_id: string;
  request_id: string | null;
  session_id: string | null;
  type_id: string | null;
  type_title: string | null;
  style_id: string | null;
  style_label: string | null;
  image_url: string;
  prompt_snapshot: string | null;
  brand_template_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface SaveGalleryInput {
  requestId: string;
  sessionId: string;
  typeId: string;
  typeTitle: string;
  styleId: string;
  styleLabel: string;
  imageUrl: string;
  promptSnapshot?: string;
  brandTemplateId?: string | null;
  metadata?: Record<string, unknown>;
}

export function useContentFactoryGallery() {
  const { user } = useAuth();
  const { activeId: projectId } = useProjectsStore();
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) {
      setItems([]);
      return;
    }
    setLoading(true);
    const { data, error } = await (supabase.from("content_factory_gallery" as never) as ReturnType<
      typeof supabase.from
    >)
      .select(
        "id, project_id, request_id, session_id, type_id, type_title, style_id, style_label, image_url, prompt_snapshot, brand_template_id, metadata, created_at",
      )
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(100);
    setLoading(false);
    if (error) {
      console.warn("[gallery] load", error.message);
      return;
    }
    setItems((data ?? []) as unknown as GalleryItem[]);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveItem = useCallback(
    async (input: SaveGalleryInput): Promise<boolean> => {
      if (!projectId || !user?.id || !input.imageUrl) return false;

      const { data: existing } = await (supabase.from("content_factory_gallery" as never) as ReturnType<
        typeof supabase.from
      >)
        .select("id")
        .eq("project_id", projectId)
        .eq("request_id", input.requestId)
        .maybeSingle();

      if (existing) return true;

      const { error } = await (supabase.from("content_factory_gallery" as never) as ReturnType<
        typeof supabase.from
      >).insert({
        project_id: projectId,
        created_by: user.id,
        request_id: input.requestId,
        session_id: input.sessionId,
        type_id: input.typeId,
        type_title: input.typeTitle,
        style_id: input.styleId,
        style_label: input.styleLabel,
        image_url: input.imageUrl,
        prompt_snapshot: input.promptSnapshot ?? null,
        brand_template_id: input.brandTemplateId ?? null,
        metadata: input.metadata ?? {},
      });
      if (error) {
        console.warn("[gallery] save", error.message);
        return false;
      }
      await load();
      return true;
    },
    [projectId, user?.id, load],
  );

  const removeItem = useCallback(
    async (id: string) => {
      const { error } = await (supabase.from("content_factory_gallery" as never) as ReturnType<
        typeof supabase.from
      >)
        .delete()
        .eq("id", id);
      if (error) throw new Error(error.message);
      setItems((prev) => prev.filter((i) => i.id !== id));
    },
    [],
  );

  return { items, loading, load, saveItem, removeItem, projectId };
}
