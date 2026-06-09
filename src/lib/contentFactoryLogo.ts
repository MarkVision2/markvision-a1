/**
 * Логотип и фото людей в мастере контент-завода — поля для n8n webhook и блоки в ТЗ.
 */

export type LogoSourceType = "wizard_upload" | "brand_template" | "";

/** Плоские поля логотипа для n8n (дублируются в body.*). */
export function buildLogoWebhookFields(
  logoUrl: string | null,
  source: LogoSourceType = "wizard_upload",
): Record<string, unknown> {
  if (!logoUrl) {
    return {
      logo_url: "",
      brand_logo_url: "",
      logo_type: "",
      logo_style_instruction: "",
    };
  }

  return {
    logo_url: logoUrl,
    // n8n brand-ноды иногда читают brand_logo_url вместо logo_url
    brand_logo_url: logoUrl,
    logo_type: source,
    logo_style_instruction: LOGO_STYLE_INSTRUCTION,
  };
}

/** Проверка контракта перед отправкой в n8n. */
export function assertLogoWebhookContract(
  hadLogoFile: boolean,
  flat: Record<string, unknown>,
  imageUrls: string[],
): { ok: true } | { ok: false; reason: string } {
  if (!hadLogoFile) return { ok: true };

  const logoUrl = flat.logo_url;
  if (typeof logoUrl !== "string" || !/^https:\/\//.test(logoUrl)) {
    return { ok: false, reason: "logo_url не содержит публичную HTTPS-ссылку" };
  }

  const brandLogo = flat.brand_logo_url;
  if (typeof brandLogo !== "string" || brandLogo !== logoUrl) {
    return { ok: false, reason: "brand_logo_url не совпадает с logo_url" };
  }

  if (!imageUrls.length || imageUrls[0] !== logoUrl) {
    return { ok: false, reason: "logo_url должен быть первым в image_urls" };
  }

  return { ok: true };
}

export const LOGO_STYLE_INSTRUCTION =
  "Внимательно изучи описание и дизайн логотипа по ссылке logo_url: форму, цвета, типографику, " +
  "композицию и визуальный язык. Примени этот фирменный стиль ко всему создаваемому контенту — " +
  "палитру, шрифты, графические элементы и общую эстетику должны соответствовать логотипу.";

export function logoPromptBlock(logoUrl: string | null): string {
  if (!logoUrl) return "";
  return [
    `Логотип бренда: ${logoUrl}`,
    LOGO_STYLE_INSTRUCTION,
    "Логотип должен быть органично интегрирован в креатив (водяной знак, угол, шапка или фирменный блок).",
  ].join("\n");
}

export function peoplePhotosPromptBlock(count: number): string {
  if (count <= 0) return "";
  return [
    `Загружено ${count} фото людей (people_photo_urls).`,
    "Используй эти изображения как референс лиц, внешности и персонажей в контенте.",
    "Сохраняй узнаваемость людей с фото — не заменяй их случайными моделями.",
  ].join("\n");
}

/** URL для image_urls: логотип первым, затем люди, затем остальное. */
export function mergeImageUrls(parts: {
  logoUrl?: string | null;
  peopleUrls?: string[];
  assetUrls?: string[];
  brandUrls?: string[];
}): string[] {
  const out: string[] = [];
  const push = (u: string | null | undefined) => {
    if (u && !out.includes(u)) out.push(u);
  };
  push(parts.logoUrl);
  for (const u of parts.peopleUrls ?? []) push(u);
  for (const u of parts.assetUrls ?? []) push(u);
  for (const u of parts.brandUrls ?? []) push(u);
  return out;
}
