/**
 * Радар идей: вкладка «Авторы» — кто приносит больше всего залетевших постов
 * и кто чаще всего пробивает свою аудиторию (как «Authors» в viralex):
 * залетевшие, просмотры сверх нормы, сила автора, плотность хитов.
 */
import { useMemo, useState } from "react";
import { Loader2, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SOURCE_KIND_META, type RadarPost, type RadarSource } from "@/lib/radarClient";
import { authorStats, FOLLOWER_BRACKETS, followerBracket, formatAge, formatCompact, formatX, type AuthorSort } from "@/lib/radarStats";
import { cn } from "@/lib/utils";
import { Chip, Empty, PlatformChip, XBadge } from "./RadarBits";

interface AuthorsTabProps {
  posts: RadarPost[];
  sources: RadarSource[];
  busy: string | null;
  onCrawl: (source: RadarSource) => void;
  onAddSource: (platform: RadarSource["platform"], handle: string) => void;
  onOpenPost: (post: RadarPost) => void;
}

function Stat({ label, value, strong = false }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] leading-tight text-muted-foreground">{label}</div>
      <div className={cn("truncate text-base font-semibold tabular-nums", strong && "text-success")}>{value}</div>
    </div>
  );
}

export function AuthorsTab({ posts, sources, busy, onCrawl, onAddSource, onOpenPost }: AuthorsTabProps) {
  const [sort, setSort] = useState<AuthorSort>("viral");
  const [bracket, setBracket] = useState("all");
  const authors = useMemo(() => authorStats(posts, sources, sort), [posts, sources, sort]);
  const visible = useMemo(() => authors.filter((a) => bracket === "all" || followerBracket(a.followers) === bracket), [authors, bracket]);

  if (authors.length === 0) {
    return <Empty>Авторов пока нет — они появятся после первого сбора: кто приносит залетевшие посты и как часто.</Empty>;
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-border/60 p-0.5">
          {([["viral", "Принесли больше всего"], ["strength", "Пробивают свою аудиторию"]] as const).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setSort(v)}
              className={cn("rounded-md px-3 py-1.5 text-xs font-medium", sort === v ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
            >
              {label}
            </button>
          ))}
        </div>
        <Select value={bracket} onValueChange={setBracket}>
          <SelectTrigger className="h-8 w-[190px]" aria-label="Размер аудитории"><SelectValue /></SelectTrigger>
          <SelectContent>{FOLLOWER_BRACKETS.map((b) => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}</SelectContent>
        </Select>
        <span className="ml-auto text-xs text-muted-foreground">
          {sort === "viral" ? "Сначала авторы с наибольшим числом залетевших постов" : "Сначала авторы с самым высоким X-фактором"} · {visible.length} авторов
        </span>
      </div>

      <div className="grid gap-2">
        {visible.map((a, i) => {
          const src = a.source;
          const crawlBusy = src ? busy === `crawl:${src.id}` : false;
          return (
            <div key={a.key} className="grid min-w-0 gap-3 rounded-2xl border border-border/60 bg-card p-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,2fr)_auto] lg:items-center">
              <div className="flex min-w-0 items-start gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-bold tabular-nums">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="min-w-0 max-w-full truncate font-semibold" title={`@${a.handle}`}>@{a.handle}</span>
                    <PlatformChip platform={a.platform} short />
                    {src && <Chip label={SOURCE_KIND_META[src.kind]?.label ?? src.kind} cls={SOURCE_KIND_META[src.kind]?.cls ?? ""} />}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {a.followers ? `${formatCompact(a.followers)} подписчиков · ${FOLLOWER_BRACKETS.find((b) => b.value === followerBracket(a.followers))?.label ?? ""}` : "подписчики неизвестны"}
                    {a.lastPublishedAt && <> · последний пост {formatAge(a.lastPublishedAt)}</>}
                  </div>
                </div>
              </div>
              <div className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                <Stat label="Залетевших постов" value={a.viral} strong={a.viral > 0} />
                <Stat label="Просмотров сверх нормы" value={a.aboveNorm > 0 ? formatCompact(a.aboveNorm) : "—"} />
                <Stat label="Сила автора" value={a.strength ? formatX(a.strength) : "—"} />
                <Stat label="Плотность хитов" value={`${Math.round(a.hitRate * 100)} % (${a.viral} из ${a.posts})`} />
              </div>
              <div className="flex flex-wrap items-center gap-1.5 lg:justify-end">
                {a.topPost && (
                  <Button size="sm" variant="secondary" className="h-8 gap-1.5" onClick={() => onOpenPost(a.topPost!)} title="Открыть лучший пост автора">
                    Лучший пост <XBadge x={a.topPost.x_factor} />
                  </Button>
                )}
                {src ? (
                  <Button size="sm" variant="ghost" className="h-8 gap-1" disabled={crawlBusy} onClick={() => onCrawl(src)}>
                    {crawlBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    Собрать
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" className="h-8 gap-1" disabled={busy === "source"} onClick={() => onAddSource(a.platform, a.handle)}>
                    <Plus className="h-3.5 w-3.5" />
                    В источники
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
