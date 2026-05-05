import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function ymdToDmy(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${d}.${m}.${y}`;
}

function parseUsdFromXml(xml: string): number | null {
  // NBK RSS: <item><title>USD</title><description>470.12</description>...</item>
  const items = xml.split(/<item[\s>]/i).slice(1);
  for (const it of items) {
    const titleM = it.match(/<title>\s*([^<]+?)\s*<\/title>/i);
    const descM = it.match(/<description>\s*([^<]+?)\s*<\/description>/i);
    if (titleM && descM && titleM[1].trim().toUpperCase() === "USD") {
      const v = Number(descM[1].replace(",", "."));
      if (Number.isFinite(v) && v > 0) return v;
    }
  }
  return null;
}

async function fetchNbkRate(date: string): Promise<number | null> {
  // Try requested date, then walk back up to 7 days for weekends/holidays.
  for (let i = 0; i < 8; i++) {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - i);
    const ymd = d.toISOString().slice(0, 10);
    const url = `https://nationalbank.kz/rss/get_rates.cfm?fdate=${ymdToDmy(ymd)}`;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const xml = await res.text();
      const rate = parseUsdFromXml(xml);
      if (rate) return rate;
    } catch (_) { /* try next */ }
  }
  return null;
}

export async function getRate(
  admin: ReturnType<typeof createClient>,
  date: string,
): Promise<number | null> {
  const { data: cached } = await admin
    .from("fx_rates").select("usd_kzt").eq("date", date).maybeSingle();
  if (cached?.usd_kzt) return Number(cached.usd_kzt);
  const rate = await fetchNbkRate(date);
  if (rate) {
    await admin.from("fx_rates").upsert(
      { date, usd_kzt: rate, source: "nbk", fetched_at: new Date().toISOString() },
      { onConflict: "date" },
    );
  }
  return rate;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const date = url.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return new Response(JSON.stringify({ error: "invalid date" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const rate = await getRate(admin, date);
    return new Response(JSON.stringify({ date, usd_kzt: rate }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
