/**
 * Радар идей: просмотр ролика прямо на странице. Ссылки на файлы у площадок
 * подписаны и через несколько дней протухают, поэтому плеер включается по
 * кнопке (не грузим видео пачкой), играет со звуком и при отказе CDN честно
 * предлагает открыть оригинал, а не показывает чёрный прямоугольник.
 */
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ExternalLink, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RadarPost } from "@/lib/radarClient";
import { cn } from "@/lib/utils";

type VideoPost = Pick<RadarPost, "video_url" | "url" | "media_type" | "platform">;

/** Есть ли что проигрывать: прямая https-ссылка на файл. */
export function playableVideoUrl(post: VideoPost): string | null {
  const raw = post.video_url?.trim();
  if (!raw || !/^https:\/\//i.test(raw)) return null;
  return raw;
}

interface PostVideoProps {
  post: VideoPost;
  /** Показывается, пока плеер не запущен (превью поста). */
  poster?: React.ReactNode;
  className?: string;
  /** Кнопка поверх превью — маленькая (карточка) или обычная (панель разбора). */
  size?: "sm" | "lg";
}

export function PostVideo({ post, poster, className, size = "lg" }: PostVideoProps) {
  const src = playableVideoUrl(post);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    setPlaying(false);
    setFailed(false);
  }, [src]);

  // Клик по кнопке — жест пользователя, поэтому звук разрешён; muted не ставим.
  useEffect(() => {
    if (!playing || !ref.current) return;
    ref.current.play().catch(() => setFailed(true));
  }, [playing]);

  if (!src) return <>{poster}</>;

  if (failed) {
    return (
      <div className={cn("relative h-full w-full", className)}>
        {poster}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/85 p-4 text-center">
          <AlertTriangle className="h-5 w-5 text-warning" />
          <p className="text-xs text-muted-foreground">Площадка больше не отдаёт этот файл — ссылка устарела.</p>
          {post.url && (
            <Button asChild size="sm" variant="outline" className="gap-1">
              <a href={post.url} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3.5 w-3.5" />
                Открыть оригинал
              </a>
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (playing) {
    return (
      <video
        ref={ref}
        src={src}
        className={cn("h-full w-full bg-black object-contain", className)}
        controls
        autoPlay
        playsInline
        preload="metadata"
        onError={() => setFailed(true)}
        data-testid="post-video"
      />
    );
  }

  // Слой не должен перехватывать клики мимо кнопки: под ним лежит превью,
  // клик по которому открывает разбор поста.
  return (
    <div className={cn("pointer-events-none relative grid h-full w-full place-items-center", className)}>
      {poster}
      <button
        type="button"
        aria-label="Смотреть видео"
        title="Смотреть со звуком"
        onClick={(e) => {
          e.stopPropagation();
          setPlaying(true);
        }}
        className={cn(
          "pointer-events-auto grid place-items-center rounded-full bg-background/85 text-foreground shadow-lg backdrop-blur transition-transform hover:scale-110",
          size === "lg" ? "h-14 w-14" : "h-11 w-11",
        )}
      >
        <Play className={cn("translate-x-[1px] fill-current", size === "lg" ? "h-6 w-6" : "h-4 w-4")} />
      </button>
    </div>
  );
}
