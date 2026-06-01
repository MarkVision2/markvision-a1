import { useEffect, useState } from "react";
import { Image as ImageIcon, Layers, Loader2, Play, Video } from "lucide-react";

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
export function CreativePreview({ row, compact = false, playable = false, className }: Props) {
  const isVideo = row.creativeType === "video";
  const isCarousel = row.creativeType === "carousel";
  const [capturedPoster, setCapturedPoster] = useState<string | null>(null);
  const [refreshedThumb, setRefreshedThumb] = useState<string | null>(null);
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(row.videoUrl);
  const [playerOpen, setPlayerOpen] = useState(false);
  const [loadingFullVideo, setLoadingFullVideo] = useState(false);
  const src = bestCreativeImage({
    posterUrl: capturedPoster ?? row.posterUrl,
    thumbnailUrl: refreshedThumb ?? row.thumbnailUrl,
    imageUrl: row.imageUrl,
    size: compact ? 240 : 960,
  });

  const refreshVideoPreview = async (force = false) => {
    if (!row.adId) return null;
    const data = await refreshMetaCreative(row.adId, force ? { force: true } : undefined);
    if (data?.thumbnail_url) setRefreshedThumb(data.thumbnail_url);
    if (data?.ok && data.video_url) {
      setPreviewVideoUrl(data.video_url);
      return data.video_url;
    }
    return null;
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

  const handlePlayClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    // Открываем модалку сразу — пользователь должен увидеть отклик на клик.
    setPlayerOpen(true);
    setLoadingFullVideo(true);
    // Форсируем — игнорируем кеш/cooldown, потому что это явный клик пользователя.
    await refreshVideoPreview(true).catch(() => previewVideoUrl);
    setLoadingFullVideo(false);
  };


  return (
    <div className={cn("relative overflow-hidden rounded-xl bg-background", className)}>
      {isVideo && previewVideoUrl ? (
        <video
          src={previewVideoUrl}
          poster={src ?? undefined}
          muted
          playsInline
         
          loop
          preload="metadata"
          className="h-full w-full bg-background object-cover"
          onError={() => {
            setPreviewVideoUrl(null);
            void refreshVideoPreview();
          }}
        />
      ) : src && !mediaError ? (
        <img
          src={src}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => {
            setMediaError(true);
            void refreshVideoPreview().then((url) => {
              if (url) setMediaError(false);
            });
          }}
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
            <span className="grid h-10 w-10 place-items-center rounded-full border border-border/40 bg-background/45 backdrop-blur-sm">
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
                poster={src ?? undefined}
                controls
               
                playsInline
                className="aspect-[9/16] h-auto max-h-[92dvh] w-full bg-black"
                onError={async () => {
                  setPreviewVideoUrl(null);
                  setLoadingFullVideo(true);
                  await refreshVideoPreview(true).catch(() => null);
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
                style={{ backgroundImage: src ? `url(${src})` : undefined, backgroundColor: "#000" }}
              >
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/55 p-6 text-center text-sm text-white">
                  <p>Ссылка на видео из Meta истекла.</p>
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        setLoadingFullVideo(true);
                        await refreshVideoPreview(true).catch(() => null);
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
