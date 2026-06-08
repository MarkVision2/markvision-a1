import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import type { BrandColors, BrandFonts, BrandTemplate } from "@/lib/contentFactoryBrand";
import { getContentFactoryDb } from "@/lib/contentFactoryDb";
import {
  uploadBrandAsset,
  uploadBrandAssets,
} from "@/lib/contentFactoryStorage";

export type { BrandTemplate } from "@/lib/contentFactoryBrand";

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

function assertUploads(input: {
  logoFile?: File | null;
  logoUrl: string | null;
  referenceFiles?: File[];
  uploadedRefs: string[];
  brandbookFiles?: File[];
  uploadedBooks: string[];
}) {
  if (input.logoFile && !input.logoUrl) {
    throw new Error("Не удалось загрузить логотип. Проверьте Clony Supabase Storage (bucket content-factory).");
  }
  const refExpected = input.referenceFiles?.length ?? 0;
  if (refExpected > 0 && input.uploadedRefs.length < refExpected) {
    throw new Error(
      `Загружено ${input.uploadedRefs.length} из ${refExpected} референсов. Повторите или уменьшите размер файлов.`,
    );
  }
  const bookExpected = input.brandbookFiles?.length ?? 0;
  if (bookExpected > 0 && input.uploadedBooks.length < bookExpected) {
    throw new Error(
      `Загружено ${input.uploadedBooks.length} из ${bookExpected} файлов брендбука. Повторите загрузку.`,
    );
  }
}

async function uploadBrandFiles(
  input: BrandTemplateInput,
  projectId: string,
  templateId: string,
  existing?: Pick<BrandTemplate, "logo_url" | "reference_urls" | "brandbook_urls">,
) {
  let logoUrl = input.logo_url ?? existing?.logo_url ?? null;
  const referenceUrls = [...(input.reference_urls ?? existing?.reference_urls ?? [])];
  const brandbookUrls = [...(input.brandbook_urls ?? existing?.brandbook_urls ?? [])];

  if (input.logoFile) {
    logoUrl = await uploadBrandAsset(input.logoFile, projectId, templateId, "logo");
  }
  const uploadedRefs = input.referenceFiles?.length
    ? await uploadBrandAssets(input.referenceFiles, projectId, templateId, "reference")
    : [];
  const uploadedBooks = input.brandbookFiles?.length
    ? await uploadBrandAssets(input.brandbookFiles, projectId, templateId, "brandbook")
    : [];

  assertUploads({
    logoFile: input.logoFile,
    logoUrl,
    referenceFiles: input.referenceFiles,
    uploadedRefs,
    brandbookFiles: input.brandbookFiles,
    uploadedBooks,
  });

  return {
    logoUrl,
    referenceUrls: [...referenceUrls, ...uploadedRefs],
    brandbookUrls: [...brandbookUrls, ...uploadedBooks],
  };
}

function buildRowPayload(input: BrandTemplateInput, userId: string | undefined, files: {
  logoUrl: string | null;
  referenceUrls: string[];
  brandbookUrls: string[];
}) {
  return {
    name: input.name.trim(),
    description: input.description?.trim() || null,
    colors: input.colors ?? {},
    fonts: input.fonts ?? {},
    tone: input.tone?.trim() || null,
    style_notes: input.style_notes?.trim() || null,
    prompt_addon: input.prompt_addon?.trim() || null,
    logo_url: files.logoUrl,
    reference_urls: files.referenceUrls,
    brandbook_urls: files.brandbookUrls,
    is_default: input.is_default ?? false,
    updated_at: new Date().toISOString(),
    ...(userId ? { created_by: userId } : {}),
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

  const clearDefault = useCallback(async () => {
    if (!projectId || !sb) return;
    await sb
      .from("content_factory_brand_templates")
      .update({ is_default: false })
      .eq("project_id", projectId);
  }, [projectId, sb]);

  const createTemplate = useCallback(
    async (input: BrandTemplateInput): Promise<BrandTemplate | null> => {
      if (!projectId || !sb || !input.name.trim()) {
        throw new Error("Выберите проект и укажите название шаблона");
      }

      const tempId = crypto.randomUUID();
      const files = await uploadBrandFiles(input, projectId, tempId);

      if (input.is_default) await clearDefault();

      const { data, error } = await sb
        .from("content_factory_brand_templates")
        .insert({
          id: tempId,
          project_id: projectId,
          ...buildRowPayload(input, user?.id, files),
        })
        .select("*")
        .single();

      if (error) throw new Error(error.message);
      const created = rowToTemplate(data as Record<string, unknown>);
      await load();
      return created;
    },
    [projectId, sb, user?.id, load, clearDefault],
  );

  const updateTemplate = useCallback(
    async (id: string, input: BrandTemplateInput): Promise<BrandTemplate | null> => {
      if (!projectId || !sb || !input.name.trim()) {
        throw new Error("Выберите проект и укажите название шаблона");
      }

      const existing = templates.find((t) => t.id === id);
      if (!existing) throw new Error("Шаблон не найден");

      const files = await uploadBrandFiles(input, projectId, id, existing);

      if (input.is_default) await clearDefault();

      const { data, error } = await sb
        .from("content_factory_brand_templates")
        .update(buildRowPayload(input, user?.id, files))
        .eq("id", id)
        .eq("project_id", projectId)
        .select("*")
        .single();

      if (error) throw new Error(error.message);
      const updated = rowToTemplate(data as Record<string, unknown>);
      await load();
      return updated;
    },
    [projectId, sb, user?.id, templates, load, clearDefault],
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

  return {
    templates,
    loading,
    load,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    getById,
    projectId,
    isConfigured: Boolean(sb),
  };
}
