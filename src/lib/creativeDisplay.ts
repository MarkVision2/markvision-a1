const TAG_LABELS: Record<string, string> = {
  video: "Видео",
  image: "Фото",
  carousel: "Карусель",
  wa: "WhatsApp",
  site: "Сайт",
  ai: "AI",
};

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Активно",
  PAUSED: "На паузе",
  CAMPAIGN_PAUSED: "Кампания на паузе",
  ADSET_PAUSED: "Группа на паузе",
  DISAPPROVED: "Отклонено",
  PENDING_REVIEW: "На проверке",
  WITH_ISSUES: "Есть проблемы",
};

export interface ParsedCreativeName {
  title: string;
  tags: string[];
  full: string;
}

export function parseCreativeDisplayName(name: string): ParsedCreativeName {
  const full = name.trim();
  const parts = full.split("|").map((s) => s.trim()).filter(Boolean);
  const raw = parts[0] || full;
  const title = raw.replace(/_/g, " ").replace(/\s+/g, " ").trim();

  const tags = parts.slice(1).map((t) => {
    const key = t.toLowerCase();
    return TAG_LABELS[key] ?? t;
  });

  return { title: title || "Без названия", tags, full };
}

export function formatCreativeStatus(status: string | null | undefined): string {
  if (!status) return "—";
  const key = status.toUpperCase();
  return STATUS_LABELS[key] ?? status.replace(/_/g, " ").toLowerCase();
}

export function isCreativeActive(status: string | null | undefined): boolean {
  return (status ?? "").toUpperCase() === "ACTIVE";
}

export function pickCreativeTitle(args: {
  name?: string | null;
  headline?: string | null;
}): { title: string; subtitle: string | null; tags: string[] } {
  const parsed = parseCreativeDisplayName(args.name ?? "");
  if (args.headline?.trim()) {
    return { title: args.headline.trim(), subtitle: parsed.title, tags: parsed.tags };
  }
  return { title: parsed.title, subtitle: null, tags: parsed.tags };
}
