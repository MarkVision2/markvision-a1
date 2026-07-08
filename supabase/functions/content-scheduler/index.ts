// API планировщика автопостинга v5: CRUD cf_scheduled_posts + publish_now + stats + cover_url для Reels.
// verify_jwt=false, защита заголовком x-app-key == cf_settings.client_pub_key.
//
// project_id (опционально): очередь постов теперь может быть привязана к
// проекту CRM — publisher публикует такие посты через Instagram-аккаунт
// именно этого проекта (instagram_accounts), а не через один глобальный
// аккаунт из cf_settings. Записи без project_id — легаси, как раньше.
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H: Record<string, string> = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-app-key",
};
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
async function db(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers as Record<string, string> || {}) } });
  const t = await r.text();
  let body: unknown = null;
  try { body = t ? JSON.parse(t) : null; } catch { body = t; }
  return { ok: r.ok, status: r.status, body };
}
async function setting(k: string) { return ((await db(`cf_settings?key=eq.${k}&select=value`)).body as { value: string }[] | null)?.[0]?.value; }

const TYPES = ["IMAGE", "REELS", "STORIES", "CAROUSEL"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const appKey = req.headers.get("x-app-key") ?? "";
  const expected = await setting("client_pub_key");
  if (!expected || appKey !== expected) return json({ ok: false, error: "forbidden" }, 403);

  const b = await req.json().catch(() => ({} as Record<string, unknown>));
  const action = String(b.action ?? "list");
  const projectId = typeof b.project_id === "string" && b.project_id ? b.project_id : null;

  if (action === "list") {
    const filter = projectId ? `&project_id=eq.${projectId}` : "";
    const { body } = await db(`cf_scheduled_posts?select=*${filter}&order=scheduled_at.desc&limit=200`);
    return json({ ok: true, posts: body ?? [] });
  }

  if (action === "stats") {
    const from = String(b.from ?? ""), to = String(b.to ?? "");
    const re = /^\d{4}-\d{2}-\d{2}$/;
    if (!re.test(from) || !re.test(to)) return json({ ok: false, error: "bad period" }, 400);
    const r = await fetch(`${SB_URL}/rest/v1/rpc/cf_autopost_stats`, { method: "POST", headers: { ...H }, body: JSON.stringify({ p_from: from, p_to: to, p_project_id: projectId }) });
    const t = await r.text();
    let data: unknown = null; try { data = t ? JSON.parse(t) : null; } catch { /* */ }
    if (!r.ok) return json({ ok: false, error: "rpc", detail: t }, 500);
    return json({ ok: true, stats: data });
  }

  if (action === "create") {
    const media_type = String(b.media_type ?? "IMAGE").toUpperCase();
    if (!TYPES.includes(media_type)) return json({ ok: false, error: "bad media_type" }, 400);
    const caption = typeof b.caption === "string" ? b.caption : "";
    const scheduled_at = b.scheduled_at ? new Date(String(b.scheduled_at)).toISOString() : null;
    if (!scheduled_at || isNaN(Date.parse(scheduled_at))) return json({ ok: false, error: "bad scheduled_at" }, 400);
    if (caption.length > 2200) return json({ ok: false, error: "caption > 2200" }, 400);

    const row: Record<string, unknown> = { media_type, caption, scheduled_at, status: "queued", dry_run: b.dry_run === true, project_id: projectId };
    if (media_type === "CAROUSEL") {
      const urls = Array.isArray(b.child_urls) ? (b.child_urls as string[]).filter((u) => typeof u === "string" && u) : [];
      if (urls.length < 2 || urls.length > 10) return json({ ok: false, error: "карусель: 2–10 элементов" }, 400);
      row.child_urls = urls; row.media_url = urls[0]; row.thumbnail_url = b.thumbnail_url ?? urls[0];
    } else {
      if (!b.media_url || typeof b.media_url !== "string") return json({ ok: false, error: "media_url обязателен" }, 400);
      row.media_url = b.media_url;
      if (media_type === "REELS" && typeof b.cover_url === "string" && b.cover_url) {
        row.cover_url = b.cover_url; row.thumbnail_url = b.cover_url;
      } else {
        row.thumbnail_url = b.thumbnail_url ?? (media_type === "IMAGE" ? b.media_url : null);
      }
    }
    const { ok, body, status } = await db(`cf_scheduled_posts`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row) });
    if (!ok) return json({ ok: false, error: "db", detail: body }, status);
    return json({ ok: true, post: Array.isArray(body) ? body[0] : body });
  }

  if (action === "update") {
    const id = String(b.id ?? "");
    if (!id) return json({ ok: false, error: "id" }, 400);
    const upd: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof b.caption === "string") upd.caption = b.caption;
    if (b.scheduled_at) {
      const iso = new Date(String(b.scheduled_at)).toISOString();
      if (isNaN(Date.parse(iso))) return json({ ok: false, error: "bad scheduled_at" }, 400);
      upd.scheduled_at = iso;
    }
    if (typeof b.cover_url === "string") { upd.cover_url = b.cover_url; upd.thumbnail_url = b.cover_url; }
    if (typeof b.dry_run === "boolean") upd.dry_run = b.dry_run;
    const { ok, body } = await db(`cf_scheduled_posts?id=eq.${id}&status=in.(queued,failed,tested)`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(upd) });
    if (!ok) return json({ ok: false, error: "db", detail: body }, 400);
    return json({ ok: true, post: Array.isArray(body) ? body[0] : body });
  }

  if (action === "publish_now") {
    const id = String(b.id ?? "");
    if (!id) return json({ ok: false, error: "id" }, 400);
    await db(`cf_scheduled_posts?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ scheduled_at: new Date().toISOString(), status: "queued", dry_run: false, container_id: null, published_ig_media_id: null, error: null, updated_at: new Date().toISOString() }) });
    const secret = await setting("cron_secret");
    let result: unknown = null;
    try { result = await (await fetch(`${SB_URL}/functions/v1/publisher?key=${secret}`)).json(); } catch { /* крон подхватит */ }
    return json({ ok: true, result });
  }

  if (action === "retry") {
    const id = String(b.id ?? "");
    if (!id) return json({ ok: false, error: "id" }, 400);
    await db(`cf_scheduled_posts?id=eq.${id}&status=in.(failed,tested)`, { method: "PATCH", body: JSON.stringify({ status: "queued", error: null, container_id: null, updated_at: new Date().toISOString() }) });
    return json({ ok: true });
  }

  if (action === "delete") {
    const id = String(b.id ?? "");
    if (!id) return json({ ok: false, error: "id" }, 400);
    await db(`cf_scheduled_posts?id=eq.${id}`, { method: "DELETE" });
    return json({ ok: true });
  }

  return json({ ok: false, error: "unknown action" }, 400);
});
