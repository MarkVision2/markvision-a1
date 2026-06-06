import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTaskReminders } from "@/hooks/useTaskReminders";

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

// Храним dismissed как Record<id, timestamp> — таймстемп нужен,
// чтобы автоматически удалять записи старше 30 дней. Раньше при
// каждом сохранении ВСЕ таймстемпы перезаписывались на now, поэтому
// очистка не срабатывала и localStorage рос бесконечно.
function readDismissedRaw(): Record<string, number> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
    const fresh: Record<string, number> = {};
    for (const [k, ts] of Object.entries(parsed)) {
      if (typeof ts === "number" && ts > cutoff) fresh[k] = ts;
    }
    return fresh;
  } catch {
    return {};
  }
}

function readDismissed(): Set<string> {
  return new Set(Object.keys(readDismissedRaw()));
}

function persistDismissed(set: Set<string>) {
  try {
    const prev = readDismissedRaw();
    const obj: Record<string, number> = {};
    const now = Date.now();
    // Сохраняем оригинальный timestamp, чтобы 30-дневная очистка работала.
    for (const k of set) obj[k] = prev[k] ?? now;
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
  const { items: taskItems, toggleTask } = useTaskReminders();
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
    for (const t of taskItems) {
      const dueTs = new Date(t.dueAt).getTime();
      if (Number.isNaN(dueTs)) continue;
      if (dueTs > cutoffAhead) continue;
      if (dueTs < cutoffStale) continue;
      if (dismissed.has(t.taskId)) continue;
      out.push(t);
    }
    // Старые просрочки выше — чтобы первой висела самая критичная.
    return out.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  }, [taskItems, now, dismissed]);

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
        "pointer-events-auto fixed left-1/2 top-[calc(0.75rem+env(safe-area-inset-top))] z-[100] flex w-[calc(100vw-1.5rem)] max-w-md -translate-x-1/2",
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
