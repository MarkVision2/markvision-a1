/**
 * Единая сборка пользовательского ТЗ для content-factory (шаг 3 + n8n).
 * Превью и реальная отправка должны использовать одни и те же функции.
 */

export type WizardMode = "link" | "photo" | "description" | string | null;

export interface WizardInputState {
  mode?: WizardMode;
  linkUrl?: string;
  description?: string;
  productName?: string;
  extraInstructions?: string;
  photos?: File[];
  photosCount?: number;
  typeId?: string;
  aspect?: string;
  lang?: string;
  variants?: number;
  brandTemplateId?: string | null;
}

export interface MarketingMeta {
  goalLabel: string;
  goalDescription: string;
  toneLabel: string;
  toneDescription: string;
  ctaPhrase: string;
}

const WIZARD_STORAGE_KEY = "mv:create-wizard:v1";

/** Сохраняем текстовые поля мастера (File в storage не кладём). */
export function persistWizardState(patch: WizardInputState): void {
  try {
    const prev = JSON.parse(sessionStorage.getItem(WIZARD_STORAGE_KEY) || "{}") as WizardInputState;
    const { photos: _p, ...rest } = patch;
    sessionStorage.setItem(WIZARD_STORAGE_KEY, JSON.stringify({ ...prev, ...rest }));
  } catch {
    /* ignore */
  }
}

export function loadWizardState(locationState: WizardInputState): WizardInputState {
  try {
    const saved = JSON.parse(sessionStorage.getItem(WIZARD_STORAGE_KEY) || "{}") as WizardInputState;
    return { ...saved, ...locationState };
  } catch {
    return locationState;
  }
}

export function clearWizardState(): void {
  try {
    sessionStorage.removeItem(WIZARD_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function buildUserBriefParts(state: WizardInputState): string[] {
  const mode = state.mode ?? null;
  const linkUrl = (state.linkUrl ?? "").trim();
  const description = (state.description ?? "").trim();
  const productName = (state.productName ?? "").trim();
  const extraInstructions = (state.extraInstructions ?? "").trim();
  const photos = state.photos ?? [];
  const photosCount = state.photosCount ?? photos.length;

  const parts: string[] = [];
  if (productName) parts.push(`Товар / бренд: ${productName}`);
  if (mode === "link" && linkUrl) parts.push(`Ссылка на источник: ${linkUrl}`);
  if (mode === "description" && description) parts.push(description);
  if (mode === "photo") {
    parts.push(
      `Создать креативы на основе ${photosCount} загруженных фото (включая логотип, если он среди них). ` +
        "Используй визуал, цвета и фирменный стиль из приложенных изображений.",
    );
  }
  if (extraInstructions) parts.push(`Дополнительные инструкции:\n${extraInstructions}`);
  return parts;
}

export function buildUserBriefText(state: WizardInputState): string {
  return buildUserBriefParts(state).join("\n\n");
}

export function buildBriefWithMarketing(state: WizardInputState, marketing: MarketingMeta): string {
  return [
    `Цель контента: ${marketing.goalLabel} — ${marketing.goalDescription}.`,
    `Стиль подачи: ${marketing.toneLabel} — ${marketing.toneDescription}.`,
    `Призыв к действию (CTA): "${marketing.ctaPhrase}". Должен быть органично вписан в подпись/оверлей.`,
    buildUserBriefText(state),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Имя продукта для n8n (поле name). */
export function resolveProductName(
  state: WizardInputState,
  contentTypeTitle?: string | null,
): string {
  const productName = (state.productName ?? "").trim();
  if (productName) return productName;
  const link = (state.linkUrl ?? "").trim();
  if (link) {
    try {
      const host = new URL(link).hostname.replace(/^www\./, "");
      return host || "Креатив";
    } catch {
      return "Креатив";
    }
  }
  return contentTypeTitle?.trim() || "Креатив";
}

/**
 * Описание для n8n (поле description).
 * n8n-ноды иногда читают description вместо prompt — не оставляем пустым.
 */
export function resolveProductDescription(
  state: WizardInputState,
  fullPrompt: string,
): string {
  const description = (state.description ?? "").trim();
  if (description) return description;
  const userBrief = buildUserBriefText(state);
  if (userBrief.trim()) return userBrief;
  if (fullPrompt.trim()) return fullPrompt.slice(0, 4000);
  return "клиент не оставил описание — используй best-practice по нише";
}

export function isBriefTooEmpty(state: WizardInputState): boolean {
  const mode = state.mode ?? null;
  const hasText =
    Boolean((state.productName ?? "").trim()) ||
    Boolean((state.description ?? "").trim()) ||
    Boolean((state.extraInstructions ?? "").trim());
  const hasLink = mode === "link" && Boolean((state.linkUrl ?? "").trim());
  const hasPhotos = mode === "photo" && ((state.photos?.length ?? 0) > 0 || (state.photosCount ?? 0) > 0);
  return !hasText && !hasLink && !hasPhotos;
}
