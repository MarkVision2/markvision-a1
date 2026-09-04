/**
 * Выбор аккаунтов для массовой публикации: поиск, фильтры по площадке и
 * группе, пресеты и чекбоксы. Аккаунты, которые планировщик не возьмёт
 * (выключены, не активны, здоровье < 20), помечены и по пресетам не выбираются —
 * иначе оператор выбирает 40 строк, а заданий создаётся 12.
 */
import { useMemo, useState } from "react";
import { Check, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  PLATFORM_META,
  formatFollowers,
  type PublishAccount,
  type PublishGroup,
  type PublishPlatform,
} from "@/lib/publishingClient";
import {
  ANY,
  EMPTY_FILTERS,
  accountEligibility,
  filterAccounts,
  isPublishable,
  todayLoad,
  type AccountFilters,
} from "@/lib/publishingSelection";
import { cn } from "@/lib/utils";

interface Props {
  accounts: PublishAccount[];
  groups: PublishGroup[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  /** Компактный режим для диалога — ограничивает высоту списка. */
  maxHeight?: string;
}

const PLATFORMS = Object.keys(PLATFORM_META) as PublishPlatform[];

export function AccountPicker({ accounts, groups, selected, onChange, maxHeight = "22rem" }: Props) {
  const [filters, setFilters] = useState<AccountFilters>(EMPTY_FILTERS);
  const set = (patch: Partial<AccountFilters>) => setFilters((f) => ({ ...f, ...patch }));

  const visible = useMemo(() => filterAccounts(accounts, filters), [accounts, filters]);
  const visiblePublishable = useMemo(() => visible.filter(isPublishable), [visible]);
  const allVisibleChosen = visiblePublishable.length > 0 && visiblePublishable.every((a) => selected.has(a.id));

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  /** Пресет: заменить выбор ровно на переданные аккаунты (только годные). */
  const pick = (list: PublishAccount[]) => onChange(new Set(list.filter(isPublishable).map((a) => a.id)));

  /** «Выбрать все» работает по видимому срезу и не трогает скрытых фильтром. */
  const toggleVisible = () => {
    const next = new Set(selected);
    if (allVisibleChosen) visiblePublishable.forEach((a) => next.delete(a.id));
    else visiblePublishable.forEach((a) => next.add(a.id));
    onChange(next);
  };

  const platformPresets = PLATFORMS.map((p) => ({
    platform: p,
    list: accounts.filter((a) => a.platform === p && isPublishable(a)),
  })).filter((p) => p.list.length > 0);

  return (
    <div className="space-y-3">
      {/* Пресеты — один клик вместо тридцати галочек */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button type="button" variant="secondary" size="sm" onClick={() => pick(accounts)}>
          Все активные ({accounts.filter(isPublishable).length})
        </Button>
        {platformPresets.map(({ platform, list }) => (
          <Button key={platform} type="button" variant="outline" size="sm" onClick={() => pick(list)}>
            {PLATFORM_META[platform].label} ({list.length})
          </Button>
        ))}
        {groups.map((g) => {
          const list = accounts.filter((a) => a.group_id === g.id && isPublishable(a));
          if (!list.length) return null;
          return (
            <Button key={g.id} type="button" variant="outline" size="sm" onClick={() => pick(list)}>
              {g.name} ({list.length})
            </Button>
          );
        })}
        {selected.size > 0 && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(new Set())}>
            <X className="mr-1 h-3.5 w-3.5" /> Снять выбор
          </Button>
        )}
      </div>

      {/* Поиск и фильтры */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-9 pl-8"
            placeholder="Поиск по имени или @хэндлу"
            aria-label="Поиск аккаунтов"
            value={filters.search}
            onChange={(e) => set({ search: e.target.value })}
          />
        </div>
        <Select value={filters.platform} onValueChange={(v) => set({ platform: v as AccountFilters["platform"] })}>
          <SelectTrigger className="h-9 w-[150px]" aria-label="Площадка"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Все площадки</SelectItem>
            {PLATFORMS.map((p) => <SelectItem key={p} value={p}>{PLATFORM_META[p].label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.groupId} onValueChange={(v) => set({ groupId: v })}>
          <SelectTrigger className="h-9 w-[160px]" aria-label="Группа"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Все группы</SelectItem>
            <SelectItem value="__none">Без группы</SelectItem>
            {groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant={filters.onlyPublishable ? "secondary" : "outline"}
          size="sm"
          className="h-9"
          onClick={() => set({ onlyPublishable: !filters.onlyPublishable })}
        >
          {filters.onlyPublishable && <Check className="mr-1 h-3.5 w-3.5" />} Только готовые
        </Button>
      </div>

      {/* Шапка списка */}
      <div className="flex items-center justify-between rounded-t-xl border border-b-0 bg-muted/40 px-3 py-2 text-sm">
        <label className="flex cursor-pointer items-center gap-2">
          <Checkbox
            checked={allVisibleChosen}
            disabled={!visiblePublishable.length}
            onCheckedChange={toggleVisible}
            aria-label="Выбрать все показанные аккаунты"
          />
          <span className="text-muted-foreground">
            {allVisibleChosen ? "Снять все показанные" : "Выбрать все показанные"} ({visiblePublishable.length})
          </span>
        </label>
        <span className="font-medium tabular-nums">Выбрано: {selected.size}</span>
      </div>

      {/* Список */}
      <ScrollArea className="rounded-b-xl border" style={{ maxHeight }}>
        {visible.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">Под фильтры ничего не подошло.</div>
        ) : (
          <ul className="divide-y">
            {visible.map((a) => {
              const e = accountEligibility(a);
              const load = todayLoad(a);
              const chosen = selected.has(a.id);
              return (
                <li key={a.id}>
                  <label
                    className={cn(
                      "flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/50",
                      chosen && "bg-primary/5",
                      !e.ok && "opacity-60",
                    )}
                  >
                    <Checkbox
                      checked={chosen}
                      disabled={!e.ok}
                      onCheckedChange={() => toggle(a.id)}
                      aria-label={`Выбрать ${a.account_name}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{a.account_name}</span>
                        <Badge variant="outline" className={cn("border-transparent text-[10px]", PLATFORM_META[a.platform]?.cls)}>
                          {PLATFORM_META[a.platform]?.label ?? a.platform}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        {a.handle && <span className="truncate">@{a.handle}</span>}
                        {a.followers != null && <span>{formatFollowers(a.followers)} подписчиков</span>}
                        <span className={cn("tabular-nums", load.full && "text-amber-700")}>
                          сегодня {load.used}/{load.limit}
                        </span>
                      </div>
                      {e.hint && <div className="text-xs text-amber-700">{e.hint}</div>}
                      {e.ok && load.full && (
                        <div className="text-xs text-muted-foreground">дневной лимит выбран — слот уедет на завтра</div>
                      )}
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{Math.round(a.health_score)}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </ScrollArea>
    </div>
  );
}
