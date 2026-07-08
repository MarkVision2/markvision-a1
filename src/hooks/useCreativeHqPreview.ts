import { useCallback, useEffect, useMemo, useState } from "react";
import type { CreativePreviewSource } from "@/components/creatives/CreativePreview";
import {
  bestCreativeImageHq,
  isHighQualityCreativeUrl,
  isLowResMetaThumb,
  isPersistedCreativeUrl,
  pickCreativePreviewUrl,
  pickDisplayImageSrc,
} from "@/lib/metaThumb";
import { refreshMetaCreative, type RefreshResult } from "@/lib/metaCreativeRefresh";
import { enqueuePosterCapture } from "@/lib/videoPosterCapture";

const refreshAttempts = new Map<string, number>();
const MAX_REFRESH_ATTEMPTS = 5;

interface Options {
  compact?: boolean;
  /** Подгружать HD только когда карточка в зоне видимости */
  inView?: boolean;
}

/** Нужен refresh, если нет постоянного poster_url в Storage (fbcdn-ссылки истекают). */
function needsVisualRefresh(row: CreativePreviewSource, extraPoster: string | null): boolean {
  const urls = [extraPoster, row.posterUrl, row.imageUrl, row.thumbnailUrl].filter(
    (u): u is string => typeof u === "string" && u.trim().length > 0,
  );
  if (urls.length === 0) return true;
  return !urls.some(isPersistedCreativeUrl);
}

function applyRefreshVisuals(data: RefreshResult | null): {
  poster: string | null;
  thumb: string | null;
  video: string | null;
} {
  if (!data) return { poster: null, thumb: null, video: null };
  const poster = data.poster_url?.trim() || null;
  const thumb = data.thumbnail_url?.trim() || null;
  return {
    poster,
    thumb,
    video: data.video_url?.trim() || null,
  };
}

export function useCreativeHqPreview(row: CreativePreviewSource, opts: Options = {}) {
  const isVideo = row.creativeType === "video";
  const inView = opts.inView ?? true;
  const [capturedPoster, setCapturedPoster] = useState<string | null>(null);
  const [refreshedPoster, setRefreshedPoster] = useState<string | null>(null);
  const [refreshedThumb, setRefreshedThumb] = useState<string | null>(null);
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(row.videoUrl);
  const [loadingHq, setLoadingHq] = useState(() => needsVisualRefresh(row, row.posterUrl));
  const [hqFailed, setHqFailed] = useState(false);

  const thumbSize = opts.compact ? 720 : 1080;
  const sources = useMemo(() => ({
    posterUrl: capturedPoster ?? refreshedPoster ?? row.posterUrl,
    thumbnailUrl: refreshedThumb ?? row.thumbnailUrl,
    imageUrl: refreshedThumb ?? row.imageUrl,
    size: thumbSize,
  }), [capturedPoster, refreshedPoster, refreshedThumb, row.posterUrl, row.thumbnailUrl, row.imageUrl, thumbSize]);

  const displaySrc = useMemo(() => pickCreativePreviewUrl(sources), [sources]);
  const hqSrc = useMemo(() => bestCreativeImageHq(sources), [sources]);
  const imageSrc = useMemo(
    () => pickDisplayImageSrc({
      hqSrc,
      displaySrc,
      loadingHq,
      isLowRes: Boolean(displaySrc && !hqSrc),
      hqFailed,
    }),
    [hqSrc, displaySrc, loadingHq, hqFailed],
  );
  const isHqReady = Boolean(hqSrc);
  const isLowRes = Boolean(displaySrc && !isHqReady);
  const canPlayInline = isVideo && Boolean(previewVideoUrl);
  const useVideoFrame = isVideo && Boolean(previewVideoUrl) && !displaySrc;
  const lowResFallbackSrc =
    displaySrc && isLowResMetaThumb(displaySrc) && !isHighQualityCreativeUrl(imageSrc)
      ? displaySrc
      : null;

  useEffect(() => {
    setPreviewVideoUrl(row.videoUrl);
    setRefreshedPoster(null);
    setRefreshedThumb(null);
    setCapturedPoster(null);
    setHqFailed(false);
    setLoadingHq(needsVisualRefresh(row, row.posterUrl));
  }, [row.adId, row.videoUrl, row.posterUrl, row.imageUrl, row.thumbnailUrl]);

  useEffect(() => {
    if (!row.adId || !inView) return;

    let cancelled = false;
    const adId = row.adId;
    const needsRefresh = needsVisualRefresh(row, row.posterUrl);

    if (!needsRefresh) {
      setLoadingHq(false);
      return;
    }

    void (async () => {
      setLoadingHq(true);
      setHqFailed(false);

      let videoUrl = row.videoUrl ?? null;
      const attempts = refreshAttempts.get(adId) ?? 0;

      let refreshedFromApi: { poster: string | null; thumb: string | null; video: string | null } = {
        poster: null,
        thumb: null,
        video: null,
      };
      if (attempts < MAX_REFRESH_ATTEMPTS) {
        refreshAttempts.set(adId, attempts + 1);
        // На карточке обновляем постер; свежий mp4 — по клику ▶ (forceRefresh).
        const data = await refreshMetaCreative(adId, { refreshVideo: false }).catch(() => null);
        if (cancelled) return;
        refreshedFromApi = applyRefreshVisuals(data);
        if (refreshedFromApi.poster) setRefreshedPoster(refreshedFromApi.poster);
        else if (refreshedFromApi.thumb) setRefreshedThumb(refreshedFromApi.thumb);
        if (refreshedFromApi.video) {
          videoUrl = refreshedFromApi.video;
          setPreviewVideoUrl(refreshedFromApi.video);
        }
      }

      const posterAfterRefresh = refreshedFromApi.poster ?? row.posterUrl;
      const stillNeedsHq = needsVisualRefresh(row, posterAfterRefresh);

      if (isVideo && stillNeedsHq && videoUrl) {
        const poster = await enqueuePosterCapture(adId, videoUrl).catch(() => null);
        if (!cancelled && poster) setCapturedPoster(poster);
      }

      if (!cancelled) {
        const hasPersisted = isPersistedCreativeUrl(
          refreshedFromApi.poster ?? row.posterUrl,
        );
        const hasAnyVisual = Boolean(
          hasPersisted
          || bestCreativeImageHq({
            posterUrl: refreshedFromApi.poster ?? row.posterUrl,
            thumbnailUrl: refreshedFromApi.thumb ?? row.thumbnailUrl,
            imageUrl: refreshedFromApi.thumb ?? row.imageUrl,
            size: thumbSize,
          }),
        );
        setLoadingHq(false);
        if (!hasAnyVisual && needsRefresh) setHqFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    inView,
    row.adId,
    row.creativeType,
    row.videoUrl,
    row.posterUrl,
    row.thumbnailUrl,
    row.imageUrl,
    thumbSize,
  ]);

  const forceRefresh = useCallback(async () => {
    if (!row.adId) return null;
    setLoadingHq(true);
    setHqFailed(false);
    refreshAttempts.delete(row.adId);
    const data = await refreshMetaCreative(row.adId, { force: true, refreshVideo: isVideo }).catch(() => null);
    const visuals = applyRefreshVisuals(data);
    if (visuals.poster) setRefreshedPoster(visuals.poster);
    else if (visuals.thumb) setRefreshedThumb(visuals.thumb);
    const videoUrl = isVideo
      ? (visuals.video ?? null)
      : (visuals.video ?? previewVideoUrl ?? row.videoUrl ?? null);
    if (visuals.video) setPreviewVideoUrl(visuals.video);
    if (isVideo && !visuals.poster && !visuals.thumb && videoUrl) {
      const captured = await enqueuePosterCapture(row.adId, videoUrl).catch(() => null);
      if (captured) setCapturedPoster(captured);
    }
    const hasVisual = Boolean(
      visuals.poster
      ?? visuals.thumb
      ?? capturedPoster
      ?? refreshedPoster
      ?? refreshedThumb
      ?? row.posterUrl
      ?? row.thumbnailUrl,
    );
    setLoadingHq(false);
    if (!hasVisual) setHqFailed(true);
    return videoUrl;
  }, [
    row.adId,
    isVideo,
    previewVideoUrl,
    row.videoUrl,
    row.posterUrl,
    row.thumbnailUrl,
    capturedPoster,
    refreshedPoster,
    refreshedThumb,
  ]);

  return {
    isVideo,
    displaySrc,
    imageSrc,
    hqSrc,
    previewVideoUrl,
    loadingHq,
    isHqReady,
    isLowRes,
    hqFailed,
    canPlayInline,
    useVideoFrame,
    lowResFallbackSrc,
    forceRefresh,
  };
}
