import {
  emptyFunnel,
  type ContentPlanFunnel,
  type ContentPlanItem,
  type ContentPlanType,
} from "@/lib/contentPlan";

/** Строка Instagram media для линковки/воронки контент-плана. */
export type ContentPlanIgMedia = {
  media_id: string;
  caption: string | null;
  media_type: string | null;
  media_product_type: string | null;
  permalink: string | null;
  thumbnail_url: string | null;
  media_url: string | null;
  timestamp: string | null;
  like_count: number | null;
  comments_count: number | null;
  shares_count: number | null;
  saved_count: number | null;
  reach: number | null;
  impressions: number | null;
  video_views: number | null;
  plays: number | null;
};

export type ContentPlanOrganicEvent = {
  id: string;
  codeword_id: string | null;
  codeword: string | null;
  event_type: string;
  lead_id: string | null;
  reel_id: string | null;
  payload?: { user_agent?: string | null } | null;
};

export type ContentPlanLeadLite = {
  id: string;
  stage_role: string | null;
  paid: boolean | null;
  amount: number | null;
  deposit_amount: number | null;
  webinar_status: string | null;
};

const BOT_UA =
  /(bot|crawler|spider|preview|facebookcatalog|whatsapp|telegram|slack|discord|vkshare|skypeuripreview|facebookexternalhit)/i;

export function isBotUserAgent(ua: string | null | undefined): boolean {
  if (!ua) return false;
  return BOT_UA.test(ua);
}

export function contentTypeFromIgMedia(m: Pick<ContentPlanIgMedia, "media_type" | "media_product_type">): ContentPlanType {
  const product = (m.media_product_type ?? "").toUpperCase();
  const type = (m.media_type ?? "").toUpperCase();
  if (product === "REELS" || type === "REELS") return "REELS";
  if (product === "STORY" || product === "STORIES" || type === "STORY") return "STORIES";
  if (type === "CAROUSEL_ALBUM" || product === "CAROUSEL") return "CAROUSEL";
  return "IMAGE";
}

export function titleFromIgCaption(caption: string | null | undefined, fallback: string): string {
  const line = (caption ?? "").trim().split("\n")[0]?.trim() ?? "";
  return (line.slice(0, 80) || fallback).slice(0, 120);
}

export function normalizeCaptionKey(caption: string | null | undefined): string {
  return (
    (caption ?? "")
      .trim()
      .split("\n")[0]
      ?.toLowerCase()
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) ?? ""
  );
}

/** Дата якоря для soft-match: scheduled / published / created. */
export function planAnchorIso(item: Pick<ContentPlanItem, "publishedAt" | "scheduledAt" | "createdAt">): string | null {
  return item.publishedAt ?? item.scheduledAt ?? item.createdAt ?? null;
}

/**
 * Найти IG media_id для строки плана.
 * Приоритет: уже привязанный → published_ig_media_id автопоста → caption+время.
 */
export function resolveIgMediaIdForPlan(input: {
  plan: Pick<ContentPlanItem, "igMediaId" | "autopostId" | "description" | "title" | "publishedAt" | "scheduledAt" | "createdAt">;
  media: ContentPlanIgMedia[];
  /** autopost_id → published_ig_media_id */
  publishedByAutopost: Map<string, string>;
  /** media_id уже занятые другими строками плана */
  claimedMediaIds: Set<string>;
}): string | null {
  const { plan, media, publishedByAutopost, claimedMediaIds } = input;
  if (plan.igMediaId) return plan.igMediaId;

  if (plan.autopostId) {
    const fromAp = publishedByAutopost.get(plan.autopostId);
    if (fromAp && !claimedMediaIds.has(fromAp)) return fromAp;
  }

  const key = normalizeCaptionKey(plan.description) || normalizeCaptionKey(plan.title);
  if (!key) return null;

  const anchor = planAnchorIso(plan);
  const anchorTs = anchor ? new Date(anchor).getTime() : NaN;

  let best: { id: string; score: number } | null = null;
  for (const m of media) {
    if (claimedMediaIds.has(m.media_id)) continue;
    const mKey = normalizeCaptionKey(m.caption);
    if (!mKey || mKey !== key) continue;
    let score = 10;
    if (!Number.isNaN(anchorTs) && m.timestamp) {
      const deltaH = Math.abs(new Date(m.timestamp).getTime() - anchorTs) / 3_600_000;
      if (deltaH > 72) continue;
      score += Math.max(0, 72 - deltaH);
    }
    if (!best || score > best.score) best = { id: m.media_id, score };
  }
  return best?.id ?? null;
}

export function mediaNotLinkedToPlan(
  media: ContentPlanIgMedia[],
  linkedMediaIds: Set<string>,
): ContentPlanIgMedia[] {
  return media.filter((m) => m.media_id && !linkedMediaIds.has(m.media_id));
}

export function matchCodewordInCaption(
  caption: string | null | undefined,
  codewords: Array<{ id: string; codeword: string; reel_id?: string | null }>,
  mediaId?: string | null,
): { id: string; codeword: string } | null {
  const low = (caption ?? "").toLowerCase();
  if (!low.trim()) return null;
  for (const k of codewords) {
    const word = (k.codeword ?? "").trim().toLowerCase();
    if (!word) continue;
    if (!low.includes(word)) continue;
    if (k.reel_id && mediaId && k.reel_id !== mediaId) continue;
    return { id: k.id, codeword: k.codeword };
  }
  return null;
}

function applyLeadStages(f: ContentPlanFunnel, leadIds: Set<string>, leads: ContentPlanLeadLite[]) {
  if (leadIds.size === 0) return;
  let whatsapp = 0;
  let webinar = 0;
  let deposits = 0;
  let paidN = 0;
  let revenue = 0;
  for (const id of leadIds) {
    const lead = leads.find((l) => l.id === id);
    if (!lead) continue;
    const role = lead.stage_role ?? "";
    if (
      [
        "whatsapp",
        "bot_activated",
        "warming",
        "joined_group",
        "confirmed",
        "attended",
        "interest",
        "call_scheduled",
        "call_done",
        "offer",
        "deposit",
        "paid",
        "student",
        "graduate",
      ].includes(role)
    ) {
      whatsapp += 1;
    }
    if (
      lead.webinar_status === "attended" ||
      lead.webinar_status === "late" ||
      [
        "attended",
        "interest",
        "call_scheduled",
        "call_done",
        "offer",
        "deposit",
        "paid",
        "student",
        "graduate",
      ].includes(role)
    ) {
      webinar += 1;
    }
    if (["deposit", "paid", "student", "graduate"].includes(role) || (lead.deposit_amount ?? 0) > 0) {
      deposits += 1;
    }
    if (lead.paid || role === "paid" || role === "student" || role === "graduate") {
      paidN += 1;
      revenue += Number(lead.amount ?? 0);
    }
  }
  f.whatsappJoined = whatsapp;
  f.webinarAttended = webinar;
  f.deposits = deposits;
  if (paidN > 0) {
    f.paid = paidN;
    f.revenue = revenue || f.revenue;
  }
  if (f.registrations < leadIds.size) f.registrations = leadIds.size;
}

/**
 * Воронка публикации: IG insights + organic events по reel_id (как Контент-центр).
 * Если media нет — fallback на агрегаты код-слова.
 */
export function buildContentPlanFunnel(input: {
  adSpend?: number;
  media?: ContentPlanIgMedia | null;
  igMediaId?: string | null;
  codewordId?: string | null;
  events: ContentPlanOrganicEvent[];
  leads: ContentPlanLeadLite[];
  codewordStats?: {
    codeword_dms?: number;
    codeword_comments?: number;
    link_clicks?: number;
    leads?: number;
    sales?: number;
    revenue?: number;
  } | null;
}): ContentPlanFunnel {
  const f = emptyFunnel(input.adSpend ?? 0);
  const m = input.media ?? null;

  if (m) {
    // Meta иногда отдаёт reach=0 при ненулевых views/impressions (особенно Reels).
    const reach = Number(m.reach ?? 0);
    const viewsProxy = Number(m.impressions ?? 0) || Number(m.plays ?? 0) || Number(m.video_views ?? 0);
    f.reach = reach > 0 ? reach : viewsProxy;
    f.views = Number(m.plays ?? m.video_views ?? m.impressions ?? 0);
    f.likes = Number(m.like_count ?? 0);
    f.saves = Number(m.saved_count ?? 0);
    f.shares = Number(m.shares_count ?? 0);
    f.comments = Number(m.comments_count ?? 0);
  }

  const igMediaId = input.igMediaId ?? m?.media_id ?? null;

  if (igMediaId) {
    const forMedia = input.events.filter((e) => e.reel_id === igMediaId);
    let hits = 0;
    let dms = 0;
    let clicks = 0;
    const leadIds = new Set<string>();
    for (const e of forMedia) {
      if (e.event_type === "codeword_comment" || e.event_type === "codeword_dm") {
        hits += 1;
        if (e.event_type === "codeword_dm") dms += 1;
      }
      if (e.event_type === "link_click" && !isBotUserAgent(e.payload?.user_agent)) {
        clicks += 1;
      }
      if (e.event_type === "lead" && e.lead_id) leadIds.add(e.lead_id);
    }
    f.codewordHits = hits;
    f.messagesSent = dms || hits;
    f.messagesOpened = f.messagesSent;
    f.linkClicks = clicks;
    f.registrations = leadIds.size;
    applyLeadStages(f, leadIds, input.leads);
    return f;
  }

  const st = input.codewordStats;
  if (st && input.codewordId) {
    f.codewordHits = Number(st.codeword_dms ?? 0) + Number(st.codeword_comments ?? 0);
    f.messagesSent = Number(st.codeword_dms ?? 0) || f.codewordHits;
    f.messagesOpened = f.messagesSent;
    f.linkClicks = Number(st.link_clicks ?? 0);
    f.registrations = Number(st.leads ?? 0);
    f.paid = Number(st.sales ?? 0);
    f.revenue = Number(st.revenue ?? 0);

    const leadIds = new Set<string>();
    for (const e of input.events) {
      if (e.codeword_id !== input.codewordId) continue;
      if (e.event_type !== "lead" || !e.lead_id) continue;
      leadIds.add(e.lead_id);
    }
    applyLeadStages(f, leadIds, input.leads);
  }

  return f;
}

export function draftFromIgMedia(
  m: ContentPlanIgMedia,
  codewords: Array<{ id: string; codeword: string; reel_id?: string | null }>,
): {
  title: string;
  contentType: ContentPlanType;
  status: "published";
  description: string | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  scheduledAt: string | null;
  igMediaId: string;
  codewordId: string | null;
  codeword: string | null;
  platforms: { instagram: true; facebook: false; threads: false; telegram: false; linkedin: false };
} {
  const contentType = contentTypeFromIgMedia(m);
  const cw = matchCodewordInCaption(m.caption, codewords, m.media_id);
  return {
    title: titleFromIgCaption(m.caption, `${contentType} Instagram`),
    contentType,
    status: "published",
    description: m.caption,
    mediaUrl: m.media_url,
    thumbnailUrl: m.thumbnail_url,
    publishedAt: m.timestamp,
    scheduledAt: m.timestamp,
    igMediaId: m.media_id,
    codewordId: cw?.id ?? null,
    codeword: cw?.codeword ?? null,
    platforms: {
      instagram: true,
      facebook: false,
      threads: false,
      telegram: false,
      linkedin: false,
    },
  };
}
