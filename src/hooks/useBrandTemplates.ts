import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import type { BrandColors, BrandFonts, BrandTemplate } from "@/lib/contentFactoryBrand";
import { getContentFactoryDb } from "@/lib/contentFactoryDb";
import {
  uploadBrandAsset,
  uploadBrandAssets,
} from "@/lib/contentFactoryStorage";

export type BrandTemplateInput = {
  name: string;
  description?: string;
  colors?: BrandColors;
  fonts?: BrandFonts;
  tone?: string;
  style_notes?: string;
  prompt_addon?: string;
  is_default?: boolean;
  logoFile?: File | null;
  referenceFiles?: File[];
  brandbookFiles?: File[];
  logo_url?: string | null;
  reference_urls?: string[];
  brandbook_urls?: string[];
};

function rowToTemplate(row: Record<string, unknown>): BrandTemplate {
  return {
    id: String(row.id),
    project_id: String(row.project_id),
    name: String(row.name),
    description: (row.description as string | null) ?? null,
    colors: (row.colors as BrandColors) ?? {},
    fonts: (row.fonts as BrandFonts) ?? {},
    tone: (row.tone as string | null) ?? null,
    style_notes: (row.style_notes as string | null) ?? null,
    prompt_addon: (row.prompt_addon as string | null) ?? null,
    logo_url: (row.logo_url as string | null) ?? null,
    reference_urls: (row.reference_urls as string[]) ?? [],
    brandbook_urls: (row.brandbook_urls as string[]) ?? [],
    is_default: Boolean(row.is_default),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export function useBrandTemplates() {
  const { user } = useAuth();
  const { activeId: projectId } = useProjectsStore();
  const [templates, setTemplates] = useState<BrandTemplate[]>([]);
  const [loading, setLoading] = useState(false);

  const sb = getContentFactoryDb();

  const load = useCallback(async () => {
    if (!projectId || !sb) {
      setTemplates([]);
      return;
    }
    setLoading(true);
    const { data, error } = await sb
      .from("content_factory_brand_templates")
      .select("*")
      .eq("project_id", projectId)
      .order("is_default", { ascending: false })
      .order("updated_at", { ascending: false });
    setLoading(false);
    if (error) {
      console.warn("[brand-templates] load", error.message);
      return;
    }
    setTemplates((data ?? []).map((r) => rowToTemplate(r as Record<string, unknown>)));
  }, [projectId, sb]);

  useEffect(() => {
    void load();
  }, [load]);

  const createTemplate = useCallback(
    async (input: BrandTemplateInput): Promise<BrandTemplate | null> => {
      if (!projectId || !sb || !input.name.trim()) return null;

      const tempId = crypto.randomUUID();
      let logoUrl = input.logo_url ?? null;
      const referenceUrls = [...(input.reference_urls ?? [])];
      const brandbookUrls = [...(input.brandbook_urls ?? [])];

      if (input.logoFile) {
        logoUrl = await uploadBrandAsset(input.logoFile, projectId, tempId, "logo");
      }
      const uploadedRefs = input.referenceFiles?.length
        ? await uploadBrandAssets(input.referenceFiles, projectId, tempId, "reference")
        : [];
      const uploadedBooks = input.brandbookFiles?.length
        ? await uploadBrandAssets(input.brandbookFiles, projectId, tempId, "brandbook")
        : [];
      const allReferenceUrls = [...referenceUrls, ...uploadedRefs];
      const allBrandbookUrls = [...brandbookUrls, ...uploadedBooks];

      if (input.is_default) {
        await sb
          .from("content_factory_brand_templates")
          .update({ is_default: false })
          .eq("project_id", projectId);
      }

      const { data, error } = await sb
        .from("content_factory_brand_templates")
        .insert({
          id: tempId,
          project_id: projectId,
          created_by: user?.id ?? null,
          name: input.name.trim(),
          description: input.description?.trim() || null,
          colors: input.colors ?? {},
          fonts: input.fonts ?? {},
          tone: input.tone?.trim() || null,
          style_notes: input.style_notes?.trim() || null,
          prompt_addon: input.prompt_addon?.trim() || null,
          logo_url: logoUrl,
          reference_urls: allReferenceUrls,
          brandbook_urls: allBrandbookUrls,
          is_default: input.is_default ?? false,
        })
        .select("*")
        .single();

      if (error) throw new Error(error.message);
      const created = rowToTemplate(data as Record<string, unknown>);
      await load();
      return created;
    },
    [projectId, sb, user?.id, load],
  );

  const deleteTemplate = useCallback(
    async (id: string) => {
      if (!sb) throw new Error("Clony Supabase не настроен");
      const { error } = await sb.from("content_factory_brand_templates").delete().eq("id", id);
      if (error) throw new Error(error.message);
      setTemplates((prev) => prev.filter((t) => t.id !== id));
    },
    [sb],
  );

  const getById = useCallback(
    (id: string | null | undefined): BrandTemplate | null => {
      if (!id) return null;
      return templates.find((t) => t.id === id) ?? null;
    },
    [templates],
  );

  return { templates, loading, load, createTemplate, deleteTemplate, getById, projectId };
}
