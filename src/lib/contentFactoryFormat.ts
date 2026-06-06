import {
  CREATIVE_FORMAT_BY_ID,
  type CreativeFormat,
  type CreativeFormatId,
} from "@/data/creativeFormats";

export function resolveCreativeFormat(id: string): CreativeFormat | null {
  return CREATIVE_FORMAT_BY_ID[id as CreativeFormatId] ?? null;
}

/** Плоские поля для n8n webhook — читать body.creative_format / body.style_id. */
export function buildFormatWebhookFields(format: CreativeFormat) {
  return {
    style_id: format.id,
    creative_format: format.id,
    creative_format_label: format.label,
    creative_format_tag: format.tag,
    creative_format_category: format.category,
    n8n_pipeline: format.n8nPipeline,
    format_output_hint: format.outputHint,
    // Обратная совместимость: body.style — человекочитаемая метка
    style: format.label,
  };
}
