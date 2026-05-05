// Channel attribution by UTM / source / referrer.
// Used by Сквозная аналитика to bucket leads into real ad channels.
import {
  Camera,
  Facebook,
  Globe,
  MessageCircle,
  Music2,
  Search,
  Send,
  Share2,
  Youtube,
  type LucideIcon,
} from "lucide-react";

export type ChannelKey =
  | "facebook"
  | "instagram"
  | "google"
  | "tiktok"
  | "youtube"
  | "yandex"
  | "vk"
  | "telegram"
  | "whatsapp"
  | "direct"
  | "referral"
  | "other";

export interface ChannelMeta {
  key: ChannelKey;
  label: string;
  Icon: LucideIcon;
  /** Tailwind text color for icon */
  color: string;
  /** Tailwind background tint for the icon chip */
  bg: string;
}

export const CHANNELS: Record<ChannelKey, ChannelMeta> = {
  facebook:  { key: "facebook",  label: "Facebook Ads",  Icon: Facebook,      color: "text-[#4F8AF7]", bg: "bg-[#4F8AF7]/10" },
  instagram: { key: "instagram", label: "Instagram",     Icon: Camera,        color: "text-[#E1306C]", bg: "bg-[#E1306C]/10" },
  google:    { key: "google",    label: "Google Ads",    Icon: Search,        color: "text-[#FBBC05]", bg: "bg-[#FBBC05]/10" },
  tiktok:    { key: "tiktok",    label: "TikTok Ads",    Icon: Music2,        color: "text-foreground", bg: "bg-secondary/60" },
  youtube:   { key: "youtube",   label: "YouTube",       Icon: Youtube,       color: "text-[#FF0000]", bg: "bg-[#FF0000]/10" },
  yandex:    { key: "yandex",    label: "Яндекс.Директ", Icon: Search,        color: "text-[#FFCC00]", bg: "bg-[#FFCC00]/10" },
  vk:        { key: "vk",        label: "ВКонтакте",     Icon: Share2,        color: "text-[#4C75A3]", bg: "bg-[#4C75A3]/10" },
  telegram:  { key: "telegram",  label: "Telegram",      Icon: Send,          color: "text-[#229ED9]", bg: "bg-[#229ED9]/10" },
  whatsapp:  { key: "whatsapp",  label: "WhatsApp",      Icon: MessageCircle, color: "text-success",   bg: "bg-success/10" },
  direct:    { key: "direct",    label: "Прямой / сайт", Icon: Globe,         color: "text-muted-foreground", bg: "bg-secondary/60" },
  referral:  { key: "referral",  label: "Переходы",      Icon: Share2,        color: "text-muted-foreground", bg: "bg-secondary/60" },
  other:     { key: "other",     label: "Прочее",        Icon: Globe,         color: "text-muted-foreground", bg: "bg-secondary/60" },
};

const TOKENS: Array<{ rx: RegExp; key: ChannelKey }> = [
  { rx: /\b(fb|facebook|meta|fbads|fb_ads|facebook_ads)\b/, key: "facebook" },
  { rx: /\b(ig|insta|instagram)\b/,                          key: "instagram" },
  { rx: /\b(google|googleads|adwords|gads|gsearch)\b/,       key: "google" },
  { rx: /\b(tt|tiktok|tiktokads|tt_ads)\b/,                  key: "tiktok" },
  { rx: /\b(yt|youtube)\b/,                                  key: "youtube" },
  { rx: /\b(yandex|ya|direct_ya|yandexdirect)\b/,            key: "yandex" },
  { rx: /\b(vk|vkontakte|vkads)\b/,                          key: "vk" },
  { rx: /\b(tg|telegram)\b/,                                 key: "telegram" },
  { rx: /\b(wa|whatsapp)\b/,                                 key: "whatsapp" },
];

const HOSTS: Array<{ rx: RegExp; key: ChannelKey }> = [
  { rx: /facebook\.com|fb\.com|m\.facebook/i, key: "facebook" },
  { rx: /instagram\.com/i,                    key: "instagram" },
  { rx: /google\./i,                          key: "google" },
  { rx: /tiktok\.com/i,                       key: "tiktok" },
  { rx: /youtube\.com|youtu\.be/i,            key: "youtube" },
  { rx: /yandex\./i,                          key: "yandex" },
  { rx: /vk\.com/i,                           key: "vk" },
  { rx: /t\.me|telegram\./i,                  key: "telegram" },
  { rx: /wa\.me|whatsapp\./i,                 key: "whatsapp" },
];

export interface AttributableLead {
  source?: string | null;
  channel?: string | null;
  referrer?: string | null;
  utm?: { source?: string | null; medium?: string | null; campaign?: string | null; content?: string | null; term?: string | null } | null;
}

function matchToken(s: string | null | undefined): ChannelKey | null {
  if (!s) return null;
  const v = s.toLowerCase();
  for (const t of TOKENS) if (t.rx.test(v)) return t.key;
  return null;
}

function matchHost(ref: string | null | undefined): ChannelKey | null {
  if (!ref) return null;
  for (const h of HOSTS) if (h.rx.test(ref)) return h.key;
  return null;
}

export function resolveChannel(lead: AttributableLead): ChannelMeta {
  const utm = lead.utm ?? {};
  const candidate =
    matchToken(utm.source) ||
    matchToken(utm.medium) ||
    matchToken(utm.campaign) ||
    matchToken(lead.source) ||
    matchToken(lead.channel) ||
    matchHost(lead.referrer);
  if (candidate) return CHANNELS[candidate];
  if (lead.referrer) return CHANNELS.referral;
  if ((lead.source ?? "").toLowerCase() === "site" || (lead.source ?? "").toLowerCase() === "web") {
    return CHANNELS.direct;
  }
  return CHANNELS.other;
}

/** UTM campaign signature for grouping in tables. */
export function utmCampaignKey(lead: AttributableLead): string {
  const utm = lead.utm ?? {};
  const src = (utm.source ?? lead.source ?? "—").toString();
  const cmp = (utm.campaign ?? "—").toString();
  return `${src}|${cmp}`;
}
