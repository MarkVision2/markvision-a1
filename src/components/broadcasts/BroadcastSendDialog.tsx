import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  MessageCircle,
  Send,
  Smartphone,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  CHANNEL_META,
  renderMessage,
  type Broadcast,
  type BroadcastContact,
  type BroadcastResult,
} from "@/lib/broadcastStore";
import { runBroadcast, sendWhatsAppMessage } from "@/lib/broadcastSender";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  broadcast: Broadcast | null;
  recipients: BroadcastContact[];
  whatsappConnected: boolean;
  onFinish: (patch: Partial<Broadcast>) => void;
}

type Phase = "confirm" | "sending" | "done";

export function BroadcastSendDialog({
  open,
  onOpenChange,
  broadcast,
  recipients,
  whatsappConnected,
  onFinish,
}: Props) {
  const [phase, setPhase] = useState<Phase>("confirm");
  const [progress, setProgress] = useState(0);
  const [sent, setSent] = useState(0);
  const [failed, setFailed] = useState(0);
  const [results, setResults] = useState<BroadcastResult[]>([]);
  const [testPhone, setTestPhone] = useState("");
  const [testing, setTesting] = useState(false);
  const cancelRef = useRef(false);

  useEffect(() => {
    if (open) {
      setPhase("confirm");
      setProgress(0);
      setSent(0);
      setFailed(0);
      setResults([]);
      cancelRef.current = false;
    }
  }, [open]);

  if (!broadcast) return null;

  const isSms = broadcast.channel === "sms";
  const blocked = isSms || !whatsappConnected || recipients.length === 0;
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
      const sample = recipients[0] ?? { name: "Имя", phone };
      await sendWhatsAppMessage(phone, renderMessage(broadcast.title, broadcast.message, sample));
      toast.success("Тестовое сообщение отправлено");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось отправить тест");
    } finally {
      setTesting(false);
    }
  };

  const start = async () => {
    cancelRef.current = false;
    setPhase("sending");
    onFinish({ status: "sending" });
    const summary = await runBroadcast({
      channel: broadcast.channel,
      contacts: recipients,
      title: broadcast.title,
      message: broadcast.message,
      shouldCancel: () => cancelRef.current,
      onProgress: ({ index, total, result }) => {
        setProgress(Math.round(((index + 1) / total) * 100));
        setResults((prev) => [...prev, result]);
        if (result.status === "sent") setSent((s) => s + 1);
        else setFailed((f) => f + 1);
      },
    });

    const status: Broadcast["status"] = summary.canceled
      ? "canceled"
      : summary.failed === 0
        ? "sent"
        : summary.sent === 0
          ? "failed"
          : "partial";

    onFinish({
      status,
      sentAt: new Date().toISOString(),
      recipientsCount: recipients.length,
      stats: { total: recipients.length, sent: summary.sent, failed: summary.failed },
      results: summary.results,
    });
    setPhase("done");

    if (summary.canceled) toast("Рассылка остановлена");
    else if (summary.failed === 0) toast.success(`Отправлено ${summary.sent} сообщений`);
    else toast.warning(`Отправлено ${summary.sent}, с ошибкой ${summary.failed}`);
  };

  const preview = renderMessage(broadcast.title, broadcast.message, recipients[0] ?? { name: "Имя" }).replace(
    /\*(.+?)\*/g,
    "$1",
  );

  return (
    <Dialog open={open} onOpenChange={(v) => (phase === "sending" ? null : onOpenChange(v))}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-primary text-primary-foreground shadow-glow">
              <Send className="h-4 w-4" />
            </span>
            {phase === "done" ? "Рассылка завершена" : "Запуск рассылки"}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-1.5">
            <ChannelIcon className="h-3.5 w-3.5" />
            {CHANNEL_META[broadcast.channel].label} · {recipients.length} получателей
          </DialogDescription>
        </DialogHeader>

        {phase === "confirm" && (
          <div className="space-y-3">
            {/* Предупреждения */}
            {isSms && (
              <Banner tone="warning" icon={AlertTriangle}>
                SMS-провайдер ещё не подключён. Сейчас доступна отправка только через WhatsApp.
                Сохраните как запланированную и подключите провайдера позже.
              </Banner>
            )}
            {!isSms && !whatsappConnected && (
              <Banner tone="warning" icon={AlertTriangle}>
                WhatsApp не подключён. Подключите номер в разделе «Подключения», чтобы запустить рассылку.
              </Banner>
            )}
            {!blocked && (
              <Banner tone="muted" icon={AlertTriangle}>
                Это реальная отправка <b>{recipients.length}</b> клиентам через WhatsApp. Сообщения
                уходят с паузой ~1.2с между ними. Перед запуском отправьте тест себе.
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
              <Button
                onClick={start}
                disabled={blocked}
                className="bg-gradient-primary text-primary-foreground"
              >
                <Send className="mr-1.5 h-4 w-4" />
                Отправить {recipients.length}
              </Button>
            </div>
          </div>
        )}

        {phase === "sending" && (
          <div className="space-y-3">
            <Progress value={progress} className="h-2" />
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {sent + failed} из {recipients.length}
              </span>
              <span className="flex items-center gap-3">
                <span className="text-success">✓ {sent}</span>
                {failed > 0 && <span className="text-destructive">✕ {failed}</span>}
              </span>
            </div>
            <div className="max-h-40 space-y-1 overflow-y-auto">
              {results.slice(-8).reverse().map((r, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  {r.status === "sent" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
                  ) : (
                    <X className="h-3.5 w-3.5 shrink-0 text-destructive" />
                  )}
                  <span className="truncate text-muted-foreground">
                    {r.name || r.phone} {r.error ? `· ${r.error}` : ""}
                  </span>
                </div>
              ))}
            </div>
            <Button
              variant="outline"
              onClick={() => {
                cancelRef.current = true;
              }}
              className="w-full"
            >
              Остановить
            </Button>
          </div>
        )}

        {phase === "done" && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-success/40 bg-success/10 p-3 text-center">
                <div className="text-2xl font-bold tabular-nums text-success">{sent}</div>
                <div className="text-[11px] text-muted-foreground">Доставлено</div>
              </div>
              <div className="rounded-xl border border-border/60 bg-card/40 p-3 text-center">
                <div className={cn("text-2xl font-bold tabular-nums", failed > 0 ? "text-destructive" : "")}>{failed}</div>
                <div className="text-[11px] text-muted-foreground">С ошибкой</div>
              </div>
            </div>
            <Button onClick={() => onOpenChange(false)} className="w-full bg-gradient-primary text-primary-foreground">
              Готово
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
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
