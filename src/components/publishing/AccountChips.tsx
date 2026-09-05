/**
 * Полоса аккаунтов в композере: аватар + хэндл + площадка, клик переключает.
 * Негодные (выключены, не активны, здоровье < 20) показываются приглушённо и
 * не выбираются — планировщик их всё равно пропустит.
 */
import { Check, ChevronDown, Users } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PLATFORM_META, type PublishAccount } from "@/lib/publishingClient";
import { accountEligibility, isPublishable } from "@/lib/publishingSelection";
import { initials } from "@/components/publishing/PostPreview";
import { cn } from "@/lib/utils";

interface Props {
  accounts: PublishAccount[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}

export function AccountChips({ accounts, selected, onChange }: Props) {
  const usable = accounts.filter(isPublishable);
  const allChosen = usable.length > 0 && usable.every((a) => selected.has(a.id));

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  const toggleAll = () => onChange(allChosen ? new Set() : new Set(usable.map((a) => a.id)));

  if (!accounts.length) {
    return <p className="text-sm text-muted-foreground">Аккаунтов пока нет — подключите их кнопками в шапке раздела.</p>;
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" className="h-10 flex-1 justify-between border-border/80 bg-secondary/40 px-3 hover:bg-secondary/70">
              <span className="flex min-w-0 items-center gap-2">
                <Users className="h-4 w-4 text-primary" />
                <span className="truncate">Выбрано аккаунтов: {selected.size}</span>
              </span>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[min(34rem,calc(100vw-2rem))] border-border/80 bg-popover p-2 shadow-elevated">
            <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
              {accounts.map((a) => {
        const e = accountEligibility(a);
        const chosen = selected.has(a.id);
        const meta = PLATFORM_META[a.platform];
        return (
          <Button
            key={a.id}
            type="button"
            variant="ghost"
            disabled={!e.ok}
            onClick={() => toggle(a.id)}
            title={e.hint ?? `${a.account_name} · ${meta?.label ?? a.platform}`}
            aria-pressed={chosen}
            aria-label={`${a.handle ?? a.account_name} — ${meta?.label ?? a.platform}`}
            className={cn(
              "group relative flex h-auto w-full justify-start gap-3 rounded-lg border px-2.5 py-2 text-left",
              chosen ? "border-primary/40 bg-primary/10" : "border-transparent hover:border-border hover:bg-muted",
              !e.ok && "cursor-not-allowed opacity-40",
            )}
          >
            <span className="relative">
              <Avatar className="h-7 w-7">
                <AvatarFallback className="text-[10px]">{initials(a.account_name)}</AvatarFallback>
              </Avatar>
              {chosen && (
                <span className="absolute -left-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check className="h-2.5 w-2.5" />
                </span>
              )}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium leading-tight">{a.handle ?? a.account_name}</span>
              <span className={cn("block truncate text-[10px] leading-tight", meta ? "text-muted-foreground" : "")}>
                {meta?.label ?? a.platform}
              </span>
            </span>
          </Button>
        );
              })}
            </div>
          </PopoverContent>
        </Popover>
        <label className="flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-border/80 bg-secondary/40 px-3 text-sm">
        <Checkbox checked={allChosen} disabled={!usable.length} onCheckedChange={toggleAll} aria-label="Выбрать все аккаунты" />
        <span>Все</span>
        </label>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {accounts.filter((a) => selected.has(a.id)).slice(0, 7).map((a) => (
          <div key={a.id} className="flex shrink-0 items-center gap-2 rounded-full border border-primary/35 bg-primary/10 py-1 pl-1 pr-2.5">
            <Avatar className="h-6 w-6"><AvatarFallback className="text-[9px]">{initials(a.account_name)}</AvatarFallback></Avatar>
            <span className="max-w-32 truncate text-xs font-medium">{a.handle ?? a.account_name}</span>
          </div>
        ))}
        {selected.size > 7 && <span className="flex shrink-0 items-center text-xs text-muted-foreground">+{selected.size - 7}</span>}
      </div>
    </div>
  );
}
