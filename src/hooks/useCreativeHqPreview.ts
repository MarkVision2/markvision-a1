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
const MAX_REFRESH_ATTEMPTS = 3;

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

export function useCreativeHqPreview(row: CreativePreviewSource, opts: Options = {}) {
  const isVideo = row.creativeType === "video";
  const inView = opts.inView ?? true;
  const [capturedPoster, setCapturedPoster] = useState<string | null>(null);
  const [refreshedThumb, setRefreshedThumb] = useState<string | null>(null);
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(row.videoUrl);
  const [loadingHq, setLoadingHq] = useState(false);

  const thumbSize = opts.compact ? 720 : 1080;
  const sources = useMemo(() => ({
    posterUrl: capturedPoster ?? row.posterUrl,
    thumbnailUrl: refreshedThumb ?? row.thumbnailUrl,
    imageUrl: refreshedThumb ?? row.imageUrl,
    size: thumbSize,
  }), [capturedPoster, refreshedThumb, row.posterUrl, row.thumbnailUrl, row.imageUrl, thumbSize]);

  const displaySrc = useMemo(() => pickCreativePreviewUrl(sources), [sources]);
  const hqSrc = useMemo(() => bestCreativeImageHq(sources), [sources]);
  const imageSrc = useMemo(
    () => pickDisplayImageSrc({ hqSrc, displaySrc, loadingHq, isLowRes: Boolean(displaySrc && !hqSrc) }),
    [hqSrc, displaySrc, loadingHq],
  );
  const isHqReady = Boolean(hqSrc);
  const isLowRes = Boolean(displaySrc && !isHqReady);
  const canPlayInline = isVideo && Boolean(previewVideoUrl);

  useEffect(() => {
    setPreviewVideoUrl(row.videoUrl);
    setRefreshedThumb(null);
    setCapturedPoster(null);
  }, [row.adId, row.videoUrl]);

  useEffect(() => {
    if (!row.adId || !inView) return;

    let cancelled = false;
    const adId = row.adId;
    const needsHq = sourcesNeedHq(row, capturedPoster ?? row.posterUrl);

    void (async () => {
      if (needsHq) setLoadingHq(true);

      let videoUrl = row.videoUrl ?? null;
      const attempts = refreshAttempts.get(adId) ?? 0;

      let refreshedFromApi: string | null = null;
      if (needsHq && attempts < MAX_REFRESH_ATTEMPTS) {
        refreshAttempts.set(adId, attempts + 1);
        const data = await refreshMetaCreative(adId).catch(() => null);
        if (cancelled) return;
        if (data?.thumbnail_url) {
          refreshedFromApi = data.thumbnail_url;
          setRefreshedThumb(data.thumbnail_url);
        }
        if (data?.video_url) {
          videoUrl = data.video_url;
          setPreviewVideoUrl(data.video_url);
        }
      }

      const hasHqAfterRefresh = !sourcesNeedHq(
        {
          ...row,
          imageUrl: refreshedFromApi ?? row.imageUrl,
          thumbnailUrl: refreshedFromApi ?? row.thumbnailUrl,
        },
        capturedPoster ?? row.posterUrl,
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
    row.adId,
    row.videoUrl,
    row.posterUrl,
    row.imageUrl,
    row.thumbnailUrl,
    capturedPoster,
    refreshedThumb,
  ]);

  const forceRefresh = async () => {
    if (!row.adId) return null;
    setLoadingHq(true);
    refreshAttempts.delete(row.adId);
    const data = await refreshMetaCreative(row.adId, { force: true }).catch(() => null);
    if (data?.thumbnail_url) setRefreshedThumb(data.thumbnail_url);
    let videoUrl = data?.video_url ?? previewVideoUrl ?? row.videoUrl ?? null;
    if (data?.video_url) setPreviewVideoUrl(data.video_url);
    if (isVideo && videoUrl) {
      const poster = await enqueuePosterCapture(row.adId, videoUrl).catch(() => null);
      if (poster) setCapturedPoster(poster);
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
