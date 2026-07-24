import { useCallback, useEffect, useState } from "react";
import { BarChart3 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";
import {
  fetchRecipientCounts,
  fetchRecipients,
  type RecipientCounts,
  type RecipientDetail,
} from "@/lib/broadcastServer";
import type { Broadcast } from "@/lib/broadcastStore";

type Tone = "muted" | "primary" | "success" | "warning" | "destructive";
const STATUS_META: Record<string, { label: string; tone: Tone }> = {
  queued: { label: "В очереди", tone: "muted" },
  sending: { label: "Отправляется", tone: "warning" },
  sent: { label: "Отправлено", tone: "primary" },
  delivered: { label: "Доставлено", tone: "primary" },
  read: { label: "Прочитано", tone: "success" },
  replied: { label: "Ответил", tone: "success" },
  clicked: { label: "Перешёл", tone: "success" },
  converted: { label: "Купил", tone: "success" },
  failed: { label: "Ошибка", tone: "destructive" },
  skipped_optout: { label: "Отписка", tone: "muted" },
};

const toneCls: Record<Tone, string> = {
  muted: "bg-secondary text-muted-foreground",
  primary: "bg-primary/15 text-primary",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  destructive: "bg-destructive/15 text-destructive",
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  broadcast: Broadcast | null;
}

export function BroadcastDetailsDialog({ open, onOpenChange, broadcast }: Props) {
  const [counts, setCounts] = useState<RecipientCounts | null>(null);
  const [rows, setRows] = useState<RecipientDetail[]>([]);

  const campaignId = broadcast?.id ?? null;
  const load = useCallback(() => {
    if (!campaignId) return;
    void fetchRecipientCounts(campaignId).then(setCounts);
    void fetchRecipients(campaignId).then(setRows);
  }, [campaignId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);
  useRealtimeTable("broadcast_recipients", load, open, 800);

  if (!broadcast) return null;

  const funnel: { key: keyof RecipientCounts; label: string; tone: Tone }[] = [
    { key: "sent", label: "Отправлено", tone: "primary" },
    { key: "delivered", label: "Доставлено", tone: "primary" },
    { key: "read", label: "Прочитано", tone: "success" },
    { key: "replied", label: "Ответили", tone: "success" },
    { key: "clicked", label: "Переходы", tone: "success" },
    { key: "converted", label: "Купили", tone: "success" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[560px]">
        <DialogHeader className="border-b border-border/60 px-5 py-4">
          <DialogTitle className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/30">
              <BarChart3 className="h-4 w-4" />
            </span>
            {broadcast.name || "Рассылка"}
          </DialogTitle>
          <DialogDescription>
            Статусы получателей · всего {counts?.total ?? broadcast.recipientsCount}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* Воронка */}
          <div className="grid grid-cols-3 gap-2">
            {funnel.map((f) => (
              <div key={f.key} className="rounded-xl border border-border/60 bg-card/40 p-3 text-center">
                <div
                  className={cn(
                    "text-xl font-bold tabular-nums",
                    f.tone === "success" && "text-success",
                    f.tone === "primary" && "text-primary",
                  )}
                >
                  {counts?.[f.key] ?? 0}
                </div>
                <div className="text-[10px] text-muted-foreground">{f.label}</div>
              </div>
            ))}
          </div>
          {((counts?.failed ?? 0) > 0 || (counts?.queued ?? 0) > 0 || (counts?.optout ?? 0) > 0) && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              {(counts?.queued ?? 0) > 0 && <span>В очереди: {counts?.queued}</span>}
              {(counts?.failed ?? 0) > 0 && <span className="text-destructive">Ошибок: {counts?.failed}</span>}
              {(counts?.optout ?? 0) > 0 && <span>Отписок: {counts?.optout}</span>}
            </div>
          )}

          {/* Список получателей */}
          <div className="space-y-1">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Получатели
            </div>
            {rows.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/60 p-4 text-center text-xs text-muted-foreground">
                Пока нет данных
              </div>
            ) : (
              rows.map((r) => {
                const meta = STATUS_META[r.status] ?? { label: r.status, tone: "muted" as Tone };
                return (
                  <div
                    key={r.id}
                    className="flex items-center gap-2 rounded-lg border border-border/50 bg-background/40 px-3 py-2 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{r.name || r.phone}</div>
                      {r.name && <div className="truncate text-[10px] text-muted-foreground">{r.phone}</div>}
                      {r.error && <div className="truncate text-[10px] text-destructive">{r.error}</div>}
                    </div>
                    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", toneCls[meta.tone])}>
                      {meta.label}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
