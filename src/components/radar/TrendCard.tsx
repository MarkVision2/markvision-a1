/**
 * Радар идей: карточка поста в ленте трендов — превью, главное число
 * (просмотры или лайки), «обычно / сейчас», X-фактор, автор, ниша, действия.
 */
import { ExternalLink, Loader2, ScanSearch, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ANALYSIS_STATUS_META, formatEngagement, type RadarPost } from "@/lib/radarClient";
import { formatAge, formatCompact, nicheOf, primaryMetric, usualMetric, VIRAL_X_FACTOR } from "@/lib/radarStats";
import { cn } from "@/lib/utils";
import { Chip, PlatformChip, ScoreBadge, XBadge } from "./RadarBits";

interface TrendCardProps {
  post: RadarPost;
  rank?: number;
  own?: boolean;
  busy: boolean;
  onOpen: () => void;
  onAnalyze: () => void;
}

const KIND_LABEL = { views: "просмотров", likes: "лайков" } as const;

export function TrendCard({ post, rank, own = false, busy, onOpen, onAnalyze }: TrendCardProps) {
  const main = primaryMetric(post);
  const usual = usualMetric(post);
  const niche = nicheOf(post);
  const status = ANALYSIS_STATUS_META[post.analysis_status] ?? ANALYSIS_STATUS_META.pending;
  const analyzed = post.analysis_status === "done" && post.analysis;
  const viral = Number(post.x_factor) >= VIRAL_X_FACTOR;
  const fresh = post.published_at ? Date.now() - Date.parse(post.published_at) < 48 * 3_600_000 : false;

  return (
    <article
      className={cn(
        "group flex flex-col overflow-hidden rounded-2xl border bg-card transition-colors",
        viral ? "border-success/40" : "border-border/60 hover:border-primary/40",
      )}
      data-testid="trend-card"
    >
      <button type="button" onClick={onOpen} className="relative aspect-[4/5] w-full overflow-hidden bg-muted text-left" aria-label="Открыть разбор поста">
        {post.thumbnail_url ? (
          <img src={post.thumbnail_url} alt="" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" loading="lazy" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-muted to-background text-muted-foreground">
            <ScanSearch className="h-8 w-8 opacity-40" />
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-2">
          <div className="flex items-center gap-1.5">
            <PlatformChip platform={post.platform} short className="bg-background/80 backdrop-blur" />
            {fresh && <Chip label="Свежий" cls="bg-background/80 text-foreground backdrop-blur" />}
          </div>
          {rank != null && (
            <span className="grid h-7 min-w-7 place-items-center rounded-full bg-background/85 px-2 text-xs font-bold tabular-nums text-foreground backdrop-blur">
              {rank}
            </span>
          )}
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-3 pt-10 text-white">
          <div className="flex items-end justify-between gap-2">
            <div>
              <div className="text-2xl font-bold leading-none tabular-nums">{formatCompact(main.value)}</div>
              <div className="mt-1 text-[11px] uppercase tracking-wide text-white/70">{KIND_LABEL[main.kind]} · {formatAge(post.published_at)}</div>
            </div>
            <XBadge x={post.x_factor} />
          </div>
        </div>
      </button>

      <div className="flex flex-1 flex-col gap-2.5 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-semibold">{post.author_handle ? `@${post.author_handle}` : "—"}</span>
            {own && <Chip label="свой аккаунт" cls="bg-success/15 text-success" />}
          </div>
          {niche && <Chip label={niche} cls="bg-muted text-muted-foreground" className="max-w-[45%] truncate" />}
        </div>

        {analyzed ? (
          <p className="line-clamp-2 text-sm italic text-foreground/90">«{post.analysis!.hook}»</p>
        ) : post.caption ? (
          <p className="line-clamp-2 text-xs text-muted-foreground">{post.caption}</p>
        ) : (
          <p className="text-xs text-muted-foreground">Без подписи</p>
        )}

        <dl className="grid grid-cols-3 gap-2 rounded-xl bg-muted/50 px-3 py-2 text-xs">
          <div>
            <dt className="text-muted-foreground">обычно</dt>
            <dd className="font-semibold tabular-nums">{usual == null ? "—" : formatCompact(usual)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">сейчас</dt>
            <dd className={cn("font-semibold tabular-nums", viral && "text-success")}>{formatCompact(main.value)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">ER</dt>
            <dd className="font-semibold tabular-nums">{formatEngagement(post.engagement_rate)}</dd>
          </div>
        </dl>

        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          <div className="flex items-center gap-1.5">
            <ScoreBadge score={post.score} />
            <Chip label={status.label} cls={status.cls} />
          </div>
          <div className="flex items-center gap-1">
            {analyzed ? (
              <Button size="sm" variant="secondary" className="h-8 gap-1" onClick={onOpen}>
                <ScanSearch className="h-3.5 w-3.5" />
                Разбор
              </Button>
            ) : (
              <Button size="sm" variant="secondary" className="h-8 gap-1" disabled={busy || post.analysis_status === "analyzing"} onClick={onAnalyze}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Разобрать
              </Button>
            )}
            {post.url && (
              <Button asChild size="icon" variant="ghost" className="h-8 w-8" aria-label="Открыть оригинал">
                <a href={post.url} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /></a>
              </Button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
