import { useEffect, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Phone, PhoneCall, PhoneMissed, PhoneIncoming, PhoneOutgoing, Loader2, AlertTriangle, ShieldCheck } from "lucide-react";
import { dial, normalizePhone, getTelephonyProvider, type DialProvider } from "@/lib/telephony";
import { toast } from "sonner";

type Direction = "outgoing" | "incoming";
type Status = "answered" | "missed";

export interface CallResult {
  direction: Direction;
  status: Status;
  durationSec?: number;
  note?: string;
}

interface Props {
  trigger: React.ReactNode;
  phone: string;
  onConfirm: (r: CallResult) => void;
  leadId?: string;
  /** Log every dial attempt (success/error) for audit. */
  onAttempt?: (info: { provider: string; ok: boolean; phone?: string; warning?: string; error?: string }) => void;
}

const SKIP_CONFIRM_KEY = "crm.call.skipConfirm.v1";

export function CallDialPopover({ trigger, phone, onConfirm, leadId, onAttempt }: Props) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"dial" | "confirm" | "result">("dial");
  const [dialing, setDialing] = useState(false);
  const [direction, setDirection] = useState<Direction>("outgoing");
  const [status, setStatus] = useState<Status>("answered");
  const [minutes, setMinutes] = useState("");
  const [note, setNote] = useState("");
  const [skipConfirm, setSkipConfirm] = useState<boolean>(() => {
    try { return localStorage.getItem(SKIP_CONFIRM_KEY) === "1"; } catch { return false; }
  });
  const phoneDigits = normalizePhone(phone);
  const [provider, setProvider] = useState<DialProvider>("tel");

  useEffect(() => {
    if (open) getTelephonyProvider().then(setProvider).catch(() => setProvider("tel"));
  }, [open]);

  const reset = () => {
    setStep("dial");
    setDialing(false);
    setDirection("outgoing");
    setStatus("answered");
    setMinutes("");
    setNote("");
  };

  const requestCall = () => {
    if (!phoneDigits) {
      toast.error("У лида нет номера телефона");
      return;
    }
    if (skipConfirm) {
      void performDial();
    } else {
      setStep("confirm");
    }
  };

  const performDial = async () => {
    setDialing(true);
    const r = await dial(phone, { leadId });
    setDialing(false);
    onAttempt?.({
      provider: r.provider,
      ok: r.ok && !r.error,
      phone: phoneDigits,
      warning: r.warning,
      error: r.error,
    });
    if (!r.ok) {
      toast.error(r.error ?? "Не удалось набрать номер");
      setStep("dial");
      return;
    }
    if (r.warning) toast.info(r.warning);
    else toast.success(r.provider === "sipuni" ? "Звонок через Sipuni запущен" : "Открыт системный звонок");
    setStep("result");
  };

  const toggleSkip = (v: boolean) => {
    setSkipConfirm(v);
    try { localStorage.setItem(SKIP_CONFIRM_KEY, v ? "1" : "0"); } catch { /* noop */ }
  };

  const submit = () => {
    const m = parseFloat(minutes.replace(",", "."));
    const durationSec = !isNaN(m) && m > 0 ? Math.round(m * 60) : undefined;
    onConfirm({ direction, status, durationSec, note: note.trim() || undefined });
    setOpen(false);
    reset();
  };

  const Pill = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
        active ? "border-primary/50 bg-primary/10 text-primary" : "border-border/60 bg-background hover:bg-secondary/50",
      )}
    >
      {children}
    </button>
  );

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-3 p-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">
            {step === "dial" ? "Набрать номер" : step === "confirm" ? "Подтвердите звонок" : "Итог звонка"}
          </div>
          <div className="text-[11px] text-muted-foreground">{phone || "—"}</div>
        </div>

        {step === "dial" && (
          <>
            <div className="rounded-lg border border-border/60 bg-secondary/40 p-2 text-[11px] text-muted-foreground">
              <span className="mr-1.5 inline-flex items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                {provider === "sipuni" ? "Sipuni" : provider === "sip" ? "SIP-софтфон" : "Системный"}
              </span>
              {provider === "sipuni"
                ? "Sipuni сначала позвонит вам на внутренний номер, затем соединит с клиентом."
                : provider === "sip"
                ? "Откроется ваш SIP-софтфон (Zoiper/MicroSIP/Sipuni Desktop)."
                : "Откроется системное приложение звонков (мобильный/FaceTime/dialer)."}
            </div>
            <Button
              onClick={requestCall}
              disabled={dialing || !phoneDigits}
              className="w-full bg-gradient-primary text-primary-foreground"
            >
              {dialing ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}
              {dialing ? "Соединяю…" : `Позвонить ${phone || ""}`}
            </Button>
            <button
              type="button"
              onClick={() => setStep("result")}
              className="w-full text-center text-[11px] text-muted-foreground underline-offset-2 hover:underline"
            >
              Записать звонок без набора
            </button>
          </>
        )}

        {step === "confirm" && (
          <>
            <div className="rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-[11px] text-warning">
              <div className="mb-1 flex items-center gap-1.5 font-semibold">
                <AlertTriangle className="h-3.5 w-3.5" /> Точно позвонить?
              </div>
              <div className="text-warning/90">
                Будет инициирован вызов на номер{" "}
                <span className="font-semibold">{phone}</span> через{" "}
                <span className="font-semibold">
                  {provider === "sipuni" ? "Sipuni" : provider === "sip" ? "SIP-софтфон" : "системный звонок"}
                </span>.
                {provider === "sipuni" && " АТС сначала позвонит вам, затем соединит с клиентом."}
              </div>
            </div>
            <label className="flex items-center gap-2 rounded-md bg-secondary/40 px-2 py-1.5 text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                checked={skipConfirm}
                onChange={(e) => toggleSkip(e.target.checked)}
                className="h-3 w-3 cursor-pointer accent-primary"
              />
              <ShieldCheck className="h-3 w-3" />
              Не спрашивать на этом устройстве
            </label>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="flex-1" onClick={() => setStep("dial")} disabled={dialing}>
                Отмена
              </Button>
              <Button
                size="sm"
                className="flex-1 bg-gradient-primary text-primary-foreground"
                onClick={performDial}
                disabled={dialing}
              >
                {dialing ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}
                {dialing ? "Соединяю…" : "Подтвердить"}
              </Button>
            </div>
          </>
        )}

        {step === "result" && (
          <>
            <div>
              <Label className="mb-1.5 block text-[11px] uppercase tracking-wide text-muted-foreground">Направление</Label>
              <div className="flex gap-1.5">
                <Pill active={direction === "outgoing"} onClick={() => setDirection("outgoing")}>
                  <PhoneOutgoing className="h-3.5 w-3.5" /> Исходящий
                </Pill>
                <Pill active={direction === "incoming"} onClick={() => setDirection("incoming")}>
                  <PhoneIncoming className="h-3.5 w-3.5" /> Входящий
                </Pill>
              </div>
            </div>

            <div>
              <Label className="mb-1.5 block text-[11px] uppercase tracking-wide text-muted-foreground">Статус</Label>
              <div className="flex gap-1.5">
                <Pill active={status === "answered"} onClick={() => setStatus("answered")}>
                  <PhoneCall className="h-3.5 w-3.5" /> Отвечен
                </Pill>
                <Pill active={status === "missed"} onClick={() => setStatus("missed")}>
                  <PhoneMissed className="h-3.5 w-3.5" /> Не дозвонились
                </Pill>
              </div>
            </div>

            {status === "answered" && (
              <div>
                <Label className="mb-1.5 block text-[11px] uppercase tracking-wide text-muted-foreground">
                  Длительность (мин)
                </Label>
                <Input
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                  placeholder="например, 3"
                  inputMode="decimal"
                  className="h-8 text-sm"
                />
              </div>
            )}

            <div>
              <Label className="mb-1.5 block text-[11px] uppercase tracking-wide text-muted-foreground">
                Комментарий
              </Label>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 280))}
                placeholder="О чём договорились…"
                rows={2}
                className="text-sm"
              />
            </div>

            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="flex-1" onClick={() => setStep("dial")}>
                <Phone className="h-4 w-4" /> Назад
              </Button>
              <Button onClick={submit} className="flex-1 bg-gradient-primary text-primary-foreground" size="sm">
                Сохранить
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}