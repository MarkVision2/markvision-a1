import { useEffect, useRef, useState } from "react";
import { Image as ImageIcon, Layers, Loader2, Play, Video } from "lucide-react";

import { cn } from "@/lib/utils";
import { useCreativeHqPreview } from "@/hooks/useCreativeHqPreview";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

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
 * Универсальное превью креатива Meta: HQ-постер, видео только при hover
 * после загрузки чёткого кадра. Низкие 64×64 thumbnail никогда не показываем.
 */
export function CreativePreview({ row, compact = false, playable = false, className }: Props) {
  const isCarousel = row.creativeType === "carousel";
  const {
    isVideo,
    displaySrc,
    previewVideoUrl,
    loadingHq,
    canPlayInline,
    forceRefresh,
  } = useCreativeHqPreview(row, { compact });

  const [playerOpen, setPlayerOpen] = useState(false);
  const [loadingFullVideo, setLoadingFullVideo] = useState(false);
  const [mediaError, setMediaError] = useState(false);
  const [playVideo, setPlayVideo] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (playVideo && canPlayInline) void el.play().catch(() => {});
    else el.pause();
  }, [playVideo, canPlayInline]);

  const TypeIcon = isVideo ? Video : isCarousel ? Layers : ImageIcon;

  const handlePlayClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setPlayerOpen(true);
    setLoadingFullVideo(true);
    await forceRefresh();
    setLoadingFullVideo(false);
  };

  const showVideo = canPlayInline && playVideo && displaySrc;
  const showImage = displaySrc && !mediaError && !showVideo;

  return (
    <div
      className={cn("relative overflow-hidden rounded-xl bg-background", className)}
      onMouseEnter={() => setPlayVideo(true)}
      onMouseLeave={() => setPlayVideo(false)}
    >
      {showVideo ? (
        <video
          ref={videoRef}
          src={previewVideoUrl!}
          poster={displaySrc ?? undefined}
          muted
          playsInline
          loop
          preload="metadata"
          className="h-full w-full bg-background object-cover"
          onError={() => {
            void forceRefresh();
          }}
        />
      ) : showImage ? (
        <img
          src={displaySrc!}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => {
            setMediaError(true);
            void forceRefresh().then(() => setMediaError(false));
          }}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-secondary/20">
          {loadingHq && isVideo ? (
            <Loader2 className={cn("animate-spin text-muted-foreground/50", compact ? "h-4 w-4" : "h-6 w-6")} />
          ) : (
            <TypeIcon className={cn("text-muted-foreground/40", compact ? "h-5 w-5" : "h-8 w-8")} />
          )}
        </div>
      )}
      {!compact && (
        <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-background/90 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
          <TypeIcon className="h-3 w-3" />
          {row.creativeType}
        </span>
      )}
      {compact && (
        <span className="absolute right-0.5 top-0.5 grid h-4 w-4 place-items-center rounded bg-background/90">
          <TypeIcon className="h-2.5 w-2.5" />
        </span>
      )}
      {!compact && isVideo && (
        playable ? (
          <button
            type="button"
            onClick={handlePlayClick}
            disabled={loadingFullVideo}
            className="absolute inset-0 grid place-items-center transition-colors hover:bg-black/20"
            aria-label="Смотреть видео"
          >
            <span className="grid h-14 w-14 place-items-center rounded-full border border-white/30 bg-black/55 backdrop-blur-sm transition-transform hover:scale-110">
              {loadingFullVideo ? (
                <Loader2 className="h-6 w-6 animate-spin text-white" />
              ) : (
                <Play className="h-6 w-6 fill-white text-white" />
              )}
            </span>
          </button>
        ) : (
          <span className="pointer-events-none absolute inset-0 grid place-items-center">
            <span className="grid h-10 w-10 place-items-center rounded-full border border-border/50 bg-background/75">
              <Play className="h-4 w-4 text-foreground" />
            </span>
          </span>
        )
      )}
      {!compact && row.effectiveStatus && row.effectiveStatus !== "ACTIVE" && (
        <span className="absolute right-2 top-2 rounded-md bg-warning/80 px-1.5 py-0.5 text-[10px] font-bold uppercase text-warning-foreground">
          {row.effectiveStatus}
        </span>
      )}

      {playable && isVideo && (
        <Dialog open={playerOpen} onOpenChange={setPlayerOpen}>
          <DialogContent className="max-h-[100dvh] max-w-[100vw] border-0 bg-black p-0 sm:max-w-[min(420px,95vw)]">
            <DialogTitle className="sr-only">{row.name ?? "Видео из Meta"}</DialogTitle>
            {previewVideoUrl ? (
              <video
                src={previewVideoUrl}
                poster={displaySrc ?? undefined}
                controls
                playsInline
                className="aspect-[9/16] h-auto max-h-[92dvh] w-full bg-black"
                onError={async () => {
                  setLoadingFullVideo(true);
                  await forceRefresh();
                  setLoadingFullVideo(false);
                }}
              />
            ) : loadingFullVideo ? (
              <div className="grid aspect-[9/16] place-items-center bg-black text-sm text-white/70">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : (
              <div
                className="relative aspect-[9/16] w-full bg-cover bg-center"
                style={{ backgroundImage: displaySrc ? `url(${displaySrc})` : undefined, backgroundColor: "#000" }}
              >
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/55 p-6 text-center text-sm text-white">
                  <p>Ссылка на видео из Meta истекла.</p>
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        setLoadingFullVideo(true);
                        await forceRefresh();
                        setLoadingFullVideo(false);
                      }}
                      className="rounded-md bg-white/15 px-3 py-1.5 text-xs font-semibold backdrop-blur hover:bg-white/25"
                    >
                      Попробовать снова
                    </button>
                    <a
                      href={`https://www.facebook.com/ads/library/?id=${row.adId}`}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                    >
                      Открыть в Facebook Ads Library
                    </a>
                  </div>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}

    </div>
  );
}
