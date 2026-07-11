import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { requireUser, requireMetaAdAccountAccess } from "../_lib/auth.ts";
import { resolveMetaAccessToken } from "../_lib/metaToken.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const META_API_VERSION = "v21.0";

interface DailyRow {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  revenue: number;
}

interface InsightsResponse {
  currency: string;
  totals: {
    spend: number;
    impressions: number;
    clicks: number;
    leads: number;
    revenue: number;
    cpl: number;
    cpm: number;
    cpc: number;
    ctr: number;
    romi: number;
  };
  daily: DailyRow[];
}

function monthRange(month: string): { since: string; until: string } | null {
  // month format: YYYY-MM
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  const year = Number(m[1]);
  const monthIdx = Number(m[2]) - 1;
  if (monthIdx < 0 || monthIdx > 11) return null;
  const first = new Date(Date.UTC(year, monthIdx, 1));
  const last = new Date(Date.UTC(year, monthIdx + 1, 0));
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { since: fmt(first), until: fmt(last) };
}

function normalizeActId(id: string): string {
  // Accept "act_123", "ACT_123", "123" — return "act_123"
  const trimmed = id.trim();
  if (/^act_\d+$/i.test(trimmed)) return `act_${trimmed.replace(/^act_/i, "")}`;
  if (/^\d+$/.test(trimmed)) return `act_${trimmed}`;
  return trimmed;
}

function maxAction(
  actions: Array<{ action_type: string; value: string }> | undefined,
  types: string[],
): number {
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
): number {
  if (!actions) return 0;
  return actions
    .filter((a) => types.includes(a.action_type))
    .reduce((acc, a) => acc + Number(a.value || 0), 0);
}

const PURCHASE_ACTIONS = [
  "purchase",
  "offsite_conversion.fb_pixel_purchase",
  "omni_purchase",
];

// Lead actions — we take the MAX across these (not sum) because Meta often
// double-reports the same lead under multiple action_types (e.g. `lead` +
// `offsite_conversion.fb_pixel_lead`).
const LEAD_ACTIONS = [
  "lead",
  "leadgen.other",
  "onsite_conversion.lead_grouped",
  "offsite_conversion.fb_pixel_lead",
  "onsite_web_lead",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const auth = await requireUser(req);
    if (!auth.ok) return auth.response;

    const url = new URL(req.url);
    const rawActId = url.searchParams.get("actId");
    const month = url.searchParams.get("month"); // YYYY-MM
    if (!rawActId || !month) {
      return new Response(
        JSON.stringify({ error: "actId and month (YYYY-MM) are required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    const range = monthRange(month);
    if (!range) {
      return new Response(
        JSON.stringify({ error: "month must be in YYYY-MM format" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const actId = normalizeActId(rawActId);

    // Tenant authorization: caller must have RLS access to a cabinet that
    // matches this Meta ad account id.
    const acctAccess = await requireMetaAdAccountAccess(auth.authHeader, actId);
    if (!acctAccess.ok) return acctAccess.response;

    // Токен кабинета (OAuth) в приоритете; общий — запасной.
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: cab } = await admin
      .from("ad_cabinets")
      .select("access_token")
      .or(`external_id.eq.${actId},ad_account_id.eq.${actId}`)
      .limit(1)
      .maybeSingle();
    const cabTok = String((cab as { access_token?: string | null } | null)?.access_token || "").trim();
    const fallbackTok = await resolveMetaAccessToken({ admin });
    const tokens = [...new Set([cabTok, fallbackTok].filter((t): t is string => !!t))];
    if (tokens.length === 0) {
      return new Response(
        JSON.stringify({ error: "Нет Meta-токена для кабинета. Подключите его через Facebook." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const fields = [
      "date_start",
      "spend",
      "impressions",
      "clicks",
      "actions",
      "action_values",
    ].join(",");
    const timeRange = encodeURIComponent(
      JSON.stringify({ since: range.since, until: range.until }),
    );

    const insightsUrl = (tk: string) =>
      `https://graph.facebook.com/${META_API_VERSION}/${actId}/insights` +
      `?fields=${fields}&time_range=${timeRange}&time_increment=1&level=account&limit=500` +
      `&access_token=${encodeURIComponent(tk)}`;
    const currencyUrl = (tk: string) =>
      `https://graph.facebook.com/${META_API_VERSION}/${actId}` +
      `?fields=currency&access_token=${encodeURIComponent(tk)}`;

    // Перебор токенов: кабинетный → общий запасной, берём первый рабочий.
    let metaResp = await fetch(insightsUrl(tokens[0]));
    let usedTok = tokens[0];
    for (let ti = 1; ti < tokens.length && !metaResp.ok; ti++) {
      usedTok = tokens[ti];
      metaResp = await fetch(insightsUrl(usedTok));
    }
    const accountResp = await fetch(currencyUrl(usedTok));
    const metaJson = await metaResp.json();
    const accountJson = await accountResp.json().catch(() => ({}));
    if (!metaResp.ok) {
      return new Response(
        JSON.stringify({
          error: "Meta API error",
          status: metaResp.status,
          details: metaJson?.error ?? metaJson,
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const accountCurrency: string = accountJson?.currency ?? "USD";

    let rows: DailyRow[] = ((metaJson.data ?? []) as Array<{
      date_start: string;
      spend?: string;
      impressions?: string;
      clicks?: string;
      actions?: Array<{ action_type: string; value: string }>;
      action_values?: Array<{ action_type: string; value: string }>;
    }>).map((r) => ({
      date: r.date_start,
      spend: Number(r.spend ?? 0),
      impressions: Number(r.impressions ?? 0),
      clicks: Number(r.clicks ?? 0),
      leads: maxAction(r.actions, LEAD_ACTIONS),
      revenue: sumActions(r.action_values, PURCHASE_ACTIONS),
    }));

    let displayCurrency = accountCurrency;
    if (accountCurrency !== "KZT" && rows.length > 0) {
      try {
        const admin = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        const dates = Array.from(new Set(rows.map((r) => r.date)));
        const { data: cached } = await admin.from("fx_rates").select("date, usd_kzt").in("date", dates);
        const map = new Map<string, number>();
        for (const c of (cached ?? []) as Array<{ date: string; usd_kzt: number | string }>) {
          map.set(c.date, Number(c.usd_kzt));
        }
        rows = rows.map((r) => {
          const rate = map.get(r.date);
          if (!rate) return r;
          return { ...r, spend: r.spend * rate, revenue: r.revenue * rate };
        });
        if (rows.every((r) => map.has(r.date))) displayCurrency = "KZT";
        else if (rows.some((r) => map.has(r.date))) displayCurrency = "KZT";
      } catch (_) { /* fall back to original currency */ }
    }

    const totals = rows.reduce(
      (acc, r) => {
        acc.spend += r.spend;
        acc.impressions += r.impressions;
        acc.clicks += r.clicks;
        acc.leads += r.leads;
        acc.revenue += r.revenue;
        return acc;
      },
      { spend: 0, impressions: 0, clicks: 0, leads: 0, revenue: 0 },
    );

    const cpl = totals.leads > 0 ? totals.spend / totals.leads : 0;
    const cpm =
      totals.impressions > 0 ? (totals.spend / totals.impressions) * 1000 : 0;
    const cpc = totals.clicks > 0 ? totals.spend / totals.clicks : 0;
    const ctr =
      totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
    const romi =
      totals.spend > 0 ? ((totals.revenue - totals.spend) / totals.spend) * 100 : 0;

    const response: InsightsResponse = {
      currency: displayCurrency,
      totals: { ...totals, cpl, cpm, cpc, ctr, romi },
      daily: rows,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("meta-insights error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});