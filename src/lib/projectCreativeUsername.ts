/** Нормализует Instagram-ник: убирает @ и пробелы, оставляет латиницу/цифры/._ */
export function normalizeCreativeUsername(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim().replace(/^@+/, "");
  if (!trimmed) return "";
  return trimmed.replace(/[^a-zA-Z0-9._]/g, "").slice(0, 30);
}

/** Для webhook: пустой ник → поле не отправляем. */
export function buildCreativeUsernameWebhookFields(
  raw: string | null | undefined,
): Record<string, string> {
  const username = normalizeCreativeUsername(raw);
  if (!username) return {};
  return { username };
}

export function formatCreativeUsernameDisplay(raw: string | null | undefined): string {
  const username = normalizeCreativeUsername(raw);
  return username ? `@${username}` : "";
}
