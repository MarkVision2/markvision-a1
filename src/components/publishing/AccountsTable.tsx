/**
 * Вкладка «Аккаунты» — управление сетью.
 *
 * Плотная таблица: 11 колонок с горизонтальным скроллом и селектами в каждой
 * строке не читались, поэтому редкие настройки (лимит, разгон, персона,
 * отключение) убраны в меню строки, а на виду осталось то, на что оператор
 * смотрит каждый день: кто, в каком состоянии, сколько сегодня, когда постил.
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2, MoreHorizontal, Search, ShieldCheck, Sparkles } from "lucide-react";
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
  PLATFORM_META,
  effectiveDailyLimit,
  formatFollowers,
  healthTone,
  rampStage,
  type PublishAccount,
  type PublishPlatform,
} from "@/lib/publishingClient";
import { fmtExact, fmtRelative } from "@/lib/publishingFormat";
import { ANY, EMPTY_FILTERS, filterAccounts, type AccountFilters } from "@/lib/publishingSelection";
import { cn } from "@/lib/utils";

const NONE = "__none";

const HEALTH_DOT = {
  good: "bg-emerald-500",
  warn: "bg-amber-500",
  bad: "bg-destructive",
} as const;

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

/* ───────────────────────────── таблица ───────────────────────────── */

export function AccountsTable({ pub }: { pub: UsePublishing }) {
  const disabled = pub.busy != null;
  const [filters, setFilters] = useState<AccountFilters>(EMPTY_FILTERS);
  const [selected, setSelected] = useState<Set<string>>(new Set());

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

  const visible = useMemo(() => filterAccounts(pub.accounts, filters), [pub.accounts, filters]);
  // Выделение переживает перерисовку, но не должно тянуть отключённые аккаунты.
  const live = useMemo(() => new Set(pub.accounts.map((a) => a.id)), [pub.accounts]);
  const chosen = useMemo(() => [...selected].filter((id) => live.has(id)), [selected, live]);
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

  if (!pub.accounts.length) {
    return (
      <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
        Аккаунтов пока нет — подключите Instagram-страницы через Meta или аккаунт Threads.
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
    <div className="space-y-3">
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
        <Select value={filters.platform} onValueChange={(v) => setFilters((f) => ({ ...f, platform: v as AccountFilters["platform"] }))}>
          <SelectTrigger className="h-9 w-[150px]" aria-label="Фильтр по площадке"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Все площадки</SelectItem>
            {(Object.keys(PLATFORM_META) as PublishPlatform[]).map((p) => (
              <SelectItem key={p} value={p}>{PLATFORM_META[p].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.groupId} onValueChange={(v) => setFilters((f) => ({ ...f, groupId: v }))}>
          <SelectTrigger className="h-9 w-[160px]" aria-label="Фильтр по группе"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Все группы</SelectItem>
            <SelectItem value={NONE}>Без группы</SelectItem>
            {pub.groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-xs tabular-nums text-muted-foreground">{visible.length} из {pub.accounts.length}</span>
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
      </div>

      <BulkAccountsBar pub={pub} selected={chosen} onClear={() => setSelected(new Set())} />

      {visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          Под фильтры ничего не подошло.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-9 w-9 pl-3 pr-0">
                  <Checkbox checked={allVisibleChosen} onCheckedChange={toggleAllVisible} aria-label="Выбрать все показанные аккаунты" />
                </TableHead>
                <TableHead className="h-9">Аккаунт</TableHead>
                <TableHead className="h-9 w-[135px]">Статус</TableHead>
                <TableHead className="h-9 w-[150px]">Группа</TableHead>
                <TableHead className="h-9 w-[90px] text-right">Сегодня</TableHead>
                <TableHead className="h-9 w-[110px] text-right">Здоровье</TableHead>
                <TableHead className="h-9 w-[105px] whitespace-nowrap">Пост</TableHead>
                <TableHead className="h-9 w-[60px] text-center">Вкл</TableHead>
                <TableHead className="h-9 w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((a) => (
                <AccountRow
                  key={a.id}
                  a={a}
                  pub={pub}
                  disabled={disabled}
                  run={run}
                  checked={selected.has(a.id)}
                  onToggle={() => toggleOne(a.id)}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
    </TooltipProvider>
  );
}

/* ───────────────────────────── строка ───────────────────────────── */

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
  const platform = PLATFORM_META[a.platform];
  const tone = healthTone(a.health_score);
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

      {/* Кто: аватар, имя, @хэндл, площадка — одним блоком */}
      <TableCell className="py-2">
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
              {a.followers != null && <span className="shrink-0">{formatFollowers(a.followers)}</span>}
              {persona && <span className="shrink-0 truncate">· {persona.name}</span>}
            </div>
          </div>
        </div>
      </TableCell>

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

      {/* Здоровье: точка + число вместо полосы — одинаковые «100» переставали читаться */}
      <TableCell className="py-2 text-right">
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              aria-label={`Здоровье ${a.account_name}`}
              className="inline-flex cursor-help items-center gap-1.5 text-sm tabular-nums"
            >
              <span className={cn("h-2 w-2 rounded-full", HEALTH_DOT[tone])} aria-hidden />
              {Math.round(a.health_score)}
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs" side="left">
            <HealthHint a={a} />
          </TooltipContent>
        </Tooltip>
      </TableCell>

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
