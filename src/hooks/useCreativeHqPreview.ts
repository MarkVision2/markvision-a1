import { useEffect, useMemo, useState } from "react";
import type { CreativePreviewSource } from "@/components/creatives/CreativePreview";
import {
  bestCreativeImageHq,
  isHighQualityCreativeUrl,
  pickCreativePreviewUrl,
} from "@/lib/metaThumb";
import { refreshMetaCreative } from "@/lib/metaCreativeRefresh";
import { enqueuePosterCapture } from "@/lib/videoPosterCapture";

const refreshAttempts = new Map<string, number>();
const MAX_REFRESH_ATTEMPTS = 3;

interface Options {
  compact?: boolean;
}

export function useCreativeHqPreview(row: CreativePreviewSource, opts: Options = {}) {
  const isVideo = row.creativeType === "video";
  const [capturedPoster, setCapturedPoster] = useState<string | null>(null);
  const [refreshedThumb, setRefreshedThumb] = useState<string | null>(null);
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(row.videoUrl);
  const [loadingHq, setLoadingHq] = useState(false);

  const thumbSize = opts.compact ? 480 : 1080;
  const sources = useMemo(() => ({
    posterUrl: capturedPoster ?? row.posterUrl,
    thumbnailUrl: refreshedThumb ?? row.thumbnailUrl,
    imageUrl: row.imageUrl,
    size: thumbSize,
  }), [capturedPoster, refreshedThumb, row.posterUrl, row.thumbnailUrl, row.imageUrl, thumbSize]);

  const displaySrc = useMemo(() => pickCreativePreviewUrl(sources), [sources]);
  const hqSrc = useMemo(() => bestCreativeImageHq(sources), [sources]);
  const isHqReady = Boolean(hqSrc);
  const isLowRes = Boolean(displaySrc && !isHqReady);
  const canPlayInline = isVideo && Boolean(previewVideoUrl);

  useEffect(() => {
    setPreviewVideoUrl(row.videoUrl);
    setRefreshedThumb(null);
    setCapturedPoster(null);
  }, [row.adId, row.videoUrl]);

  useEffect(() => {
    if (!row.adId) return;

    let cancelled = false;
    const adId = row.adId;
    const wantsHq = isVideo && !isHighQualityCreativeUrl(row.posterUrl) && !isHighQualityCreativeUrl(row.imageUrl);

    void (async () => {
      if (wantsHq) setLoadingHq(true);

      let videoUrl = row.videoUrl;
      const attempts = refreshAttempts.get(adId) ?? 0;

      if (wantsHq && attempts < MAX_REFRESH_ATTEMPTS) {
        refreshAttempts.set(adId, attempts + 1);
        const data = await refreshMetaCreative(adId).catch(() => null);
        if (cancelled) return;
        if (data?.thumbnail_url) setRefreshedThumb(data.thumbnail_url);
        if (data?.video_url) {
          videoUrl = data.video_url;
          setPreviewVideoUrl(data.video_url);
        }
      }

      const hasHqPoster = Boolean(
        row.posterUrl && isHighQualityCreativeUrl(row.posterUrl),
      ) || Boolean(row.imageUrl && isHighQualityCreativeUrl(row.imageUrl))
        || Boolean(capturedPoster);

      if (isVideo && !hasHqPoster && videoUrl) {
        const poster = await enqueuePosterCapture(adId, videoUrl).catch(() => null);
        if (!cancelled && poster) setCapturedPoster(poster);
      }

      if (!cancelled) setLoadingHq(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    isVideo,
    row.adId,
    row.videoUrl,
    row.posterUrl,
    row.imageUrl,
    capturedPoster,
  ]);

  const forceRefresh = async () => {
    if (!row.adId) return null;
    setLoadingHq(true);
    refreshAttempts.delete(row.adId);
    const data = await refreshMetaCreative(row.adId, { force: true }).catch(() => null);
    if (data?.thumbnail_url) setRefreshedThumb(data.thumbnail_url);
    if (data?.video_url) setPreviewVideoUrl(data.video_url);
    setLoadingHq(false);
    return data?.video_url ?? null;
  };

  return {
    isVideo,
    displaySrc,
    hqSrc,
    previewVideoUrl,
    loadingHq,
    isHqReady,
    isLowRes,
    canPlayInline,
    forceRefresh,
  };
}
