import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

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

    // Determine target date — default = yesterday (UTC).
    const url = new URL(req.url);
    let dateParam = url.searchParams.get("date");
    let body: Record<string, unknown> = {};
    if (!dateParam && (req.method === "POST")) {
      body = await req.json().catch(() => ({}));
      dateParam = (body.date as string) ?? null;
    }
    let target: string;
    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      target = dateParam;
    } else {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - 1);
      target = ymd(d);
    }

    const { data: cabinets, error: cabErr } = await admin
      .from("ad_cabinets")
      .select("id, external_id");
    if (cabErr) throw cabErr;

    const results: Array<Record<string, unknown>> = [];

    for (const cab of cabinets ?? []) {
      const ext = (cab.external_id ?? "").trim();
      if (!ext) continue;
      const actId = normalizeActId(ext);

      const fields = ["date_start", "spend", "impressions", "clicks", "actions", "action_values"].join(",");
      const timeRange = encodeURIComponent(JSON.stringify({ since: target, until: target }));
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
        const currency: string = aJson?.currency ?? "USD";
        const row = (iJson.data ?? [])[0];
        const spend = Number(row?.spend ?? 0);
        const impressions = Number(row?.impressions ?? 0);
        const clicks = Number(row?.clicks ?? 0);
        const leads = maxAction(row?.actions, LEAD_ACTIONS);
        const revenue = sumActions(row?.action_values, PURCHASE_ACTIONS);
        const cpl = leads > 0 ? spend / leads : 0;
        const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
        const cpc = clicks > 0 ? spend / clicks : 0;
        const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;

        const { error: upErr } = await admin
          .from("cabinet_daily_insights")
          .upsert({
            cabinet_id: cab.id,
            external_id: actId,
            date: target,
            spend, impressions, clicks, leads, revenue,
            cpl, cpm, cpc, ctr,
            currency,
            synced_at: new Date().toISOString(),
          }, { onConflict: "external_id,date" });
        if (upErr) {
          results.push({ cabinet: ext, ok: false, error: upErr.message });
          continue;
        }
        results.push({ cabinet: ext, ok: true, date: target, spend, leads, clicks, revenue });
      } catch (e) {
        results.push({ cabinet: ext, ok: false, error: (e as Error).message });
      }
    }

    return new Response(JSON.stringify({ date: target, count: results.length, results }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
