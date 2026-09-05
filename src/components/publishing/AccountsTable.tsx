/**
 * Вкладка «Аккаунты» — вся сеть площадок в одной таблице.
 *
 * Один список, два вида: «Управление» (статус, группа, сегодня, здоровье,
 * включение, меню редких настроек) и «Статистика» (подписчики, посты, показы,
 * вовлечение, ER). Поиск, фильтры по площадке и группе и выделение общие —
 * оператор не теряет контекст, переключаясь между «кто в каком состоянии» и
 * «кто как работает». Таблица прокручивается внутри себя с прилипшей шапкой,
 * чтобы сотня аккаунтов не выталкивала остальную страницу.
 *
 * Метрики (metrics.accounts, витрина publish_account_metrics) снимаются
 * контрольными точками d1/d3/d7 — у свежих постов показы честно пустые.
 */
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Loader2, MoreHorizontal, Search, ShieldCheck, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { BulkAccountsBar } from "@/components/publishing/BulkAccountsBar";
import { initials } from "@/components/publishing/PostPreview";
import type { UsePublishing } from "@/hooks/usePublishing";
import {
  ACCOUNT_STATUS_META,
  PLATFORM_DOT as PLATFORM_DOT_META,
  PLATFORM_META,
  effectiveDailyLimit,
  formatFollowers,
  healthTone,
  rampStage,
  type AccountMetrics,
  type PublishAccount,
  type PublishPlatform,
} from "@/lib/publishingClient";
import { fmtExact, fmtNum, fmtRelative } from "@/lib/publishingFormat";
import { ANY, EMPTY_FILTERS, filterAccounts, type AccountFilters } from "@/lib/publishingSelection";
import { cn } from "@/lib/utils";

const NONE = "__none";

export const HEALTH_DOT = {
  good: "bg-emerald-500",
  warn: "bg-amber-500",
  bad: "bg-destructive",
} as const;

/** Точка площадки — единый набор из publishingClient (тот же в предпросмотре и сводке). */
export const PLATFORM_DOT = PLATFORM_DOT_META;

type View = "manage" | "stats";
type SortKey = "account_name" | "followers" | "posts_total" | "reach" | "comments" | "er_percent" | "health_score";

const STATS_COLUMNS: { key: SortKey; label: string; hint?: string; numeric: boolean; width: string }[] = [
  { key: "followers", label: "Подписчики", numeric: true, width: "w-[110px]" },
  { key: "posts_total", label: "Посты", hint: "всего / за 30 дней", numeric: true, width: "w-[100px]" },
  { key: "reach", label: "Показы", hint: "охват по снятым метрикам", numeric: true, width: "w-[120px]" },
  { key: "comments", label: "Комментарии", numeric: true, width: "w-[110px]" },
  { key: "er_percent", label: "ER", hint: "реакции / охват", numeric: true, width: "w-[80px]" },
  { key: "health_score", label: "Здоровье", numeric: true, width: "w-[100px]" },
];

/** TikTok, подключённый до появления права video.list, метрик не отдаёт. */
function metricsScopeHint(a: Pick<PublishAccount, "platform" | "oauth_scope">): string | null {
  if (a.platform !== "tiktok" || !a.oauth_scope) return null;
  return a.oauth_scope.split(/[,\s]+/).includes("video.list")
    ? null
    : "без права video.list — метрики не собираются, переподключите аккаунт";
}

function rampLabel(a: Pick<PublishAccount, "ramp_enabled" | "ramp_started_at">): string {
  const st = rampStage(a.ramp_enabled, a.ramp_started_at);
  if (st.stage === 4) return a.ramp_enabled ? "Полный лимит" : "Без разгона";
  return `Ступень ${st.stage} · ${st.limit}/день · ещё ${st.daysLeft} дн.`;
}

function fmtLastPost(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days === 0) return "сегодня";
  if (days === 1) return "вчера";
  if (days < 30) return `${days} дн. назад`;
  return d.toLocaleDateString("ru-RU", { timeZone: "Asia/Almaty", day: "2-digit", month: "2-digit", year: "2-digit" });
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Ошибка";
}

/** Из чего сложилось здоровье и когда проверяли — подсказка у числа. */
export function HealthHint({ a }: { a: { health_reasons?: string[] | null; last_checked_at?: string | null } }) {
  const reasons = a.health_reasons ?? [];
  return (
    <div className="space-y-1 text-xs">
      {reasons.length ? (
        <ul className="list-disc space-y-0.5 pl-4">{reasons.map((r) => <li key={r}>{r}</li>)}</ul>
      ) : (
        <div>Оценка ещё не считалась — нажмите «Проверить».</div>
      )}
      <div className="text-muted-foreground">
        {a.last_checked_at ? `Проверен ${fmtRelative(a.last_checked_at)} (${fmtExact(a.last_checked_at)})` : "У площадки ещё не проверялся"}
      </div>
    </div>
  );
}

/** Точка + число: одинаковые полосы «100» переставали читаться. */
function HealthCell({ a, name }: { a: { health_score: number; health_reasons?: string[] | null; last_checked_at?: string | null }; name: string }) {
  const tone = healthTone(a.health_score);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} aria-label={`Здоровье ${name}`} className="inline-flex cursor-help items-center gap-1.5 text-sm tabular-nums">
          <span className={cn("h-2 w-2 rounded-full", HEALTH_DOT[tone])} aria-hidden />
          {Math.round(a.health_score)}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs" side="left"><HealthHint a={a} /></TooltipContent>
    </Tooltip>
  );
}

/** Кто: аватар, имя, площадка, @хэндл, подписчики — одинаково в обоих видах. */
function Identity({ a, personaName, followers }: { a: PublishAccount; personaName?: string | null; followers?: number | null }) {
  const platform = PLATFORM_META[a.platform];
  const subs = followers ?? a.followers;
  return (
    <div className="flex items-center gap-2.5">
      <Avatar className="h-8 w-8 shrink-0">
        <AvatarFallback className="text-[10px]">{initials(a.account_name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{a.account_name}</span>
          {platform && (
            <Badge variant="outline" className={cn("shrink-0 border-transparent px-1.5 py-0 text-[10px]", platform.cls)}>
              {platform.label}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {a.handle && <span className="truncate">@{a.handle}</span>}
          {subs != null && <span className="shrink-0">{formatFollowers(subs)}</span>}
          {personaName && <span className="shrink-0 truncate">· {personaName}</span>}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────── таблица ───────────────────────────── */

export function AccountsTable({ pub }: { pub: UsePublishing }) {
  const disabled = pub.busy != null;
  const [filters, setFilters] = useState<AccountFilters>(EMPTY_FILTERS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [view, setView] = useState<View>("manage");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "followers", desc: true });
  // «Внимание»: не активен, выключен или здоровье ниже порога — то, что сводка зовёт «требуют внимания».
  const [attentionOnly, setAttentionOnly] = useState(false);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    try {
      const r = (await fn()) as { checked?: number; token_expired?: number } | undefined;
      if (r && typeof r.checked === "number") {
        const dead = r.token_expired ?? 0;
        if (dead) toast.warning(`Проверено ${r.checked}, протухших токенов: ${dead}`);
        else toast.success(`Проверено ${r.checked} — все токены живые`);
      } else {
        toast.success(label);
      }
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const metricsById = useMemo(() => {
    const m = new Map<string, AccountMetrics>();
    for (const r of pub.metrics?.accounts ?? []) m.set(r.account_id, r);
    return m;
  }, [pub.metrics?.accounts]);

  const needsAttention = (a: PublishAccount) => a.status !== "active" || !a.publish_enabled || Number(a.health_score ?? 0) < 20;
  const attentionCount = useMemo(() => pub.accounts.filter(needsAttention).length, [pub.accounts]);
  const filtered = useMemo(() => {
    const base = filterAccounts(pub.accounts, filters);
    return attentionOnly ? base.filter(needsAttention) : base;
  }, [pub.accounts, filters, attentionOnly]);
  const visible = useMemo(() => {
    if (view !== "stats") return filtered;
    const dir = sort.desc ? -1 : 1;
    const val = (a: PublishAccount): number | null => {
      const m = metricsById.get(a.id);
      switch (sort.key) {
        case "followers": return m?.followers ?? a.followers ?? null;
        case "health_score": return a.health_score;
        case "posts_total": return m?.posts_total ?? null;
        case "reach": return m && m.measured_posts ? m.reach : null;
        case "comments": return m && m.measured_posts ? m.comments : null;
        case "er_percent": return m?.er_percent ?? null;
        default: return null;
      }
    };
    return [...filtered].sort((a, b) => {
      if (sort.key === "account_name") return dir * a.account_name.localeCompare(b.account_name, "ru");
      // Пустые метрики всегда внизу — иначе аккаунт без данных возглавит рейтинг.
      const av = val(a);
      const bv = val(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return dir * (av - bv);
    });
  }, [filtered, view, sort, metricsById]);

  // Счётчики по площадкам — для быстрого фильтра и чтобы будущие TikTok/YouTube/Threads были видны сразу.
  const byPlatform = useMemo(() => {
    const c = new Map<PublishPlatform, number>();
    for (const a of pub.accounts) c.set(a.platform, (c.get(a.platform) ?? 0) + 1);
    return c;
  }, [pub.accounts]);

  const totals = useMemo(
    () =>
      visible.reduce(
        (acc, a) => {
          const m = metricsById.get(a.id);
          // Те же правила, что в ячейках: охват и комментарии — только по снятым метрикам.
          const measured = (m?.measured_posts ?? 0) > 0;
          return {
            followers: acc.followers + (m?.followers ?? a.followers ?? 0),
            posts: acc.posts + (m?.posts_total ?? 0),
            reach: acc.reach + (measured ? m!.reach : 0),
            comments: acc.comments + (measured ? m!.comments : 0),
          };
        },
        { followers: 0, posts: 0, reach: 0, comments: 0 },
      ),
    [visible, metricsById],
  );

  // Массовое действие идёт только по тем, кто сейчас на экране: выделение под другим
  // фильтром не должно уезжать в него незаметно.
  const visibleIds = useMemo(() => new Set(visible.map((a) => a.id)), [visible]);
  const chosen = useMemo(() => [...selected].filter((id) => visibleIds.has(id)), [selected, visibleIds]);
  const allVisibleChosen = visible.length > 0 && visible.every((a) => selected.has(a.id));

  const toggleAllVisible = () => {
    const next = new Set(selected);
    if (allVisibleChosen) visible.forEach((a) => next.delete(a.id));
    else visible.forEach((a) => next.add(a.id));
    setSelected(next);
  };

  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "account_name" }));

  if (!pub.accounts.length) {
    if (pub.loading) {
      return (
        <div className="space-y-2 rounded-2xl border p-3" aria-busy="true" aria-label="Загрузка аккаунтов">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-3 px-2 py-2">
              <div className="h-8 w-8 animate-pulse rounded-full bg-muted" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
                <div className="h-2.5 w-1/5 animate-pulse rounded bg-muted" />
              </div>
              <div className="h-5 w-20 animate-pulse rounded-full bg-muted" />
            </div>
          ))}
        </div>
      );
    }
    return (
      <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
        Аккаунтов пока нет — подключите Instagram, TikTok, YouTube или Threads кнопкой «Подключить аккаунт».
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
    <div className="space-y-3">
      {/* Панель: поиск, группа, счётчик, проверка, вид */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-9 pl-8"
            placeholder="Поиск по имени или @хэндлу"
            aria-label="Поиск аккаунтов"
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
          />
        </div>
        <Select value={filters.groupId} onValueChange={(v) => setFilters((f) => ({ ...f, groupId: v }))}>
          <SelectTrigger className="h-9 w-[160px]" aria-label="Фильтр по группе"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Все группы</SelectItem>
            <SelectItem value={NONE}>Без группы</SelectItem>
            {pub.groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          className="h-9"
          disabled={disabled}
          onClick={() => void run("Проверка завершена", () => pub.healthCheck())}
        >
          {pub.busy === "health_check" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-1.5 h-4 w-4" />}
          Проверить все
        </Button>
        <div role="tablist" aria-label="Вид таблицы" className="inline-flex h-9 items-center rounded-lg bg-muted p-0.5 text-xs">
          {(["manage", "stats"] as View[]).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={cn(
                "rounded-md px-3 py-1.5 font-medium transition-colors",
                view === v ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v === "manage" ? "Управление" : "Статистика"}
            </button>
          ))}
        </div>
      </div>

      {/* Площадки: одна строка чипов вместо селекта — сразу видно, кого сколько */}
      <div role="group" aria-label="Фильтр по площадке" className="flex flex-wrap items-center gap-1.5">
        <PlatformChip
          active={filters.platform === ANY}
          label="Все"
          count={pub.accounts.length}
          onClick={() => setFilters((f) => ({ ...f, platform: ANY }))}
        />
        {(Object.keys(PLATFORM_META) as PublishPlatform[]).map((p) => (
          <PlatformChip
            key={p}
            active={filters.platform === p}
            label={PLATFORM_META[p].label}
            dot={PLATFORM_DOT[p]}
            count={byPlatform.get(p) ?? 0}
            onClick={() => setFilters((f) => ({ ...f, platform: p }))}
          />
        ))}
        {attentionCount > 0 && (
          <button
            type="button"
            aria-pressed={attentionOnly}
            onClick={() => setAttentionOnly((v) => !v)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors",
              attentionOnly ? "border-amber-500/60 bg-amber-500/10 font-medium text-amber-700 dark:text-amber-300" : "border-border text-amber-700 hover:bg-amber-500/5 dark:text-amber-300",
            )}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />
            Внимание <span className="tabular-nums">{attentionCount}</span>
          </button>
        )}
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">{visible.length} из {pub.accounts.length}</span>
      </div>

      <BulkAccountsBar pub={pub} selected={chosen} onClear={() => setSelected(new Set())} />

      {view === "stats" && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Total label="Аккаунтов" value={String(visible.length)} />
          <Total label="Подписчиков" value={formatFollowers(totals.followers) || "0"} />
          <Total label="Опубликовано постов" value={fmtNum(totals.posts)} />
          <Total label="Показов" value={fmtNum(totals.reach)} />
        </div>
      )}

      {visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          Под фильтры ничего не подошло.
        </div>
      ) : (
        <div className="max-h-[calc(100vh-23rem)] min-h-[200px] overflow-auto rounded-2xl border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card shadow-[inset_0_-1px_0_hsl(var(--border))]">
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-9 w-9 pl-3 pr-0">
                  <Checkbox checked={allVisibleChosen} onCheckedChange={toggleAllVisible} aria-label="Выбрать все показанные аккаунты" />
                </TableHead>
                {view === "manage" ? (
                  <>
                    <TableHead className="h-9">Аккаунт</TableHead>
                    <TableHead className="h-9 w-[135px]">Статус</TableHead>
                    <TableHead className="h-9 w-[150px]">Группа</TableHead>
                    <TableHead className="h-9 w-[90px] text-right">Сегодня</TableHead>
                    <TableHead className="h-9 w-[110px] text-right">Здоровье</TableHead>
                    <TableHead className="h-9 w-[105px] whitespace-nowrap">Пост</TableHead>
                    <TableHead className="h-9 w-[60px] text-center">Вкл</TableHead>
                    <TableHead className="h-9 w-10" />
                  </>
                ) : (
                  <>
                    <TableHead className="h-9">
                      <SortButton label="Аккаунт" active={sort.key === "account_name"} desc={sort.desc} onClick={() => toggleSort("account_name")} />
                    </TableHead>
                    {STATS_COLUMNS.map((c) => (
                      <TableHead key={c.key} className={cn("h-9 text-right", c.width)}>
                        <SortButton label={c.label} hint={c.hint} numeric active={sort.key === c.key} desc={sort.desc} onClick={() => toggleSort(c.key)} />
                      </TableHead>
                    ))}
                    <TableHead className="h-9 w-[160px]">Статус</TableHead>
                  </>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((a) =>
                view === "manage" ? (
                  <AccountRow
                    key={a.id}
                    a={a}
                    pub={pub}
                    disabled={disabled}
                    run={run}
                    checked={selected.has(a.id)}
                    onToggle={() => toggleOne(a.id)}
                  />
                ) : (
                  <StatsRow key={a.id} a={a} m={metricsById.get(a.id) ?? null} checked={selected.has(a.id)} onToggle={() => toggleOne(a.id)} />
                ),
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {view === "stats" && (
        <p className="text-xs text-muted-foreground">
          Показы и вовлечение снимаются контрольными точками через 1, 3 и 7 дней после публикации — у свежих постов
          колонки пустые, пока воркер не собрал первую точку.
        </p>
      )}
    </div>
    </TooltipProvider>
  );
}

function PlatformChip({ active, label, count, dot, onClick }: { active: boolean; label: string; count: number; dot?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors",
        active ? "border-foreground/30 bg-foreground/5 font-medium" : "border-border text-muted-foreground hover:text-foreground",
        !active && count === 0 && "opacity-60",
      )}
    >
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", dot)} aria-hidden />}
      {label}
      <span className="tabular-nums">{count}</span>
    </button>
  );
}

function SortButton({ label, hint, numeric, active, desc, onClick }: { label: string; hint?: string; numeric?: boolean; active: boolean; desc: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      className={cn("inline-flex items-center gap-1 whitespace-nowrap hover:text-foreground", numeric && "flex-row-reverse", active && "text-foreground")}
    >
      {label}
      {active && (desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
    </button>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

/* ───────────────────────────── строка: статистика ───────────────────────────── */

function StatsRow({ a, m, checked, onToggle }: { a: PublishAccount; m: AccountMetrics | null; checked: boolean; onToggle: () => void }) {
  const status = ACCOUNT_STATUS_META[a.status] ?? ACCOUNT_STATUS_META.error;
  const measured = m?.measured_posts ?? 0;
  const pending = (m?.posts_total ?? 0) - measured;
  return (
    <TableRow data-state={checked ? "selected" : undefined}>
      <TableCell className="py-2 pl-3 pr-0">
        <Checkbox checked={checked} onCheckedChange={onToggle} aria-label={`Выбрать ${a.account_name}`} />
      </TableCell>
      <TableCell className="py-2"><Identity a={a} followers={m?.followers ?? a.followers} /></TableCell>
      <TableCell className="py-2 text-right text-sm tabular-nums">
        {(m?.followers ?? a.followers) == null ? "—" : formatFollowers(m?.followers ?? a.followers)}
      </TableCell>
      <TableCell className="py-2 text-right text-sm tabular-nums">
        {m ? fmtNum(m.posts_total) : "—"}
        {m && <div className="text-xs text-muted-foreground">за 30 дн. {fmtNum(m.posts_30d)}</div>}
      </TableCell>
      <TableCell className="py-2 text-right text-sm tabular-nums">
        {measured ? fmtNum(m!.reach) : "—"}
        {pending > 0 && <div className="text-xs text-muted-foreground">ждём метрики: {pending}</div>}
      </TableCell>
      <TableCell className="py-2 text-right text-sm tabular-nums">{measured ? fmtNum(m!.comments) : "—"}</TableCell>
      <TableCell className="py-2 text-right text-sm tabular-nums">
        {m?.er_percent == null ? "—" : `${m.er_percent.toLocaleString("ru-RU")}%`}
      </TableCell>
      <TableCell className="py-2 text-right"><HealthCell a={a} name={a.account_name} /></TableCell>
      <TableCell className="py-2">
        <Badge variant="outline" className={cn("whitespace-nowrap border-transparent font-medium", status.cls)}>{status.label}</Badge>
        {!a.publish_enabled && <div className="text-xs text-muted-foreground">публикация выключена</div>}
        {m && m.failed_30d > 0 && (
          <div className="flex items-center gap-1 text-xs text-destructive">
            <AlertTriangle className="h-3 w-3" /> ошибок за 30 дн.: {m.failed_30d}
          </div>
        )}
        {m && m.jobs_queued > 0 && <div className="text-xs text-muted-foreground">в очереди: {m.jobs_queued}</div>}
      </TableCell>
    </TableRow>
  );
}

/* ───────────────────────────── строка: управление ───────────────────────────── */

function AccountRow({
  a, pub, disabled, run, checked, onToggle,
}: {
  a: PublishAccount;
  pub: UsePublishing;
  disabled: boolean;
  run: (label: string, fn: () => Promise<unknown>) => Promise<void>;
  checked: boolean;
  onToggle: () => void;
}) {
  const [limit, setLimit] = useState(String(a.daily_limit));
  useEffect(() => setLimit(String(a.daily_limit)), [a.daily_limit]);

  const status = ACCOUNT_STATUS_META[a.status] ?? ACCOUNT_STATUS_META.error;
  const effLimit = effectiveDailyLimit(a);
  const group = pub.groups.find((g) => g.id === a.group_id) ?? null;
  const persona = pub.personas.find((p) => p.id === a.persona_id) ?? null;
  const ramping = rampStage(a.ramp_enabled, a.ramp_started_at).stage < 4;
  const scopeHint = metricsScopeHint(a);

  const commitLimit = () => {
    const n = Number(limit);
    if (!Number.isInteger(n) || n < 0) {
      setLimit(String(a.daily_limit));
      return;
    }
    if (n === a.daily_limit) return;
    void run("Лимит обновлён", () => pub.updateAccount(a.id, { daily_limit: n }));
  };

  const onDisconnect = () => {
    if (!window.confirm(`Отключить аккаунт «${a.account_name}»? Задания в очереди будут отменены.`)) return;
    void run("Аккаунт отключён", () => pub.disconnect(a.id));
  };

  return (
    <TableRow data-state={checked ? "selected" : undefined}>
      <TableCell className="py-2 pl-3 pr-0">
        <Checkbox checked={checked} onCheckedChange={onToggle} aria-label={`Выбрать ${a.account_name}`} />
      </TableCell>

      <TableCell className="py-2"><Identity a={a} personaName={persona?.name} /></TableCell>

      {/* Статус: чип, а ошибка и подсказка по правам — в тултипе, а не третьей строкой */}
      <TableCell className="py-2">
        <div className="flex items-center gap-1">
          <Badge variant="outline" className={cn("whitespace-nowrap border-transparent font-medium", status.cls)}>{status.label}</Badge>
          {(a.last_error || scopeHint) && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  tabIndex={0}
                  aria-label={`Подробности статуса ${a.account_name}`}
                  className="cursor-help text-xs text-amber-600 dark:text-amber-400"
                >
                  ⚠
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">{a.last_error ?? scopeHint}</TooltipContent>
            </Tooltip>
          )}
        </div>
      </TableCell>

      {/* Группа — самая частая правка, поэтому осталась инлайн, но без рамки */}
      <TableCell className="py-2">
        <Select
          value={a.group_id ?? NONE}
          disabled={disabled}
          onValueChange={(v) => void run("Группа обновлена", () => pub.updateAccount(a.id, { group_id: v === NONE ? null : v }))}
        >
          <SelectTrigger
            aria-label={`Группа для ${a.account_name}`}
            className={cn(
              "h-8 w-full border-transparent bg-transparent px-2 hover:bg-muted focus:bg-background",
              !group && "text-muted-foreground",
            )}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Без группы</SelectItem>
            {pub.groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </TableCell>

      {/* Сегодня: сколько из действующего лимита; иконка — идёт разгон */}
      <TableCell className="py-2 text-right">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex cursor-help items-center gap-1 text-sm tabular-nums">
              {ramping && <Sparkles className="h-3 w-3 text-muted-foreground" />}
              {a.published_today} / {effLimit}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {rampLabel(a)} · базовый лимит {a.daily_limit}/день
          </TooltipContent>
        </Tooltip>
      </TableCell>

      <TableCell className="py-2 text-right"><HealthCell a={a} name={a.account_name} /></TableCell>

      <TableCell className="py-2 text-xs text-muted-foreground">{fmtLastPost(a.last_post_at)}</TableCell>

      <TableCell className="py-2 text-center">
        <Switch
          checked={a.publish_enabled}
          disabled={disabled}
          aria-label={`Публикации для ${a.account_name}`}
          onCheckedChange={(v) =>
            void run(v ? "Публикации включены" : "Публикации выключены", () => pub.updateAccount(a.id, { publish_enabled: v }))
          }
        />
      </TableCell>

      {/* Редкие настройки — в меню строки, чтобы не тащить их через всю таблицу */}
      <TableCell className="py-2 pr-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Действия для ${a.account_name}`}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem disabled={disabled} onSelect={() => void run("Проверено", () => pub.healthCheck([a.id]))}>
              <ShieldCheck className="mr-2 h-3.5 w-3.5" /> Проверить сейчас
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Лимит в день</DropdownMenuLabel>
            <div className="px-2 pb-1.5">
              <Input
                type="number"
                min={0}
                aria-label={`Лимит в день для ${a.account_name}`}
                className="h-8"
                value={limit}
                disabled={disabled}
                onChange={(e) => setLimit(e.target.value)}
                onBlur={commitLimit}
                onKeyDown={(e) => e.key === "Enter" && commitLimit()}
              />
            </div>

            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={disabled}
              onSelect={() =>
                void run(a.ramp_enabled ? "Разгон выключен" : "Разгон включён", () =>
                  pub.updateAccount(a.id, { ramp_enabled: !a.ramp_enabled }),
                )
              }
            >
              {a.ramp_enabled ? "Выключить разгон" : "Включить разгон"}
            </DropdownMenuItem>
            {a.ramp_enabled && (
              <DropdownMenuItem disabled={disabled} onSelect={() => void run("Разгон перезапущен", () => pub.updateAccount(a.id, { ramp_restart: true }))}>
                Перезапустить разгон
              </DropdownMenuItem>
            )}

            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Персона{persona ? `: ${persona.name}` : ""}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={a.persona_id ?? NONE}
                  onValueChange={(v) => void run("Персона обновлена", () => pub.updateAccount(a.id, { persona_id: v === NONE ? null : v }))}
                >
                  <DropdownMenuRadioItem value={NONE}>Без персоны</DropdownMenuRadioItem>
                  {pub.personas.map((p) => <DropdownMenuRadioItem key={p.id} value={p.id}>{p.name}</DropdownMenuRadioItem>)}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" disabled={disabled} onSelect={onDisconnect}>
              Отключить
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}
