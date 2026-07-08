// API раздела «Контент-аналитика» — агрегатный макро-дашборд органического контента.
// По образцу content-center: verify_jwt=false, внутри service role, зовёт RPC cf_content_analytics.
//
// project_id (опционально): при передаче RPC считает по мультитенантным
// таблицам (instagram_media/instagram_account_daily) конкретного проекта.
// Без project_id — легаси-поведение (единый глобальный аккаунт).
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
function ymd(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const url = new URL(req.url);
  let from = url.searchParams.get("from");
  let to = url.searchParams.get("to");
  let projectId: string | null = url.searchParams.get("project_id");
  if (req.method === "POST") {
    const b = await req.json().catch(() => ({} as Record<string, unknown>));
    from = (b.from as string) ?? from;
    to = (b.to as string) ?? to;
    projectId = (b.project_id as string) ?? projectId;
  }

  const now = new Date();
  if (!from) from = ymd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
  if (!to) to = ymd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)));

  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(from) || !re.test(to)) return json({ error: "bad_period", from, to }, 400);

  const r = await fetch(`${SB_URL}/rest/v1/rpc/cf_content_analytics`, {
    method: "POST",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_from: from, p_to: to, p_project_id: projectId || null }),
  });
  const text = await r.text();
  if (!r.ok) return json({ error: "rpc_failed", status: r.status, detail: text }, 500);
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return json(data ?? { from, to, kpis: {}, trend: [], by_format: [], top_posts: [], bottom_posts: [], followers: {}, production: {} });
});
