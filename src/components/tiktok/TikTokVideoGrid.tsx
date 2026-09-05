import { Clapperboard, Eye, Heart, Loader2, MessageCircle, Play, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCount, formatDuration, type Lang, t, type TikTokVideo } from "@/lib/tiktokClient";

interface Props {
  videos: TikTokVideo[] | null;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  lang: Lang;
  onLoad: () => void;
  onMore: () => void;
}

/** Display API: лента видео аккаунта (video.list) с метриками. */
export function TikTokVideoGrid({ videos, hasMore, loading, error, lang, onLoad, onMore }: Props) {
  if (!videos && !loading) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border bg-card py-10 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-muted text-muted-foreground"><Clapperboard className="h-6 w-6" /></span>
        <p className="max-w-sm text-sm text-muted-foreground">{t("videosDesc", lang)}</p>
        <Button onClick={onLoad} size="sm">{t("loadVideos", lang)}</Button>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {videos && videos.length === 0 && !loading && (
        <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">{t("noVideos", lang)}</div>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {(videos ?? []).map((v) => (
          <a
            key={v.id}
            href={v.share_url ?? v.embed_link ?? undefined}
            target="_blank"
            rel="noreferrer noopener"
            className="group relative block overflow-hidden rounded-2xl border bg-black/90 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            style={{ aspectRatio: "9 / 16" }}
          >
            {v.cover_image_url ? (
              <img src={v.cover_image_url} alt={v.title || v.description} loading="lazy" className="h-full w-full object-cover transition group-hover:scale-[1.02]" />
            ) : (
              <div className="grid h-full w-full place-items-center text-white/50"><Play className="h-8 w-8" /></div>
            )}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-2.5 text-white">
              <div className="line-clamp-2 text-xs font-medium leading-snug">{v.title || v.description || "—"}</div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-white/85">
                <span className="inline-flex items-center gap-1"><Eye className="h-3 w-3" />{formatCount(v.view_count, lang)}</span>
                <span className="inline-flex items-center gap-1"><Heart className="h-3 w-3" />{formatCount(v.like_count, lang)}</span>
                <span className="inline-flex items-center gap-1"><MessageCircle className="h-3 w-3" />{formatCount(v.comment_count, lang)}</span>
                <span className="inline-flex items-center gap-1"><Share2 className="h-3 w-3" />{formatCount(v.share_count, lang)}</span>
              </div>
            </div>
            {v.duration != null && (
              <span className="absolute right-2 top-2 rounded-md bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-white">{formatDuration(v.duration)}</span>
            )}
          </a>
        ))}
        {loading && Array.from({ length: videos?.length ? 2 : 5 }).map((_, i) => (
          <Skeleton key={`sk-${i}`} className="rounded-2xl" style={{ aspectRatio: "9 / 16" }} />
        ))}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {videos && hasMore && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={onMore} disabled={loading}>
            {loading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}{t("loadMore", lang)}
          </Button>
        </div>
      )}
    </div>
  );
}
