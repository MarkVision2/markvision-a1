import { useState } from "react";
import { CheckCircle2, Circle, Clock, Plus, Trash2 } from "lucide-react";
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

export function LeadTasksTab({ tasks, onAdd, onToggle, onRemove }: Props) {
  const [title, setTitle] = useState("");

  const overdue = tasks.filter((t) => !t.doneAt && new Date(t.dueAt).getTime() < Date.now());
  const sorted = [...tasks].sort((a, b) => {
    if (!!a.doneAt !== !!b.doneAt) return a.doneAt ? 1 : -1;
    return a.dueAt.localeCompare(b.dueAt);
  });

  const submit = (dueAt: string) => {
    const t = title.trim();
    if (!t) return;
    onAdd(t, dueAt);
    setTitle("");
  };

  return (
    <div className="space-y-3">
      {overdue.length > 0 && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">
          🔴 {overdue.length} просроченн{overdue.length === 1 ? "ая задача" : "ых задач"}
        </div>
      )}

      <div className="rounded-xl border border-border/60 bg-card/40 p-3">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(plusHours(1)); }}
          placeholder="Новая задача (например: позвонить ещё раз)"
          maxLength={120}
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" onClick={() => submit(plusHours(1))} disabled={!title.trim()}>
            <Plus className="h-3.5 w-3.5" />через 1ч
          </Button>
          <Button size="sm" variant="outline" onClick={() => submit(plusHours(3))} disabled={!title.trim()}>
            +3ч
          </Button>
          <Button size="sm" variant="outline" onClick={() => submit(tomorrow9am())} disabled={!title.trim()}>
            завтра 9:00
          </Button>
          <Button size="sm" variant="outline" onClick={() => submit(plusHours(72))} disabled={!title.trim()}>
            +3 дня
          </Button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 bg-secondary/20 px-3 py-8 text-center text-sm text-muted-foreground">
          Нет задач. Добавьте первую — иначе лид забудется.
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