/**
 * Единая сборка пользовательского ТЗ для content-factory (шаг 3 + n8n).
 * Превью и реальная отправка должны использовать одни и те же функции.
 */

import {
  copyPromptBlock,
  normalizeCopyMode,
  type CopyMode,
} from "@/lib/contentFactoryCopy";
import { clearWizardFiles } from "@/lib/wizardFilesStore";
import { toSerializableWizardState } from "@/lib/contentFactoryAspect";

export type WizardMode = "link" | "photo" | "description" | string | null;

export interface WizardInputState {
  mode?: WizardMode;
  linkUrl?: string;
  description?: string;
  productName?: string;
  extraInstructions?: string;
  /** auto = AI пишет текст; custom = дословный overlay */
  copyMode?: CopyMode;
  /** Точный текст для наложения (режим custom) */
  overlayText?: string;
  photos?: File[];
  photosCount?: number;
  /** Логотип для фирменного стиля (шаг 1, режимы photo/description). */
  logoFile?: File | null;
  /** Флаг из шага 1 — File не сохраняется в sessionStorage. */
  hasLogo?: boolean;
  /** Публичный URL после upload в Storage (шаг 3). */
  logoUrl?: string | null;
  /** Фото людей — отдельно от контентных фото (шаг 1, режим photo). */
  peoplePhotos?: File[];
  peoplePhotosCount?: number;
  typeId?: string;
  aspect?: string;
  lang?: string;
  variants?: number;
  brandTemplateId?: string | null;
  /** Нейрофото: стили/ракурсы с одностраничного визарда */
  selectedStyles?: string[];
  selectedAngles?: string[];
  /** Автозапуск генерации без показа шага 3 */
  neuroAutoSubmit?: boolean;
  /** Шаг 3 — маркетинг и цвет (сохраняются в sessionStorage). */
  colorId?: string;
  ctaId?: string;
  /** Пользовательское код-слово для CTA (например «Хаб»). */
  codeWord?: string;
  toneId?: string;
  goalId?: string;
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
export function persistWizardState(
  patch: WizardInputState & { clearFormat?: boolean },
): void {
  try {
    const prev = JSON.parse(sessionStorage.getItem(WIZARD_STORAGE_KEY) || "{}") as WizardInputState;
    const { clearFormat, ...raw } = patch;
    const serializable = toSerializableWizardState(raw as Record<string, unknown>);
    const next: WizardInputState = { ...prev, ...serializable };
    // Новый прогон с шага 1 — сбрасываем формат, иначе залипает старый 4:5 из прошлой сессии.
    if (clearFormat) {
      delete next.aspect;
      delete next.variants;
      delete next.lang;
      delete next.selectedStyles;
      delete next.selectedAngles;
      delete next.ctaId;
      delete next.codeWord;
      delete next.toneId;
      delete next.goalId;
      delete next.colorId;
    }
    sessionStorage.setItem(WIZARD_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export function loadWizardState(locationState: WizardInputState): WizardInputState {
  try {
    const saved = JSON.parse(sessionStorage.getItem(WIZARD_STORAGE_KEY) || "{}") as WizardInputState;
    // location.state может потерять File и часть полей — sessionStorage приоритетнее для format,
    // но явные значения из location (если есть) перекрывают saved.
    const loc = toSerializableWizardState((locationState ?? {}) as Record<string, unknown>);
    const merged: WizardInputState = { ...saved, ...loc };
    // Пустые строки/undefined из loc не должны затирать aspect/variants из saved.
    if (loc.aspect == null || loc.aspect === "") {
      if (saved.aspect) merged.aspect = saved.aspect;
    }
    if (loc.variants == null) {
      if (typeof saved.variants === "number") merged.variants = saved.variants;
    }
    if (loc.lang == null || loc.lang === "") {
      if (saved.lang) merged.lang = saved.lang;
    }
    return merged;
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
  clearWizardFiles();
}

export function buildUserBriefParts(state: WizardInputState): string[] {
  const mode = state.mode ?? null;
  const linkUrl = (state.linkUrl ?? "").trim();
  const description = (state.description ?? "").trim();
  const productName = (state.productName ?? "").trim();
  const copyMode = normalizeCopyMode(state.copyMode);
  const overlayText = (state.overlayText ?? "").trim();
  const extraInstructions = (state.extraInstructions ?? "").trim();
  const photos = state.photos ?? [];
  const photosCount = state.photosCount ?? photos.length;
  const peoplePhotos = state.peoplePhotos ?? [];
  const peopleCount = state.peoplePhotosCount ?? peoplePhotos.length;
  const logoUrl = (state.logoUrl ?? "").trim();
  const hasLogo = Boolean(state.logoFile || state.hasLogo || logoUrl);

  const parts: string[] = [];
  if (productName) parts.push(`Товар / бренд: ${productName}`);
  if (description) parts.push(description);
  if (linkUrl) parts.push(`Ссылка на источник: ${linkUrl}`);
  if (hasLogo) {
    if (logoUrl) {
      parts.push(
        `Логотип бренда (обязательно использовать в креативе): ${logoUrl}`,
        "Изучи логотип по ссылке: форму, цвета, типографику — примени фирменный визуальный язык ко всему контенту.",
      );
    } else {
      parts.push(
        "Загружен логотип бренда. Внимательно изучи его дизайн, цвета и стиль — примени фирменный визуальный язык ко всему контенту.",
      );
    }
  }
  if (mode === "photo") {
    if (photosCount > 0) {
      parts.push(
        `Создать креативы на основе ${photosCount} загруженных фото товара/контента. ` +
          "Используй визуал и детали из приложенных изображений.",
      );
    }
    if (peopleCount > 0) {
      parts.push(
        `Отдельно загружено ${peopleCount} фото людей — используй их как референс лиц и персонажей в креативах.`,
      );
    }
  }
  parts.push(copyPromptBlock(copyMode, overlayText));
  if (extraInstructions) {
    parts.push(`Дополнительные пожелания для AI:\n${extraInstructions}`);
  }
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
  const hasCustomOverlay =
    normalizeCopyMode(state.copyMode) === "custom" &&
    Boolean((state.overlayText ?? "").trim());
  const hasText =
    Boolean((state.productName ?? "").trim()) ||
    Boolean((state.description ?? "").trim()) ||
    Boolean((state.extraInstructions ?? "").trim()) ||
    hasCustomOverlay;
  const hasLink = mode === "link" && Boolean((state.linkUrl ?? "").trim());
  const hasPhotos =
    mode === "photo" &&
    ((state.photos?.length ?? 0) > 0 ||
      (state.photosCount ?? 0) > 0 ||
      (state.peoplePhotos?.length ?? 0) > 0 ||
      (state.peoplePhotosCount ?? 0) > 0);
  const hasLogo = Boolean(state.logoFile || state.hasLogo || (state.logoUrl ?? "").trim());
  return !hasText && !hasLink && !hasPhotos && !hasLogo;
}

/** Минимальная проверка перед отправкой в n8n — не уходит пустой/шаблонный промт. */
export function assertPromptWebhookContract(
  prompt: string,
  state: WizardInputState,
): { ok: true } | { ok: false; reason: string } {
  const text = prompt.trim();
  if (text.length < 120) {
    return { ok: false, reason: "Промт слишком короткий — вернитесь на шаг 1 и заполните бриф" };
  }
  const hasUserInput =
    Boolean((state.description ?? "").trim()) ||
    Boolean((state.productName ?? "").trim()) ||
    Boolean((state.linkUrl ?? "").trim()) ||
    Boolean(state.hasLogo || state.logoFile || (state.logoUrl ?? "").trim());
  const genericOnly = text.includes("клиент не оставил описание") && !hasUserInput;
  if (genericOnly) {
    return {
      ok: false,
      reason: "В промте нет вашего ТЗ — добавьте описание, ссылку или логотип на шаге 1",
    };
  }
  return { ok: true };
}
