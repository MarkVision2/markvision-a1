/**
 * Полоса аккаунтов в композере: аватар + хэндл + площадка, клик переключает.
 * Негодные (выключены, не активны, здоровье < 20) показываются приглушённо и
 * не выбираются — планировщик их всё равно пропустит.
 */
import { ChevronDown, Users } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AccountPicker } from "@/components/publishing/AccountPicker";
import { type PublishAccount, type PublishGroup } from "@/lib/publishingClient";
import { isPublishable } from "@/lib/publishingSelection";
import { initials } from "@/components/publishing/PostPreview";

interface Props {
  accounts: PublishAccount[];
  groups?: PublishGroup[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}

export function AccountChips({ accounts, groups = [], selected, onChange }: Props) {
  const usable = accounts.filter(isPublishable);
  const allChosen = usable.length > 0 && usable.every((a) => selected.has(a.id));

  /** «Все» трогает только годные аккаунты — не сбрасывает то, что выбрано иначе. */
  const toggleAll = () => {
    const next = new Set(selected);
    if (allChosen) usable.forEach((a) => next.delete(a.id));
    else usable.forEach((a) => next.add(a.id));
    onChange(next);
  };

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
          <PopoverContent align="start" className="w-[min(40rem,calc(100vw-2rem))] border-border/80 bg-popover p-3 shadow-elevated">
            {/* Тот же выбор с поиском, фильтрами и пресетами, что и в таблице — сотня аккаунтов иначе не листается. */}
            <AccountPicker accounts={accounts} groups={groups} selected={selected} onChange={onChange} maxHeight="18rem" />
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
