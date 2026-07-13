// Google Ads structure sync: тянет кампании и их дневную статистику по
// провайдеру 'google' (паритет с meta-structure-sync) и пишет в
// google_campaigns / google_campaign_daily. Refresh-токен — per-project из
// google_ads_connections (env — глобальный fallback).
//
// Авторизация: shared cron secret (x-cron-secret) ИЛИ админский JWT.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const API = "v18";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function ymd(d: Date) { return d.toISOString().slice(0, 10); }
function ymdTz(d: Date, timeZone = "Asia/Almaty") {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}`;
}
function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return ymd(d);
}
function normalizeCustomerId(id: string) { return id.replace(/^customers\//i, "").replace(/[^0-9]/g, ""); }

async function getAccessToken(refreshToken: string): Promise<string> {
  const clientId = Deno.env.get("GOOGLE_ADS_OAUTH_CLIENT_ID") || Deno.env.get("GOOGLE_OAUTH_CLIENT_ID")!;
  const clientSecret = Deno.env.get("GOOGLE_ADS_OAUTH_CLIENT_SECRET") || Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET")!;
  const params = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" });
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString(),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`oauth refresh failed: ${data?.error_description ?? r.status}`);
  return data.access_token as string;
}

// deno-lint-ignore no-explicit-any
async function gaql(accessToken: string, devToken: string, login: string | null, customerId: string, query: string): Promise<any[]> {
  const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}`, "developer-token": devToken, "Content-Type": "application/json" };
  if (login) headers["login-customer-id"] = normalizeCustomerId(login);
  const r = await fetch(`https://googleads.googleapis.com/${API}/customers/${customerId}/googleAds:searchStream`, {
    method: "POST", headers, body: JSON.stringify({ query }),
  });
  if (!r.ok) throw new Error(`google ads api ${r.status}: ${(await r.text()).slice(0, 300)}`);
  // deno-lint-ignore no-explicit-any
  const batches = (await r.json()) as Array<{ results?: any[] }>;
  // deno-lint-ignore no-explicit-any
  const out: any[] = [];
  for (const b of batches) for (const row of b.results ?? []) out.push(row);
  return out;
}

async function isAuthorized(req: Request): Promise<boolean> {
  const cronSecret = Deno.env.get("CAPI_WORKER_KEY") || Deno.env.get("N8N_CALLBACK_SECRET");
  const provided = req.headers.get("x-cron-secret");
  if (cronSecret && provided && provided === cronSecret) return true;
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return false;
  try {
    const c = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: claims } = await c.auth.getClaims(authHeader.replace("Bearer ", ""));
    const uid = claims?.claims?.sub;
    if (!uid) return false;
    const { data } = await c.from("user_roles").select("role").eq("user_id", uid).eq("role", "admin").maybeSingle();
    return !!data;
  } catch { return false; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!(await isAuthorized(req))) return json({ ok: false, error: "unauthorized" }, 401);

  const devToken = Deno.env.get("GOOGLE_ADS_DEVELOPER_TOKEN");
  const envRefresh = Deno.env.get("GOOGLE_ADS_OAUTH_REFRESH_TOKEN") || null;
  if (!devToken) return json({ ok: false, error: "google_ads_not_configured", hint: "Set GOOGLE_ADS_DEVELOPER_TOKEN and connect a project via google-oauth-start." }, 503);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let body: Record<string, unknown> = {};
  if (req.method === "POST") body = await req.json().catch(() => ({}));
  const url = new URL(req.url);
  const qp = (k: string) => url.searchParams.get(k) ?? (body[k] as string | undefined) ?? null;
  const isYmd = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  let since = qp("since"), until = qp("until");
  if (!(isYmd(since) && isYmd(until))) { const y = addDays(ymdTz(new Date()), -1); since = until = y; }
  if (since! > until!) [since, until] = [until, since];
  const cabinetId = qp("cabinet_id");

  let cabQ = admin.from("ad_cabinets").select("id, external_id, project_id").eq("provider", "google");
  if (cabinetId) cabQ = cabQ.eq("id", cabinetId);
  const { data: cabinets, error: cabErr } = await cabQ;
  if (cabErr) return json({ ok: false, error: cabErr.message }, 500);
  if (!cabinets || cabinets.length === 0) return json({ ok: true, results: [], note: "no Google Ads cabinets" });

  const envLogin = Deno.env.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID") || null;
  const projectIds = Array.from(new Set(cabinets.map((c) => (c as { project_id?: string }).project_id).filter(Boolean))) as string[];
  const conn = new Map<string, { refresh_token: string; login_customer_id: string | null }>();
  if (projectIds.length) {
    const { data } = await admin.from("google_ads_connections").select("project_id, refresh_token, login_customer_id").in("project_id", projectIds);
    for (const c of data ?? []) conn.set((c as { project_id: string }).project_id, { refresh_token: (c as { refresh_token: string }).refresh_token, login_customer_id: (c as { login_customer_id: string | null }).login_customer_id });
  }
  const atCache = new Map<string, string>();
  const atFor = async (rt: string) => { const c = atCache.get(rt); if (c) return c; const at = await getAccessToken(rt); atCache.set(rt, at); return at; };

  const results: Array<Record<string, unknown>> = [];
  for (const cab of cabinets) {
    const ext = (cab.external_id ?? "").trim();
    if (!ext) { results.push({ cabinet: ext, ok: false, error: "external_id missing" }); continue; }
    const customerId = normalizeCustomerId(ext);
    const projId = (cab as { project_id?: string }).project_id ?? "";
    const c = projId ? conn.get(projId) : undefined;
    const rt = c?.refresh_token ?? envRefresh;
    const login = c?.login_customer_id ?? envLogin;
    if (!rt) { results.push({ cabinet: ext, ok: false, error: "no refresh token" }); continue; }
    try {
      const at = await atFor(rt);
      // Кампании
      const campRows = await gaql(at, devToken, login, customerId,
        "SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign_budget.amount_micros FROM campaign");
      const campUpserts = campRows.map((r) => ({
        cabinet_id: cab.id, project_id: projId || null, customer_id: customerId,
        campaign_id: String(r.campaign?.id ?? ""),
        name: r.campaign?.name ?? null, status: r.campaign?.status ?? null,
        channel_type: r.campaign?.advertisingChannelType ?? null,
        budget_micros: r.campaignBudget?.amountMicros ? Number(r.campaignBudget.amountMicros) : null,
        last_synced_at: new Date().toISOString(),
      })).filter((c) => c.campaign_id);
      if (campUpserts.length) await admin.from("google_campaigns").upsert(campUpserts, { onConflict: "campaign_id" });

      // Дневная статистика по кампаниям
      const dayRows = await gaql(at, devToken, login, customerId,
        `SELECT campaign.id, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date BETWEEN '${since}' AND '${until}'`);
      const dayUpserts = dayRows.map((r) => ({
        campaign_id: String(r.campaign?.id ?? ""), cabinet_id: cab.id, project_id: projId || null,
        date: r.segments?.date,
        spend: Number(r.metrics?.costMicros ?? 0) / 1_000_000,
        impressions: Number(r.metrics?.impressions ?? 0),
        clicks: Number(r.metrics?.clicks ?? 0),
        leads: Number(r.metrics?.conversions ?? 0),
        revenue: Number(r.metrics?.conversionsValue ?? 0),
        currency: "KZT", synced_at: new Date().toISOString(),
      })).filter((r) => r.campaign_id && r.date);
      if (dayUpserts.length) await admin.from("google_campaign_daily").upsert(dayUpserts, { onConflict: "campaign_id,date" });

      // Группы объявлений
      const agRows = await gaql(at, devToken, login, customerId,
        "SELECT ad_group.id, ad_group.name, ad_group.status, campaign.id FROM ad_group");
      const agUpserts = agRows.map((r) => ({
        ad_group_id: String(r.adGroup?.id ?? ""), campaign_id: r.campaign?.id ? String(r.campaign.id) : null,
        project_id: projId || null, cabinet_id: cab.id,
        name: r.adGroup?.name ?? null, status: r.adGroup?.status ?? null,
        last_synced_at: new Date().toISOString(),
      })).filter((r) => r.ad_group_id);
      if (agUpserts.length) await admin.from("google_ad_groups").upsert(agUpserts, { onConflict: "ad_group_id" });

      // Объявления (креативы)
      const adRows = await gaql(at, devToken, login, customerId,
        "SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type, ad_group_ad.status, ad_group.id, campaign.id FROM ad_group_ad");
      const adUpserts = adRows.map((r) => ({
        ad_id: String(r.adGroupAd?.ad?.id ?? ""),
        ad_group_id: r.adGroup?.id ? String(r.adGroup.id) : null,
        campaign_id: r.campaign?.id ? String(r.campaign.id) : null,
        project_id: projId || null, cabinet_id: cab.id,
        name: r.adGroupAd?.ad?.name ?? null, type: r.adGroupAd?.ad?.type ?? null, status: r.adGroupAd?.status ?? null,
        last_synced_at: new Date().toISOString(),
      })).filter((r) => r.ad_id);
      if (adUpserts.length) await admin.from("google_creatives").upsert(adUpserts, { onConflict: "ad_id" });

      // Дневная статистика по объявлениям
      const adDayRows = await gaql(at, devToken, login, customerId,
        `SELECT ad_group_ad.ad.id, ad_group.id, campaign.id, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value FROM ad_group_ad WHERE segments.date BETWEEN '${since}' AND '${until}'`);
      const adDayUpserts = adDayRows.map((r) => ({
        ad_id: String(r.adGroupAd?.ad?.id ?? ""),
        ad_group_id: r.adGroup?.id ? String(r.adGroup.id) : null,
        campaign_id: r.campaign?.id ? String(r.campaign.id) : null,
        project_id: projId || null, cabinet_id: cab.id, date: r.segments?.date,
        spend: Number(r.metrics?.costMicros ?? 0) / 1_000_000,
        impressions: Number(r.metrics?.impressions ?? 0),
        clicks: Number(r.metrics?.clicks ?? 0),
        leads: Number(r.metrics?.conversions ?? 0),
        revenue: Number(r.metrics?.conversionsValue ?? 0),
        currency: "KZT", synced_at: new Date().toISOString(),
      })).filter((r) => r.ad_id && r.date);
      if (adDayUpserts.length) await admin.from("google_creative_daily").upsert(adDayUpserts, { onConflict: "ad_id,date" });

      results.push({ cabinet: ext, ok: true, campaigns: campUpserts.length, days: dayUpserts.length, adGroups: agUpserts.length, ads: adUpserts.length, adDays: adDayUpserts.length });
    } catch (e) {
      results.push({ cabinet: ext, ok: false, error: (e as Error).message });
    }
  }
  return json({ ok: true, since, until, results });
});
