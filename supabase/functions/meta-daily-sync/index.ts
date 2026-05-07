import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const META_API_VERSION = "v21.0";

// "Лиды с сайта / лид-формы" — берём максимум среди вариантов одного и того же события,
// чтобы не задвоить (Meta часто дублирует одно и то же действие под разными именами).
const LEAD_ACTIONS = [
  "lead",
  "leadgen.other",
  "onsite_conversion.lead_grouped",
  "offsite_conversion.fb_pixel_lead",
  "onsite_web_lead",
];
// "Начатые переписки" — отдельное событие, считаем как лид и СУММИРУЕМ с лидами выше.
const MESSAGING_ACTIONS = [
  "onsite_conversion.messaging_conversation_started_7d",
  "onsite_conversion.messaging_first_reply",
  "onsite_conversion.total_messaging_connection",
];
const PURCHASE_ACTIONS = [
  "purchase",
  "offsite_conversion.fb_pixel_purchase",
  "omni_purchase",
];

function maxAction(actions: Array<{ action_type: string; value: string }> | undefined, types: string[]) {
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
function sumActions(actions: Array<{ action_type: string; value: string }> | undefined, types: string[]) {
  if (!actions) return 0;
  return actions.filter((a) => types.includes(a.action_type)).reduce((s, a) => s + Number(a.value || 0), 0);
}
function normalizeActId(id: string) {
  const t = id.trim();
  if (/^act_\d+$/i.test(t)) return `act_${t.replace(/^act_/i, "")}`;
  if (/^\d+$/.test(t)) return `act_${t}`;
  return t;
}
function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

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
  for (const r of (data ?? []) as Array<{ date: string; usd_kzt: number | string }>) {
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN");
    if (!META_ACCESS_TOKEN) {
      return new Response(JSON.stringify({ error: "META_ACCESS_TOKEN missing" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Read params: date | since/until | cabinet_id (from query OR JSON body).
    const url = new URL(req.url);
    let body: Record<string, unknown> = {};
    if (req.method === "POST") body = await req.json().catch(() => ({}));
    const qpDate = url.searchParams.get("date") ?? (body.date as string | undefined) ?? null;
    const qpSince = url.searchParams.get("since") ?? (body.since as string | undefined) ?? null;
    const qpUntil = url.searchParams.get("until") ?? (body.until as string | undefined) ?? null;
    const qpCabinetId = url.searchParams.get("cabinet_id") ?? (body.cabinet_id as string | undefined) ?? null;

    const isYmd = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

    let since: string;
    let until: string;
    if (isYmd(qpSince) && isYmd(qpUntil)) {
      since = qpSince!;
      until = qpUntil!;
    } else if (isYmd(qpDate)) {
      since = qpDate!;
      until = qpDate!;
    } else {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - 1);
      since = until = ymd(d);
    }
    if (since > until) [since, until] = [until, since];

    let cabQuery = admin.from("ad_cabinets").select("id, external_id, project_id");
    if (qpCabinetId) cabQuery = cabQuery.eq("id", qpCabinetId);
    const { data: cabinets, error: cabErr } = await cabQuery;
    if (cabErr) throw cabErr;

    const results: Array<Record<string, unknown>> = [];

    for (const cab of cabinets ?? []) {
      const ext = (cab.external_id ?? "").trim();
      if (!ext) continue;
      const actId = normalizeActId(ext);

      const fields = ["date_start", "spend", "impressions", "clicks", "actions", "action_values"].join(",");
      const timeRange = encodeURIComponent(JSON.stringify({ since, until }));
      const apiUrl =
        `https://graph.facebook.com/${META_API_VERSION}/${actId}/insights` +
        `?fields=${fields}&time_range=${timeRange}&time_increment=1&level=account&limit=500` +
        `&access_token=${encodeURIComponent(META_ACCESS_TOKEN)}`;
      const accountUrl =
        `https://graph.facebook.com/${META_API_VERSION}/${actId}` +
        `?fields=currency&access_token=${encodeURIComponent(META_ACCESS_TOKEN)}`;

      try {
        const [iRes, aRes] = await Promise.all([fetch(apiUrl), fetch(accountUrl)]);
        const iJson = await iRes.json();
        const aJson = await aRes.json().catch(() => ({}));
        if (!iRes.ok) {
          results.push({ cabinet: ext, ok: false, error: iJson?.error?.message ?? "meta error" });
          continue;
        }
        const accountCurrency: string = aJson?.currency ?? "USD";
        const rawRows = (iJson.data ?? []) as Array<Record<string, unknown>>;
        const dates = Array.from(new Set(
          rawRows.map((r) => String(r?.date_start ?? "")).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
        ));
        const needConvert = accountCurrency !== "KZT";
        const ratesMap = needConvert ? await getRatesForDates(admin, dates) : new Map<string, number>();

        const rows: Array<Record<string, unknown>> = [];
        let totalSpend = 0, totalLeads = 0, totalClicks = 0, totalRevenue = 0;
        for (const row of rawRows) {
          const date = String(row?.date_start ?? "");
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
          let spend = Number(row?.spend ?? 0);
          const impressions = Number(row?.impressions ?? 0);
          const clicks = Number(row?.clicks ?? 0);
          const leads = maxAction(row?.actions as any, LEAD_ACTIONS);
          let revenue = sumActions(row?.action_values as any, PURCHASE_ACTIONS);
          let storedCurrency = accountCurrency;
          if (needConvert) {
            const rate = ratesMap.get(date);
            if (rate) {
              spend = spend * rate;
              revenue = revenue * rate;
              storedCurrency = "KZT";
            }
          }
          const cpl = leads > 0 ? spend / leads : 0;
          const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
          const cpc = clicks > 0 ? spend / clicks : 0;
          const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
          rows.push({
            cabinet_id: cab.id,
            external_id: actId,
            project_id: (cab as any).project_id ?? null,
            date,
            spend, impressions, clicks, leads, revenue,
            cpl, cpm, cpc, ctr,
            currency: storedCurrency,
            synced_at: new Date().toISOString(),
          });
          totalSpend += spend; totalLeads += leads; totalClicks += clicks; totalRevenue += revenue;
        }
        if (rows.length > 0) {
          const { error: upErr } = await admin
            .from("cabinet_daily_insights")
            .upsert(rows, { onConflict: "external_id,date" });
          if (upErr) {
            results.push({ cabinet: ext, ok: false, error: upErr.message });
            continue;
          }
        }
        results.push({
          cabinet: ext, ok: true,
          since, until, days: rows.length,
          spend: totalSpend, leads: totalLeads, clicks: totalClicks, revenue: totalRevenue,
        });
        console.log(
          `[meta-daily-sync] cabinet=${ext} project=${(cab as any).project_id ?? "—"} ` +
          `range=${since}..${until} days=${rows.length} spend=${totalSpend.toFixed(2)} ` +
          `leads=${totalLeads} clicks=${totalClicks} revenue=${totalRevenue.toFixed(2)}`,
        );
      } catch (e) {
        results.push({ cabinet: ext, ok: false, error: (e as Error).message });
      }
    }

    return new Response(JSON.stringify({ since, until, count: results.length, results }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
