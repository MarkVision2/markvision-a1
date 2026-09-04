/**
 * Сбор метрик опубликованных роликов (docs/AUTOPOSTING-PLATFORM-PLAN.md, M5).
 *
 * Крон раз в 6 часов: post_metrics_due() отдаёт задания, у которых наступила
 * контрольная точка d1 / d3 / d7 без записи в post_metrics. Для каждого —
 * insights площадки от имени аккаунта:
 *   Instagram: /{media}/insights?metric=reach,views,likes,comments,shares,saved
 *   Threads:   /{media}/insights?metric=views,likes,replies,reposts,quotes,shares
 * Число подписчиков (для нормировки охвата) снимается раз в сутки на аккаунт.
 * После сбора пересчитывается outcome_score идей проекта.
 *
 * Авторизация: x-automation-key (pg_cron) или JWT admin/manager (ручной прогон).
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { requireUser, userHasAnyRole } from "../_lib/auth.ts";
import { automationKeyValid, CORS_HEADERS, decryptSecret, json } from "../_lib/publishing.ts";

const GRAPH_IG = "https://graph.instagram.com/v21.0";
const GRAPH_FB = "https://graph.facebook.com/v21.0";
const GRAPH_THREADS = "https://graph.threads.net/v1.0";
const WALL_CLOCK_BUDGET_MS = 45_000;

interface Due {
  job_id: string;
  project_id: string;
  account_id: string;
  platform: string;
  external_post_id: string;
  checkpoint: string;
}

interface Metrics {
  reach: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  raw: unknown;
}

function pick(rows: { name?: string; values?: { value?: number }[]; total_value?: { value?: number } }[], name: string): number {
  const row = rows.find((r) => r.name === name);
  const v = row?.values?.[0]?.value ?? row?.total_value?.value ?? 0;
  return Number(v) || 0;
}

/** Нормализация ответа insights в единый набор полей — чистая функция для тестов. */
export function normalizeInsights(platform: string, payload: unknown): Metrics {
  const rows = ((payload as { data?: unknown[] } | null)?.data ?? []) as { name?: string; values?: { value?: number }[]; total_value?: { value?: number } }[];
  if (platform === "threads") {
    return {
      reach: pick(rows, "views"),
      views: pick(rows, "views"),
      likes: pick(rows, "likes"),
      comments: pick(rows, "replies"),
      shares: pick(rows, "reposts") + pick(rows, "shares"),
      saves: 0,
      raw: payload,
    };
  }
  return {
    reach: pick(rows, "reach"),
    views: pick(rows, "views") || pick(rows, "plays") || pick(rows, "video_views"),
    likes: pick(rows, "likes"),
    comments: pick(rows, "comments"),
    shares: pick(rows, "shares"),
    saves: pick(rows, "saved"),
    raw: payload,
  };
}

async function fetchInsights(platform: string, mediaId: string, token: string): Promise<Metrics | { error: string }> {
  const url = platform === "threads"
    ? `${GRAPH_THREADS}/${mediaId}/insights?metric=views,likes,replies,reposts,quotes,shares&access_token=${token}`
    : `${/^IG/i.test(token) ? GRAPH_IG : GRAPH_FB}/${mediaId}/insights?metric=reach,views,likes,comments,shares,saved&access_token=${token}`;
  try {
    const res = await fetch(url);
    const body = await res.json().catch(() => ({}));
    if (body?.error) {
      // Часть метрик недоступна у отдельных типов медиа — падаем на reach/views.
      const fallback = platform === "threads"
        ? `${GRAPH_THREADS}/${mediaId}/insights?metric=views,likes&access_token=${token}`
        : `${/^IG/i.test(token) ? GRAPH_IG : GRAPH_FB}/${mediaId}/insights?metric=reach&access_token=${token}`;
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
  const url = platform === "threads"
    ? `${GRAPH_THREADS}/${externalId}/threads_insights?metric=followers_count&access_token=${token}`
    : `${/^IG/i.test(token) ? GRAPH_IG : GRAPH_FB}/${externalId}?fields=followers_count&access_token=${token}`;
  try {
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

async function collect(admin: SupabaseClient, limit: number) {
  const { data, error } = await admin.rpc("post_metrics_due", { p_limit: limit });
  if (error) return { due: 0, collected: 0, failed: 0, error: error.message };
  const due = (data ?? []) as Due[];
  const deadline = Date.now() + WALL_CLOCK_BUDGET_MS;
  const tokenCache = new Map<string, { token: string | null; followers: number | null; externalId: string }>();
  const projects = new Set<string>();
  let collected = 0;
  let failed = 0;

  for (const d of due) {
    if (Date.now() > deadline) break;
    let acc = tokenCache.get(d.account_id);
    if (!acc) {
      const { data: row } = await admin.from("publish_accounts")
        .select("access_token_encrypted, external_account_id, followers, metrics_synced_at")
        .eq("id", d.account_id).maybeSingle();
      const r = row as { access_token_encrypted: string | null; external_account_id: string; followers: number | null; metrics_synced_at: string | null } | null;
      let token: string | null = null;
      try { token = r ? await decryptSecret(r.access_token_encrypted) : null; } catch { token = null; }
      let followers = r?.followers ?? null;
      const stale = !r?.metrics_synced_at || Date.now() - Date.parse(r.metrics_synced_at) > 86_400_000;
      if (token && r && stale) {
        const f = await fetchFollowers(d.platform, r.external_account_id, token);
        if (f != null) {
          followers = f;
          await admin.from("publish_accounts").update({ followers: f, metrics_synced_at: new Date().toISOString() }).eq("id", d.account_id);
        }
      }
      acc = { token, followers, externalId: r?.external_account_id ?? "" };
      tokenCache.set(d.account_id, acc);
    }
    if (!acc.token) { failed++; continue; }

    const m = await fetchInsights(d.platform, d.external_post_id, acc.token);
    if ("error" in m) { failed++; continue; }
    const { error: insErr } = await admin.from("post_metrics").upsert({
      project_id: d.project_id,
      account_id: d.account_id,
      job_id: d.job_id,
      platform: d.platform,
      external_post_id: d.external_post_id,
      checkpoint: d.checkpoint,
      reach: m.reach, views: m.views, likes: m.likes, comments: m.comments, shares: m.shares, saves: m.saves,
      followers: acc.followers,
      raw: m.raw as Record<string, unknown>,
    }, { onConflict: "job_id,checkpoint" });
    if (insErr) { failed++; continue; }
    collected++;
    projects.add(d.project_id);
  }

  let outcomes = 0;
  for (const projectId of projects) {
    const { data: n } = await admin.rpc("idea_recompute_outcomes", { p_project_id: projectId });
    outcomes += Number(n ?? 0);
  }
  return { due: due.length, collected, failed, ideas_rescored: outcomes };
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
  return json({ ok: true, ...(await collect(admin, limit)) });
});
