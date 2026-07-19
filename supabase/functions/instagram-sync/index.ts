// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GRAPH_FB = "https://graph.facebook.com/v21.0";
const GRAPH_IG = "https://graph.instagram.com/v21.0";

/** Instagram Login tokens (IGAA…/IGQV…) must hit graph.instagram.com; Page tokens use Facebook Graph. */
function graphFor(token: string) {
  return /^IG/i.test(token) ? GRAPH_IG : GRAPH_FB;
}

function pickSyncToken(account: any): string | null {
  const login = typeof account?.ig_login_access_token === "string" ? account.ig_login_access_token.trim() : "";
  const page = typeof account?.page_access_token === "string" ? account.page_access_token.trim() : "";
  // Prefer Instagram Login when present — works without FB Page binding.
  if (login) return login;
  if (page) return page;
  return null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Carousel albums often have null thumbnail_url — use first image child / media_url. */
function pickThumbnail(m: any): string | null {
  if (typeof m?.thumbnail_url === "string" && m.thumbnail_url) return m.thumbnail_url;
  const children = m?.children?.data;
  if (Array.isArray(children)) {
    for (const child of children) {
      if (typeof child?.thumbnail_url === "string" && child.thumbnail_url) return child.thumbnail_url;
      if (typeof child?.media_url === "string" && child.media_url && !/\.mp4(\?|$)/i.test(child.media_url)) {
        return child.media_url;
      }
    }
  }
  if (typeof m?.media_url === "string" && m.media_url && !/\.mp4(\?|$)/i.test(m.media_url)) {
    return m.media_url;
  }
  return null;
}

async function syncOne(supa: any, account: any) {
  const token = pickSyncToken(account);
  const igId = account.ig_user_id;
  if (!token) {
    await supa.from("instagram_accounts").update({
      last_error: "profile: нет access token (подключите Instagram Login или Facebook Page)",
      active: false,
    }).eq("project_id", account.project_id);
    return;
  }
  const GRAPH = graphFor(token);

  // 1) Account profile fields
  try {
    const r = await fetch(
      `${GRAPH}/${igId}?fields=username,name,profile_picture_url,followers_count,follows_count,media_count&access_token=${token}`,
    );
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    await supa.from("instagram_accounts").update({
      username: j.username ?? account.username,
      name: j.name ?? account.name,
      profile_picture_url: j.profile_picture_url ?? account.profile_picture_url,
      followers_count: j.followers_count ?? 0,
      follows_count: j.follows_count ?? 0,
      media_count: j.media_count ?? 0,
      last_sync_at: new Date().toISOString(),
      last_error: null,
    }).eq("project_id", account.project_id);
  } catch (e: any) {
    await supa.from("instagram_accounts").update({
      last_error: `profile: ${e.message}`,
      active: e.message?.includes("OAuth") ? false : account.active,
    }).eq("project_id", account.project_id);
    return;
  }

  // 2) Media list (last 100). children needed for carousel preview fallback.
  const mediaRes = await fetch(
    `${GRAPH}/${igId}/media?fields=id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count,children{media_type,media_url,thumbnail_url}&limit=100&access_token=${token}`,
  );
  const mediaJson = await mediaRes.json();
  if (mediaJson.error) {
    await supa.from("instagram_accounts").update({ last_error: `media: ${mediaJson.error.message}` }).eq("project_id", account.project_id);
    return;
  }
  const items = (mediaJson.data ?? []) as any[];

  // 3) Insights per media.
  // Graph API v22+: impressions/plays are invalid for many IG media types.
  // Asking for an invalid metric rejects the WHOLE request → zeros in UI.
  // Use: reach + views (+ interactions). views → plays/impressions for old UI.
  for (const m of items) {
    const isStory = m.media_product_type === "STORY";
    const metrics = isStory
      ? ["reach", "views", "replies"]
      : ["reach", "views", "likes", "comments", "shares", "saved", "total_interactions"];

    let reach = 0, impressions = 0, plays = 0, shares = 0, saved = 0, totalInter = 0, videoViews = 0;
    try {
      const ir = await fetch(
        `${GRAPH}/${m.id}/insights?metric=${metrics.join(",")}&access_token=${token}`,
      );
      const ij = await ir.json();
      const rows = ij.data ?? (ij.error
        ? ((await (await fetch(`${GRAPH}/${m.id}/insights?metric=reach&access_token=${token}`)).json()).data ?? [])
        : []);
      for (const row of rows) {
        const val = Number(row.values?.[0]?.value ?? 0);
        if (row.name === "reach") reach = val;
        else if (row.name === "views" || row.name === "plays" || row.name === "video_views") {
          plays = val;
          videoViews = val;
          impressions = val;
        } else if (row.name === "impressions") impressions = val;
        else if (row.name === "shares") shares = val;
        else if (row.name === "saved") saved = val;
        else if (row.name === "total_interactions") totalInter = val;
      }
    } catch (_e) { /* skip */ }

    const likes = Number(m.like_count ?? 0);
    const comments = Number(m.comments_count ?? 0);
    if (!totalInter) totalInter = likes + comments + shares + saved;

    await supa.from("instagram_media").upsert({
      project_id: account.project_id,
      ig_user_id: igId,
      media_id: m.id,
      media_type: m.media_type ?? null,
      media_product_type: m.media_product_type ?? "FEED",
      caption: m.caption ?? null,
      permalink: m.permalink ?? null,
      thumbnail_url: pickThumbnail(m),
      media_url: m.media_url ?? null,
      timestamp: m.timestamp ?? null,
      like_count: likes,
      comments_count: comments,
      shares_count: shares,
      saved_count: saved,
      reach, impressions, video_views: videoViews, plays,
      total_interactions: totalInter,
      last_synced_at: new Date().toISOString(),
    }, { onConflict: "media_id" });
  }

  // 4) Account daily insights (last 30 days) — reach only (other day metrics need metric_type=total_value).
  try {
    const since = Math.floor((Date.now() - 30 * 86400_000) / 1000);
    const until = Math.floor(Date.now() / 1000);
    const ar = await fetch(
      `${GRAPH}/${igId}/insights?metric=reach&period=day&since=${since}&until=${until}&access_token=${token}`,
    );
    const aj = await ar.json();
    if (aj.data) {
      const byDate: Record<string, any> = {};
      for (const m of aj.data) {
        for (const v of m.values ?? []) {
          const d = ymd(new Date(v.end_time));
          byDate[d] = byDate[d] ?? { date: d };
          byDate[d][m.name] = v.value ?? 0;
        }
      }
      const rows = Object.values(byDate).map((r: any) => ({
        project_id: account.project_id,
        ig_user_id: igId,
        date: r.date,
        followers: account.followers_count,
        reach: r.reach ?? 0,
        impressions: r.impressions ?? 0,
        profile_views: r.profile_views ?? 0,
        website_clicks: r.website_clicks ?? 0,
        synced_at: new Date().toISOString(),
      }));
      if (rows.length > 0) {
        await supa.from("instagram_account_daily").upsert(rows, { onConflict: "ig_user_id,date" });
      }
    }
  } catch (_e) { /* skip */ }

  // 5) Demographics (lifetime, once per day)
  try {
    const dems = ["audience_city", "audience_gender_age"];
    for (const dim of dems) {
      const dr = await fetch(
        `${GRAPH}/${igId}/insights?metric=${dim}&period=lifetime&access_token=${token}`,
      );
      const dj = await dr.json();
      const vals = dj.data?.[0]?.values?.[0]?.value;
      if (!vals) continue;
      const dimName = dim === "audience_city" ? "city" : "age_gender";
      // Clear & re-insert
      await supa.from("instagram_demographics").delete()
        .eq("ig_user_id", igId).eq("dimension", dimName);
      const rows = Object.entries(vals).map(([key, value]) => ({
        project_id: account.project_id,
        ig_user_id: igId,
        dimension: dimName,
        key,
        value: Number(value),
        snapshot_at: new Date().toISOString(),
      }));
      if (rows.length > 0) {
        await supa.from("instagram_demographics").upsert(rows, { onConflict: "ig_user_id,dimension,key" });
      }
    }
  } catch (_e) { /* skip */ }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supa = createClient(SUPABASE_URL, SERVICE_ROLE);

    const body = await req.json().catch(() => ({}));
    const { project_id, all } = body ?? {};

    let query = supa.from("instagram_accounts").select("*").eq("active", true);
    if (project_id && !all) query = query.eq("project_id", project_id);
    const { data: accounts, error } = await query;
    if (error) return json({ error: error.message }, 500);

    const results: any[] = [];
    for (const acc of accounts ?? []) {
      try {
        await syncOne(supa, acc);
        results.push({ project_id: acc.project_id, ok: true });
      } catch (e: any) {
        results.push({ project_id: acc.project_id, ok: false, error: e.message });
      }
    }

    return json({ ok: true, synced: results.length, results });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});
