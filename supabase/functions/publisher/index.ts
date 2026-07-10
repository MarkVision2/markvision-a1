// Автопостинг v7: очередь cf_scheduled_posts. IMAGE, REELS (с обложкой cover_url), STORIES, CAROUSEL.
// dry_run — пробный режим (создаём контейнер, не публикуем).
//
// Мультитенантность: если у поста задан project_id — токен и ig_user_id
// берём из instagram_accounts этого проекта. Легаси-посты без project_id
// (старый единый клиент) продолжают публиковаться через cf_settings.
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H: Record<string, string> = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
const IG = "https://graph.facebook.com/v21.0";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function db(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers as Record<string, string> || {}) } });
  const t = await r.text();
  try { return t ? JSON.parse(t) : null; } catch { return null; }
}
async function setting(k: string) { return (await db(`cf_settings?key=eq.${k}&select=value`))?.[0]?.value; }
async function tg(text: string) {
  const t = await setting("tg_bot_token"), c = await setting("tg_chat_id");
  if (!t || !c) return;
  await fetch(`https://api.telegram.org/bot${t}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: c, text }) }).catch(() => {});
}
async function patch(id: string, data: Record<string, unknown>) {
  await db(`cf_scheduled_posts?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ ...data, updated_at: new Date().toISOString() }) });
}
function isVideo(url: string) {
  const u = (url || "").toLowerCase().split("?")[0];
  return u.endsWith(".mp4") || u.endsWith(".mov") || u.endsWith(".m4v");
}
async function createContainer(igUserId: string, params: URLSearchParams) {
  return await (await fetch(`${IG}/${igUserId}/media?${params}`, { method: "POST" })).json().catch(() => ({}));
}
// status_code — машинный статус (FINISHED/ERROR/IN_PROGRESS); status — человекочитаемая
// причина от Instagram при ERROR (например код 2207052 — медиа не подошло по формату/
// не удалось обработать). Раньше запрашивали только status_code и на ошибке писали
// голое "container ERROR" — реальная причина от Instagram терялась.
async function containerStatus(token: string, id: string): Promise<{ code: string; detail: string }> {
  const j = await (await fetch(`${IG}/${id}?fields=status_code,status&access_token=${token}`)).json().catch(() => ({}));
  return { code: j.status_code ?? "", detail: typeof j.status === "string" ? j.status : "" };
}
async function publish(igUserId: string, token: string, creationId: string) {
  return await (await fetch(`${IG}/${igUserId}/media_publish?creation_id=${creationId}&access_token=${token}`, { method: "POST" })).json().catch(() => ({}));
}

function formatMetaError(raw: unknown): string {
  if (typeof raw === "string") {
    try {
      return formatMetaError(JSON.parse(raw));
    } catch {
      if (/Invalid OAuth access token|Cannot parse access token|code.?190/i.test(raw)) {
        return "Токен Instagram устарел или недействителен. Переподключите Facebook в Настройках → Meta.";
      }
      return raw.slice(0, 300);
    }
  }
  if (raw && typeof raw === "object") {
    const err = (raw as { error?: { message?: string; code?: number; type?: string } }).error;
    if (err?.code === 190 || /Invalid OAuth access token|Cannot parse access token/i.test(err?.message ?? "")) {
      return "Токен Instagram устарел или недействителен. Переподключите Facebook в Настройках → Meta.";
    }
    if (err?.message) return err.message;
  }
  const s = JSON.stringify(raw);
  return s.slice(0, 300);
}
function ensureContainerId(j: unknown, label: string): string {
  const id = (j as { id?: string })?.id;
  if (id) return id;
  throw new Error(`${label}: ${formatMetaError(j)}`);
}

interface Account { igUserId: string; token: string }
const legacyAccount: { value: Account | null } = { value: null };
async function getLegacyAccount(): Promise<Account | null> {
  if (legacyAccount.value) return legacyAccount.value;
  const igUserId = await setting("ig_user_id");
  const token = await setting("ig_access_token");
  if (!igUserId || !token) return null;
  legacyAccount.value = { igUserId, token };
  return legacyAccount.value;
}
const projectAccounts = new Map<string, Account | null>();
async function getProjectAccount(projectId: string): Promise<Account | null> {
  if (projectAccounts.has(projectId)) return projectAccounts.get(projectId)!;
  const rows = await db(`instagram_accounts?project_id=eq.${projectId}&active=eq.true&select=ig_user_id,page_access_token&limit=1`);
  const row = rows?.[0];
  const acc = row?.ig_user_id && row?.page_access_token ? { igUserId: row.ig_user_id, token: row.page_access_token } : null;
  projectAccounts.set(projectId, acc);
  return acc;
}
async function resolveAccount(projectId: string | null): Promise<Account | null> {
  if (projectId) return getProjectAccount(projectId);
  return getLegacyAccount();
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("key") !== (await setting("cron_secret"))) return new Response("forbidden", { status: 403 });

  const now = new Date().toISOString();
  const out: Record<string, number> = { published: 0, processing: 0, failed: 0, tested: 0 };

  const due = (await db(`cf_scheduled_posts?status=eq.queued&scheduled_at=lte.${now}&select=*&order=scheduled_at&limit=5`)) ?? [];
  for (const p of due) {
    const account = await resolveAccount(p.project_id ?? null);
    if (!account) {
      await patch(p.id, { status: "failed", error: "instagram account not connected for this project" });
      out.failed++;
      continue;
    }
    const { igUserId, token } = account;
    try {
      const caption = p.caption ?? "";
      let containerId: string | null = null;

      if (p.media_type === "CAROUSEL") {
        const urls: string[] = Array.isArray(p.child_urls) ? p.child_urls : [];
        if (urls.length < 2) throw new Error("карусели нужно ≥ 2 элементов");
        const childIds: string[] = [];
        for (const u of urls) {
          const cp = new URLSearchParams({ access_token: token, is_carousel_item: "true" });
          if (isVideo(u)) { cp.set("media_type", "VIDEO"); cp.set("video_url", u); } else { cp.set("image_url", u); }
          const cj = await createContainer(igUserId, cp);
          if (!cj.id) throw new Error("child: " + formatMetaError(cj));
          childIds.push(cj.id);
        }
        const pj = await createContainer(igUserId, new URLSearchParams({ access_token: token, media_type: "CAROUSEL", children: childIds.join(","), caption }));
        containerId = ensureContainerId(pj, "carousel");
      } else if (p.media_type === "REELS") {
        const params = new URLSearchParams({ access_token: token, media_type: "REELS", video_url: p.media_url, caption });
        if (p.cover_url) params.set("cover_url", p.cover_url);
        const j = await createContainer(igUserId, params);
        containerId = ensureContainerId(j, "reels");
      } else if (p.media_type === "STORIES") {
        const params = new URLSearchParams({ access_token: token, media_type: "STORIES" });
        if (isVideo(p.media_url)) params.set("video_url", p.media_url); else params.set("image_url", p.media_url);
        const j = await createContainer(igUserId, params);
        containerId = ensureContainerId(j, "stories");
      } else {
        const j = await createContainer(igUserId, new URLSearchParams({ access_token: token, image_url: p.media_url, caption }));
        containerId = ensureContainerId(j, "image");
      }

      if (p.dry_run) {
        await patch(p.id, { status: "tested", container_id: containerId, error: null });
        out.tested++;
        await tg(`🧪 Пробный режим: медиа принято Instagram, публикация не выполнена: «${caption.slice(0, 50)}…»`);
        continue;
      }

      let done = false;
      for (let i = 0; i < 5; i++) {
        const st = await containerStatus(token, containerId!);
        if (st.code === "ERROR") {
          const detail = st.detail || "неизвестная причина";
          await patch(p.id, { status: "failed", error: `container ERROR: ${detail}`.slice(0, 500) });
          out.failed++;
          await tg(`❌ Автопост: ошибка обработки медиа. Причина Instagram: ${detail}`);
          done = true;
          break;
        }
        if (st.code === "FINISHED" || st.code === "") {
          const pub = await publish(igUserId, token, containerId!);
          if (pub.id) { await patch(p.id, { status: "published", container_id: containerId, published_ig_media_id: pub.id, error: null }); out.published++; await tg(`✅ Опубликован: «${caption.slice(0, 60)}…»`); done = true; break; }
        }
        await sleep(1500);
      }
      if (!done) { await patch(p.id, { status: "processing", container_id: containerId }); out.processing++; }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await patch(p.id, { status: "failed", error: msg.slice(0, 500) });
      out.failed++;
      await tg(`❌ Автопост не создался: ${msg.slice(0, 200)}`);
    }
  }

  const processing = (await db(`cf_scheduled_posts?status=eq.processing&select=*&limit=10`)) ?? [];
  for (const p of processing) {
    const account = await resolveAccount(p.project_id ?? null);
    if (!account) { await patch(p.id, { status: "failed", error: "instagram account not connected for this project" }); out.failed++; continue; }
    const { igUserId, token } = account;
    if (!p.container_id) { await patch(p.id, { status: "failed", error: "нет container_id" }); out.failed++; continue; }
    const st = await containerStatus(token, p.container_id);
    if (st.code === "ERROR") {
      const detail = st.detail || "неизвестная причина";
      await patch(p.id, { status: "failed", error: `container ERROR: ${detail}`.slice(0, 500) });
      out.failed++;
      await tg(`❌ Автопост: ошибка обработки медиа. Причина Instagram: ${detail}`);
      continue;
    }
    if (st.code && st.code !== "FINISHED") continue;
    const pub = await publish(igUserId, token, p.container_id);
    if (pub.id) {
      await patch(p.id, { status: "published", published_ig_media_id: pub.id, error: null });
      out.published++;
      await tg(`✅ Опубликован отложенный пост: «${(p.caption ?? "").slice(0, 60)}…»`);
    } else {
      const s = JSON.stringify(pub);
      if (!s.includes("not ready") && !s.includes("Media ID is not available")) {
        await patch(p.id, { status: "failed", error: formatMetaError(pub).slice(0, 500) });
        out.failed++;
      }
    }
  }
  return Response.json(out);
});
