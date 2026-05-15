import { useState } from "react";
import { CalendarClock, CheckCircle2, Circle, Clock, Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { LeadTask } from "@/types/crm";

interface Props {
  tasks: LeadTask[];
  onAdd: (title: string, dueAt: string) => void;
  onToggle: (taskId: string) => void;
  onRemove: (taskId: string) => void;
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

function plusHours(h: number) {
  return new Date(Date.now() + h * 3600 * 1000).toISOString();
}

function tomorrow9am() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}

function toDateTimeLocal(iso: string) {
  const d = new Date(iso);
  const offsetMs = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - offsetMs).toISOString().slice(0, 16);
}

function fromDateTimeLocal(value: string) {
  return new Date(value).toISOString();
}

export function LeadTasksTab({ tasks, onAdd, onToggle, onRemove }: Props) {
  const [title, setTitle] = useState("Связаться позже");
  const [dueAt, setDueAt] = useState(toDateTimeLocal(plusHours(2)));

  const overdue = tasks.filter((t) => !t.doneAt && new Date(t.dueAt).getTime() < Date.now());
  const sorted = [...tasks].sort((a, b) => {
    if (!!a.doneAt !== !!b.doneAt) return a.doneAt ? 1 : -1;
    return a.dueAt.localeCompare(b.dueAt);
  });

  const submit = (targetIso = fromDateTimeLocal(dueAt)) => {
    const t = title.trim() || "Связаться позже";
    if (!dueAt) return;
    if (!t) return;
    onAdd(t, targetIso);
    setTitle("Связаться позже");
    setDueAt(toDateTimeLocal(plusHours(2)));
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission();
    }
  };

  return (
    <div className="space-y-3">
      {overdue.length > 0 && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">
          {overdue.length} просроченн{overdue.length === 1 ? "ая задача" : "ых задач"}
        </div>
      )}

      <div className="rounded-2xl border border-border/60 bg-card/50 p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/15 text-primary ring-1 ring-primary/30">
            <CalendarClock className="h-4 w-4" />
          </span>
          <div>
            <div className="text-sm font-semibold">Поставить задачу</div>
            <div className="text-xs text-muted-foreground">Выберите дату и время, когда нужно вернуться к клиенту.</div>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-[1fr_210px]">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder="Например: связаться позже"
            maxLength={120}
          />
          <Input
            type="datetime-local"
            value={dueAt}
            min={toDateTimeLocal(new Date().toISOString())}
            onChange={(e) => setDueAt(e.target.value)}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Button size="sm" onClick={() => submit()} disabled={!dueAt}>
            <Plus className="h-3.5 w-3.5" />Сохранить задачу
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDueAt(toDateTimeLocal(plusHours(1)))}>
            через 1 час
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDueAt(toDateTimeLocal(plusHours(3)))}>
            через 3 часа
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDueAt(toDateTimeLocal(tomorrow9am()))}>
            завтра 9:00
          </Button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 bg-secondary/20 px-3 py-8 text-center text-sm text-muted-foreground">
          Задач пока нет. Сохранённая задача появится здесь и напомнит в нужное время.
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
                  t.doneAt ? "border-border/40 opacity-60" : isOverdue ? "border-destructive/40 bg-destructive/5" : "border-border/60",
                )}
              >
                <button onClick={() => onToggle(t.id)} className="shrink-0">
                  {t.doneAt
                    ? <CheckCircle2 className="h-4 w-4 text-success" />
                    : <Circle className="h-4 w-4 text-muted-foreground" />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className={cn("truncate", t.doneAt && "line-through")}>{t.title}</div>
                  <div className={cn("flex items-center gap-1 text-[11px]", isOverdue ? "text-destructive font-semibold" : "text-muted-foreground")}>
                    <Clock className="h-3 w-3" />
                    {fmt(t.dueAt)}
                    {isOverdue && <span className="ml-1">просрочено</span>}
                  </div>
                </div>
                <button
                  onClick={() => onRemove(t.id)}
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                  title="Удалить задачу"
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
