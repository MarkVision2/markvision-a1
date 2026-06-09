/**
 * Сборка полного JSON для n8n webhook Контент-завода.
 * Контракт: плоские поля на корне + полный дубль в body (ноды читают $json.body ?? $json).
 */
import { finalizeN8nWebhookBody } from "@/lib/contentFactoryPayload";

export interface ContentFactoryWebhookInput {
  flat: Record<string, unknown>;
  finalTechnicalBrief: string;
  userRawPrompt: string;
  task: string;
  route: string;
  typeId: string;
  category: string | null;
  sourceInput: Record<string, unknown>;
  formatBlock: Record<string, unknown>;
  designBlock: Record<string, unknown>;
  marketingBlock: Record<string, unknown>;
  contentTypeBlock: Record<string, unknown> | null;
  angles?: Array<{ id: string; label: string; description: string }>;
  autoCandidates?: Array<{ id: string; label: string; description: string }> | null;
}

/** Собирает body и root payload — всё ТЗ доступно n8n в body.* */
export function buildContentFactoryWebhookPayload(
  input: ContentFactoryWebhookInput,
): Record<string, unknown> {
  const promptFields = finalizeN8nWebhookBody(input.flat, {
    finalTechnicalBrief: input.finalTechnicalBrief,
    userRawPrompt: input.userRawPrompt,
  });

  const body: Record<string, unknown> = {
    ...promptFields,
    task: input.task,
    route: input.route,
    typeId: input.typeId,
    category: input.category,
    source_input: input.sourceInput,
    format: input.formatBlock,
    design: input.designBlock,
    marketing: input.marketingBlock,
    contentType: input.contentTypeBlock,
  };

  if (input.angles?.length) {
    body.angles = input.angles;
    body.angle_ids = input.angles.map((a) => a.id);
  }
  if (input.autoCandidates?.length) {
    body.auto_candidates = input.autoCandidates;
  }

  const submittedAt = new Date().toISOString();

  return {
    source: "lovable.content-factory",
    submittedAt,
    task: input.task,
    route: input.route,
    typeId: input.typeId,
    category: input.category,
    ...promptFields,
    body,
    contentType: input.contentTypeBlock,
    source_input: input.sourceInput,
    format: input.formatBlock,
    design: input.designBlock,
    marketing: input.marketingBlock,
    finalPrompt: promptFields.finalPrompt,
    user_raw_prompt: promptFields.user_raw_prompt,
  };
}

/** fb_niche / контекст продукта — все источники ТЗ без привязки к mode. */
export function buildNicheContext(parts: {
  productName?: string;
  description?: string;
  linkUrl?: string;
  extraInstructions?: string;
}): string {
  return [parts.productName, parts.description, parts.linkUrl, parts.extraInstructions]
    .filter((s): s is string => Boolean(s && s.trim()))
    .join(" | ");
}
