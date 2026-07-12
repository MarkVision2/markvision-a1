// Google Ads offline conversions: отгружает реальные продажи/заявки из CRM
// обратно в Google Ads по gclid (uploadClickConversions), чтобы Smart Bidding
// оптимизировался на деньги. Идемпотентно через google_offline_conversions.
//
// Требует на подключении проекта заданный conversion_action_sale (resource name
// "customers/{cid}/conversionActions/{id}") — создаётся в Google Ads как
// конверсия типа Import. conversion_action_lead — опционально для заявок.
//
// Авторизация: shared cron secret (x-cron-secret) ИЛИ админский JWT.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const API = "v18";
const MAX_PER_RUN = 200;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function normalizeCustomerId(id: string) { return id.replace(/^customers\//i, "").replace(/[^0-9]/g, ""); }
// Google хочет "yyyy-MM-dd HH:mm:ss+00:00".
function gAdsTime(iso: string): string {
  const d = new Date(iso); const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}+00:00`;
}

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

interface ConvRow { lead_id: string; gclid: string; action: string; time: string; value: number; currency: string; type: string; }

// deno-lint-ignore no-explicit-any
async function uploadBatch(accessToken: string, devToken: string, login: string | null, customerId: string, rows: ConvRow[]): Promise<any> {
  const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}`, "developer-token": devToken, "Content-Type": "application/json" };
  if (login) headers["login-customer-id"] = normalizeCustomerId(login);
  const conversions = rows.map((r) => ({
    gclid: r.gclid,
    conversionAction: r.action,
    conversionDateTime: r.time,
    conversionValue: r.value,
    currencyCode: r.currency,
  }));
  const r = await fetch(`https://googleads.googleapis.com/${API}/customers/${customerId}:uploadClickConversions`, {
    method: "POST", headers, body: JSON.stringify({ conversions, partialFailure: true }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`upload ${r.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!(await isAuthorized(req))) return json({ ok: false, error: "unauthorized" }, 401);

  const devToken = Deno.env.get("GOOGLE_ADS_DEVELOPER_TOKEN");
  if (!devToken) return json({ ok: false, error: "google_ads_not_configured" }, 503);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const envLogin = Deno.env.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID") || null;

  // Подключения с настроенным конверсионным действием.
  const { data: conns } = await admin
    .from("google_ads_connections")
    .select("project_id, refresh_token, login_customer_id, conversion_action_sale, conversion_action_lead");
  const list = (conns ?? []).filter((c) => (c as { conversion_action_sale?: string }).conversion_action_sale || (c as { conversion_action_lead?: string }).conversion_action_lead);
  if (list.length === 0) return json({ ok: true, results: [], note: "no conversion actions configured" });

  const results: Array<Record<string, unknown>> = [];
  for (const c of list) {
    const conn = c as { project_id: string; refresh_token: string; login_customer_id: string | null; conversion_action_sale: string | null; conversion_action_lead: string | null };
    const projId = conn.project_id;
    try {
      // Основной google-кабинет проекта → customerId для загрузки.
      const { data: cab } = await admin.from("ad_cabinets")
        .select("external_id").eq("project_id", projId).eq("provider", "google")
        .order("created_at", { ascending: true }).limit(1).maybeSingle();
      const customerId = cab ? normalizeCustomerId((cab as { external_id: string }).external_id) : null;
      if (!customerId) { results.push({ project: projId, ok: false, error: "no google cabinet" }); continue; }

      const login = conn.login_customer_id ?? envLogin;
      const accessToken = await getAccessToken(conn.refresh_token);

      // Уже отгруженные — чтобы не дублировать.
      const { data: done } = await admin.from("google_offline_conversions").select("lead_id, action_type").eq("project_id", projId);
      const doneSet = new Set((done ?? []).map((d) => `${(d as { lead_id: string }).lead_id}:${(d as { action_type: string }).action_type}`));

      const rows: ConvRow[] = [];

      // ПРОДАЖИ: оплаченные лиды с gclid.
      if (conn.conversion_action_sale) {
        const { data: sales } = await admin.from("leads")
          .select("id, gclid, amount, paid_at")
          .eq("project_id", projId).eq("paid", true)
          .not("gclid", "is", null).not("paid_at", "is", null)
          .order("paid_at", { ascending: false }).limit(MAX_PER_RUN);
        for (const l of sales ?? []) {
          const lead = l as { id: string; gclid: string; amount: number | null; paid_at: string };
          if (doneSet.has(`${lead.id}:sale`)) continue;
          rows.push({ lead_id: lead.id, gclid: lead.gclid, action: conn.conversion_action_sale, time: gAdsTime(lead.paid_at), value: Number(lead.amount ?? 0), currency: "KZT", type: "sale" });
        }
      }

      // ЗАЯВКИ (опц.): первый контакт с gclid.
      if (conn.conversion_action_lead) {
        const { data: leadsRows } = await admin.from("leads")
          .select("id, gclid, first_touch_at, created_at")
          .eq("project_id", projId).not("gclid", "is", null)
          .order("created_at", { ascending: false }).limit(MAX_PER_RUN);
        for (const l of leadsRows ?? []) {
          const lead = l as { id: string; gclid: string; first_touch_at: string | null; created_at: string };
          if (doneSet.has(`${lead.id}:lead`)) continue;
          rows.push({ lead_id: lead.id, gclid: lead.gclid, action: conn.conversion_action_lead, time: gAdsTime(lead.first_touch_at ?? lead.created_at), value: 0, currency: "KZT", type: "lead" });
        }
      }

      if (rows.length === 0) { results.push({ project: projId, ok: true, uploaded: 0 }); continue; }

      const batch = rows.slice(0, MAX_PER_RUN);
      const resp = await uploadBatch(accessToken, devToken, login, customerId, batch);
      const apiResults = (resp?.results ?? []) as Array<Record<string, unknown>>;

      const logRows = batch.map((r, i) => {
        const ok = !!(apiResults[i] && Object.keys(apiResults[i]).length > 0);
        return {
          project_id: projId, lead_id: r.lead_id, gclid: r.gclid, customer_id: customerId,
          action_type: r.type, conversion_time: new Date(r.time.replace(" ", "T")).toISOString(),
          value: r.value, currency: r.currency,
          status: ok ? "uploaded" : "error",
          error: ok ? null : (resp?.partialFailureError ? JSON.stringify(resp.partialFailureError).slice(0, 400) : "unknown"),
        };
      });
      await admin.from("google_offline_conversions").upsert(logRows, { onConflict: "lead_id,action_type", ignoreDuplicates: true });
      const uploaded = logRows.filter((r) => r.status === "uploaded").length;
      results.push({ project: projId, ok: true, uploaded, failed: logRows.length - uploaded });
    } catch (e) {
      results.push({ project: projId, ok: false, error: (e as Error).message });
    }
  }
  return json({ ok: true, results });
});
