/**
 * Полоса аккаунтов в композере: аватар + хэндл + площадка, клик переключает.
 * Негодные (выключены, не активны, здоровье < 20) показываются приглушённо и
 * не выбираются — планировщик их всё равно пропустит.
 */
import { Check } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
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
    <div className="flex flex-wrap items-center gap-1.5">
      {accounts.map((a) => {
        const e = accountEligibility(a);
        const chosen = selected.has(a.id);
        const meta = PLATFORM_META[a.platform];
        return (
          <button
            key={a.id}
            type="button"
            disabled={!e.ok}
            onClick={() => toggle(a.id)}
            title={e.hint ?? `${a.account_name} · ${meta?.label ?? a.platform}`}
            aria-pressed={chosen}
            aria-label={`${a.handle ?? a.account_name} — ${meta?.label ?? a.platform}`}
            className={cn(
              "group relative flex max-w-[190px] items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-left transition-colors",
              chosen ? "border-primary bg-primary/10" : "border-border hover:bg-muted",
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
          </button>
        );
      })}

      <label className="ml-1 flex cursor-pointer items-center gap-1.5 text-sm">
        <Checkbox checked={allChosen} disabled={!usable.length} onCheckedChange={toggleAll} aria-label="Выбрать все аккаунты" />
        <span>Все</span>
      </label>
    </div>
  );
}
