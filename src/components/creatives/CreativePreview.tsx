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
  const containerRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(!compact);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const checkVisible = () => {
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight + 320 && rect.bottom > -320) setInView(true);
    };
    checkVisible();
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setInView(true);
      },
      { rootMargin: "320px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [compact]);

  const {
    isVideo,
    displaySrc,
    imageSrc,
    previewVideoUrl,
    loadingHq,
    isHqReady,
    isLowRes,
    canPlayInline,
    useVideoFrame,
    lowResFallbackSrc,
    forceRefresh,
  } = useCreativeHqPreview(row, { compact, inView });

  const [playerOpen, setPlayerOpen] = useState(false);
  const [playerVideoUrl, setPlayerVideoUrl] = useState<string | null>(null);
  const [loadingFullVideo, setLoadingFullVideo] = useState(false);
  const [mediaError, setMediaError] = useState(false);
  const [playVideo, setPlayVideo] = useState(false);
  const [touchPreview, setTouchPreview] = useState(false);
  const [videoFrameReady, setVideoFrameReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const posterVideoRef = useRef<HTMLVideoElement>(null);

  const isActive = isCreativeActive(row.effectiveStatus);
  const mediaFit = fit === "contain" ? "object-contain" : "object-cover";

  useEffect(() => {
    setVideoFrameReady(false);
  }, [previewVideoUrl, row.adId]);

  // Сбрасываем флаг ошибки, когда появляется новый источник (после forceRefresh
  // или смены креатива). Иначе после первой неудачной загрузки превью навсегда
  // оставалось бы плейсхолдером — даже если подъехал валидный постер. И наоборот:
  // не зацикливаемся на повторной загрузке одного и того же битого URL.
  useEffect(() => {
    setMediaError(false);
  }, [imageSrc, previewVideoUrl, row.adId]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if ((playVideo || touchPreview) && canPlayInline) void el.play().catch(() => {});
    else el.pause();
  }, [playVideo, touchPreview, canPlayInline]);

  const primeVideoFrame = (el: HTMLVideoElement) => {
    const seek = () => {
      try {
        const t = Math.min(0.5, Math.max(0.05, (el.duration || 1) * 0.08));
        if (el.currentTime < 0.05) el.currentTime = t;
        el.pause();
        setVideoFrameReady(true);
      } catch {
        setVideoFrameReady(false);
      }
    };
    if (el.readyState >= 2) seek();
    else el.addEventListener("loadeddata", seek, { once: true });
  };

  const TypeIcon = isVideo ? Video : isCarousel ? Layers : ImageIcon;

  const handlePlayClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setPlayerOpen(true);
    setPlayerVideoUrl(null);
    setLoadingFullVideo(true);
    const freshUrl = await forceRefresh();
    setPlayerVideoUrl(freshUrl);
    setLoadingFullVideo(false);
  };

  const handleRetryVideo = async () => {
    setPlayerVideoUrl(null);
    setLoadingFullVideo(true);
    const freshUrl = await forceRefresh();
    setPlayerVideoUrl(freshUrl);
    setLoadingFullVideo(false);
  };

  const showVideo = canPlayInline && (playVideo || touchPreview);
  const showImage = Boolean(imageSrc) && !mediaError && !showVideo;
  const showVideoFrame = useVideoFrame && !showVideo && !mediaError;
  // Не подставляем обратно тот же URL, который только что отвалился (mediaError) —
  // иначе получаем цикл error→refresh→error. При ошибке уходим в плейсхолдер.
  const thumbFallbackSrc =
    lowResFallbackSrc
    ?? (loadingHq && displaySrc && !useVideoFrame ? displaySrc : null);
  const showLowResFallback =
    Boolean(thumbFallbackSrc) && !mediaError && !showVideo && !showImage && !showVideoFrame;

  const handlePreviewTap = (e: React.MouseEvent) => {
    if (!isVideo || !canPlayInline || playable) return;
    e.stopPropagation();
    setTouchPreview((v) => !v);
  };

  return (
    <div
      ref={containerRef}
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
          poster={imageSrc ?? displaySrc ?? undefined}
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
          src={imageSrc!}
          alt=""
          className={cn(
            "h-full w-full transition-opacity duration-300",
            mediaFit,
            isHqReady ? "opacity-100" : "opacity-95",
          )}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => {
            setMediaError(true);
            void forceRefresh();
          }}
        />
      ) : showVideoFrame ? (
        <video
          ref={posterVideoRef}
          src={previewVideoUrl!}
          muted
          playsInline
          preload="auto"
          className={cn(
            "h-full w-full bg-zinc-950 transition-opacity duration-300",
            mediaFit,
            videoFrameReady ? "opacity-100" : "opacity-0",
          )}
          onLoadedMetadata={(e) => primeVideoFrame(e.currentTarget)}
          onError={() => {
            setMediaError(true);
            void forceRefresh();
          }}
        />
      ) : showLowResFallback ? (
        <>
          <div
            className="absolute inset-0 scale-110 bg-cover bg-center opacity-50 blur-2xl"
            style={{ backgroundImage: `url(${thumbFallbackSrc})` }}
            aria-hidden
          />
          <img
            src={thumbFallbackSrc!}
            alt=""
            className="relative z-[1] max-h-[72%] max-w-[72%] object-contain opacity-90"
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
          />
        </>
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-gradient-to-br from-zinc-700/60 to-zinc-900">
          {loadingHq ? (
            <Loader2 className={cn("animate-spin text-white/55", compact ? "h-4 w-4" : "h-6 w-6")} />
          ) : (
            <>
              <TypeIcon className={cn("text-white/40", compact ? "h-5 w-5" : "h-8 w-8")} />
              {!compact && <span className="px-2 text-center text-[10px] font-medium text-white/45">Превью недоступно</span>}
            </>
          )}
        </div>
      )}

      {loadingHq && !imageSrc && !showVideoFrame && !showLowResFallback && (
        <span className="absolute inset-0 flex items-center justify-center bg-zinc-950/80">
          <Loader2 className={cn("animate-spin text-white/70", compact ? "h-4 w-4" : "h-7 w-7")} />
        </span>
      )}

      {showVideoFrame && !videoFrameReady && !loadingHq && (
        <span className="absolute inset-0 flex items-center justify-center bg-zinc-950/80">
          <Loader2 className={cn("animate-spin text-white/70", compact ? "h-4 w-4" : "h-7 w-7")} />
        </span>
      )}

      {(isLowRes || showLowResFallback) && loadingHq && imageSrc && !compact && (
        <span className="absolute bottom-2 left-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white/90">
          Улучшаем качество…
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
        <Dialog
          open={playerOpen}
          onOpenChange={(open) => {
            setPlayerOpen(open);
            if (!open) setPlayerVideoUrl(null);
          }}
        >
          <DialogContent className="max-h-[100dvh] max-w-[100vw] border-0 bg-black p-0 sm:max-w-[min(420px,95vw)]">
            <DialogTitle className="sr-only">{row.name ?? "Видео из Meta"}</DialogTitle>
            {playerVideoUrl ? (
              <video
                key={playerVideoUrl}
                src={playerVideoUrl}
                poster={imageSrc ?? displaySrc ?? undefined}
                controls
                autoPlay
                playsInline
                className="aspect-[9/16] h-auto max-h-[92dvh] w-full bg-black"
                onError={() => {
                  void handleRetryVideo();
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
                  <p>Не удалось загрузить видео из Meta.</p>
                  <button
                    type="button"
                    onClick={() => {
                      void handleRetryVideo();
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
