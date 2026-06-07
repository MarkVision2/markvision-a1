import { useEffect, useMemo, useState } from "react";
import type { CreativePreviewSource } from "@/components/creatives/CreativePreview";
import { bestCreativeImage, isHighQualityCreativeUrl, upscaleMetaThumb } from "@/lib/metaThumb";
import { refreshMetaCreative } from "@/lib/metaCreativeRefresh";
import { enqueuePosterCapture } from "@/lib/videoPosterCapture";

const refreshAttempts = new Map<string, number>();
const MAX_REFRESH_ATTEMPTS = 2;

function hasStoredHqPoster(row: CreativePreviewSource): boolean {
  return isHighQualityCreativeUrl(row.posterUrl)
    || isHighQualityCreativeUrl(row.imageUrl)
    || isHighQualityCreativeUrl(row.thumbnailUrl);
}

interface Options {
  /** Меньший размер для компактных превью в таблицах. */
  compact?: boolean;
}

export function useCreativeHqPreview(row: CreativePreviewSource, opts: Options = {}) {
  const isVideo = row.creativeType === "video";
  const [capturedPoster, setCapturedPoster] = useState<string | null>(null);
  const [refreshedThumb, setRefreshedThumb] = useState<string | null>(null);
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(row.videoUrl);
  const [loadingHq, setLoadingHq] = useState(isVideo && !hasStoredHqPoster(row));

  const thumbSize = opts.compact ? 480 : 1080;
  const displaySrc = useMemo(() => {
    const hq = bestCreativeImage({
      posterUrl: capturedPoster ?? row.posterUrl,
      thumbnailUrl: refreshedThumb ?? row.thumbnailUrl,
      imageUrl: row.imageUrl,
      size: thumbSize,
    });
    if (hq) return hq;
    if (!isVideo) {
      return upscaleMetaThumb(refreshedThumb ?? row.thumbnailUrl, thumbSize)
        ?? row.imageUrl
        ?? row.thumbnailUrl;
    }
    return null;
  }, [
    capturedPoster,
    refreshedThumb,
    row.posterUrl,
    row.thumbnailUrl,
    row.imageUrl,
    thumbSize,
    isVideo,
  ]);

  const isHqReady = Boolean(displaySrc);
  const canPlayInline = isVideo && Boolean(previewVideoUrl) && isHqReady;

  useEffect(() => {
    setPreviewVideoUrl(row.videoUrl);
    setRefreshedThumb(null);
    setCapturedPoster(null);
    setLoadingHq(isVideo && !hasStoredHqPoster(row));
  }, [isVideo, row.adId, row.videoUrl, row.posterUrl, row.imageUrl, row.thumbnailUrl]);

  useEffect(() => {
    if (!isVideo || !row.adId) return;

    let cancelled = false;
    const adId = row.adId;

    void (async () => {
      setLoadingHq(!hasStoredHqPoster(row));
      let videoUrl = row.videoUrl;
      let hqThumb: string | null = null;

      const needsRefresh = !hasStoredHqPoster(row) || !row.videoUrl;
      const attempts = refreshAttempts.get(adId) ?? 0;

      if (needsRefresh && attempts < MAX_REFRESH_ATTEMPTS) {
        refreshAttempts.set(adId, attempts + 1);
        const data = await refreshMetaCreative(adId).catch(() => null);
        if (cancelled) return;
        if (data?.thumbnail_url) {
          hqThumb = data.thumbnail_url;
          setRefreshedThumb(data.thumbnail_url);
        }
        if (data?.video_url) {
          videoUrl = data.video_url;
          setPreviewVideoUrl(data.video_url);
        }
      }

      const hasPoster = Boolean(
        row.posterUrl
        || isHighQualityCreativeUrl(row.imageUrl)
        || isHighQualityCreativeUrl(hqThumb)
        || isHighQualityCreativeUrl(row.thumbnailUrl),
      );

      if (!hasPoster && videoUrl) {
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
    row.thumbnailUrl,
  ]);

  const forceRefresh = async () => {
    if (!row.adId) return null;
    setLoadingHq(true);
    const data = await refreshMetaCreative(row.adId, { force: true }).catch(() => null);
    if (data?.thumbnail_url) setRefreshedThumb(data.thumbnail_url);
    if (data?.video_url) setPreviewVideoUrl(data.video_url);
    setLoadingHq(false);
    return data?.video_url ?? null;
  };

  return {
    isVideo,
    displaySrc,
    previewVideoUrl,
    loadingHq,
    isHqReady,
    canPlayInline,
    forceRefresh,
  };
}
