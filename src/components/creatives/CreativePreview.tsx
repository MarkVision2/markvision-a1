import { useEffect, useRef, useState } from "react";
import { Image as ImageIcon, Layers, Loader2, Play, Video } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatCreativeStatus, isCreativeActive } from "@/lib/creativeDisplay";
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
  compact?: boolean;
  playable?: boolean;
  /** cover — заполняет область (может обрезать). contain — целиком, без обрезки. */
  fit?: "cover" | "contain";
  className?: string;
}

export function CreativePreview({
  row,
  compact = false,
  playable = false,
  fit = "contain",
  className,
}: Props) {
  const isCarousel = row.creativeType === "carousel";
  const {
    isVideo,
    displaySrc,
    previewVideoUrl,
    loadingHq,
    isLowRes,
    canPlayInline,
    forceRefresh,
  } = useCreativeHqPreview(row, { compact });

  const [playerOpen, setPlayerOpen] = useState(false);
  const [loadingFullVideo, setLoadingFullVideo] = useState(false);
  const [mediaError, setMediaError] = useState(false);
  const [playVideo, setPlayVideo] = useState(false);
  const [touchPreview, setTouchPreview] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const isActive = isCreativeActive(row.effectiveStatus);
  const mediaFit = fit === "contain" ? "object-contain" : "object-cover";

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if ((playVideo || touchPreview) && canPlayInline) void el.play().catch(() => {});
    else el.pause();
  }, [playVideo, touchPreview, canPlayInline]);

  const TypeIcon = isVideo ? Video : isCarousel ? Layers : ImageIcon;

  const handlePlayClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setPlayerOpen(true);
    setLoadingFullVideo(true);
    await forceRefresh();
    setLoadingFullVideo(false);
  };

  const showVideo = canPlayInline && (playVideo || touchPreview);
  const showImage = displaySrc && !mediaError && !showVideo;

  const handlePreviewTap = (e: React.MouseEvent) => {
    if (!isVideo || !canPlayInline || playable) return;
    e.stopPropagation();
    setTouchPreview((v) => !v);
  };

  return (
    <div
      className={cn(
        "relative overflow-hidden bg-zinc-950",
        fit === "contain" && "flex items-center justify-center",
        className,
      )}
      onMouseEnter={() => setPlayVideo(true)}
      onMouseLeave={() => {
        setPlayVideo(false);
        setTouchPreview(false);
      }}
      onClick={(e) => handlePreviewTap(e)}
      role={isVideo && canPlayInline && !playable ? "button" : undefined}
      tabIndex={isVideo && canPlayInline && !playable ? 0 : undefined}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && isVideo && canPlayInline && !playable) {
          e.preventDefault();
          setTouchPreview((v) => !v);
        }
      }}
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
          className={cn("h-full w-full bg-zinc-950", mediaFit)}
          onError={() => {
            void forceRefresh();
          }}
        />
      ) : showImage ? (
        <img
          src={displaySrc!}
          alt=""
          className={cn("h-full w-full", mediaFit)}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => {
            setMediaError(true);
            void forceRefresh().then(() => setMediaError(false));
          }}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-secondary/20">
          {loadingHq ? (
            <Loader2 className={cn("animate-spin text-muted-foreground/50", compact ? "h-4 w-4" : "h-6 w-6")} />
          ) : (
            <TypeIcon className={cn("text-muted-foreground/40", compact ? "h-5 w-5" : "h-8 w-8")} />
          )}
        </div>
      )}

      {isLowRes && loadingHq && !compact && (
        <span className="absolute bottom-2 left-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[9px] font-medium text-white/80">
          Загрузка HD…
        </span>
      )}

      {!compact && (
        <div className="absolute left-2 top-2 flex flex-wrap gap-1">
          <span className="inline-flex items-center gap-1 rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
            <TypeIcon className="h-3 w-3" />
            {row.creativeType === "video" ? "Видео" : row.creativeType === "carousel" ? "Карусель" : "Фото"}
          </span>
          {row.effectiveStatus && (
            <span
              className={cn(
                "rounded-md px-1.5 py-0.5 text-[10px] font-semibold backdrop-blur-sm",
                isActive ? "bg-emerald-600/90 text-white" : "bg-black/55 text-white/85",
              )}
            >
              {formatCreativeStatus(row.effectiveStatus)}
            </span>
          )}
        </div>
      )}

      {compact && (
        <span className="absolute right-0.5 top-0.5 grid h-4 w-4 place-items-center rounded bg-black/70 text-white">
          <TypeIcon className="h-2.5 w-2.5" />
        </span>
      )}

      {!compact && isVideo && (
        playable ? (
          <button
            type="button"
            onClick={handlePlayClick}
            disabled={loadingFullVideo}
            className="absolute bottom-2 right-2 z-10 grid h-11 w-11 place-items-center rounded-full bg-black/75 text-white opacity-100 backdrop-blur-sm transition hover:bg-primary sm:h-9 sm:w-9 sm:opacity-0 sm:group-hover:opacity-100"
            aria-label="Смотреть видео"
          >
            {loadingFullVideo ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4 fill-current" />
            )}
          </button>
        ) : (
          <span className="pointer-events-none absolute bottom-2 right-2 grid h-10 w-10 place-items-center rounded-full bg-black/65 text-white opacity-100 sm:h-8 sm:w-8 sm:opacity-0 sm:group-hover:opacity-100">
            <Play className="h-3.5 w-3.5 fill-current" />
          </span>
        )
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
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
