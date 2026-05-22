import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCrmStore } from "@/hooks/useCrmStore";

const DISMISSED_KEY = "crm.task.dismissed.v1";
// Скрываем «просроченное» напоминание через этот срок после dueAt — иначе оно висит
// бесконечно и раздражает (баг пользователя).
const STALE_AFTER_HOURS = 72;
const SHOW_AHEAD_MIN = 0; // показываем только когда срок реально настал

interface Reminder {
  taskId: string;
  leadId: string;
  leadName: string;
  leadPhone: string;
  title: string;
  dueAt: string;
}

function readDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as Record<string, number>;
    // Чистим записи старше 30 дней — чтобы localStorage не разрастался.
    const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
    const fresh = new Set<string>();
    for (const [k, ts] of Object.entries(parsed)) {
      if (typeof ts === "number" && ts > cutoff) fresh.add(k);
    }
    return fresh;
  } catch {
    return new Set();
  }
}

function persistDismissed(set: Set<string>) {
  try {
    const obj: Record<string, number> = {};
    const now = Date.now();
    for (const k of set) obj[k] = now;
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(obj));
  } catch {
    /* noop */
  }
}

/**
 * Глобальный тостер просроченных задач.
 * Один тост за раз: «Пора выполнить задачу» с двумя действиями:
 *   — «Открыть» — перейти к лиду И отметить задачу выполненной
 *   — крестик   — скрыть напоминание (не вернётся, пока задача не изменится)
 *
 * Скрытие сохраняется в localStorage, поэтому уведомление НЕ возвращается
 * при следующей загрузке страницы (раньше всплывало каждый раз — баг пользователя).
 */
export function TaskReminderToast() {
  const navigate = useNavigate();
  const { leads, toggleTask } = useCrmStore();
  const [now, setNow] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissed());
  const persistRef = useRef(dismissed);
  persistRef.current = dismissed;

  // Минутный тикер — для пересчёта «настал ли срок».
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const due = useMemo<Reminder[]>(() => {
    const out: Reminder[] = [];
    const cutoffAhead = now + SHOW_AHEAD_MIN * 60_000;
    const cutoffStale = now - STALE_AFTER_HOURS * 3600_000;
    for (const l of leads) {
      for (const t of l.tasks ?? []) {
        if (t.doneAt) continue;
        const dueTs = new Date(t.dueAt).getTime();
        if (Number.isNaN(dueTs)) continue;
        if (dueTs > cutoffAhead) continue; // ещё не настал
        if (dueTs < cutoffStale) continue; // слишком давно — не докучаем
        if (dismissed.has(t.id)) continue;
        out.push({
          taskId: t.id,
          leadId: l.id,
          leadName: l.name,
          leadPhone: l.phone,
          title: t.title,
          dueAt: t.dueAt,
        });
      }
    }
    // Старые просрочки выше — чтобы первой висела самая критичная.
    return out.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  }, [leads, now, dismissed]);

  const current = due[0];
  if (!current) return null;

  const handleOpen = () => {
    // Помечаем задачу выполненной — главное требование пользователя.
    toggleTask(current.leadId, current.taskId);
    // На всякий случай добавляем в dismissed — если toggle не успеет до ререндера.
    const next = new Set(persistRef.current);
    next.add(current.taskId);
    setDismissed(next);
    persistDismissed(next);
    // Открываем CRM и просим раскрыть карточку лида через query-param.
    navigate(`/crm?lead=${encodeURIComponent(current.leadId)}`);
  };

  const handleDismiss = () => {
    const next = new Set(persistRef.current);
    next.add(current.taskId);
    setDismissed(next);
    persistDismissed(next);
  };

  return (
    <div
      role="alert"
      className={cn(
        "pointer-events-auto fixed left-1/2 top-4 z-[100] flex w-[calc(100vw-2rem)] max-w-md -translate-x-1/2",
        "items-start gap-3 rounded-2xl border border-warning/40 bg-card/95 px-4 py-3 shadow-2xl backdrop-blur",
      )}
    >
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">Пора выполнить задачу</div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {current.leadPhone || current.leadName}: {current.title}
        </div>
      </div>
      <Button size="sm" className="shrink-0" onClick={handleOpen}>
        Открыть
      </Button>
      <button
        type="button"
        onClick={handleDismiss}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-secondary"
        aria-label="Скрыть напоминание"
        title="Скрыть"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
