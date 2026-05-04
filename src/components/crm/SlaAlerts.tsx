import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SlaAlertBucket } from "@/hooks/useCrmAnalytics";

interface Props {
  alerts: SlaAlertBucket;
  onJumpToNoAnswer: () => void;
}

export function SlaAlerts({ alerts, onJumpToNoAnswer }: Props) {
  const red = alerts.red.length;
  const yellow = alerts.yellow.length;

  if (red === 0 && yellow === 0) {
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

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {red > 0 && (
        <button
          onClick={onJumpToNoAnswer}
          className={cn(
            "group flex items-start gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-left transition-colors hover:bg-destructive/15",
          )}
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