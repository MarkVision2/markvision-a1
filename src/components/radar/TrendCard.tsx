/**
 * Радар идей: карточка поста в ленте трендов — превью (с заглушкой, если CDN
 * не отдал картинку), главное число (просмотры или лайки), X-фактор, автор,
 * ниша, хук из разбора, «обычно / сейчас / ER», оценка и действия.
 */
import { ExternalLink, Loader2, ScanSearch, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ANALYSIS_STATUS_META, formatEngagement, type RadarPost } from "@/lib/radarClient";
import { formatAge, formatCompact, nicheOf, primaryMetric, usualMetric, VIRAL_X_FACTOR } from "@/lib/radarStats";
import { cn } from "@/lib/utils";
import { PostVideo, playableVideoUrl } from "./PostVideo";
import { Chip, PlatformChip, PostThumb, ScoreBadge, XBadge } from "./RadarBits";

interface TrendCardProps {
  post: RadarPost;
  rank?: number;
  own?: boolean;
  busy: boolean;
  onOpen: () => void;
  onAnalyze: () => void;
}

const KIND_LABEL = { views: "просмотров", likes: "лайков" } as const;

/** Первая буква ника для аватара-заглушки (у площадок аватар автора сборщик не отдаёт). */
const initialOf = (handle: string | null) => (handle ?? "").replace(/^@+/, "").trim().charAt(0).toUpperCase() || "•";

export function TrendCard({ post, rank, own = false, busy, onOpen, onAnalyze }: TrendCardProps) {
  const main = primaryMetric(post);
  const usual = usualMetric(post);
  const niche = nicheOf(post);
  const status = ANALYSIS_STATUS_META[post.analysis_status] ?? ANALYSIS_STATUS_META.pending;
  const analyzed = post.analysis_status === "done" && post.analysis;
  const viral = Number(post.x_factor) >= VIRAL_X_FACTOR;
  const fresh = post.published_at ? Date.now() - Date.parse(post.published_at) < 48 * 3_600_000 : false;
  const handle = post.author_handle ? `@${post.author_handle.replace(/^@+/, "")}` : null;
  const hasVideo = Boolean(playableVideoUrl(post));

  return (
    <article
      className={cn(
        "group flex flex-col overflow-hidden rounded-2xl border bg-card transition-[border-color,box-shadow] hover:shadow-[0_8px_30px_-12px_hsl(var(--foreground)/0.25)]",
        viral ? "border-success/40" : "border-border/60 hover:border-primary/40",
      )}
      data-testid="trend-card"
    >
      <div className="relative aspect-[4/5] w-full overflow-hidden bg-muted">
        <button type="button" onClick={onOpen} className="absolute inset-0 text-left" aria-label="Открыть разбор поста">
          <PostThumb post={post} imgClassName="transition-transform duration-300 group-hover:scale-[1.03]" />
        </button>
        {hasVideo && (
          <PostVideo post={post} size="sm" className="absolute inset-0" />
        )}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <PlatformChip platform={post.platform} short className="bg-background/80 backdrop-blur" />
            {own && <Chip label="свой аккаунт" cls="bg-background/85 text-success ring-1 ring-inset ring-success/40 backdrop-blur" />}
            {fresh && <Chip label="Свежий" cls="bg-background/80 text-foreground backdrop-blur" />}
          </div>
          {rank != null && (
            <span className="grid h-7 min-w-7 shrink-0 place-items-center rounded-full bg-background/85 px-2 text-xs font-bold tabular-nums text-foreground backdrop-blur">
              {rank}
            </span>
          )}
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent p-3 pt-12 text-white">
          <div className="flex items-end justify-between gap-2">
            <div className="min-w-0">
              <div className="text-2xl font-bold leading-none tabular-nums">{formatCompact(main.value)}</div>
              <div className="mt-1 truncate text-[11px] uppercase tracking-wide text-white/70">{KIND_LABEL[main.kind]} · {formatAge(post.published_at)}</div>
            </div>
            <XBadge x={post.x_factor} className="shrink-0" />
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2.5 p-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-bold",
              own ? "bg-success/20 text-success" : "bg-muted text-muted-foreground",
            )}
            aria-hidden
          >
            {initialOf(post.author_handle)}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={handle ?? undefined}>{handle ?? "—"}</span>
        </div>

        {analyzed ? (
          <p className="line-clamp-2 text-sm italic leading-snug text-foreground/90" title={post.analysis!.hook}>«{post.analysis!.hook}»</p>
        ) : post.caption ? (
          <p className="line-clamp-2 text-xs leading-snug text-muted-foreground" title={post.caption}>{post.caption}</p>
        ) : (
          <p className="text-xs text-muted-foreground">Без подписи</p>
        )}

        <dl className="grid grid-cols-3 gap-1.5 rounded-xl bg-muted/50 px-2.5 py-2 text-xs sm:gap-2 sm:px-3">
          <div className="min-w-0">
            <dt className="text-[11px] text-muted-foreground">обычно</dt>
            <dd className="truncate font-semibold tabular-nums">{usual == null ? "—" : formatCompact(usual)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[11px] text-muted-foreground">сейчас</dt>
            <dd className={cn("truncate font-semibold tabular-nums", viral && "text-success")}>{formatCompact(main.value)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[11px] text-muted-foreground">ER</dt>
            <dd className="truncate font-semibold tabular-nums">{formatEngagement(post.engagement_rate)}</dd>
          </div>
        </dl>

        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
          <ScoreBadge score={post.score} />
          {niche ? (
            <Chip label={<span className="block truncate">{niche}</span>} cls="bg-muted text-muted-foreground" className="min-w-0 max-w-[11rem]" title={niche} />
          ) : (
            <Chip label={status.label} cls={status.cls} />
          )}
          <div className="ml-auto flex items-center gap-1">
            {analyzed ? (
              <Button size="sm" variant="secondary" className="h-8 gap-1 px-2.5" onClick={onOpen}>
                <ScanSearch className="h-3.5 w-3.5" />
                Разбор
              </Button>
            ) : (
              <Button size="sm" variant="secondary" className="h-8 gap-1 px-2.5" disabled={busy || post.analysis_status === "analyzing"} onClick={onAnalyze}>
                {busy || post.analysis_status === "analyzing" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {post.analysis_status === "analyzing" ? "Разбираем" : post.analysis_status === "failed" ? "Повторить" : "Разобрать"}
              </Button>
            )}
            {post.url && (
              <Button asChild size="icon" variant="ghost" className="h-8 w-8" aria-label="Открыть оригинал">
                <a href={post.url} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /></a>
              </Button>
            )}
          </div>
        </div>
        {post.analysis_status === "failed" && post.error && (
          <p className="line-clamp-2 text-[11px] leading-snug text-destructive/90" title={post.error}>Разбор не удался: {post.error}</p>
        )}
      </div>
    </article>
  );
}
