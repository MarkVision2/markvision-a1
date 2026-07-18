// meta-creative-refresh — резолвит mp4 source для ad_id, СОХРАНЯЕТ видео и постер
// в Supabase Storage (постоянные ссылки вместо истекающих fbcdn).
//
// Токены пробуем по очереди: системный (automation_settings.meta_access_token → env)
// и токен кабинета (ad_cabinets.access_token). Video source Meta отдаёт только тому
// токену, который имеет доступ к ролику; поэтому берём первый рабочий.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { requireUser } from "../_lib/auth.ts";
import { resolveMetaAccessToken } from "../_lib/metaToken.ts";
import {
  ensurePosterInStorage,
  ensureVideoInStorage,
  isLowResThumb,
  isSupabasePosterUrl,
  isSupabaseVideoUrl,
  pickBestUrl,
  pickBestVideoThumb,
  type VideoThumbItem,
} from "../_lib/creativePoster.ts";

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
  const story = creative.object_story_spec as Record<string, unknown> | undefined;
  const storyVideo = story?.video_data as Record<string, unknown> | undefined;
  const linkData = story?.link_data as Record<string, unknown> | undefined;
  return pickBestUrl(
    typeof creative.image_url === "string" ? creative.image_url : null,
    typeof storyVideo?.image_url === "string" ? storyVideo.image_url : null,
    typeof linkData?.picture === "string" ? linkData.picture : null,
    typeof creative.thumbnail_url === "string" ? creative.thumbnail_url : null,
  );
}

/** Пробуем токены по очереди — берём первый, который читает объявление. */
async function resolveVideoFromAd(adId: string, tokens: string[]) {
  const fields = "creative{thumbnail_url,image_url,video_id,object_story_spec,asset_feed_spec}";
  let lastText = ""; let lastStatus = 400;
  for (const token of tokens) {
    const r = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/${adId}?fields=${fields}&access_token=${encodeURIComponent(token)}`,
    );
    if (r.ok) {
      const ad = await r.json() as { creative?: Record<string, unknown> };
      return { ok: true as const, videoId: extractVideoId(ad.creative), thumbnail: extractThumb(ad.creative) };
    }
    lastText = await r.text(); lastStatus = r.status;
  }
  return { ok: false as const, status: lastStatus, text: lastText };
}

/** Среди токенов ищем тот, что вернёт video source; попутно собираем лучший thumb. */
async function resolveVideoSource(videoId: string, tokens: string[]) {
  let bestThumb: string | null = null;
  for (const token of tokens) {
    const r = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/${videoId}?fields=source,picture,thumbnails{uri,width,height,is_preferred,scale}&access_token=${encodeURIComponent(token)}`,
    );
    if (!r.ok) continue;
    const v = await r.json() as { source?: string; picture?: string; thumbnails?: { data?: VideoThumbItem[] } };
    const t = pickBestVideoThumb(v.thumbnails?.data ?? [], v.picture);
    if (t && !bestThumb) bestThumb = t;
    if (v.source) return { source: v.source, thumb: bestThumb ?? t ?? null };
  }
  return { source: null as string | null, thumb: bestThumb };
}

/** Meta часто не отдаёт mp4 source — тогда берём официальный playable-превью
 * объявления (signed iframe с business.facebook.com, работает без логина). */
async function resolvePreviewIframe(adId: string, tokens: string[]): Promise<string | null> {
  const formats = ["INSTAGRAM_REELS", "MOBILE_FEED_STANDARD", "DESKTOP_FEED_STANDARD"];
  for (const token of tokens) {
    for (const fmt of formats) {
      try {
        const r = await fetch(
          `https://graph.facebook.com/${META_API_VERSION}/${adId}/previews?ad_format=${fmt}&access_token=${encodeURIComponent(token)}`,
        );
        if (!r.ok) continue;
        const j = await r.json() as { data?: Array<{ body?: string }> };
        const body = j.data?.[0]?.body ?? "";
        const m = body.match(/src="([^"]+)"/);
        if (m?.[1]) return m[1].replace(/&amp;/g, "&");
      } catch {
        // пробуем следующий формат/токен
      }
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: { ad_id?: string; refresh_video?: boolean };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid json" }, 400);
  }
  const adId = String(body.ad_id ?? "").trim();
  if (!adId) return json({ ok: false, error: "ad_id required" }, 400);
  const refreshVideo = Boolean(body.refresh_video);

  const { data: row, error: rowErr } = await admin
    .from("meta_creatives")
    .select("id, video_id, thumbnail_url, poster_url, video_url, cabinet_id")
    .eq("ad_id", adId)
    .maybeSingle();
  if (rowErr) return json({ ok: false, error: rowErr.message }, 500);
  if (!row) return json({ ok: false, error: "not found" }, 404);

  const cabinetId = (row as { cabinet_id?: string | null }).cabinet_id ?? null;

  // Токен кабинета (OAuth) в приоритете; общий запасной — вторым.
  let cabinetToken: string | null = null;
  if (cabinetId) {
    const { data: cab } = await admin.from("ad_cabinets").select("access_token").eq("id", cabinetId).maybeSingle();
    const ct = (cab as { access_token?: string | null } | null)?.access_token;
    if (ct && ct.trim()) cabinetToken = ct.trim();
  }
  const fallbackToken = await resolveMetaAccessToken({ admin });
  const tokens = [...new Set([cabinetToken, fallbackToken].filter((t): t is string => !!t))];
  if (tokens.length === 0) return json({ ok: false, error: "META_ACCESS_TOKEN missing" }, 500);

  const existingPoster = ((row as { poster_url?: string | null }).poster_url ?? "").trim();
  const existingVideo = ((row as { video_url?: string | null }).video_url ?? "").trim();
  const hasPersistedPoster = Boolean(existingPoster && isSupabasePosterUrl(existingPoster));
  const hasPersistedVideo = Boolean(existingVideo && isSupabaseVideoUrl(existingVideo));

  if (hasPersistedPoster && !refreshVideo) {
    return json({
      ok: true,
      poster_url: existingPoster,
      thumbnail_url: existingPoster,
      video_url: hasPersistedVideo ? existingVideo : undefined,
    });
  }
  if (refreshVideo && hasPersistedVideo) {
    return json({
      ok: true,
      video_url: existingVideo,
      poster_url: hasPersistedPoster ? existingPoster : undefined,
      thumbnail_url: hasPersistedPoster ? existingPoster : undefined,
    });
  }

  let videoId = ((row as { video_id?: string | null }).video_id ?? "").trim();
  const storedThumb = ((row as { thumbnail_url?: string | null }).thumbnail_url ?? "").trim();
  let resolvedThumb: string | null = null;

  const thumbLooksLow = !storedThumb || isLowResThumb(storedThumb);
  if (!videoId || thumbLooksLow) {
    const resolved = await resolveVideoFromAd(adId, tokens);
    if (!resolved.ok) {
      const isRate = resolved.status === 403 && /request limit/i.test(resolved.text);
      return json({
        ok: false, fallback: true, rate_limited: isRate,
        error: `meta ${resolved.status}: ${resolved.text.slice(0, 160)}`,
        retry_after_seconds: isRate ? 300 : 60,
      }, 200);
    }
    if (!videoId) videoId = resolved.videoId ?? "";
    if (resolved.thumbnail) resolvedThumb = resolved.thumbnail;
    if (videoId || resolvedThumb) {
      const patch: Record<string, unknown> = { last_synced_at: new Date().toISOString() };
      if (videoId) patch.video_id = videoId;
      if (resolvedThumb) { patch.thumbnail_url = resolvedThumb; patch.image_url = resolvedThumb; }
      await admin.from("meta_creatives").update(patch).eq("ad_id", adId);
    }
  }

  if (!videoId) {
    const thumb = (resolvedThumb ?? storedThumb) || null;
    const posterUrl = thumb && !isLowResThumb(thumb)
      ? await ensurePosterInStorage(admin, adId, cabinetId, existingPoster, thumb)
      : null;
    return json({ ok: Boolean(posterUrl ?? thumb), reason: "not_video", thumbnail_url: posterUrl ?? thumb, poster_url: posterUrl }, 200);
  }

  try {
    const { source, thumb } = await resolveVideoSource(videoId, tokens);
    const bestThumb = thumb ?? resolvedThumb ?? (storedThumb && !isLowResThumb(storedThumb) ? storedThumb : null);
    const posterUrl = hasPersistedPoster
      ? existingPoster
      : bestThumb ? await ensurePosterInStorage(admin, adId, cabinetId, existingPoster, bestThumb) : null;

    if (!source) {
      if (bestThumb || posterUrl) {
        const patch: Record<string, unknown> = { last_synced_at: new Date().toISOString() };
        if (bestThumb) { patch.thumbnail_url = bestThumb; patch.image_url = bestThumb; }
        if (posterUrl) patch.poster_url = posterUrl;
        await admin.from("meta_creatives").update(patch).eq("ad_id", adId);
      }
      // mp4 недоступен — отдаём официальный playable-превью Meta (iframe).
      const previewIframe = refreshVideo ? await resolvePreviewIframe(adId, tokens) : null;
      return json({
        ok: Boolean(posterUrl ?? previewIframe),
        error: previewIframe ? undefined : "no source url (token has no access to this video)",
        fallback: !previewIframe,
        thumbnail_url: posterUrl ?? bestThumb,
        poster_url: posterUrl,
        preview_iframe_url: previewIframe,
      }, 200);
    }

    // Заливаем mp4 в наш Storage — постоянная ссылка вместо истекающего fbcdn.
    const persistedVideo = await ensureVideoInStorage(admin, adId, cabinetId, existingVideo, source);
    const finalVideoUrl = persistedVideo ?? source;

    const patch: Record<string, unknown> = { video_url: finalVideoUrl, last_synced_at: new Date().toISOString() };
    if (bestThumb) { patch.thumbnail_url = bestThumb; patch.image_url = bestThumb; }
    if (posterUrl) patch.poster_url = posterUrl;
    await admin.from("meta_creatives").update(patch).eq("ad_id", adId);

    return json({ ok: true, video_url: finalVideoUrl, thumbnail_url: posterUrl ?? bestThumb, poster_url: posterUrl });
  } catch (_e) {
    return json({ ok: false, fallback: true, error: "META_REFRESH_FAILED", retry_after_seconds: 60 });
  }
});
