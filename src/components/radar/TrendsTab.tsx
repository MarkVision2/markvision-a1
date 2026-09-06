/**
 * Радар идей: вкладка «Тренды» — фильтры (площадка, период, ниша, только
 * залетевшие, поиск), сортировка (горячее / X-фактор / просмотры / свежие /
 * оценка) и сетка карточек постов.
 */
import { useMemo, useState } from "react";
import { Flame, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PLATFORM_META, type RadarPlatform, type RadarPost } from "@/lib/radarClient";
import {
  DEFAULT_TREND_FILTER, filterTrends, nicheOptions, TREND_PERIODS, TREND_SORTS, VIRAL_X_FACTOR, type TrendFilter,
} from "@/lib/radarStats";
import { cn } from "@/lib/utils";
import { Empty } from "./RadarBits";
import { TrendCard } from "./TrendCard";

const ALL_NICHES = "__all__";
const PLATFORMS = Object.keys(PLATFORM_META) as RadarPlatform[];

interface TrendsTabProps {
  posts: RadarPost[];
  ownSourceIds: Set<string>;
  busy: string | null;
  onOpen: (post: RadarPost) => void;
  onAnalyze: (post: RadarPost) => void;
  onAddSource: () => void;
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button size="sm" variant={active ? "default" : "outline"} className={cn("h-8 rounded-full px-3", !active && "text-muted-foreground")} onClick={onClick}>
      {children}
    </Button>
  );
}

export function TrendsTab({ posts, ownSourceIds, busy, onOpen, onAnalyze, onAddSource }: TrendsTabProps) {
  const [filter, setFilter] = useState<TrendFilter>(DEFAULT_TREND_FILTER);
  const set = (patch: Partial<TrendFilter>) => setFilter((f) => ({ ...f, ...patch }));
  const niches = useMemo(() => nicheOptions(posts), [posts]);
  const platformsPresent = useMemo(() => new Set(posts.map((p) => p.platform)), [posts]);
  const visible = useMemo(() => filterTrends(posts, filter), [posts, filter]);
  const viralCount = useMemo(() => posts.filter((p) => Number(p.x_factor) >= VIRAL_X_FACTOR).length, [posts]);
  const activeFilters = useMemo(() => {
    const list: { key: string; label: string; clear: () => void }[] = [];
    if (filter.viralOnly) list.push({ key: "viral", label: `только залетевшие (×${VIRAL_X_FACTOR} и выше)`, clear: () => set({ viralOnly: false }) });
    if (filter.platform !== "all") list.push({ key: "platform", label: PLATFORM_META[filter.platform]?.label ?? filter.platform, clear: () => set({ platform: "all" }) });
    if (filter.period !== "all") list.push({ key: "period", label: TREND_PERIODS.find((p) => p.value === filter.period)?.label ?? filter.period, clear: () => set({ period: "all" }) });
    if (filter.niche) list.push({ key: "niche", label: `ниша «${filter.niche}»`, clear: () => set({ niche: null }) });
    if (filter.query.trim()) list.push({ key: "query", label: `поиск «${filter.query.trim()}»`, clear: () => set({ query: "" }) });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  if (posts.length === 0) {
    return (
      <Empty action={<Button size="sm" onClick={onAddSource}>Добавить источник</Button>}>
        Лента пуста. Добавьте аккаунты конкурентов или вставьте ссылку сверху — радар соберёт посты, посчитает, какие из них залетели, и разберёт лучшие.
      </Empty>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterChip active={filter.platform === "all"} onClick={() => set({ platform: "all" })}>Все площадки</FilterChip>
          {PLATFORMS.filter((p) => platformsPresent.has(p)).map((p) => (
            <FilterChip key={p} active={filter.platform === p} onClick={() => set({ platform: p })}>{PLATFORM_META[p].label}</FilterChip>
          ))}
        </div>
        <span className="hidden h-5 w-px bg-border sm:block" />
        <FilterChip active={filter.viralOnly} onClick={() => set({ viralOnly: !filter.viralOnly })}>
          <Flame className={cn("mr-1 h-3.5 w-3.5", filter.viralOnly ? "" : "text-warning")} />
          Залетевшие{viralCount ? ` (${viralCount})` : ""}
        </FilterChip>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select value={filter.period} onValueChange={(v) => set({ period: v as TrendFilter["period"] })}>
            <SelectTrigger className="h-8 w-[150px]" aria-label="Период"><SelectValue /></SelectTrigger>
            <SelectContent>{TREND_PERIODS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
          </Select>
          {niches.length > 0 && (
            <Select value={filter.niche ?? ALL_NICHES} onValueChange={(v) => set({ niche: v === ALL_NICHES ? null : v })}>
              <SelectTrigger className="h-8 w-[190px]" aria-label="Ниша"><SelectValue placeholder="Все ниши" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_NICHES}>Все ниши</SelectItem>
                {niches.map((n) => <SelectItem key={n.niche} value={n.niche}>{n.niche} ({n.count})</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input aria-label="Поиск по постам" placeholder="Автор, подпись, хук…" value={filter.query} onChange={(e) => set({ query: e.target.value })} className="h-8 w-[200px] pl-8" />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-muted-foreground">Сортировка</span>
        {TREND_SORTS.map((s) => (
          <button
            key={s.value}
            type="button"
            title={s.hint}
            onClick={() => set({ sort: s.value })}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              filter.sort === s.value ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {s.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">{visible.length} из {posts.length}</span>
      </div>

      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-xs" role="status">
          <span className="font-semibold text-foreground">Показаны {visible.length} из {posts.length}</span>
          {activeFilters.map((f) => (
            <span key={f.key} className="inline-flex items-center gap-1 rounded-full bg-background/70 px-2 py-0.5 text-muted-foreground">
              {f.label}
              <button type="button" aria-label={`Снять фильтр: ${f.label}`} className="text-muted-foreground hover:text-foreground" onClick={f.clear}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <Button size="sm" variant="ghost" className="ml-auto h-7 px-2 text-xs" onClick={() => setFilter(DEFAULT_TREND_FILTER)}>
            Сбросить всё
          </Button>
        </div>
      )}

      {visible.length === 0 ? (
        <Empty>Под эти фильтры постов нет — снимите период или нишу.</Empty>
      ) : (
        <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {visible.map((post, i) => (
            <TrendCard
              key={post.id}
              post={post}
              rank={filter.sort === "hot" || filter.sort === "x" ? i + 1 : undefined}
              own={ownSourceIds.has(post.source_id ?? "")}
              busy={busy === `analyze:${post.id}`}
              onOpen={() => onOpen(post)}
              onAnalyze={() => onAnalyze(post)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
