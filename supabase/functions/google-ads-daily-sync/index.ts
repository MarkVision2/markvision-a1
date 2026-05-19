// Google Ads daily sync.
// Tries to fetch daily insights for cabinets with provider='google' via the
// Google Ads API and writes them to cabinet_daily_insights.
//
// Env vars required:
//   GOOGLE_ADS_DEVELOPER_TOKEN
//   GOOGLE_ADS_OAUTH_CLIENT_ID
//   GOOGLE_ADS_OAUTH_CLIENT_SECRET
//   GOOGLE_ADS_OAUTH_REFRESH_TOKEN     — refresh token for the "manager" or login account
//   GOOGLE_ADS_LOGIN_CUSTOMER_ID       — manager account id (without dashes); optional
//
// Per-cabinet token override is supported via columns on ad_cabinets that we
// already have (access_token); the customer id is the ad_cabinets.external_id
// stripped of "customers/" prefix or any dashes.
//
// If env vars are not configured, this function returns 503 with a hint to
// post pre-aggregated data through `google-ads-intake` instead.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GOOGLE_ADS_API_VERSION = "v18";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
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
  return ymd(d);
}

function normalizeCustomerId(id: string): string {
  // "123-456-7890" -> "1234567890", "customers/123..." -> "123..."
  return id.replace(/^customers\//i, "").replace(/[^0-9]/g, "");
}

async function getAccessToken(refreshToken: string): Promise<string> {
  const clientId = Deno.env.get("GOOGLE_ADS_OAUTH_CLIENT_ID")!;
  const clientSecret = Deno.env.get("GOOGLE_ADS_OAUTH_CLIENT_SECRET")!;
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`oauth refresh failed: ${data?.error_description ?? r.status}`);
  return data.access_token as string;
}

interface GaqlRow {
  segments: { date: string };
  metrics: {
    cost_micros: string;
    impressions: string;
    clicks: string;
    conversions: string;
    conversions_value: string;
  };
}

async function runGaql(
  accessToken: string,
  developerToken: string,
  loginCustomerId: string | null,
  customerId: string,
  query: string,
): Promise<GaqlRow[]> {
  const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}/googleAds:searchStream`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": developerToken,
    "Content-Type": "application/json",
  };
  if (loginCustomerId) headers["login-customer-id"] = loginCustomerId;
  const r = await fetch(url, { method: "POST", headers, body: JSON.stringify({ query }) });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`google ads api ${r.status}: ${txt.slice(0, 300)}`);
  }
  // searchStream returns an array of batches: [{ results: [...] }, ...]
  const batches = (await r.json()) as Array<{ results?: GaqlRow[] }>;
  const out: GaqlRow[] = [];
  for (const b of batches) for (const row of b.results ?? []) out.push(row);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // SECURITY: require either the shared cron secret OR an admin JWT.
  const cronSecret = Deno.env.get("CAPI_WORKER_KEY") || Deno.env.get("N8N_CALLBACK_SECRET");
  const providedSecret = req.headers.get("x-cron-secret");
  let authorized = false;
  if (cronSecret && providedSecret && providedSecret === cronSecret) {
    authorized = true;
  } else {
    const authHeader = req.headers.get("Authorization") || "";
    if (authHeader.startsWith("Bearer ")) {
      try {
        const authedClient = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_ANON_KEY")!,
          { global: { headers: { Authorization: authHeader } } },
        );
        const token = authHeader.replace("Bearer ", "");
        const { data: claims } = await authedClient.auth.getClaims(token);
        const uid = claims?.claims?.sub;
        if (uid) {
          const { data: roleRow } = await authedClient
            .from("user_roles").select("role").eq("user_id", uid).eq("role", "admin").maybeSingle();
          if (roleRow) authorized = true;
        }
      } catch (_e) { /* deny */ }
    }
  }
  if (!authorized) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }


  const developerToken = Deno.env.get("GOOGLE_ADS_DEVELOPER_TOKEN");
  const refreshToken = Deno.env.get("GOOGLE_ADS_OAUTH_REFRESH_TOKEN");
  if (!developerToken || !refreshToken) {
    return json(
      {
        ok: false,
        error: "google_ads_not_configured",
        hint: "Set GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_OAUTH_CLIENT_ID/SECRET, GOOGLE_ADS_OAUTH_REFRESH_TOKEN in edge function secrets. Or POST aggregated daily rows to /functions/v1/google-ads-intake.",
      },
      503,
    );
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: Record<string, unknown> = {};
  if (req.method === "POST") body = await req.json().catch(() => ({}));
  const url = new URL(req.url);
  const qpDate = url.searchParams.get("date") ?? (body.date as string | undefined) ?? null;
  const qpSince = url.searchParams.get("since") ?? (body.since as string | undefined) ?? null;
  const qpUntil = url.searchParams.get("until") ?? (body.until as string | undefined) ?? null;
  const qpCabinetId = url.searchParams.get("cabinet_id") ?? (body.cabinet_id as string | undefined) ?? null;

  const isYmd = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  let since: string;
  let until: string;
  if (isYmd(qpSince) && isYmd(qpUntil)) {
    since = qpSince!; until = qpUntil!;
  } else if (isYmd(qpDate)) {
    since = qpDate!; until = qpDate!;
  } else {
    const yesterdayAlmaty = addDaysYmd(ymdInTimeZone(new Date(), "Asia/Almaty"), -1);
    since = until = yesterdayAlmaty;
  }
  if (since > until) [since, until] = [until, since];

  // Cabinet selection — only providers='google'.
  let cabQuery = admin.from("ad_cabinets").select("id, external_id, project_id, provider").eq("provider", "google");
  if (qpCabinetId) cabQuery = cabQuery.eq("id", qpCabinetId);
  const { data: cabinets, error: cabErr } = await cabQuery;
  if (cabErr) return json({ ok: false, error: cabErr.message }, 500);

  if (!cabinets || cabinets.length === 0) {
    return json({ ok: true, since, until, results: [], note: "no Google Ads cabinets configured" });
  }

  const loginCustomerId = Deno.env.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID") || null;
  let accessToken: string;
  try {
    accessToken = await getAccessToken(refreshToken);
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  }

  const gaql = `
    SELECT
      segments.date,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.conversions_value
    FROM customer
    WHERE segments.date BETWEEN '${since}' AND '${until}'
  `;

  const results: Array<Record<string, unknown>> = [];
  for (const cab of cabinets) {
    const ext = (cab.external_id ?? "").trim();
    if (!ext) { results.push({ cabinet: ext, ok: false, error: "external_id missing" }); continue; }
    const customerId = normalizeCustomerId(ext);
    try {
      const rows = await runGaql(accessToken, developerToken, loginCustomerId, customerId, gaql);
      const upserts: Array<Record<string, unknown>> = [];
      let totSpend = 0, totLeads = 0, totClicks = 0, totRevenue = 0;
      for (const r of rows) {
        const date = r.segments?.date;
        if (!date) continue;
        const spend = Number(r.metrics?.cost_micros ?? 0) / 1_000_000;
        const impressions = Number(r.metrics?.impressions ?? 0);
        const clicks = Number(r.metrics?.clicks ?? 0);
        const leads = Number(r.metrics?.conversions ?? 0);
        const revenue = Number(r.metrics?.conversions_value ?? 0);
        const cpl = leads > 0 ? spend / leads : 0;
        const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
        const cpc = clicks > 0 ? spend / clicks : 0;
        const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
        upserts.push({
          cabinet_id: cab.id,
          external_id: ext,
          project_id: (cab as { project_id?: string }).project_id ?? null,
          date,
          spend, impressions, clicks, leads, revenue,
          cpl, cpm, cpc, ctr,
          currency: "KZT",
          provider: "google",
          synced_at: new Date().toISOString(),
        });
        totSpend += spend; totLeads += leads; totClicks += clicks; totRevenue += revenue;
      }
      if (upserts.length > 0) {
        const { error: upErr } = await admin
          .from("cabinet_daily_insights")
          .upsert(upserts, { onConflict: "external_id,date" });
        if (upErr) { results.push({ cabinet: ext, ok: false, error: upErr.message }); continue; }
      }
      results.push({ cabinet: ext, ok: true, days: upserts.length, spend: totSpend, leads: totLeads, clicks: totClicks, revenue: totRevenue });
    } catch (e) {
      results.push({ cabinet: ext, ok: false, error: (e as Error).message });
    }
  }

  return json({ ok: true, since, until, count: results.length, results });
});
