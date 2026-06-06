/**
 * Бренд-шаблоны контент-завода: типы и поля для n8n webhook.
 */

export interface BrandColors {
  primary?: string;
  secondary?: string;
  accent?: string;
}

export interface BrandFonts {
  heading?: string;
  body?: string;
}

export interface BrandTemplate {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  colors: BrandColors;
  fonts: BrandFonts;
  tone: string | null;
  style_notes: string | null;
  prompt_addon: string | null;
  logo_url: string | null;
  reference_urls: string[];
  brandbook_urls: string[];
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export function brandPromptBlock(template: BrandTemplate): string {
  const lines: string[] = [
    `Бренд-шаблон: ${template.name}.`,
  ];
  if (template.description?.trim()) lines.push(`Описание бренда: ${template.description.trim()}`);
  if (template.tone?.trim()) lines.push(`Тон бренда: ${template.tone.trim()}`);
  if (template.style_notes?.trim()) lines.push(`Стиль и визуал: ${template.style_notes.trim()}`);
  const c = template.colors ?? {};
  const colorBits = [c.primary, c.secondary, c.accent].filter(Boolean);
  if (colorBits.length) lines.push(`Фирменные цвета: ${colorBits.join(", ")}.`);
  const f = template.fonts ?? {};
  if (f.heading || f.body) {
    lines.push(
      `Шрифты: заголовки — ${f.heading || "по бренду"}, основной текст — ${f.body || "по бренду"}.`,
    );
  }
  if (template.prompt_addon?.trim()) lines.push(template.prompt_addon.trim());
  if (template.logo_url) lines.push("Используй логотип из brand_logo_url / image_urls.");
  if (template.reference_urls?.length) {
    lines.push(`Референсы стиля (${template.reference_urls.length} шт.) — в brand_reference_urls / image_urls.`);
  }
  if (template.brandbook_urls?.length) {
    lines.push(`Материалы брендбука (${template.brandbook_urls.length} шт.) — в brand_brandbook_urls.`);
  }
  return lines.join("\n");
}

/** Плоские + вложенные поля для n8n (дублируются в body.*). */
export function buildBrandWebhookFields(template: BrandTemplate | null): Record<string, unknown> {
  if (!template) {
    return {
      brand_template_id: null,
      brand_name: "",
      brand_logo_url: "",
      brand_reference_urls: [],
      brand_brandbook_urls: [],
      brand_prompt_addon: "",
      brand_template: null,
    };
  }

  const colors = template.colors ?? {};
  const fonts = template.fonts ?? {};

  return {
    brand_template_id: template.id,
    brand_name: template.name,
    brand_description: template.description ?? "",
    brand_colors_primary: colors.primary ?? "",
    brand_colors_secondary: colors.secondary ?? "",
    brand_colors_accent: colors.accent ?? "",
    brand_colors: JSON.stringify(colors),
    brand_fonts_heading: fonts.heading ?? "",
    brand_fonts_body: fonts.body ?? "",
    brand_fonts: JSON.stringify(fonts),
    brand_tone: template.tone ?? "",
    brand_style_notes: template.style_notes ?? "",
    brand_logo_url: template.logo_url ?? "",
    brand_reference_urls: template.reference_urls ?? [],
    brand_brandbook_urls: template.brandbook_urls ?? [],
    brand_prompt_addon: template.prompt_addon ?? "",
    brand_template: {
      id: template.id,
      name: template.name,
      description: template.description,
      colors,
      fonts,
      tone: template.tone,
      style_notes: template.style_notes,
      logo_url: template.logo_url,
      reference_urls: template.reference_urls,
      brandbook_urls: template.brandbook_urls,
      prompt_addon: template.prompt_addon,
    },
  };
}

/** URL бренда для image_urls (логотип + референсы). */
export function brandImageUrls(template: BrandTemplate | null): string[] {
  if (!template) return [];
  const urls: string[] = [];
  if (template.logo_url) urls.push(template.logo_url);
  for (const u of template.reference_urls ?? []) {
    if (u && !urls.includes(u)) urls.push(u);
  }
  return urls;
}
