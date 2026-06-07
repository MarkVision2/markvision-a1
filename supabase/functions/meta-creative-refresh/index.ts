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

function extractVideoId(creative: Record<string, unknown> | null | undefined): string | null {
  if (!creative) return null;
  const direct = creative.video_id;
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  const story = creative.object_story_spec as Record<string, unknown> | undefined;
  const storyVideo = story?.video_data as Record<string, unknown> | undefined;
  const storyVideoId = storyVideo?.video_id;
  if (typeof storyVideoId === "string" && storyVideoId.trim()) return storyVideoId.trim();

  const assetFeed = creative.asset_feed_spec as Record<string, unknown> | undefined;
  const videos = assetFeed?.videos as Array<Record<string, unknown>> | undefined;
  const assetVideoId = videos?.map((v) => v.video_id).find((v) => typeof v === "string" && v.trim());
  return typeof assetVideoId === "string" ? assetVideoId.trim() : null;
}

function extractThumb(creative: Record<string, unknown> | null | undefined): string | null {
  if (!creative) return null;
  const direct = creative.thumbnail_url ?? creative.image_url;
  if (typeof direct === "string" && direct.trim()) return direct;

  const story = creative.object_story_spec as Record<string, unknown> | undefined;
  const storyVideo = story?.video_data as Record<string, unknown> | undefined;
  const videoImage = storyVideo?.image_url;
  if (typeof videoImage === "string" && videoImage.trim()) return videoImage;

  const linkData = story?.link_data as Record<string, unknown> | undefined;
  const picture = linkData?.picture;
  if (typeof picture === "string" && picture.trim()) return picture;
  return null;
}

async function resolveVideoFromAd(adId: string, token: string) {
  const fields = "creative{thumbnail_url,image_url,video_id,object_story_spec,asset_feed_spec}";
  const r = await fetch(
    `https://graph.facebook.com/${META_API_VERSION}/${adId}?fields=${fields}&access_token=${encodeURIComponent(token)}`,
  );
  if (!r.ok) return { ok: false as const, response: r, text: await r.text() };
  const ad = await r.json() as { creative?: Record<string, unknown> };
  const creative = ad.creative;
  return { ok: true as const, videoId: extractVideoId(creative), thumbnail: extractThumb(creative) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN");
  if (!META_ACCESS_TOKEN) return json({ ok: false, error: "META_ACCESS_TOKEN missing" }, 500);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: { ad_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid json" }, 400);
  }
  const adId = String(body.ad_id ?? "").trim();
  if (!adId) return json({ ok: false, error: "ad_id required" }, 400);

  const { data: row, error: rowErr } = await admin
    .from("meta_creatives")
    .select("id, video_id, thumbnail_url")
    .eq("ad_id", adId)
    .maybeSingle();
  if (rowErr) return json({ ok: false, error: rowErr.message }, 500);
  if (!row) return json({ ok: false, error: "not found" }, 404);
  let videoId = ((row as { video_id?: string | null }).video_id ?? "").trim();
  let resolvedThumb: string | null = null;

  if (!videoId) {
    const resolved = await resolveVideoFromAd(adId, META_ACCESS_TOKEN);
    if (!resolved.ok) return metaFallback(resolved.response.status, resolved.text);
    videoId = resolved.videoId ?? "";
    resolvedThumb = resolved.thumbnail;
    if (videoId || resolvedThumb) {
      const patch: Record<string, unknown> = { last_synced_at: new Date().toISOString() };
      if (videoId) patch.video_id = videoId;
      if (resolvedThumb) patch.thumbnail_url = resolvedThumb;
      const { error: patchErr } = await admin.from("meta_creatives").update(patch).eq("ad_id", adId);
      if (patchErr) return json({ ok: false, error: patchErr.message }, 500);
    }
  }

  if (!videoId) {
    return json({ ok: false, reason: "not_video", thumbnail_url: resolvedThumb ?? (row as { thumbnail_url?: string }).thumbnail_url ?? null }, 200);
  }

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
    if (!bestThumb && resolvedThumb) bestThumb = resolvedThumb;

    if (!v.source) {
      if (bestThumb) {
        const { error: thumbErr } = await admin
          .from("meta_creatives")
          .update({
            thumbnail_url: bestThumb,
            image_url: bestThumb,
            last_synced_at: new Date().toISOString(),
          })
          .eq("ad_id", adId);
        if (thumbErr) return json({ ok: false, error: thumbErr.message }, 500);
      }
      return json({ ok: false, error: "no source url", fallback: true, thumbnail_url: bestThumb }, 200);
    }

    const patch: Record<string, unknown> = {
      video_url: v.source,
      last_synced_at: new Date().toISOString(),
    };
    if (bestThumb) {
      patch.thumbnail_url = bestThumb;
      patch.image_url = bestThumb;
    }

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
