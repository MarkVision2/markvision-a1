// client-dashboard — read-only публичный API для клиентских dashboard'ов.
// GET /functions/v1/client-dashboard?token=mvd_xxx
// Авторизация через токен из public.client_dashboard_tokens.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type ScoreCat = "paid" | "hot" | "warm" | "cold" | "unknown";

function classify(score: number | null, isPaid: boolean, isScheduled: boolean): ScoreCat {
  if (isPaid) return "paid";
  if (isScheduled || (score ?? 0) >= 75) return "hot";
  if ((score ?? 0) >= 50) return "warm";
  if ((score ?? 0) > 0) return "cold";
  return "unknown";
}

function isoWeekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const tokenFromQuery = url.searchParams.get("token");
  let token = tokenFromQuery || "";
  if (!token && req.method === "POST") {
    try {
      const body = await req.json();
      token = body?.token || "";
    } catch { /* */ }
  }
  if (!token) return json({ error: "token required" }, 400);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SVC = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supa = createClient(SUPABASE_URL, SVC);

  // Validate token
  const { data: tok } = await supa
    .from("client_dashboard_tokens")
    .select("client_id, is_active, expires_at")
    .eq("token", token)
    .maybeSingle();
  if (!tok) return json({ error: "invalid token" }, 401);
  if (!tok.is_active) return json({ error: "token revoked" }, 401);
  if (tok.expires_at && new Date(tok.expires_at) < new Date()) {
    return json({ error: "token expired" }, 401);
  }

  // Client info — main supabase stores cabinet data in ad_cabinets, не clients_config.
  // Маппим: name (вместо client_name) → клиентское имя.
  const { data: clientRow } = await supa
    .from("ad_cabinets")
    .select("name, city, ad_account_id, currency, daily_budget, website_url")
    .eq("id", tok.client_id)
    .single();
  const client = clientRow
    ? { ...clientRow, client_name: (clientRow as any).name }
    : null;
  if (!client) return json({ error: "client not found" }, 404);

  // Leads from last 90 days
  const since = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
  let leads: Array<Record<string, unknown>> = [];
  if (client.ad_account_id) {
    const { data } = await supa
      .from("leads_crm")
      .select(
        "id, ai_score, score_label, status, created_at, last_message_at, capi_schedule_sent_at, capi_purchase_sent_at, purchase_value, auto_advance_stage",
      )
      .eq("fb_ad_account_id", client.ad_account_id)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(2000);
    leads = data ?? [];
  }

  // Aggregates
  const counts: Record<ScoreCat, number> = { paid: 0, hot: 0, warm: 0, cold: 0, unknown: 0 };
  const weeklyMap = new Map<string, Record<ScoreCat, number>>();
  let scheduled = 0;
  let paid = 0;
  let purchaseValueSum = 0;

  for (const l of leads) {
    const isPaid = !!l.capi_purchase_sent_at;
    const isScheduled = !!l.capi_schedule_sent_at || !!l.auto_advance_stage;
    if (isScheduled) scheduled += 1;
    if (isPaid) {
      paid += 1;
      purchaseValueSum += Number(l.purchase_value ?? 0);
    }
    const cat = classify(Number(l.ai_score ?? 0), isPaid, isScheduled);
    counts[cat] += 1;

    const wk = isoWeekKey(new Date(String(l.created_at)));
    const w = weeklyMap.get(wk) ?? { paid: 0, hot: 0, warm: 0, cold: 0, unknown: 0 };
    w[cat] += 1;
    weeklyMap.set(wk, w);
  }

  // Last 8 weeks (in chronological order)
  const now = new Date();
  const weeks: Array<{ week: string; counts: Record<ScoreCat, number> }> = [];
  for (let i = 7; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 7 * 24 * 3600 * 1000);
    const k = isoWeekKey(d);
    weeks.push({ week: k, counts: weeklyMap.get(k) ?? { paid: 0, hot: 0, warm: 0, cold: 0, unknown: 0 } });
  }

  const totalLeads = leads.length;
  const conversionScheduled = totalLeads > 0 ? scheduled / totalLeads : 0;
  const conversionPaid = scheduled > 0 ? paid / scheduled : 0;
  const conversionTotalToPaid = totalLeads > 0 ? paid / totalLeads : 0;

  return json({
    ok: true,
    client: {
      name: client.client_name,
      city: client.city,
      currency: client.currency || "USD",
      website_url: client.website_url,
    },
    period: { since, days: 90 },
    totals: {
      leads: totalLeads,
      scheduled,
      paid,
      purchase_value: purchaseValueSum,
      conversion_scheduled: conversionScheduled,
      conversion_paid: conversionPaid,
      conversion_total_to_paid: conversionTotalToPaid,
    },
    quality: counts,
    funnel: [
      { name: "Все лиды", value: totalLeads, cr: null },
      { name: "Записан на диагностику", value: scheduled, cr: conversionScheduled },
      { name: "Оплатил", value: paid, cr: conversionPaid },
    ],
    weekly: weeks,
    generated_at: new Date().toISOString(),
  });
});
