import { useMemo } from "react";
import { Clock, Images, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { STATUS_META, TYPE_META, type PostType } from "@/components/autopost/constants";
import { MediaThumb } from "@/components/autopost/MediaThumb";

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

export interface UpcomingPost {
  id: string;
  media_type: string;
  media_url?: string | null;
  thumbnail_url: string | null;
  child_urls: string[] | null;
  caption: string | null;
  scheduled_at: string;
  status: string;
}

const almatyYmd = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Almaty" });
const almatyHm = (iso: string) => new Date(iso).toLocaleTimeString("ru-RU", { timeZone: "Asia/Almaty", hour: "2-digit", minute: "2-digit" });
const prettyDay = (ymd: string) => {
  const [, m, d] = ymd.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
};
const timeUntil = (iso: string) => {
  const diffMin = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (diffMin <= 0) return "прямо сейчас";
  if (diffMin < 60) return `через ${diffMin} мин`;
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  if (h < 24) return m ? `через ${h} ч ${m} мин` : `через ${h} ч`;
  const days = Math.floor(h / 24);
  const remH = h % 24;
  if (remH === 0) return `через ${days} дн`;
  return `через ${days} дн ${remH} ч`;
};

function UpcomingCard({ post, onEdit }: { post: UpcomingPost; onEdit: () => void }) {
  const M = TYPE_META[post.media_type as PostType];
  const Icon = M?.icon ?? Images;
  const s = STATUS_META[post.status] ?? STATUS_META.queued;
  const isVertical = post.media_type === "REELS" || post.media_type === "STORIES";
  const slideCount = post.media_type === "CAROUSEL" && post.child_urls?.length ? post.child_urls.length : 0;

  return (
    <button
      type="button"
      onClick={onEdit}
      className="group flex w-[228px] shrink-0 snap-start flex-col overflow-hidden rounded-2xl border border-border/60 bg-card/90 text-left shadow-sm transition hover:border-primary/35 hover:shadow-md"
    >
      <div className="relative flex min-h-[220px] items-center justify-center bg-gradient-to-b from-secondary/40 via-secondary/20 to-background px-4 py-5">
        <div
          className={cn(
            "relative overflow-hidden rounded-[14px] bg-zinc-950 shadow-[0_8px_24px_rgba(0,0,0,0.35)] ring-1 ring-white/10",
            isVertical ? "aspect-[9/16] w-[118px]" : "aspect-[4/5] w-[168px]",
          )}
        >
          {post.thumbnail_url || post.media_url || post.media_type === "REELS" || post.media_type === "STORIES" ? (
            <MediaThumb
              thumbnailUrl={post.thumbnail_url}
              mediaUrl={post.media_url}
              mediaType={post.media_type}
              className="h-full w-full"
            />
          ) : (
            <div className="grid h-full w-full place-items-center text-muted-foreground">
              <Icon className="h-9 w-9 opacity-60" />
            </div>
          )}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-black/75 to-transparent" />
          <Badge className="absolute bottom-2.5 left-2 border-0 bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
            {M?.label ?? post.media_type}
          </Badge>
          {slideCount > 1 && (
            <Badge className="absolute right-2 top-2 border-0 bg-black/55 px-1.5 py-0.5 text-[10px] text-white backdrop-blur-sm">
              {slideCount} слайдов
            </Badge>
          )}
        </div>
        <span className="absolute right-3 top-3 rounded-lg border border-border/50 bg-background/85 p-1.5 opacity-0 shadow-sm backdrop-blur-sm transition group-hover:opacity-100">
          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2.5 border-t border-border/40 p-3.5">
        <div>
          <div className="text-sm font-bold leading-tight text-foreground">{timeUntil(post.scheduled_at)}</div>
          <div className="mt-1 text-xs tabular-nums text-muted-foreground">
            {almatyHm(post.scheduled_at)} · {prettyDay(almatyYmd(post.scheduled_at))}
          </div>
        </div>

        {post.caption ? (
          <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">{post.caption}</p>
        ) : (
          <p className="text-xs italic text-muted-foreground/50">Без описания</p>
        )}

        <div className="mt-auto flex items-center justify-between gap-2 pt-0.5">
          <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold", s.cls)}>
            <s.icon className={cn("h-3 w-3", post.status === "processing" && "animate-spin")} />
            {s.label}
          </span>
          {M?.aspect ? <span className="text-[10px] tabular-nums text-muted-foreground">{M.aspect}</span> : null}
        </div>
      </div>
    </button>
  );
}

export function AutopostUpcomingRail({ posts, onEdit }: { posts: UpcomingPost[]; onEdit: (p: UpcomingPost) => void }) {
  const upcoming = useMemo(
    () => posts
      .filter((p) => (p.status === "queued" || p.status === "processing") && new Date(p.scheduled_at).getTime() > Date.now())
      .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
      .slice(0, 10),
    [posts],
  );

  if (upcoming.length === 0) return null;

  return (
    <section className="mt-6">
      <div className="mb-3 flex items-center gap-2">
        <Clock className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ближайшие публикации</h3>
        <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-sky-600">
          {upcoming.length}
        </span>
      </div>
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2 snap-x snap-mandatory [scrollbar-width:thin]">
        {upcoming.map((p) => (
          <UpcomingCard key={p.id} post={p} onEdit={() => onEdit(p)} />
        ))}
      </div>
    </section>
  );
}
