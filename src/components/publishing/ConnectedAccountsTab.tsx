/**
 * «Подключённые» — сводка по каждому аккаунту сети: посты, показы, вовлечение,
 * подписчики, статус и скоринг здоровья. Данные из витрины
 * publish_account_metrics (приходят в metrics.accounts).
 *
 * Метрики снимает воркер контрольными точками d1/d3/d7, поэтому у свежих
 * постов охват честно пустой, а не нулевой.
 */
import { useMemo, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { HealthHint } from "@/components/publishing/AccountsTable";
import {
  ACCOUNT_STATUS_META,
  PLATFORM_META,
  formatFollowers,
  healthTone,
  type AccountMetrics,
  type PublishGroup,
  type PublishPlatform,
} from "@/lib/publishingClient";
import { ANY } from "@/lib/publishingSelection";
import { cn } from "@/lib/utils";

const HEALTH_CLS = {
  good: "[&>div]:bg-emerald-500",
  warn: "[&>div]:bg-amber-500",
  bad: "[&>div]:bg-destructive",
} as const;

type SortKey = "account_name" | "followers" | "posts_total" | "reach" | "comments" | "er_percent" | "health_score";

const COLUMNS: { key: SortKey; label: string; hint?: string; numeric: boolean }[] = [
  { key: "account_name", label: "Аккаунт", numeric: false },
  { key: "followers", label: "Подписчики", numeric: true },
  { key: "posts_total", label: "Посты", hint: "всего / за 30 дней", numeric: true },
  { key: "reach", label: "Показы", hint: "охват по снятым метрикам", numeric: true },
  { key: "comments", label: "Комментарии", numeric: true },
  { key: "er_percent", label: "ER", hint: "реакции / охват", numeric: true },
  { key: "health_score", label: "Здоровье", numeric: true },
];

const num = (n: number | null | undefined): string => (n == null ? "—" : n.toLocaleString("ru-RU"));

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export function ConnectedAccountsTab({ rows, groups }: { rows: AccountMetrics[]; groups: PublishGroup[] }) {
  const [search, setSearch] = useState("");
  const [platform, setPlatform] = useState<string>(ANY);
  const [groupId, setGroupId] = useState<string>(ANY);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "followers", desc: true });

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase().replace(/^@/, "");
    const filtered = rows.filter((r) => {
      if (q && !`${r.account_name} ${r.handle ?? ""}`.toLowerCase().includes(q)) return false;
      if (platform !== ANY && r.platform !== platform) return false;
      if (groupId === "__none" ? r.group_id != null : groupId !== ANY && r.group_id !== groupId) return false;
      return true;
    });
    const dir = sort.desc ? -1 : 1;
    return [...filtered].sort((a, b) => {
      if (sort.key === "account_name") return dir * a.account_name.localeCompare(b.account_name, "ru");
      // Пустые метрики всегда внизу — иначе аккаунт без данных возглавит рейтинг.
      const av = a[sort.key] as number | null;
      const bv = b[sort.key] as number | null;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return dir * (av - bv);
    });
  }, [rows, search, platform, groupId, sort]);

  const totals = useMemo(
    () =>
      visible.reduce(
        (acc, r) => ({
          followers: acc.followers + (r.followers ?? 0),
          posts: acc.posts + r.posts_total,
          reach: acc.reach + r.reach,
          comments: acc.comments + r.comments,
        }),
        { followers: 0, posts: 0, reach: 0, comments: 0 },
      ),
    [visible],
  );

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "account_name" }));

  if (!rows.length) {
    return (
      <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
        Подключённых аккаунтов пока нет — добавьте их кнопками в шапке раздела.
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Total label="Аккаунтов" value={String(visible.length)} />
        <Total label="Подписчиков" value={formatFollowers(totals.followers) || "0"} />
        <Total label="Опубликовано постов" value={num(totals.posts)} />
        <Total label="Показов" value={num(totals.reach)} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-9 pl-8"
            placeholder="Поиск по имени или @хэндлу"
            aria-label="Поиск подключённых аккаунтов"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={platform} onValueChange={setPlatform}>
          <SelectTrigger className="h-9 w-[150px]" aria-label="Площадка"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Все площадки</SelectItem>
            {(Object.keys(PLATFORM_META) as PublishPlatform[]).map((p) => (
              <SelectItem key={p} value={p}>{PLATFORM_META[p].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={groupId} onValueChange={setGroupId}>
          <SelectTrigger className="h-9 w-[160px]" aria-label="Группа"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Все группы</SelectItem>
            <SelectItem value="__none">Без группы</SelectItem>
            {groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-x-auto rounded-2xl border">
        <Table>
          <TableHeader>
            <TableRow>
              {COLUMNS.map((c) => (
                <TableHead key={c.key} className={cn(c.numeric && "text-right")}>
                  <button
                    type="button"
                    onClick={() => toggleSort(c.key)}
                    title={c.hint}
                    className={cn("inline-flex items-center gap-1 hover:text-foreground", c.numeric && "flex-row-reverse")}
                  >
                    {c.label}
                    {sort.key === c.key && (sort.desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
                  </button>
                </TableHead>
              ))}
              <TableHead>Статус</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((r) => {
              const status = ACCOUNT_STATUS_META[r.status] ?? ACCOUNT_STATUS_META.error;
              const tone = healthTone(r.health_score);
              const pending = r.posts_total - r.measured_posts;
              return (
                <TableRow key={r.account_id}>
                  <TableCell className="min-w-[190px]">
                    <div className="font-medium">{r.account_name}</div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {r.handle && <span>@{r.handle}</span>}
                      <Badge variant="outline" className={cn("border-transparent", PLATFORM_META[r.platform]?.cls)}>
                        {PLATFORM_META[r.platform]?.label ?? r.platform}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.followers == null ? "—" : formatFollowers(r.followers)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {num(r.posts_total)}
                    <div className="text-xs text-muted-foreground">за 30 дн. {num(r.posts_30d)}</div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.measured_posts ? num(r.reach) : "—"}
                    {pending > 0 && <div className="text-xs text-muted-foreground">ждём метрики: {pending}</div>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.measured_posts ? num(r.comments) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.er_percent == null ? "—" : `${r.er_percent.toLocaleString("ru-RU")}%`}
                  </TableCell>
                  <TableCell>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex cursor-help items-center justify-end gap-2" tabIndex={0} aria-label={`Здоровье ${r.account_name}`}>
                          <Progress value={r.health_score} className={cn("h-2 w-16", HEALTH_CLS[tone])} />
                          <span className="w-7 text-right text-xs tabular-nums">{Math.round(r.health_score)}</span>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs" side="left"><HealthHint a={r} /></TooltipContent>
                    </Tooltip>
                  </TableCell>
                  <TableCell className="min-w-[150px]">
                    <Badge variant="outline" className={cn("border-transparent font-medium", status.cls)}>{status.label}</Badge>
                    {!r.publish_enabled && <div className="text-xs text-muted-foreground">публикация выключена</div>}
                    {r.failed_30d > 0 && (
                      <div className="flex items-center gap-1 text-xs text-destructive">
                        <AlertTriangle className="h-3 w-3" /> ошибок за 30 дн.: {r.failed_30d}
                      </div>
                    )}
                    {r.jobs_queued > 0 && <div className="text-xs text-muted-foreground">в очереди: {r.jobs_queued}</div>}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        Показы и вовлечение снимаются контрольными точками через 1, 3 и 7 дней после публикации — у свежих постов
        колонки пустые, пока воркер не собрал первую точку.
      </p>
    </div>
    </TooltipProvider>
  );
}
