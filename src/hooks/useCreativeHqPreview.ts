import { useEffect, useMemo, useState } from "react";
import type { CreativePreviewSource } from "@/components/creatives/CreativePreview";
import {
  bestCreativeImageHq,
  isHighQualityCreativeUrl,
  pickCreativePreviewUrl,
  pickDisplayImageSrc,
} from "@/lib/metaThumb";
import { refreshMetaCreative } from "@/lib/metaCreativeRefresh";
import { enqueuePosterCapture } from "@/lib/videoPosterCapture";

const refreshAttempts = new Map<string, number>();
const MAX_REFRESH_ATTEMPTS = 5;

interface Options {
  compact?: boolean;
  /** Подгружать HD только когда карточка в зоне видимости */
  inView?: boolean;
}

function sourcesNeedHq(row: CreativePreviewSource, posterUrl: string | null): boolean {
  return !(
    isHighQualityCreativeUrl(posterUrl)
    || isHighQualityCreativeUrl(row.imageUrl)
    || isHighQualityCreativeUrl(row.thumbnailUrl)
  );
}

function applyRefreshPoster(
  data: { poster_url?: string | null; thumbnail_url?: string | null } | null,
): string | null {
  if (data?.poster_url && isHighQualityCreativeUrl(data.poster_url)) return data.poster_url;
  if (data?.thumbnail_url && isHighQualityCreativeUrl(data.thumbnail_url)) return data.thumbnail_url;
  return null;
}

export function useCreativeHqPreview(row: CreativePreviewSource, opts: Options = {}) {
  const isVideo = row.creativeType === "video";
  const inView = opts.inView ?? true;
  const [capturedPoster, setCapturedPoster] = useState<string | null>(null);
  const [refreshedPoster, setRefreshedPoster] = useState<string | null>(null);
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(row.videoUrl);
  const [loadingHq, setLoadingHq] = useState(() => sourcesNeedHq(row, row.posterUrl));

  const thumbSize = opts.compact ? 720 : 1080;
  const sources = useMemo(() => ({
    posterUrl: capturedPoster ?? refreshedPoster ?? row.posterUrl,
    thumbnailUrl: row.thumbnailUrl,
    imageUrl: row.imageUrl,
    size: thumbSize,
  }), [capturedPoster, refreshedPoster, row.posterUrl, row.thumbnailUrl, row.imageUrl, thumbSize]);

  const displaySrc = useMemo(() => pickCreativePreviewUrl(sources), [sources]);
  const hqSrc = useMemo(() => bestCreativeImageHq(sources), [sources]);
  const imageSrc = useMemo(
    () => pickDisplayImageSrc({ hqSrc, displaySrc, loadingHq, isLowRes: Boolean(displaySrc && !hqSrc) }),
    [hqSrc, displaySrc, loadingHq],
  );
  const isHqReady = Boolean(hqSrc);
  const isLowRes = Boolean(displaySrc && !isHqReady);
  const canPlayInline = isVideo && Boolean(previewVideoUrl) && isHqReady;

  useEffect(() => {
    setPreviewVideoUrl(row.videoUrl);
    setRefreshedPoster(null);
    setCapturedPoster(null);
    setLoadingHq(sourcesNeedHq(row, row.posterUrl));
  }, [row.adId, row.videoUrl, row.posterUrl, row.imageUrl, row.thumbnailUrl]);

  useEffect(() => {
    if (!row.adId || !inView) return;

    let cancelled = false;
    const adId = row.adId;
    const needsHq = sourcesNeedHq(row, capturedPoster ?? refreshedPoster ?? row.posterUrl);

    void (async () => {
      if (needsHq) setLoadingHq(true);

      let videoUrl = row.videoUrl ?? null;
      const attempts = refreshAttempts.get(adId) ?? 0;

      let refreshedFromApi: string | null = null;
      if (needsHq && attempts < MAX_REFRESH_ATTEMPTS) {
        refreshAttempts.set(adId, attempts + 1);
        const data = await refreshMetaCreative(adId).catch(() => null);
        if (cancelled) return;
        refreshedFromApi = applyRefreshPoster(data);
        if (refreshedFromApi) setRefreshedPoster(refreshedFromApi);
        if (data?.video_url) {
          videoUrl = data.video_url;
          setPreviewVideoUrl(data.video_url);
        }
      }

      const hasHqAfterRefresh = !sourcesNeedHq(
        row,
        capturedPoster ?? refreshedFromApi ?? refreshedPoster ?? row.posterUrl,
      );

      if (isVideo && !hasHqAfterRefresh && videoUrl) {
        const poster = await enqueuePosterCapture(adId, videoUrl).catch(() => null);
        if (!cancelled && poster) setCapturedPoster(poster);
      }

      if (!cancelled) setLoadingHq(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    inView,
    isVideo,
    row,
    capturedPoster,
    refreshedPoster,
  ]);

  const forceRefresh = async () => {
    if (!row.adId) return null;
    setLoadingHq(true);
    refreshAttempts.delete(row.adId);
    const data = await refreshMetaCreative(row.adId, { force: true }).catch(() => null);
    const poster = applyRefreshPoster(data);
    if (poster) setRefreshedPoster(poster);
    let videoUrl = data?.video_url ?? previewVideoUrl ?? row.videoUrl ?? null;
    if (data?.video_url) setPreviewVideoUrl(data.video_url);
    if (isVideo && !poster && videoUrl) {
      const captured = await enqueuePosterCapture(row.adId, videoUrl).catch(() => null);
      if (captured) setCapturedPoster(captured);
    }
    setLoadingHq(false);
    return videoUrl;
  };

  return {
    isVideo,
    displaySrc,
    imageSrc,
    hqSrc,
    previewVideoUrl,
    loadingHq,
    isHqReady,
    isLowRes,
    canPlayInline,
    forceRefresh,
  };
}
