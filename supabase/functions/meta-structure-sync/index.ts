// Meta Ads — structure sync.
// Pulls campaigns, ads (creatives) and their daily insights for cabinets
// with provider='meta'. Writes to:
//   public.meta_campaigns + meta_campaign_daily
//   public.meta_creatives + meta_creative_daily
//
// Designed to run alongside meta-daily-sync (which keeps cabinet-level rollup).
// Trigger: cron OR ad-hoc POST with {since, until, cabinet_id?}.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { requireUser, userHasRole } from "../_lib/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const META_API_VERSION = "v21.0";

const LEAD_ACTIONS = [
  "lead",
  "leadgen.other",
  "onsite_conversion.lead_grouped",
  "offsite_conversion.fb_pixel_lead",
  "onsite_web_lead",
];
const MESSAGING_ACTIONS = ["onsite_conversion.messaging_conversation_started_7d"];
const PURCHASE_ACTIONS = ["purchase", "offsite_conversion.fb_pixel_purchase", "omni_purchase"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function maxAction(
  actions: Array<{ action_type: string; value: string }> | undefined,
  types: string[],
) {
  if (!actions) return 0;
  let max = 0;
  for (const a of actions) {
    if (types.includes(a.action_type)) {
      const v = Number(a.value || 0);
      if (v > max) max = v;
    }
  }
  return max;
}
function sumActions(
  actions: Array<{ action_type: string; value: string }> | undefined,
  types: string[],
) {
  if (!actions) return 0;
  return actions
    .filter((a) => types.includes(a.action_type))
    .reduce((s, a) => s + Number(a.value || 0), 0);
}

function normalizeActId(id: string) {
  const t = id.trim();
  if (/^act_\d+$/i.test(t)) return `act_${t.replace(/^act_/i, "")}`;
  if (/^\d+$/.test(t)) return `act_${t}`;
  return t;
}

function ymdInTimeZone(d: Date, timeZone = "Asia/Almaty") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDaysYmd(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface FxRow { date: string; usd_kzt: number | string }

function ymdToDmy(s: string) {
  const [y, m, d] = s.split("-");
  return `${d}.${m}.${y}`;
}
function parseUsdFromXml(xml: string): number | null {
  const items = xml.split(/<item[\s>]/i).slice(1);
  for (const it of items) {
    const t = it.match(/<title>\s*([^<]+?)\s*<\/title>/i);
    const dsc = it.match(/<description>\s*([^<]+?)\s*<\/description>/i);
    if (t && dsc && t[1].trim().toUpperCase() === "USD") {
      const v = Number(dsc[1].replace(",", "."));
      if (Number.isFinite(v) && v > 0) return v;
    }
  }
  return null;
}
async function fetchNbkRate(date: string): Promise<number | null> {
  for (let i = 0; i < 8; i++) {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - i);
    const dStr = d.toISOString().slice(0, 10);
    try {
      const r = await fetch(`https://nationalbank.kz/rss/get_rates.cfm?fdate=${ymdToDmy(dStr)}`);
      if (!r.ok) continue;
      const v = parseUsdFromXml(await r.text());
      if (v) return v;
    } catch (_) { /* next */ }
  }
  return null;
}
async function getRatesForDates(
  admin: ReturnType<typeof createClient>,
  dates: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (dates.length === 0) return map;
  const { data } = await admin.from("fx_rates").select("date, usd_kzt").in("date", dates);
  for (const r of (data ?? []) as FxRow[]) {
    map.set(r.date, Number(r.usd_kzt));
  }
  for (const d of dates) {
    if (map.has(d)) continue;
    const rate = await fetchNbkRate(d);
    if (rate) {
      map.set(d, rate);
      await admin.from("fx_rates").upsert(
        { date: d, usd_kzt: rate, source: "nbk", fetched_at: new Date().toISOString() },
        { onConflict: "date" },
      );
    }
  }
  return map;
}

function pickThumbnail(creative: Record<string, unknown> | null | undefined): {
  thumbnail: string | null;
  image: string | null;
  video_id: string | null;
} {
  if (!creative) return { thumbnail: null, image: null, video_id: null };
  const thumb = (creative.thumbnail_url as string | undefined) ?? null;
  const imageUrl = (creative.image_url as string | undefined) ?? null;
  const videoId = (creative.video_id as string | undefined) ?? null;
  if (thumb || imageUrl || videoId) return { thumbnail: thumb, image: imageUrl, video_id: videoId };
  const story = creative.object_story_spec as Record<string, unknown> | undefined;
  if (story) {
    const videoData = story.video_data as Record<string, unknown> | undefined;
    if (videoData) {
      return {
        thumbnail: (videoData.image_url as string | undefined) ?? null,
        image: null,
        video_id: (videoData.video_id as string | undefined) ?? null,
      };
    }
    const linkData = story.link_data as Record<string, unknown> | undefined;
    if (linkData) {
      return {
        thumbnail: (linkData.picture as string | undefined) ?? null,
        image: (linkData.picture as string | undefined) ?? null,
        video_id: null,
      };
    }
  }
  return { thumbnail: null, image: null, video_id: null };
}

function inferCreativeType(creative: Record<string, unknown> | null | undefined): string {
  if (!creative) return "image";
  if (creative.video_id) return "video";
  const story = creative.object_story_spec as Record<string, unknown> | undefined;
  if (story?.video_data) return "video";
  if (story?.link_data && (story.link_data as Record<string, unknown>).child_attachments) return "carousel";
  if (creative.asset_feed_spec) return "dynamic";
  return "image";
}

function isMetaReduceError(text: string): boolean {
  // Meta returns code 1 "Please reduce the amount of data you're asking for"
  return /reduce the amount of data/i.test(text) || /"code"\s*:\s*1\b/.test(text);
}

async function fetchAllPagesSafe<T>(
  buildUrl: (limit: number) => string,
  initialLimit = 100,
  minLimit = 10,
): Promise<T[]> {
  let limit = initialLimit;
  while (true) {
    try {
      const out: T[] = [];
      let next: string | null = buildUrl(limit);
      while (next) {
        const r: Response = await fetch(next);
        if (!r.ok) {
          const text = await r.text();
          throw new Error(`meta api ${r.status}: ${text.slice(0, 300)}`);
        }
        const body = await r.json() as { data?: T[]; paging?: { next?: string } };
        if (Array.isArray(body.data)) out.push(...body.data);
        next = body.paging?.next ?? null;
      }
      return out;
    } catch (e) {
      const msg = (e as Error).message ?? "";
      console.log(`[meta-structure-sync] fetch failed (limit=${limit}): ${msg.slice(0, 200)}`);
      if (isMetaReduceError(msg) && limit > minLimit) {
        limit = Math.max(minLimit, Math.floor(limit / 2));
        console.log(`[meta-structure-sync] retrying with smaller limit=${limit}`);
        continue;
      }
      throw e;
    }
  }
}

// Legacy compatibility wrapper used for fixed URLs that already include limit.
async function fetchAllPages<T>(initialUrl: string): Promise<T[]> {
  return await fetchAllPagesSafe<T>(
    (limit) => initialUrl.replace(/([?&])limit=\d+/, `$1limit=${limit}`),
    Number((initialUrl.match(/[?&]limit=(\d+)/) ?? [])[1] ?? 100),
  );
}

interface ProcessedInsight {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  messages: number;
  purchases: number;
  revenue: number;
  currency: string;
}

function processInsightRow(
  row: Record<string, unknown>,
  accountCurrency: string,
  rates: Map<string, number>,
): ProcessedInsight | null {
  const date = String(row?.date_start ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  let spend = Number(row?.spend ?? 0);
  const impressions = Number(row?.impressions ?? 0);
  const clicks = Number(row?.clicks ?? 0);
  const actions = row?.actions as Array<{ action_type: string; value: string }> | undefined;
  const actionValues = row?.action_values as Array<{ action_type: string; value: string }> | undefined;
  const formLeads = maxAction(actions, LEAD_ACTIONS);
  const messages = maxAction(actions, MESSAGING_ACTIONS);
  const purchases = maxAction(actions, PURCHASE_ACTIONS);
  let revenue = sumActions(actionValues, PURCHASE_ACTIONS);
  let currency = accountCurrency;
  if (accountCurrency !== "KZT") {
    const rate = rates.get(date);
    if (rate) {
      spend = spend * rate;
      revenue = revenue * rate;
      currency = "KZT";
    }
  }
  return {
    date,
    spend,
    impressions,
    clicks,
    leads: formLeads + messages,
    messages,
    purchases,
    revenue,
    currency,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Auth: allow internal cron via shared secret, otherwise require admin JWT.
  const cronKey = Deno.env.get("META_SYNC_CRON_KEY");
  const provided = req.headers.get("x-cron-key");
  const isCron = !!cronKey && provided === cronKey;
  if (!isCron) {
    const auth = await requireUser(req);
    if (!auth.ok) return auth.response;
    if (!(await userHasRole(auth.userId, "admin"))) {
      return json({ ok: false, error: "Forbidden" }, 403);
    }
  }

  const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN");
  if (!META_ACCESS_TOKEN) {
    return json({ ok: false, error: "META_ACCESS_TOKEN missing" }, 500);
  }
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ---- params ----
  const url = new URL(req.url);
  let body: Record<string, unknown> = {};
  if (req.method === "POST") body = await req.json().catch(() => ({}));
  const qpSince = url.searchParams.get("since") ?? (body.since as string | undefined) ?? null;
  const qpUntil = url.searchParams.get("until") ?? (body.until as string | undefined) ?? null;
  const qpCabinetId = url.searchParams.get("cabinet_id") ?? (body.cabinet_id as string | undefined) ?? null;
  const isYmd = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  let since: string; let until: string;
  if (isYmd(qpSince) && isYmd(qpUntil)) { since = qpSince!; until = qpUntil!; }
  else {
    const yesterdayAlmaty = addDaysYmd(ymdInTimeZone(new Date(), "Asia/Almaty"), -1);
    // Default: last 14 days — структура и aggregates по умолчанию шире, чем у meta-daily-sync.
    since = addDaysYmd(yesterdayAlmaty, -13);
    until = yesterdayAlmaty;
  }
  if (since > until) [since, until] = [until, since];

  // ---- cabinets ----
  let cabQuery = admin.from("ad_cabinets").select("id, external_id, project_id, provider");
  if (qpCabinetId) cabQuery = cabQuery.eq("id", qpCabinetId);
  const { data: cabinets, error: cabErr } = await cabQuery;
  if (cabErr) return json({ ok: false, error: cabErr.message }, 500);

  const results: Array<Record<string, unknown>> = [];

  for (const cab of cabinets ?? []) {
    if ((cab as { provider?: string }).provider && (cab as { provider?: string }).provider !== "meta") continue;
    const ext = ((cab as { external_id?: string }).external_id ?? "").trim();
    if (!ext) continue;
    const actId = normalizeActId(ext);
    const cabinetId = (cab as { id: string }).id;
    const projectId = ((cab as { project_id?: string }).project_id ?? null) as string | null;

    try {
      // ---- 1. Account currency ----
      const accountRes = await fetch(
        `https://graph.facebook.com/${META_API_VERSION}/${actId}?fields=currency&access_token=${encodeURIComponent(META_ACCESS_TOKEN)}`,
      );
      const accountJson = await accountRes.json().catch(() => ({}));
      const accountCurrency: string = (accountJson?.currency as string) ?? "USD";

      // ---- 2. Campaigns ----
      const campFields = ["id", "name", "objective", "status", "effective_status", "daily_budget", "lifetime_budget", "start_time", "stop_time"].join(",");
      const campaigns = await fetchAllPages<Record<string, unknown>>(
        `https://graph.facebook.com/${META_API_VERSION}/${actId}/campaigns?fields=${campFields}&limit=200&access_token=${encodeURIComponent(META_ACCESS_TOKEN)}`,
      );

      // destination_type — отдельный запрос на уровне adset (наследуется кампанией для CBO).
      // Берём представительный adset на каждую кампанию, чтобы не дёргать API лишний раз.
      const adsetMap = await fetchAllPages<Record<string, unknown>>(
        `https://graph.facebook.com/${META_API_VERSION}/${actId}/adsets?fields=campaign_id,destination_type,optimization_goal&limit=200&access_token=${encodeURIComponent(META_ACCESS_TOKEN)}`,
      );
      const destByCampaign = new Map<string, string>();
      for (const a of adsetMap) {
        const cid = String(a.campaign_id ?? "");
        const dest = (a.destination_type as string | undefined) ?? null;
        if (cid && dest && !destByCampaign.has(cid)) destByCampaign.set(cid, dest);
      }

      const campaignRows = campaigns.map((c) => ({
        cabinet_id: cabinetId,
        project_id: projectId,
        campaign_id: String(c.id),
        name: String(c.name ?? ""),
        objective: (c.objective as string | undefined) ?? null,
        destination_type: destByCampaign.get(String(c.id)) ?? null,
        status: (c.status as string | undefined) ?? null,
        effective_status: (c.effective_status as string | undefined) ?? null,
        daily_budget: c.daily_budget ? Number(c.daily_budget) / 100 : null,
        lifetime_budget: c.lifetime_budget ? Number(c.lifetime_budget) / 100 : null,
        start_time: (c.start_time as string | undefined) ?? null,
        stop_time: (c.stop_time as string | undefined) ?? null,
        last_synced_at: new Date().toISOString(),
      }));
      if (campaignRows.length > 0) {
        const { error } = await admin
          .from("meta_campaigns")
          .upsert(campaignRows, { onConflict: "campaign_id" });
        if (error) throw error;
      }

      // ---- 3. Ads (creatives) ----
      const adFields = [
        "id", "name", "status", "effective_status", "campaign_id", "adset_id",
        "creative{thumbnail_url,image_url,video_id,object_story_spec,asset_feed_spec,body,title,call_to_action_type,object_url}",
      ].join(",");
      const ads = await fetchAllPages<Record<string, unknown>>(
        `https://graph.facebook.com/${META_API_VERSION}/${actId}/ads?fields=${adFields}&limit=200&access_token=${encodeURIComponent(META_ACCESS_TOKEN)}`,
      );
      // Pre-extract creative metadata.
      const adsMeta = ads.map((a) => {
        const cr = a.creative as Record<string, unknown> | undefined;
        const media = pickThumbnail(cr);
        return { a, cr, media, ctype: inferCreativeType(cr) };
      });

      // Resolve mp4 source URL for video creatives via batched ?ids=…
      const videoIds = Array.from(new Set(
        adsMeta.map((m) => m.media.video_id).filter((v): v is string => !!v),
      ));
      const videoSourceById = new Map<string, string>();
      const videoPosterById = new Map<string, string>();
      for (let i = 0; i < videoIds.length; i += 50) {
        const chunk = videoIds.slice(i, i + 50);
        try {
          const url = `https://graph.facebook.com/${META_API_VERSION}/?ids=${encodeURIComponent(chunk.join(","))}&fields=source,picture&access_token=${encodeURIComponent(META_ACCESS_TOKEN)}`;
          const r = await fetch(url);
          if (!r.ok) continue;
          const body = await r.json() as Record<string, { source?: string; picture?: string }>;
          for (const [vid, val] of Object.entries(body)) {
            if (val?.source) videoSourceById.set(vid, val.source);
            if (val?.picture) videoPosterById.set(vid, val.picture);
          }
        } catch (_) { /* ignore */ }
      }

      const creativeRows = adsMeta.map(({ a, cr, media, ctype }) => ({
        cabinet_id: cabinetId,
        project_id: projectId,
        ad_id: String(a.id),
        adset_id: (a.adset_id as string | undefined) ?? null,
        campaign_id: (a.campaign_id as string | undefined) ?? null,
        name: String(a.name ?? ""),
        status: (a.status as string | undefined) ?? null,
        effective_status: (a.effective_status as string | undefined) ?? null,
        creative_type: ctype,
        thumbnail_url: media.thumbnail
          ?? (media.video_id ? videoPosterById.get(media.video_id) ?? null : null),
        image_url: media.image,
        video_id: media.video_id,
        // Готовый mp4 source URL (fbcdn, временная подпись ~24h). Если не удалось
        // достать — пишем null, фронт покажет постер с кнопкой обновить.
        video_url: media.video_id ? videoSourceById.get(media.video_id) ?? null : null,
        primary_text: (cr?.body as string | undefined) ?? null,
        headline: (cr?.title as string | undefined) ?? null,
        cta: (cr?.call_to_action_type as string | undefined) ?? null,
        destination_url: (cr?.object_url as string | undefined) ?? null,
        last_synced_at: new Date().toISOString(),
      }));
      if (creativeRows.length > 0) {
        const { error } = await admin
          .from("meta_creatives")
          .upsert(creativeRows, { onConflict: "ad_id" });
        if (error) throw error;
      }

      // ---- 4. Insights at campaign + ad level ----
      const insightFields = ["date_start", "spend", "impressions", "clicks", "actions", "action_values"].join(",");

      const fetchInsightsWindow = async (
        level: "campaign" | "ad",
        from: string,
        to: string,
      ): Promise<Record<string, unknown>[]> => {
        const idField = level === "campaign" ? "campaign_id" : "ad_id";
        const tr = encodeURIComponent(JSON.stringify({ since: from, until: to }));
        try {
          return await fetchAllPagesSafe<Record<string, unknown>>(
            (limit) => `https://graph.facebook.com/${META_API_VERSION}/${actId}/insights?fields=${insightFields},${idField}&time_range=${tr}&time_increment=1&level=${level}&limit=${limit}&access_token=${encodeURIComponent(META_ACCESS_TOKEN)}`,
            200,
            25,
          );
        } catch (e) {
          // If Meta still complains about volume, split the window in half.
          if (isMetaReduceError((e as Error).message) && from < to) {
            const start = new Date(`${from}T00:00:00Z`).getTime();
            const end = new Date(`${to}T00:00:00Z`).getTime();
            const midTs = start + Math.floor((end - start) / 2);
            const mid = new Date(midTs).toISOString().slice(0, 10);
            const left = await fetchInsightsWindow(level, from, mid);
            const right = await fetchInsightsWindow(level, addDaysYmd(mid, 1), to);
            return [...left, ...right];
          }
          throw e;
        }
      };

      const fetchInsights = async (level: "campaign" | "ad") =>
        await fetchInsightsWindow(level, since, until);


      const [campInsights, adInsights] = await Promise.all([
        fetchInsights("campaign"),
        fetchInsights("ad"),
      ]);

      const allDates = new Set<string>();
      for (const r of [...campInsights, ...adInsights]) {
        const d = String(r?.date_start ?? "");
        if (/^\d{4}-\d{2}-\d{2}$/.test(d)) allDates.add(d);
      }
      const needConvert = accountCurrency !== "KZT";
      const ratesMap = needConvert ? await getRatesForDates(admin, Array.from(allDates)) : new Map<string, number>();

      const campDailyRows = campInsights
        .map((r) => {
          const processed = processInsightRow(r, accountCurrency, ratesMap);
          if (!processed) return null;
          return {
            campaign_id: String(r.campaign_id),
            cabinet_id: cabinetId,
            project_id: projectId,
            date: processed.date,
            spend: processed.spend,
            impressions: processed.impressions,
            clicks: processed.clicks,
            leads: processed.leads,
            messages: processed.messages,
            purchases: processed.purchases,
            revenue: processed.revenue,
            currency: processed.currency,
            synced_at: new Date().toISOString(),
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      if (campDailyRows.length > 0) {
        const { error } = await admin
          .from("meta_campaign_daily")
          .upsert(campDailyRows, { onConflict: "campaign_id,date" });
        if (error) throw error;
      }

      const adDailyRows = adInsights
        .map((r) => {
          const processed = processInsightRow(r, accountCurrency, ratesMap);
          if (!processed) return null;
          return {
            ad_id: String(r.ad_id),
            cabinet_id: cabinetId,
            project_id: projectId,
            campaign_id: (r.campaign_id as string | undefined) ?? null,
            date: processed.date,
            spend: processed.spend,
            impressions: processed.impressions,
            clicks: processed.clicks,
            leads: processed.leads,
            messages: processed.messages,
            purchases: processed.purchases,
            revenue: processed.revenue,
            currency: processed.currency,
            synced_at: new Date().toISOString(),
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      if (adDailyRows.length > 0) {
        const { error } = await admin
          .from("meta_creative_daily")
          .upsert(adDailyRows, { onConflict: "ad_id,date" });
        if (error) throw error;
      }

      results.push({
        cabinet: ext,
        ok: true,
        since, until,
        campaigns: campaignRows.length,
        creatives: creativeRows.length,
        campaign_daily: campDailyRows.length,
        creative_daily: adDailyRows.length,
      });
      console.log(
        `[meta-structure-sync] cabinet=${ext} since=${since}..${until} ` +
        `campaigns=${campaignRows.length} creatives=${creativeRows.length} ` +
        `camp_days=${campDailyRows.length} ad_days=${adDailyRows.length}`,
      );
    } catch (e) {
      results.push({ cabinet: ext, ok: false, error: (e as Error).message });
    }
  }

  return json({ ok: true, since, until, count: results.length, results });
});
