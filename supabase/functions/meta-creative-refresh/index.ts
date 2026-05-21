// meta-creative-refresh — резолвит свежий mp4 source URL для одного ad_id
// и обновляет meta_creatives.video_url. Вызывается фронтом, когда у видео
// истекла временная подпись fbcdn.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { requireUser } from "../_lib/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const META_API_VERSION = "v21.0";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function metaFallback(status: number, text: string) {
  const isRateLimited = status === 403 && /Application request limit reached|"code"\s*:\s*4/i.test(text);
  const isTransient = /"is_transient"\s*:\s*true/i.test(text);
  const fallback = isRateLimited || isTransient || status >= 500;

  if (fallback) {
    return json({
      ok: false,
      fallback: true,
      rate_limited: isRateLimited,
      retry_after_seconds: isRateLimited ? 300 : 60,
      error: isRateLimited ? "META_RATE_LIMIT" : "META_TEMPORARY_ERROR",
    });
  }

  return json({ ok: false, error: `meta ${status}: ${text.slice(0, 200)}` }, status >= 400 && status < 500 ? 400 : 502);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN");
  if (!META_ACCESS_TOKEN) return json({ ok: false, error: "META_ACCESS_TOKEN missing" }, 500);

  let body: { ad_id?: string } = {};
  try { body = await req.json(); } catch { /* */ }
  const adId = (body.ad_id ?? "").toString().trim();
  if (!/^\d+$/.test(adId)) return json({ ok: false, error: "ad_id required" }, 400);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: row, error: rowErr } = await admin
    .from("meta_creatives")
    .select("id, video_id, thumbnail_url")
    .eq("ad_id", adId)
    .maybeSingle();
  if (rowErr) return json({ ok: false, error: rowErr.message }, 500);
  if (!row) return json({ ok: false, error: "not found" }, 404);
  const videoId = (row as { video_id?: string }).video_id;
  if (!videoId) return json({ ok: false, reason: "not_video", thumbnail_url: (row as { thumbnail_url?: string }).thumbnail_url ?? null }, 200);

  try {
    const r = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/${videoId}?fields=source,picture,thumbnails{uri,width,height,is_preferred,scale}&access_token=${encodeURIComponent(META_ACCESS_TOKEN)}`,
    );
    if (!r.ok) {
      const t = await r.text();
      return metaFallback(r.status, t);
    }
    const v = await r.json() as {
      source?: string;
      picture?: string;
      thumbnails?: { data?: Array<{ uri: string; width?: number; height?: number; is_preferred?: boolean; scale?: number }> };
    };
    // Выбираем самый большой постер: предпочтительный → max(width*height) → picture
    const thumbs = v.thumbnails?.data ?? [];
    let bestThumb: string | null = null;
    if (thumbs.length) {
      const preferred = thumbs.find((t) => t.is_preferred);
      const sorted = [...thumbs].sort(
        (a, b) => ((b.width ?? 0) * (b.height ?? 0)) - ((a.width ?? 0) * (a.height ?? 0)),
      );
      bestThumb = (preferred?.uri && (preferred.width ?? 0) >= 320 ? preferred.uri : null)
        ?? sorted[0]?.uri
        ?? null;
    }
    if (!bestThumb && v.picture) bestThumb = v.picture;

    if (!v.source) {
      if (bestThumb) {
        const { error: thumbErr } = await admin
          .from("meta_creatives")
          .update({ thumbnail_url: bestThumb, last_synced_at: new Date().toISOString() })
          .eq("ad_id", adId);
        if (thumbErr) return json({ ok: false, error: thumbErr.message }, 500);
      }
      return json({ ok: false, error: "no source url", fallback: true, thumbnail_url: bestThumb }, 200);
    }

    const patch: Record<string, unknown> = {
      video_url: v.source,
      last_synced_at: new Date().toISOString(),
    };
    if (bestThumb) patch.thumbnail_url = bestThumb;

    const { error: upErr } = await admin
      .from("meta_creatives")
      .update(patch)
      .eq("ad_id", adId);
    if (upErr) return json({ ok: false, error: upErr.message }, 500);

    return json({ ok: true, video_url: v.source, thumbnail_url: bestThumb });
  } catch (_e) {
    return json({ ok: false, fallback: true, error: "META_REFRESH_FAILED", retry_after_seconds: 60 });
  }
});
