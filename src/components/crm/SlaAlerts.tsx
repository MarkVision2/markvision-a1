import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SlaAlertBucket } from "@/hooks/useCrmAnalytics";

interface Props {
  alerts: SlaAlertBucket;
  onJumpToNoAnswer: () => void;
  /** When true, render a slim single-line strip suitable for the page header. */
  compact?: boolean;
}

export function SlaAlerts({ alerts, onJumpToNoAnswer, compact }: Props) {
  const red = alerts.red.length;
  const yellow = alerts.yellow.length;

  if (red === 0 && yellow === 0) {
    if (compact) return null;
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-success/30 bg-success/10 px-4 py-3 text-sm">
        <CheckCircle2 className="h-5 w-5 text-success" />
        <div>
          <div className="font-semibold">SLA в норме</div>
          <div className="text-xs text-muted-foreground">Нет лидов без ответа дольше 5 минут.</div>
        </div>
      </div>
    );
  }

  if (compact) {
    return (
      <button
        type="button"
        onClick={onJumpToNoAnswer}
        className={cn(
          "flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left text-xs transition-colors",
          red > 0
            ? "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15"
            : "border-warning/40 bg-warning/10 text-warning hover:bg-warning/15",
        )}
      >
        {red > 0 ? (
          <AlertTriangle className="h-4 w-4 shrink-0" />
        ) : (
          <Clock className="h-4 w-4 shrink-0" />
        )}
        <span className="flex-1 truncate font-semibold">
          {red > 0 && `🔴 ${red} ${leadWord(red)} без ответа > 15 мин`}
          {red > 0 && yellow > 0 && " · "}
          {yellow > 0 && `🟡 ${yellow} ${leadWord(yellow)} ждёт 5–15 мин`}
        </span>
        <span className="shrink-0 text-[10px] uppercase tracking-wider opacity-70">
          Открыть →
        </span>
      </button>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {red > 0 && (
        <button
          onClick={onJumpToNoAnswer}
          className="group flex items-start gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-left transition-colors hover:bg-destructive/15"
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 text-destructive" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-destructive">
              🔴 {red} {leadWord(red)} без ответа более 15 минут
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Деньги горят. Откройте «Без ответа» и реанимируйте контакт.
            </div>
          </div>
        </button>
      )}
      {yellow > 0 && (
        <button
          onClick={onJumpToNoAnswer}
          className="flex items-start gap-3 rounded-2xl border border-warning/40 bg-warning/10 p-4 text-left transition-colors hover:bg-warning/15"
        >
          <Clock className="mt-0.5 h-5 w-5 text-warning" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-warning">
              🟡 {yellow} {leadWord(yellow)} ожидает ответа 5–15 минут
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Свяжитесь сейчас, пока контакт ещё «тёплый».
            </div>
          </div>
        </button>
      )}
    </div>
  );
}

function leadWord(n: number) {
  const m = n % 10;
  if (n % 100 >= 11 && n % 100 <= 14) return "лидов";
  if (m === 1) return "лид";
  if (m >= 2 && m <= 4) return "лида";
  return "лидов";
}
