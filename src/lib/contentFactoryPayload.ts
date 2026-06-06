/**
 * Сборка полей n8n webhook для Контент-завода (тестируемый контракт).
 * Workflow: dCQ20aXv6B9LRjDe (Clony AI MarkVision).
 */
import type { Step3Flow } from "@/data/contentTypeFlows";
import type { FacePipelineResolution } from "@/lib/contentFactoryFace";
import { mergeImageUrls } from "@/lib/contentFactoryLogo";
import { resolveContentTypeRoute } from "@/lib/contentFactoryRoutes";

export interface MarketingSelection {
  id: string;
  label: string;
  phrase?: string;
  description: string;
}

export interface BuildImageUrlsInput {
  isNeuroPhoto: boolean;
  facePipeline: FacePipelineResolution;
  logoUrl: string | null;
  peoplePhotoUrls: string[];
  productPhotoUrls: string[];
  brandUrls: string[];
}

/** Порядок image_urls по ТЗ; нейро — пусто; face_banner — лицо только в people_photo_urls. */
export function buildContentFactoryImageUrls(input: BuildImageUrlsInput): string[] {
  const { isNeuroPhoto, facePipeline, logoUrl, peoplePhotoUrls, productPhotoUrls, brandUrls } =
    input;

  if (isNeuroPhoto) return [];

  const peopleForMerge =
    facePipeline.pipeline === "neuro_face_banner" ? [] : peoplePhotoUrls;

  return mergeImageUrls({
    logoUrl,
    peopleUrls: peopleForMerge,
    assetUrls: productPhotoUrls,
    brandUrls,
  });
}

export interface FormatFieldsInput {
  isNeuroPhoto: boolean;
  styleId: string;
  styleLabel: string;
  creativeFormatFields: Record<string, unknown> | null;
}

export function buildContentFactoryFormatFields(input: FormatFieldsInput): Record<string, unknown> {
  const { isNeuroPhoto, styleId, styleLabel, creativeFormatFields } = input;

  if (isNeuroPhoto) {
    return {
      style_id: styleId,
      n8n_pipeline:
        styleId === "auto" ? "neuro_auto" : `neuro_${String(styleId).replace("neuro_", "")}`,
      style: styleLabel,
    };
  }

  if (creativeFormatFields) return creativeFormatFields;

  return {
    style_id: styleId,
    creative_format: styleId,
    creative_format_label: styleLabel,
    n8n_pipeline: `neuro_${String(styleId).replace("neuro_", "")}`,
    style: styleLabel,
  };
}

export interface MarketingWebhookInput {
  step3: Step3Flow;
  isNeuroPhoto: boolean;
  cta: MarketingSelection;
  tone: MarketingSelection;
  goal: MarketingSelection;
}

const EMPTY_MARKETING = {
  cta: { id: "", label: "", phrase: "", description: "" },
  tone: { id: "", label: "", description: "" },
  goal: { id: "", label: "", description: "" },
};

/** Плоские маркетинговые поля + вложенный marketing (синхронно). */
export function buildMarketingWebhookFields(input: MarketingWebhookInput): {
  flat: Record<string, string>;
  nested: typeof EMPTY_MARKETING;
} {
  const { step3, isNeuroPhoto, cta, tone, goal } = input;

  if (isNeuroPhoto) {
    return {
      flat: {
        ctas: "",
        cta_id: "",
        cta_label: "",
        cta_phrase: "",
        tone: "",
        tone_label: "",
        tone_description: "",
        goal: "",
        goal_label: "",
        goal_description: "",
      },
      nested: EMPTY_MARKETING,
    };
  }

  const includeCta = step3.showCta;
  const includeTone = step3.showTone;
  const includeGoal = step3.showGoal;

  return {
    flat: {
      ctas: includeCta ? (cta.phrase ?? "") : "",
      cta_id: includeCta ? cta.id : "",
      cta_label: includeCta ? cta.label : "",
      cta_phrase: includeCta ? (cta.phrase ?? "") : "",
      tone: includeTone ? tone.id : "",
      tone_label: includeTone ? tone.label : "",
      tone_description: includeTone ? tone.description : "",
      goal: includeGoal ? goal.id : "",
      goal_label: includeGoal ? goal.label : "",
      goal_description: includeGoal ? goal.description : "",
    },
    nested: {
      cta: includeCta
        ? { id: cta.id, label: cta.label, phrase: cta.phrase ?? "", description: cta.description }
        : EMPTY_MARKETING.cta,
      tone: includeTone
        ? { id: tone.id, label: tone.label, description: tone.description }
        : EMPTY_MARKETING.tone,
      goal: includeGoal
        ? { id: goal.id, label: goal.label, description: goal.description }
        : EMPTY_MARKETING.goal,
    },
  };
}

export interface NeuroPayloadAssertInput {
  content_type: string;
  route: string;
  task: string;
  generation_pipeline: string;
  neuro_photo_session: boolean;
  face_reference_enabled: boolean;
  photos_role: string;
  people_photo_urls: string[];
  primary_face_url: string;
  image_urls: string[];
}

/** Минимальная валидация контракта нейрофото перед отправкой в n8n. */
export function assertNeuroPhotoPayload(
  flat: NeuroPayloadAssertInput,
): { ok: true } | { ok: false; reason: string } {
  if (flat.content_type !== "neuro-photo" || flat.route !== "neuro-photo") {
    return { ok: false, reason: `content_type/route must be neuro-photo, got ${flat.content_type}` };
  }
  if (flat.task !== "neuro_photo_session" || flat.generation_pipeline !== "neuro_photo_session") {
    return {
      ok: false,
      reason: `task/pipeline must be neuro_photo_session, got ${flat.task}/${flat.generation_pipeline}`,
    };
  }
  if (!flat.neuro_photo_session || !flat.face_reference_enabled) {
    return { ok: false, reason: "neuro_photo_session and face_reference_enabled must be true" };
  }
  if (flat.photos_role !== "face") {
    return { ok: false, reason: `photos_role must be face, got ${flat.photos_role}` };
  }
  if (!flat.primary_face_url || flat.people_photo_urls.length === 0) {
    return { ok: false, reason: "primary_face_url and people_photo_urls required" };
  }
  if (!flat.primary_face_url.includes("/storage/v1/object/public/")) {
    return {
      ok: false,
      reason: "primary_face_url must be a Supabase Storage public URL",
    };
  }
  if (flat.image_urls.length > 0) {
    return { ok: false, reason: "image_urls must be empty for neuro-photo" };
  }
  return { ok: true };
}

export function resolveWebhookRoute(typeId: string): string {
  return resolveContentTypeRoute(typeId);
}
