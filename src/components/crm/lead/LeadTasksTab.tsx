import { useEffect, useMemo, useState } from "react";
import { CalendarIcon, CheckCircle2, Circle, Clock, ListChecks, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { LeadTask } from "@/types/crm";

interface Props {
  tasks: LeadTask[];
  onAdd: (title: string, dueAt: string) => void;
  onToggle: (taskId: string) => void;
  onRemove: (taskId: string) => void;
}

function fmtRu(iso: string) {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

function plusHoursISO(h: number) {
  return new Date(Date.now() + h * 3600 * 1000).toISOString();
}

function tomorrow9amISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}

function defaultDueDate() {
  // По умолчанию — через 1 час, округлённое до ближайших 5 минут.
  const d = new Date(Date.now() + 60 * 60 * 1000);
  const m = d.getMinutes();
  d.setMinutes(Math.round(m / 5) * 5, 0, 0);
  return d;
}

export function LeadTasksTab({ tasks, onAdd, onToggle, onRemove }: Props) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState<Date>(defaultDueDate);
  const [time, setTime] = useState<string>(() => {
    const d = defaultDueDate();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  });
  const [calOpen, setCalOpen] = useState(false);

  // Если пользователь не трогал дату — каждые 30 сек подвигаем default к «через час».
  useEffect(() => { /* placeholder for future auto-rolling */ }, []);

  const dueAtISO = useMemo(() => {
    const [hh, mm] = time.split(":").map((n) => parseInt(n, 10));
    const d = new Date(date);
    d.setHours(Number.isFinite(hh) ? hh : 0, Number.isFinite(mm) ? mm : 0, 0, 0);
    return d.toISOString();
  }, [date, time]);

  const trimmed = title.trim();
  const canSubmit = trimmed.length > 0;

  const submit = (overrideISO?: string) => {
    if (!canSubmit) return;
    onAdd(trimmed, overrideISO ?? dueAtISO);
    setTitle("");
    // дату/время оставляем — пользователь может ставить серию задач подряд.
  };

  const applyPreset = (iso: string) => {
    const d = new Date(iso);
    setDate(d);
    setTime(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
  };

  const overdue = tasks.filter((t) => !t.doneAt && new Date(t.dueAt).getTime() < Date.now());
  const sorted = [...tasks].sort((a, b) => {
    if (!!a.doneAt !== !!b.doneAt) return a.doneAt ? 1 : -1;
    return a.dueAt.localeCompare(b.dueAt);
  });

  return (
    <div className="space-y-3">
      {overdue.length > 0 && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">
          🔴 {overdue.length === 1 ? "1 просроченная задача" : `${overdue.length} просроченных задач`}
        </div>
      )}

      {/* Поставить задачу */}
      <div className="rounded-xl border border-border/60 bg-card/40 p-3">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
          <ListChecks className="h-3.5 w-3.5 text-primary" /> Поставить задачу
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Выберите дату и время, когда нужно вернуться к клиенту.
        </p>

        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && canSubmit) submit(); }}
          placeholder="Например: позвонить ещё раз"
          maxLength={120}
          className="mt-3"
        />

        <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
          <Popover open={calOpen} onOpenChange={setCalOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="justify-start font-normal"
              >
                <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                {format(date, "d MMMM yyyy", { locale: ru })}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-0">
              <Calendar
                mode="single"
                selected={date}
                onSelect={(d) => {
                  if (d) {
                    setDate(d);
                    setCalOpen(false);
                  }
                }}
                initialFocus
                disabled={(d) => {
                  // Сравниваем по дате (без времени) — сегодня тоже разрешено.
                  const today = new Date();
                  today.setHours(0, 0, 0, 0);
                  return d < today;
                }}
              />
            </PopoverContent>
          </Popover>

          <Input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            step={300}
            className="w-[110px]"
            aria-label="Время задачи"
          />
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => applyPreset(plusHoursISO(1))}>через 1 час</Button>
          <Button size="sm" variant="ghost" onClick={() => applyPreset(plusHoursISO(3))}>через 3 часа</Button>
          <Button size="sm" variant="ghost" onClick={() => applyPreset(tomorrow9amISO())}>завтра 9:00</Button>
          <Button size="sm" variant="ghost" onClick={() => applyPreset(plusHoursISO(72))}>через 3 дня</Button>
        </div>

        <Button
          onClick={() => submit()}
          disabled={!canSubmit}
          className="mt-3 w-full bg-success text-success-foreground hover:bg-success/90"
        >
          <ListChecks className="h-4 w-4" />
          Поставить задачу{canSubmit ? ` · ${fmtRu(dueAtISO)}` : ""}
        </Button>
      </div>

      {/* Список задач */}
      {sorted.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 bg-secondary/20 px-3 py-8 text-center text-sm text-muted-foreground">
          Задач пока нет. Поставленная задача появится здесь и напомнит в нужное время.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {sorted.map((t) => {
            const isOverdue = !t.doneAt && new Date(t.dueAt).getTime() < Date.now();
            return (
              <li
                key={t.id}
                className={cn(
                  "group flex items-center gap-2 rounded-lg border bg-card/40 px-3 py-2 text-sm",
                  t.doneAt
                    ? "border-border/40 opacity-60"
                    : isOverdue
                    ? "border-destructive/40 bg-destructive/5"
                    : "border-border/60",
                )}
              >
                <button
                  type="button"
                  onClick={() => onToggle(t.id)}
                  className="shrink-0"
                  aria-label={t.doneAt ? "Открыть задачу" : "Завершить задачу"}
                >
                  {t.doneAt
                    ? <CheckCircle2 className="h-4 w-4 text-success" />
                    : <Circle className="h-4 w-4 text-muted-foreground" />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className={cn("truncate", t.doneAt && "line-through")}>{t.title}</div>
                  <div className={cn(
                    "flex items-center gap-1 text-[11px]",
                    isOverdue ? "text-destructive font-semibold" : "text-muted-foreground",
                  )}>
                    <Clock className="h-3 w-3" />
                    {fmtRu(t.dueAt)}
                    {isOverdue && <span className="ml-1">просрочено</span>}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(t.id)}
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                  title="Удалить задачу"
                  aria-label="Удалить задачу"
                >
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
