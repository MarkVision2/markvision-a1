/**
 * Сбор метрик опубликованных роликов (docs/AUTOPOSTING-PLATFORM-PLAN.md, M5).
 *
 * Крон раз в 6 часов: post_metrics_due() отдаёт задания, у которых наступила
 * контрольная точка d1 / d3 / d7 без записи в post_metrics. Для каждого —
 * статистика площадки от имени аккаунта:
 *   Instagram: /{media}/insights?metric=reach,views,likes,comments,shares,saved
 *   Threads:   /{media}/insights?metric=views,likes,replies,reposts,quotes,shares
 *   TikTok:    POST /v2/video/query/ (scope video.list) → like/comment/share/view_count
 *   YouTube:   videos?part=statistics → viewCount/likeCount/commentCount
 * Короткоживущие токены (TikTok, YouTube, Threads) обновляются перед сбором тем
 * же ensureFreshToken, что и у воркера публикаций. Число подписчиков (для
 * нормировки охвата) снимается раз в сутки на аккаунт.
 *
 * После сбора: пересчёт outcome_score идей проекта и «лента своих публикаций»
 * в радар — по контрольной точке d3 собственный ролик кладётся в radar_posts
 * (источник kind = own_account, если заведён), а на разбор LLM уходят только
 * лучшие (охват ≥ 5 % подписчиков или ≥ 10 000 просмотров) — так радар
 * учится на том, что сработало у нас, а не только у конкурентов.
 *
 * Авторизация: x-automation-key (pg_cron) или JWT admin/manager (ручной прогон).
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { requireUser, userHasAnyRole } from "../_lib/auth.ts";
import { automationKeyValid, CORS_HEADERS, decryptSecret, json, type PublishAccount } from "../_lib/publishing.ts";
import { ensureFreshToken } from "../_lib/publishRunner.ts";
import { type Metrics, metricsScopeMissing, normalizeInsights, ownPostIsHit } from "../_lib/publishMetricsCore.ts";

const GRAPH_IG = "https://graph.instagram.com/v21.0";
const GRAPH_FB = "https://graph.facebook.com/v21.0";
const GRAPH_THREADS = "https://graph.threads.net/v1.0";
const TIKTOK_API = "https://open.tiktokapis.com/v2";
const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";
const WALL_CLOCK_BUDGET_MS = 45_000;

interface Due {
  job_id: string;
  project_id: string;
  account_id: string;
  platform: string;
  external_post_id: string;
  checkpoint: string;
}

async function readJson(r: Response): Promise<Record<string, unknown>> {
  const text = await r.text();
  try { return text ? JSON.parse(text) : {}; } catch { return { raw: text.slice(0, 300) }; }
}

async function fetchInsights(platform: string, mediaId: string, token: string): Promise<Metrics | { error: string }> {
  try {
    if (platform === "tiktok") {
      const r = await fetch(`${TIKTOK_API}/video/query/?fields=id,like_count,comment_count,share_count,view_count`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
        body: JSON.stringify({ filters: { video_ids: [mediaId] } }),
      });
      const body = await readJson(r);
      const err = body.error as { code?: string; message?: string } | undefined;
      if (err?.code && err.code !== "ok") return { error: `${err.code}: ${err.message ?? ""}`.trim() };
      if (!((body.data as { videos?: unknown[] } | undefined)?.videos ?? []).length) return { error: "TikTok не вернул видео (нет scope video.list или ролик удалён)" };
      return normalizeInsights(platform, body);
    }
    if (platform === "youtube") {
      const r = await fetch(`${YOUTUBE_API}/videos?part=statistics&id=${encodeURIComponent(mediaId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await readJson(r);
      const err = body.error as { message?: string } | undefined;
      if (!r.ok || err) return { error: String(err?.message ?? `HTTP ${r.status}`) };
      if (!((body.items as unknown[] | undefined) ?? []).length) return { error: "YouTube не нашёл видео" };
      return normalizeInsights(platform, body);
    }
    const url = platform === "threads"
      ? `${GRAPH_THREADS}/${mediaId}/insights?metric=views,likes,replies,reposts,quotes,shares&access_token=${encodeURIComponent(token)}`
      : `${/^IG/i.test(token) ? GRAPH_IG : GRAPH_FB}/${mediaId}/insights?metric=reach,views,likes,comments,shares,saved&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url);
    const body = await res.json().catch(() => ({}));
    if (body?.error) {
      // Часть метрик недоступна у отдельных типов медиа — падаем на reach/views.
      const fallback = platform === "threads"
        ? `${GRAPH_THREADS}/${mediaId}/insights?metric=views,likes&access_token=${encodeURIComponent(token)}`
        : `${/^IG/i.test(token) ? GRAPH_IG : GRAPH_FB}/${mediaId}/insights?metric=reach&access_token=${encodeURIComponent(token)}`;
      const r2 = await fetch(fallback);
      const b2 = await r2.json().catch(() => ({}));
      if (b2?.error) return { error: String(b2.error.message ?? body.error.message) };
      return normalizeInsights(platform, b2);
    }
    return normalizeInsights(platform, body);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

async function fetchFollowers(platform: string, externalId: string, token: string): Promise<number | null> {
  try {
    if (platform === "tiktok") {
      const r = await fetch(`${TIKTOK_API}/user/info/?fields=follower_count`, { headers: { Authorization: `Bearer ${token}` } });
      const body = await readJson(r);
      const v = ((body.data as { user?: { follower_count?: number } } | undefined)?.user)?.follower_count;
      return v == null ? null : Number(v);
    }
    if (platform === "youtube") {
      const r = await fetch(`${YOUTUBE_API}/channels?part=statistics&mine=true`, { headers: { Authorization: `Bearer ${token}` } });
      const body = await readJson(r);
      const v = ((body.items as { statistics?: { subscriberCount?: string } }[] | undefined) ?? [])[0]?.statistics?.subscriberCount;
      return v == null ? null : Number(v);
    }
    const url = platform === "threads"
      ? `${GRAPH_THREADS}/${externalId}/threads_insights?metric=followers_count&access_token=${encodeURIComponent(token)}`
      : `${/^IG/i.test(token) ? GRAPH_IG : GRAPH_FB}/${externalId}?fields=followers_count&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url);
    const body = await res.json().catch(() => ({}));
    if (platform === "threads") {
      const rows = (body?.data ?? []) as { name?: string; total_value?: { value?: number } }[];
      const v = rows.find((r) => r.name === "followers_count")?.total_value?.value;
      return v == null ? null : Number(v);
    }
    return body?.followers_count == null ? null : Number(body.followers_count);
  } catch {
    return null;
  }
}

interface AccountCtx {
  token: string | null;
  followers: number | null;
  account: PublishAccount | null;
  reason: string | null;
}

async function loadAccount(admin: SupabaseClient, accountId: string, platform: string): Promise<AccountCtx> {
  const { data: row } = await admin.from("publish_accounts").select("*").eq("id", accountId).maybeSingle();
  const account = row as (PublishAccount & { metrics_synced_at?: string | null }) | null;
  if (!account) return { token: null, followers: null, account: null, reason: "аккаунт удалён" };
  const missing = metricsScopeMissing(platform, account.oauth_scope);
  if (missing) return { token: null, followers: account.followers ?? null, account, reason: `нет права ${missing} — переподключите аккаунт` };
  let token: string | null = null;
  try { token = await decryptSecret(account.access_token_encrypted); } catch { token = null; }
  if (!token) return { token: null, followers: account.followers ?? null, account, reason: "токен не расшифрован" };
  const fresh = await ensureFreshToken(admin, account, token);
  token = fresh.token;
  let followers = account.followers ?? null;
  const stale = !account.metrics_synced_at || Date.now() - Date.parse(account.metrics_synced_at) > 86_400_000;
  if (stale) {
    const f = await fetchFollowers(platform, account.external_account_id, token);
    if (f != null) {
      followers = f;
      await admin.from("publish_accounts").update({ followers: f, metrics_synced_at: new Date().toISOString() }).eq("id", accountId);
    }
  }
  return { token, followers, account, reason: fresh.error ?? null };
}

/** Своя публикация → radar_posts (kind own_account): хиты на разбор, остальное — только цифры. */
async function feedOwnPost(admin: SupabaseClient, d: Due, m: Metrics, ctx: AccountCtx): Promise<boolean> {
  const { data: job } = await admin.from("publish_jobs")
    .select("caption, external_post_url, published_at, publish_videos(title, file_url)")
    .eq("id", d.job_id).maybeSingle();
  const j = job as { caption: string | null; external_post_url: string | null; published_at: string | null; publish_videos: { title: string | null; file_url: string } | null } | null;
  if (!j) return false;
  const handle = ctx.account?.handle ?? ctx.account?.account_name ?? null;
  let sourceId: string | null = null;
  if (handle) {
    const { data: src } = await admin.from("radar_sources").select("id")
      .eq("project_id", d.project_id).eq("kind", "own_account").eq("platform", d.platform)
      .in("handle", [handle, handle.replace(/^@/, ""), `@${handle.replace(/^@/, "")}`]).limit(1).maybeSingle();
    sourceId = (src as { id: string } | null)?.id ?? null;
  }
  const hit = ownPostIsHit(m, ctx.followers);
  const { data: post, error } = await admin.from("radar_posts").upsert({
    project_id: d.project_id,
    source_id: sourceId,
    platform: d.platform,
    external_id: d.external_post_id,
    url: j.external_post_url,
    author_handle: handle,
    published_at: j.published_at,
    media_type: "video",
    caption: j.caption ?? j.publish_videos?.title ?? null,
    video_url: j.publish_videos?.file_url ?? null,
    metrics: { likes: m.likes, comments: m.comments, shares: m.shares, saves: m.saves, views: m.views, reach: m.reach },
    followers: ctx.followers,
    analysis_status: hit ? "pending" : "skipped",
    error: hit ? null : "свой ролик ниже порога хита — без разбора",
    raw: { own_account: true, job_id: d.job_id, checkpoint: d.checkpoint },
  }, { onConflict: "project_id,platform,external_id" }).select("id").maybeSingle();
  if (error || !post) return false;
  await admin.rpc("radar_recompute_post", { p_post_id: (post as { id: string }).id });
  return true;
}

async function collect(admin: SupabaseClient, limit: number) {
  const { data, error } = await admin.rpc("post_metrics_due", { p_limit: limit });
  if (error) return { due: 0, collected: 0, failed: 0, error: error.message };
  const due = (data ?? []) as Due[];
  const deadline = Date.now() + WALL_CLOCK_BUDGET_MS;
  const cache = new Map<string, AccountCtx>();
  const projects = new Set<string>();
  const reasons = new Map<string, number>();
  let collected = 0;
  let failed = 0;
  let ownFed = 0;

  for (const d of due) {
    if (Date.now() > deadline) break;
    let ctx = cache.get(d.account_id);
    if (!ctx) {
      ctx = await loadAccount(admin, d.account_id, d.platform);
      cache.set(d.account_id, ctx);
    }
    if (!ctx.token) {
      failed++;
      reasons.set(ctx.reason ?? "нет токена", (reasons.get(ctx.reason ?? "нет токена") ?? 0) + 1);
      continue;
    }

    const m = await fetchInsights(d.platform, d.external_post_id, ctx.token);
    if ("error" in m) {
      failed++;
      reasons.set(`${d.platform}: ${m.error}`.slice(0, 120), (reasons.get(`${d.platform}: ${m.error}`.slice(0, 120)) ?? 0) + 1);
      continue;
    }
    const { error: insErr } = await admin.from("post_metrics").upsert({
      project_id: d.project_id,
      account_id: d.account_id,
      job_id: d.job_id,
      platform: d.platform,
      external_post_id: d.external_post_id,
      checkpoint: d.checkpoint,
      reach: m.reach, views: m.views, likes: m.likes, comments: m.comments, shares: m.shares, saves: m.saves,
      followers: ctx.followers,
      raw: m.raw as Record<string, unknown>,
    }, { onConflict: "job_id,checkpoint" });
    if (insErr) { failed++; continue; }
    collected++;
    projects.add(d.project_id);
    if (d.checkpoint === "d3" && await feedOwnPost(admin, d, m, ctx)) ownFed++;
  }

  let outcomes = 0;
  for (const projectId of projects) {
    const { data: n } = await admin.rpc("idea_recompute_outcomes", { p_project_id: projectId });
    outcomes += Number(n ?? 0);
  }
  return {
    due: due.length, collected, failed, ideas_rescored: outcomes, own_posts_fed: ownFed,
    reasons: Object.fromEntries(reasons),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  if (!(await automationKeyValid(req, admin))) {
    const auth = await requireUser(req);
    if (!auth.ok) return json({ error: "unauthorized" }, 401);
    if (!(await userHasAnyRole(auth.userId, ["admin", "manager"]))) return json({ error: "forbidden" }, 403);
  }

  const body = await req.json().catch(() => ({}));
  const limit = Math.min(Math.max(Number(body?.limit ?? 200), 1), 500);
  try {
    return json({ ok: true, ...(await collect(admin, limit)) });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
