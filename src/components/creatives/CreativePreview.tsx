import { useEffect, useState } from "react";
import { Image as ImageIcon, Layers, Loader2, Play, Video } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { bestCreativeImage } from "@/lib/metaThumb";
import { enqueuePosterCapture } from "@/lib/videoPosterCapture";
import { refreshMetaCreative } from "@/lib/metaCreativeRefresh";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

const requestedPosters = new Set<string>();

export interface CreativePreviewSource {
  adId: string;
  name?: string | null;
  creativeType: string;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  posterUrl: string | null;
  videoUrl: string | null;
  effectiveStatus?: string | null;
}

interface Props {
  row: CreativePreviewSource;
  /** Сжатый формат (для строк таблицы): без бейджа и без play-кнопки. */
  compact?: boolean;
  /** Включить кнопку полноразмерного воспроизведения видео со звуком. */
  playable?: boolean;
  className?: string;
}

/**
 * Универсальное превью креатива Meta: видео автоплей с авто-постером,
 * картинка / карусель с fallback-иконкой, автообновление протухших ссылок
 * через edge-функцию meta-creative-refresh.
 */
export function CreativePreview({ row, compact = false, className }: Props) {
  const isVideo = row.creativeType === "video";
  const isCarousel = row.creativeType === "carousel";
  const [capturedPoster, setCapturedPoster] = useState<string | null>(null);
  const [refreshedThumb, setRefreshedThumb] = useState<string | null>(null);
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(row.videoUrl);
  const src = bestCreativeImage({
    posterUrl: capturedPoster ?? row.posterUrl,
    thumbnailUrl: refreshedThumb ?? row.thumbnailUrl,
    imageUrl: row.imageUrl,
    size: compact ? 240 : 960,
  });

  const refreshVideoPreview = async () => {
    if (!row.adId) return;
    const data = await refreshMetaCreative(row.adId);
    if (data?.thumbnail_url) setRefreshedThumb(data.thumbnail_url);
    if (data?.ok && data.video_url) setPreviewVideoUrl(data.video_url);
  };

  useEffect(() => {
    setPreviewVideoUrl(row.videoUrl);
    setRefreshedThumb(null);
    setCapturedPoster(null);
  }, [row.adId, row.videoUrl]);

  useEffect(() => {
    if (!isVideo || !row.adId || row.posterUrl || capturedPoster) return;
    if (requestedPosters.has(row.adId)) return;
    requestedPosters.add(row.adId);

    let cancelled = false;
    void (async () => {
      let videoUrl = row.videoUrl;
      if (!videoUrl) {
        const data = await refreshMetaCreative(row.adId);
        if (!cancelled && data?.thumbnail_url) setRefreshedThumb(data.thumbnail_url);
        videoUrl = data?.ok ? data.video_url ?? null : null;
      }
      if (!cancelled && videoUrl) setPreviewVideoUrl(videoUrl);
      if (!videoUrl || cancelled) return;
      const poster = await enqueuePosterCapture(row.adId, videoUrl);
      if (poster && !cancelled) setCapturedPoster(poster);
    })().catch(() => {
      requestedPosters.delete(row.adId);
    });

    return () => {
      cancelled = true;
    };
  }, [capturedPoster, isVideo, row.adId, row.posterUrl, row.videoUrl]);

  const TypeIcon = isVideo ? Video : isCarousel ? Layers : ImageIcon;

  return (
    <div className={cn("relative overflow-hidden rounded-xl bg-background", className)}>
      {isVideo && previewVideoUrl ? (
        <video
          src={previewVideoUrl}
          poster={src ?? undefined}
          muted
          playsInline
          autoPlay
          loop
          preload="metadata"
          className="h-full w-full bg-background object-cover"
          onError={() => {
            setPreviewVideoUrl(null);
            void refreshVideoPreview();
          }}
        />
      ) : src ? (
        <img
          src={src}
          alt={row.name ?? ""}
          className="h-full w-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => void refreshVideoPreview()}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <TypeIcon className={cn("text-muted-foreground/40", compact ? "h-5 w-5" : "h-8 w-8")} />
        </div>
      )}
      {!compact && (
        <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-background/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider backdrop-blur">
          <TypeIcon className="h-3 w-3" />
          {row.creativeType}
        </span>
      )}
      {compact && (
        <span className="absolute right-0.5 top-0.5 grid h-4 w-4 place-items-center rounded bg-background/80 backdrop-blur">
          <TypeIcon className="h-2.5 w-2.5" />
        </span>
      )}
      {!compact && isVideo && (
        <span className="absolute inset-0 grid place-items-center pointer-events-none">
          <span className="grid h-10 w-10 place-items-center rounded-full border border-border/40 bg-background/45 backdrop-blur-sm">
            <Play className="h-4 w-4 text-foreground" />
          </span>
        </span>
      )}
      {!compact && row.effectiveStatus && row.effectiveStatus !== "ACTIVE" && (
        <span className="absolute right-2 top-2 rounded-md bg-warning/80 px-1.5 py-0.5 text-[10px] font-bold uppercase text-warning-foreground">
          {row.effectiveStatus}
        </span>
      )}
    </div>
  );
}
