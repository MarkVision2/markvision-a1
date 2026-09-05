/**
 * Панель массовых действий над выделенными аккаунтами.
 *
 * При 100+ аккаунтах правка построчно нереальна: включить пачку, перекинуть
 * в группу, назначить персону, выставить общий лимит и разгон — одним нажатием.
 * Каждое действие идёт последовательными запросами к publish-accounts и
 * рапортует, сколько строк изменилось, а сколько упало.
 */
import { useState } from "react";
import { Loader2, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { UsePublishing } from "@/hooks/usePublishing";
import type { AccountUpdateInput } from "@/lib/publishingClient";

const NONE = "__none";

interface Props {
  pub: UsePublishing;
  selected: string[];
  onClear: () => void;
}

export function BulkAccountsBar({ pub, selected, onClear }: Props) {
  const [running, setRunning] = useState<string | null>(null);
  const [limit, setLimit] = useState("");
  const n = selected.length;

  if (!n) return null;

  /**
   * Одна правка на все выделенные строки. Идём последовательно, а не
   * Promise.all: сотня параллельных вызовов edge-функции упрётся в лимиты.
   * Перечитываем страницу один раз в конце, а не после каждой строки.
   */
  const applyAll = async (label: string, patch: AccountUpdateInput, key: string) => {
    setRunning(key);
    let ok = 0;
    const failures: string[] = [];
    try {
      for (const id of selected) {
        try {
          await pub.updateAccountQuiet(id, patch);
          ok += 1;
        } catch (e) {
          failures.push(e instanceof Error ? e.message : "ошибка");
        }
      }
      if (failures.length) toast.error(`${label}: ${ok} из ${n}, ошибок ${failures.length} — ${failures[0]}`);
      else toast.success(`${label}: ${ok}`);
    } finally {
      setRunning(null);
      await pub.refetch();
    }
  };

  const busy = running != null;

  const commitLimit = () => {
    const v = Number(limit);
    if (!Number.isInteger(v) || v < 1 || v > 200) {
      toast.error("Лимит — целое число от 1 до 200; чтобы не публиковать, выключите аккаунты");
      return;
    }
    void applyAll(`Лимит ${v}/день`, { daily_limit: v }, "limit");
    setLimit("");
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-muted/40 p-3 text-sm">
      <span className="font-medium tabular-nums">Выбрано: {n}</span>
      <span className="h-4 w-px bg-border" />

      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setRunning("check");
          try {
            const r = await pub.healthCheck(selected);
            if (r.token_expired) toast.warning(`Проверено ${r.checked}, протухших токенов: ${r.token_expired}`);
            else toast.success(`Проверено ${r.checked} — все токены живые`);
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Ошибка проверки");
          } finally {
            setRunning(null);
          }
        }}
      >
        {running === "check" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />} Проверить
      </Button>

      <Button size="sm" variant="outline" disabled={busy} onClick={() => void applyAll("Публикации включены", { publish_enabled: true }, "on")}>
        {running === "on" && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Включить
      </Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void applyAll("Публикации выключены", { publish_enabled: false }, "off")}>
        {running === "off" && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Выключить
      </Button>

      <Select
        disabled={busy}
        value=""
        onValueChange={(v) => void applyAll("Группа назначена", { group_id: v === NONE ? null : v }, "group")}
      >
        <SelectTrigger className="h-8 w-[160px]" aria-label="Назначить группу">
          <SelectValue placeholder="В группу…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Без группы</SelectItem>
          {pub.groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
        </SelectContent>
      </Select>

      <Select
        disabled={busy}
        value=""
        onValueChange={(v) => void applyAll("Персона назначена", { persona_id: v === NONE ? null : v }, "persona")}
      >
        <SelectTrigger className="h-8 w-[160px]" aria-label="Назначить персону">
          <SelectValue placeholder="Персона…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Без персоны</SelectItem>
          {pub.personas.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-1">
        <Input
          className="h-8 w-20"
          type="number"
          min={0}
          placeholder="лимит"
          aria-label="Лимит в день для выделенных"
          value={limit}
          disabled={busy}
          onChange={(e) => setLimit(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && commitLimit()}
        />
        <Button size="sm" variant="outline" disabled={busy || !limit.trim()} onClick={commitLimit}>
          {running === "limit" && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Задать
        </Button>
      </div>

      <Button size="sm" variant="outline" disabled={busy} onClick={() => void applyAll("Разгон включён", { ramp_enabled: true }, "ramp-on")}>
        {running === "ramp-on" && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Разгон вкл
      </Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void applyAll("Разгон выключен", { ramp_enabled: false }, "ramp-off")}>
        {running === "ramp-off" && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Разгон выкл
      </Button>

      <Button size="sm" variant="ghost" className="ml-auto" disabled={busy} onClick={onClear}>
        <X className="mr-1 h-3.5 w-3.5" /> Снять выбор
      </Button>
    </div>
  );
}
