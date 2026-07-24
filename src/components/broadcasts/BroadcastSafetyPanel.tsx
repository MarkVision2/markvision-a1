import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Play,
  RefreshCw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserMinus,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";
import {
  fetchHealth,
  fetchSafety,
  removeOptOut,
  resumeSender,
  type BroadcastHealth,
  type BroadcastSafety,
} from "@/lib/broadcastServer";

const ACCOUNT_LABEL: Record<string, string> = {
  authorized: "Авторизован",
  yellowCard: "Жёлтая карточка",
  blocked: "Заблокирован",
  notAuthorized: "Не авторизован",
  sleepMode: "Спит",
  starting: "Запускается",
  unknown: "Неизвестно",
};

/**
 * Панель безопасности рассылок: «ban-aware» здоровье аккаунта (статус Green +
 * риск блокировки + безопасный остаток на сегодня + рекомендации), дневной
 * лимит с прогревом, авто-пауза (kill-switch) и список отписавшихся.
 */
export function BroadcastSafetyPanel({ projectId }: { projectId: string | null }) {
  const [data, setData] = useState<BroadcastSafety | null>(null);
  const [health, setHealth] = useState<BroadcastHealth | null>(null);
  const [checking, setChecking] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!projectId) return;
    void fetchSafety(projectId).then(setData);
  }, [projectId]);

  const loadHealth = useCallback(async () => {
    if (!projectId) return;
    setChecking(true);
    try {
      setHealth(await fetchHealth(projectId));
    } finally {
      setChecking(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { void loadHealth(); }, [loadHealth]);
  useRealtimeTable("broadcast_sender_state", load, !!projectId, 600);
  useRealtimeTable("broadcast_opt_outs", load, !!projectId, 600);

  if (!projectId || !data) return null;

  const pct = data.dailyCap > 0 ? Math.min(100, Math.round((data.sentToday / data.dailyCap) * 100)) : 0;
  const risk = health?.riskLevel ?? "ok";
  const riskTone =
    risk === "danger" ? "destructive" : risk === "warning" ? "warning" : "success";
  const RiskIcon = risk === "ok" ? ShieldCheck : risk === "warning" ? ShieldAlert : AlertTriangle;

  const resume = async () => {
    setBusy(true);
    try {
      await resumeSender(projectId);
      toast.success("Пауза снята — отправка возобновится");
      load();
      void loadHealth();
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
            riskTone === "destructive" && "bg-destructive/15 text-destructive ring-destructive/30",
            riskTone === "warning" && "bg-warning/15 text-warning ring-warning/30",
            riskTone === "success" && "bg-success/15 text-success ring-success/30",
          )}
        >
          <RiskIcon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-bold">
            <Shield className="h-3.5 w-3.5 text-muted-foreground" />
            Безопасность отправки
            {health && (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                  health.accountState === "authorized" && "bg-success/15 text-success",
                  (health.accountState === "yellowCard" || health.accountState === "blocked") && "bg-destructive/15 text-destructive",
                  !["authorized", "yellowCard", "blocked"].includes(health.accountState) && "bg-secondary text-muted-foreground",
                )}
              >
                {ACCOUNT_LABEL[health.accountState] ?? health.accountState}
              </span>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {health?.riskReason ?? "Прогрев номера защищает от блокировки"}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => void loadHealth()}
            disabled={checking}
            className="inline-flex items-center gap-1 rounded-lg border border-border/60 px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-secondary/60 disabled:opacity-60"
            title="Проверить статус аккаунта у WhatsApp"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", checking && "animate-spin")} />
            Проверить
          </button>
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

      {/* Ключевые цифры */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Metric label="Отправлено сегодня" value={String(data.sentToday)} />
        <Metric
          label="Безопасный остаток"
          value={String(health?.remainingToday ?? Math.max(0, data.dailyCap - data.sentToday))}
          tone="success"
        />
        <Metric label="Дневной лимит" value={`~${data.dailyCap}`} hint={health ? `прогрев: день ${health.warmupDay}` : undefined} />
      </div>

      {/* Прогресс дневного лимита */}
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className={cn("h-full rounded-full transition-all", pct >= 100 ? "bg-destructive" : "bg-success")}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Риск-баннер (когда не «ок») */}
      {health && health.riskLevel !== "ok" && (
        <div
          className={cn(
            "mt-3 flex flex-wrap items-center gap-2 rounded-xl border p-3 text-xs",
            health.riskLevel === "danger" ? "border-destructive/40 bg-destructive/10" : "border-warning/40 bg-warning/10",
          )}
        >
          <AlertTriangle className={cn("h-4 w-4 shrink-0", health.riskLevel === "danger" ? "text-destructive" : "text-warning")} />
          <span className="min-w-0 flex-1 text-foreground">{health.riskReason}</span>
          {data.paused && (
            <button
              onClick={resume}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-lg bg-gradient-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground shadow-glow disabled:opacity-60"
            >
              <Play className="h-3.5 w-3.5" />
              Снять паузу
            </button>
          )}
        </div>
      )}

      {/* Пауза без health-риска (fallback) */}
      {data.paused && (!health || health.riskLevel === "ok") && (
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

      {/* Рекомендации */}
      {health && health.recommendations.length > 0 && (
        <ul className="mt-3 space-y-1">
          {health.recommendations.map((r, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
              <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-primary/70" />
              <span>{r}</span>
            </li>
          ))}
        </ul>
      )}

      {health && health.failRatePct > 0 && (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Activity className="h-3 w-3" />
          Доля ошибок за сутки: <b className={cn(health.failRatePct >= 30 ? "text-destructive" : "text-foreground")}>{health.failRatePct}%</b>
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

function Metric({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "success" }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/40 p-2.5 text-center">
      <div className={cn("text-lg font-bold tabular-nums", tone === "success" && "text-success")}>{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      {hint && <div className="text-[9px] text-muted-foreground/70">{hint}</div>}
    </div>
  );
}
