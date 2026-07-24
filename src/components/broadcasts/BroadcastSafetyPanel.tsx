import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Play, Shield, ShieldCheck, Trash2, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";
import {
  fetchSafety,
  removeOptOut,
  resumeSender,
  type BroadcastSafety,
} from "@/lib/broadcastServer";

/**
 * Панель безопасности рассылок: сколько ушло сегодня против дневного потолка
 * (с учётом прогрева), авто-пауза номера (kill-switch) со снятием, и список
 * отписавшихся с возможностью вернуть номер.
 */
export function BroadcastSafetyPanel({ projectId }: { projectId: string | null }) {
  const [data, setData] = useState<BroadcastSafety | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!projectId) return;
    void fetchSafety(projectId).then(setData);
  }, [projectId]);

  useEffect(() => { load(); }, [load]);
  useRealtimeTable("broadcast_sender_state", load, !!projectId, 600);
  useRealtimeTable("broadcast_opt_outs", load, !!projectId, 600);

  if (!projectId || !data) return null;

  const pct = data.dailyCap > 0 ? Math.min(100, Math.round((data.sentToday / data.dailyCap) * 100)) : 0;

  const resume = async () => {
    setBusy(true);
    try {
      await resumeSender(projectId);
      toast.success("Пауза снята — отправка возобновится");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось снять паузу");
    } finally {
      setBusy(false);
    }
  };

  const unOpt = async (phone: string) => {
    try {
      await removeOptOut(projectId, phone);
      toast.success("Номер убран из отписавшихся");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось убрать");
    }
  };

  return (
    <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={cn(
            "grid h-9 w-9 place-items-center rounded-xl ring-1",
            data.paused ? "bg-destructive/15 text-destructive ring-destructive/30" : "bg-success/15 text-success ring-success/30",
          )}
        >
          {data.paused ? <AlertTriangle className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-bold">
            <Shield className="h-3.5 w-3.5 text-muted-foreground" />
            Безопасность отправки
          </div>
          <div className="text-[11px] text-muted-foreground">
            Сегодня отправлено <b className="text-foreground">{data.sentToday}</b> из ~{data.dailyCap}
            {" · "}прогрев номера защищает от блокировки
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {data.optOuts.length > 0 && (
            <button
              onClick={() => setOpen((v) => !v)}
              className="inline-flex items-center gap-1 rounded-lg border border-border/60 px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-secondary/60"
            >
              <UserMinus className="h-3.5 w-3.5" />
              Отписки: {data.optOuts.length}
            </button>
          )}
        </div>
      </div>

      {/* Прогресс дневного лимита */}
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className={cn("h-full rounded-full transition-all", pct >= 100 ? "bg-destructive" : "bg-success")}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Авто-пауза */}
      {data.paused && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs">
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
          <span className="min-w-0 flex-1 text-foreground">
            Отправка на паузе. {data.pauseReason || "Сработала защита от всплеска ошибок."}
          </span>
          <button
            onClick={resume}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg bg-gradient-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground shadow-glow disabled:opacity-60"
          >
            <Play className="h-3.5 w-3.5" />
            Снять паузу
          </button>
        </div>
      )}

      {/* Список отписавшихся */}
      {open && data.optOuts.length > 0 && (
        <div className="mt-3 max-h-48 space-y-1 overflow-y-auto rounded-xl border border-border/60 bg-background/40 p-2">
          {data.optOuts.map((o) => (
            <div key={o.phone} className="flex items-center gap-2 rounded-lg px-2 py-1 text-xs hover:bg-secondary/40">
              <span className="font-mono">{o.phone}</span>
              {o.reason && <span className="truncate text-[10px] text-muted-foreground">«{o.reason}»</span>}
              <button
                onClick={() => unOpt(o.phone)}
                className="ml-auto grid h-6 w-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
                title="Убрать из отписавшихся"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
