/**
 * Режим текста на креативе: AI сам пишет или пользователь вставляет готовый overlay.
 */

export type CopyMode = "auto" | "custom";

export const COPY_MODE_LABELS: Record<CopyMode, string> = {
  auto: "Быстро — AI сам напишет сценарий",
  custom: "Вставить свой текст",
};

export function normalizeCopyMode(value: unknown): CopyMode {
  return value === "custom" ? "custom" : "auto";
}

export function copyPromptBlock(mode: CopyMode, overlayText: string): string {
  if (mode === "custom") {
    const text = overlayText.trim();
    if (!text) {
      return "Режим текста: свой текст (пользователь не ввёл — запроси уточнение или используй CTA из брифа).";
    }
    return [
      "Режим текста: СВОЙ ТЕКСТ (copy_mode=custom).",
      "ОБЯЗАТЕЛЬНО наложи на изображение ТОЧНО следующий текст, без перефразирования, сокращений и орфографических правок:",
      `«${text}»`,
      "Текст должен быть читаемым: контрастный цвет, безопасные поля, не перекрывать ключевые объекты.",
    ].join("\n");
  }
  return [
    "Режим текста: БЫСТРО (copy_mode=auto).",
    "AI сам пишет сценарий/подпись и органично накладывает на креатив с учётом цели, тона и CTA из брифа.",
  ].join("\n");
}

/** Плоские поля для n8n webhook (дублируются в body.*). */
export function buildCopyWebhookFields(
  mode: CopyMode,
  overlayText: string,
  extraInstructions?: string,
): Record<string, unknown> {
  const trimmed = overlayText.trim();
  const extra = (extraInstructions ?? "").trim();
  return {
    copy_mode: mode,
    copy_mode_label: COPY_MODE_LABELS[mode],
    overlay_text: mode === "custom" ? trimmed : "",
    overlay_text_required: mode === "custom",
    use_exact_overlay_text: mode === "custom" && trimmed.length > 0,
    extra_instructions: extra,
  };
}
