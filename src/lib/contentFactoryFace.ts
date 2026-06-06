/**
 * Нейрофотосессия с лицом человека: референс из people_photo_urls → баннер/креатив с узнаваемым лицом.
 */

export type GenerationPipeline = "ad_creative" | "neuro_photo_session" | "neuro_face_banner";

export interface FacePipelineContext {
  typeId: string;
  isNeuroPhotoType: boolean;
  inputMode: string | null;
  peoplePhotosCount: number;
}

export interface FacePipelineResolution {
  enabled: boolean;
  pipeline: GenerationPipeline;
  task: "neuro_photo_session" | "ad_creative";
  /** n8n: "face" при референсе лица, иначе "brand_assets" */
  photosRole: "face" | "brand_assets";
}

export function resolveFacePipeline(ctx: FacePipelineContext): FacePipelineResolution {
  const hasPeople =
    ctx.inputMode === "photo" && ctx.peoplePhotosCount > 0;

  if (ctx.isNeuroPhotoType && hasPeople) {
    return {
      enabled: true,
      pipeline: "neuro_photo_session",
      task: "neuro_photo_session",
      photosRole: "face",
    };
  }

  if (ctx.isNeuroPhotoType) {
    return {
      enabled: true,
      pipeline: "neuro_photo_session",
      task: "neuro_photo_session",
      photosRole: "face",
    };
  }

  if (hasPeople) {
    return {
      enabled: true,
      pipeline: "neuro_face_banner",
      task: "neuro_photo_session",
      photosRole: "face",
    };
  }

  return {
    enabled: false,
    pipeline: "ad_creative",
    task: "ad_creative",
    photosRole: "brand_assets",
  };
}

export function neuroFacePromptBlock(
  peopleCount: number,
  pipeline: GenerationPipeline,
  outputFormatLabel?: string,
): string {
  if (peopleCount <= 0 && pipeline !== "neuro_photo_session") return "";

  const formatHint = outputFormatLabel
    ? `Формат выхода: ${outputFormatLabel}. `
    : "";

  if (pipeline === "neuro_face_banner") {
    return [
      `Нейрофотосессия с лицом человека (${peopleCount} фото в people_photo_urls).`,
      formatHint +
        "Создай рекламный баннер/креатив с УЗНАВАЕМЫМ лицом человека с референс-фото.",
      "Сохрани черты лица, пропорции, тон кожи, причёску — не подменяй случайной моделью.",
      "Лицо — главный визуальный якорь креатива; текст и бренд вокруг лица.",
      "primary_face_url — главный референс лица для face-swap / IP-Adapter / identity preservation.",
    ].join("\n");
  }

  return [
    `Нейрофотосессия (${peopleCount || "без"} референс-фото людей).`,
    "Студийное качество с сохранением identity человека с primary_face_url.",
    "Разные ракурсы и стили — но лицо должно оставаться узнаваемым.",
  ].join("\n");
}

/** Плоские поля для n8n webhook. */
export function buildFaceWebhookFields(params: {
  resolution: FacePipelineResolution;
  peoplePhotoUrls: string[];
  outputContentType: string;
  outputFormatLabel?: string;
}): Record<string, unknown> {
  const { resolution, peoplePhotoUrls, outputContentType, outputFormatLabel } = params;
  const primaryFaceUrl = peoplePhotoUrls[0] ?? "";

  return {
    face_reference_enabled: resolution.enabled,
    generation_pipeline: resolution.pipeline,
    neuro_photo_session: resolution.task === "neuro_photo_session",
    face_preserve_identity: resolution.enabled,
    primary_face_url: primaryFaceUrl,
    face_photo_count: peoplePhotoUrls.length,
    output_content_type: outputContentType,
    output_format_label: outputFormatLabel ?? outputContentType,
    photos_role: resolution.photosRole,
  };
}
