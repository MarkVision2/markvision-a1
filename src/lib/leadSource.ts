// Single source of truth for lead "source" normalization.
// Used by CRM, Analytics, Dashboard, Reports.
import {
  Camera,
  Facebook,
  FileText,
  Globe,
  Hand,
  Megaphone,
  MessageCircle,
  Phone,
  Send,
  UserPlus,
  type LucideIcon,
} from "lucide-react";

export type SourceKey =
  | "whatsapp"
  | "instagram"
  | "instagram_organic"
  | "facebook"
  | "telegram"
  | "site"
  | "ads"
  | "google"
  | "meta"
  | "lead_form"
  | "phone"
  | "referral"
  | "manual"
  | "unknown";

export interface SourceMeta {
  key: SourceKey;
  label: string;
  Icon: LucideIcon;
  /** Tailwind text color class for the icon */
  cls: string;
  /** Raw original value, useful for display when key is "unknown" */
  raw: string;
}

const TABLE: Record<string, Omit<SourceMeta, "raw">> = {
  // WhatsApp
  whatsapp: { key: "whatsapp", label: "WhatsApp", Icon: MessageCircle, cls: "text-success" },
  wa: { key: "whatsapp", label: "WhatsApp", Icon: MessageCircle, cls: "text-success" },
  // Instagram
  instagram: { key: "instagram", label: "Instagram", Icon: Camera, cls: "text-foreground" },
  ig: { key: "instagram", label: "Instagram", Icon: Camera, cls: "text-foreground" },
  // Instagram organic (от код-словов в рилсах)
  instagram_organic: { key: "instagram_organic", label: "Instagram (organic)", Icon: Camera, cls: "text-pink-500" },
  ig_organic: { key: "instagram_organic", label: "Instagram (organic)", Icon: Camera, cls: "text-pink-500" },
  reels: { key: "instagram_organic", label: "Instagram (organic)", Icon: Camera, cls: "text-pink-500" },
  // Facebook / Meta
  facebook: { key: "facebook", label: "Facebook", Icon: Facebook, cls: "text-primary" },
  fb: { key: "facebook", label: "Facebook", Icon: Facebook, cls: "text-primary" },
  meta: { key: "facebook", label: "Facebook", Icon: Facebook, cls: "text-primary" },
  // Telegram
  telegram: { key: "telegram", label: "Telegram", Icon: Send, cls: "text-primary" },
  tg: { key: "telegram", label: "Telegram", Icon: Send, cls: "text-primary" },
  // Site
  site: { key: "site", label: "Сайт", Icon: Globe, cls: "text-muted-foreground" },
  tilda: { key: "site", label: "Сайт", Icon: Globe, cls: "text-muted-foreground" },
  web: { key: "site", label: "Сайт", Icon: Globe, cls: "text-muted-foreground" },
  website: { key: "site", label: "Сайт", Icon: Globe, cls: "text-muted-foreground" },
  // Paid ads
  ads: { key: "ads", label: "Реклама", Icon: Megaphone, cls: "text-warning" },
  advert: { key: "ads", label: "Реклама", Icon: Megaphone, cls: "text-warning" },
  google: { key: "google", label: "Google Ads", Icon: Megaphone, cls: "text-warning" },
  google_ads: { key: "google", label: "Google Ads", Icon: Megaphone, cls: "text-warning" },
  googleads: { key: "google", label: "Google Ads", Icon: Megaphone, cls: "text-warning" },
  yandex: { key: "ads", label: "Яндекс.Директ", Icon: Megaphone, cls: "text-warning" },
  cpc: { key: "ads", label: "Реклама", Icon: Megaphone, cls: "text-warning" },
  // Lead forms
  lead_form: { key: "lead_form", label: "Лид-форма", Icon: FileText, cls: "text-primary" },
  leadform: { key: "lead_form", label: "Лид-форма", Icon: FileText, cls: "text-primary" },
  // Phone
  phone: { key: "phone", label: "Звонок", Icon: Phone, cls: "text-warning" },
  call: { key: "phone", label: "Звонок", Icon: Phone, cls: "text-warning" },
  // Other
  referral: { key: "referral", label: "Рекомендация", Icon: UserPlus, cls: "text-foreground" },
  manual: { key: "manual", label: "Вручную", Icon: Hand, cls: "text-muted-foreground" },
};

/** Источник для UI: учитывает source, channel и Meta-атрибуцию. */
export function resolveLeadSource(lead: {
  source?: string | null;
  channel?: string | null;
  metaAdId?: string | null;
}): SourceMeta {
  const raw = (lead.source ?? "").trim() || (lead.channel ?? "").trim();
  if (lead.metaAdId) {
    const via = normalizeSource(raw || "whatsapp");
    if (via.key === "whatsapp") {
      const meta = normalizeSource("meta");
      return { ...meta, label: "WhatsApp · Meta Ads", raw: raw || "whatsapp" };
    }
    return normalizeSource(raw || "meta");
  }
  return normalizeSource(raw);
}

export function normalizeSource(raw: string | null | undefined): SourceMeta {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) {
    return { key: "unknown", label: "Без источника", Icon: Globe, cls: "text-muted-foreground", raw: "" };
  }
  const hit = TABLE[v];
  if (hit) return { ...hit, raw: raw ?? "" };
  // Unknown utm_source — still show it, but bucket as "unknown"
  return { key: "unknown", label: raw ?? "Без источника", Icon: Globe, cls: "text-muted-foreground", raw: raw ?? "" };
}

/** Canonical key for storing in DB (normalizes synonyms before insert). */
export function canonicalSourceKey(raw: string | null | undefined): string {
  const m = normalizeSource(raw);
  if (m.key === "unknown") return (raw ?? "").trim() || "unknown";
  return m.key;
}
