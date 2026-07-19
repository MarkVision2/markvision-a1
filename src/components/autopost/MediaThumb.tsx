import { Film } from "lucide-react";
import { cn } from "@/lib/utils";

/** URL похож на видеофайл (нельзя класть в <img>). */
export function looksLikeVideoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const path = url.split("?")[0].toLowerCase();
  return /\.(mp4|mov|m4v|webm|mkv)$/i.test(path);
}

function resolvePreview(opts: {
  thumbnailUrl?: string | null;
  mediaUrl?: string | null;
  mediaType?: string | null;
}): { kind: "image" | "video" | "empty"; src: string | null } {
  const thumb = opts.thumbnailUrl?.trim() || null;
  const media = opts.mediaUrl?.trim() || null;
  const type = String(opts.mediaType ?? "").toUpperCase();
  const forceVideo = type === "REELS" || type === "STORIES";

  if (thumb && !looksLikeVideoUrl(thumb)) {
    return { kind: "image", src: thumb };
  }
  if (media && !looksLikeVideoUrl(media) && !forceVideo) {
    return { kind: "image", src: media };
  }

  const video =
    (thumb && looksLikeVideoUrl(thumb) ? thumb : null) ||
    (media && looksLikeVideoUrl(media) ? media : null) ||
    (forceVideo ? media || thumb : null);

  if (video) return { kind: "video", src: video };
  if (thumb) return { kind: "image", src: thumb };
  if (media) return { kind: "image", src: media };
  return { kind: "empty", src: null };
}

/** Превью поста: картинка или первый кадр видео (Reels без cover_url). */
export function MediaThumb({
  thumbnailUrl,
  mediaUrl,
  mediaType,
  className,
  mediaClassName,
}: {
  thumbnailUrl?: string | null;
  mediaUrl?: string | null;
  mediaType?: string | null;
  className?: string;
  mediaClassName?: string;
}) {
  const preview = resolvePreview({ thumbnailUrl, mediaUrl, mediaType });

  return (
    <div className={cn("overflow-hidden bg-muted", className)}>
      {preview.kind === "image" && preview.src ? (
        <img
          src={preview.src}
          alt=""
          className={cn("h-full w-full object-cover", mediaClassName)}
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      ) : preview.kind === "video" && preview.src ? (
        <video
          src={`${preview.src}#t=0.1`}
          muted
          playsInline
          preload="metadata"
          className={cn("h-full w-full object-cover", mediaClassName)}
        />
      ) : (
        <div className="grid h-full w-full place-items-center text-muted-foreground">
          <Film className="h-4 w-4 opacity-60" />
        </div>
      )}
    </div>
  );
}
