import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  MessageCircle,
  Send,
  Shield,
  Smartphone,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { CHANNEL_META, renderMessage, type Broadcast } from "@/lib/broadcastStore";
import { sendWhatsAppMessage } from "@/lib/broadcastSender";
import { fetchRecipientCounts, type RecipientCounts } from "@/lib/broadcastServer";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  broadcast: Broadcast | null;
  whatsappConnected: boolean;
  /** Ставит кампанию в очередь (status=sending); дальше шлёт серверный воркер. */
  onLaunch: () => Promise<void>;
}

type Phase = "confirm" | "launched";

export function BroadcastSendDialog({ open, onOpenChange, broadcast, whatsappConnected, onLaunch }: Props) {
  const [phase, setPhase] = useState<Phase>("confirm");
  const [testPhone, setTestPhone] = useState("");
  const [testing, setTesting] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [counts, setCounts] = useState<RecipientCounts | null>(null);

  useEffect(() => {
    if (open) {
      setPhase("confirm");
      setTestPhone("");
      setCounts(null);
    }
  }, [open]);

  const campaignId = broadcast?.id ?? null;
  const refreshCounts = useCallback(() => {
    if (!campaignId) return;
    void fetchRecipientCounts(campaignId).then(setCounts);
  }, [campaignId]);

  // Живой прогресс после запуска — воркер шлёт капельно в фоне.
  useEffect(() => {
    if (phase === "launched") refreshCounts();
  }, [phase, refreshCounts]);
  useRealtimeTable("broadcast_recipients", refreshCounts, phase === "launched", 800);

  if (!broadcast) return null;

  const isSms = broadcast.channel === "sms";
  const total = broadcast.recipientsCount || 0;
  const isScheduled = broadcast.schedule.mode === "scheduled";
  const blocked = isSms || !whatsappConnected || total === 0;
  const ChannelIcon = isSms ? Smartphone : MessageCircle;

  const sendTest = async () => {
    const phone = testPhone.trim();
    if (!phone) return;
    if (isSms) {
      toast.error("SMS-провайдер не подключён");
      return;
    }
    setTesting(true);
    try {
      await sendWhatsAppMessage(phone, renderMessage(broadcast.title, broadcast.message, { name: "Имя" }));
      toast.success("Тестовое сообщение отправлено");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось отправить тест");
    } finally {
      setTesting(false);
    }
  };

  const launch = async () => {
    setLaunching(true);
    try {
      await onLaunch();
      setPhase("launched");
      toast.success(isScheduled ? "Рассылка запланирована" : "Рассылка запущена");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось запустить рассылку");
    } finally {
      setLaunching(false);
    }
  };

  const preview = renderMessage(broadcast.title, broadcast.message, { name: "Имя" }).replace(/\*(.+?)\*/g, "$1");
  const done = counts ? counts.sent + counts.delivered + counts.read + counts.replied : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-primary text-primary-foreground shadow-glow">
              <Send className="h-4 w-4" />
            </span>
            {phase === "launched" ? "Рассылка в работе" : "Запуск рассылки"}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-1.5">
            <ChannelIcon className="h-3.5 w-3.5" />
            {CHANNEL_META[broadcast.channel].label} · {total} получателей
          </DialogDescription>
        </DialogHeader>

        {phase === "confirm" && (
          <div className="space-y-3">
            {isSms && (
              <Banner tone="warning" icon={AlertTriangle}>
                SMS-провайдер ещё не подключён. Сейчас доступна отправка только через WhatsApp.
              </Banner>
            )}
            {!isSms && !whatsappConnected && (
              <Banner tone="warning" icon={AlertTriangle}>
                WhatsApp не подключён. Подключите номер в разделе «Подключения», чтобы запустить рассылку.
              </Banner>
            )}

            {/* Безопасный режим */}
            {!blocked && (
              <Banner tone="muted" icon={Shield}>
                Отправка идёт <b>на сервере, капельно</b> — с рандомными паузами, дневным лимитом и прогревом
                номера, чтобы не поймать блокировку. Можно закрыть окно: рассылка продолжится в фоне.
                Клиенты, ответившие «стоп», исключаются автоматически.
              </Banner>
            )}
            {isScheduled && broadcast.schedule.at && (
              <Banner tone="muted" icon={Clock}>
                Старт по расписанию: {new Date(broadcast.schedule.at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}.
              </Banner>
            )}

            {/* Превью */}
            <div className="rounded-xl border border-border/60 bg-secondary/20 p-3">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Сообщение
              </div>
              <div className="max-h-32 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed">{preview}</div>
            </div>

            {/* Тестовая отправка */}
            {!isSms && whatsappConnected && (
              <div className="flex items-center gap-2">
                <input
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  placeholder="+7 700 … — тест себе"
                  className="flex-1 rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-sm outline-none focus:border-primary/50"
                />
                <Button variant="outline" size="sm" onClick={sendTest} disabled={testing || !testPhone.trim()}>
                  {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Тест"}
                </Button>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Отмена
              </Button>
              <Button onClick={launch} disabled={blocked || launching} className="bg-gradient-primary text-primary-foreground">
                {launching ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-1.5 h-4 w-4" />
                )}
                {isScheduled ? "Запланировать" : `Запустить · ${total}`}
              </Button>
            </div>
          </div>
        )}

        {phase === "launched" && (
          <div className="space-y-3">
            <Banner tone="muted" icon={CheckCircle2}>
              {isScheduled
                ? "Рассылка запланирована. Сервер начнёт отправку в назначенное время и продолжит капельно."
                : "Рассылка запущена. Сервер отправляет сообщения капельно в безопасном темпе — окно можно закрыть."}
            </Banner>

            <div className="grid grid-cols-3 gap-2">
              <Stat label="В очереди" value={counts?.queued ?? total} tone="muted" />
              <Stat label="Отправлено" value={done} tone="success" />
              <Stat label="Ответили" value={counts?.replied ?? 0} tone="primary" />
            </div>
            {(counts?.failed ?? 0) > 0 && (
              <div className="text-center text-[11px] text-destructive">
                С ошибкой: {counts?.failed}
                {(counts?.optout ?? 0) > 0 && <span className="text-muted-foreground"> · отписки: {counts?.optout}</span>}
              </div>
            )}

            <Button onClick={() => onOpenChange(false)} className="w-full bg-gradient-primary text-primary-foreground">
              Готово
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "muted" | "success" | "primary" }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/40 p-3 text-center">
      <div
        className={cn(
          "text-2xl font-bold tabular-nums",
          tone === "success" && "text-success",
          tone === "primary" && "text-primary",
        )}
      >
        {value}
      </div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function Banner({
  tone,
  icon: Icon,
  children,
}: {
  tone: "warning" | "muted";
  icon: typeof AlertTriangle;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-xl border p-3 text-xs leading-relaxed",
        tone === "warning" && "border-warning/40 bg-warning/10 text-foreground",
        tone === "muted" && "border-border/60 bg-secondary/30 text-muted-foreground",
      )}
    >
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", tone === "warning" ? "text-warning" : "text-muted-foreground")} />
      <div>{children}</div>
    </div>
  );
}
