import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCheck, Plus, Send, X, Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing,
  FileText, Mic,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { ChatMessage, Lead } from "@/types/crm";
import { useQuickReplies } from "@/hooks/useQuickReplies";
import { AiSuggestButton } from "../AiSuggestButton";
import { TemplatePicker } from "./TemplatePicker";
import { ChatMediaBubble } from "../ChatMediaBubble";
import { ChatVoiceButton, type VoicePayload } from "../ChatVoiceButton";

interface Props {
  lead: Lead;
  chats: ChatMessage[];
  whatsappConnected: boolean;
  stageTitle?: string;
  onSend: (text: string, opts?: { templateKey?: string }) => void;
  onSendVoice?: (payload: VoicePayload) => void | Promise<void>;
  /** Trigger for the parent to focus chat (e.g. from Action panel "Написать"). */
  focusToken?: number;
  className?: string;
}

type Filter = "all" | "messages" | "calls";

function fmtDateLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, today)) return "Сегодня";
  if (sameDay(d, yest)) return "Вчера";
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "long" });
}

function fmtDuration(sec?: number) {
  if (!sec || sec <= 0) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m} мин${s ? ` ${s} сек` : ""}` : `${s} сек`;
}

export function LeadChatPanel({
  lead, chats, whatsappConnected, stageTitle, onSend, onSendVoice, focusToken, className,
}: Props) {
  const [draft, setDraft] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [voiceMode, setVoiceMode] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { items: quickReplies, add: addReply, remove: removeReply } = useQuickReplies();
  const hasDraft = !!draft.trim();

  const sorted = useMemo(
    () => [...chats].sort((a, b) => a.at.localeCompare(b.at)),
    [chats],
  );

  const filtered = useMemo(() => {
    if (filter === "all") return sorted;
    if (filter === "calls") return sorted.filter((c) => c.kind === "call");
    return sorted.filter((c) => c.kind !== "call");
  }, [sorted, filter]);

  const counts = useMemo(() => {
    let calls = 0, msgs = 0;
    for (const c of sorted) {
      if (c.kind === "call") calls++;
      else msgs++;
    }
    return { all: sorted.length, calls, msgs };
  }, [sorted]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [filtered.length]);

  useEffect(() => {
    if (focusToken) inputRef.current?.focus();
  }, [focusToken]);

  const renderCall = (m: ChatMessage) => {
    const Icon = m.callStatus === "missed"
      ? PhoneMissed
      : m.callStatus === "incoming"
      ? PhoneIncoming
      : m.callStatus === "outgoing"
      ? PhoneOutgoing
      : Phone;
    const label =
      m.callStatus === "missed" ? "Пропущенный звонок"
      : m.callStatus === "incoming" ? "Входящий звонок"
      : "Исходящий звонок";
    const tone =
      m.callStatus === "missed"
        ? "border-destructive/40 bg-destructive/10 text-destructive"
        : "border-border/60 bg-secondary/60 text-foreground";
    const dur = fmtDuration(m.callDurationSec);
    return (
      <div key={m.id} className="flex justify-center">
        <div className={cn("flex items-center gap-2 rounded-full border px-3 py-1 text-[11px]", tone)}>
          <Icon className="h-3.5 w-3.5" />
          <span className="font-semibold">{label}</span>
          {dur && <span className="opacity-70">· {dur}</span>}
          <span className="opacity-60">
            · {new Date(m.at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
      </div>
    );
  };

  // Group items by date for separators
  const groups: { dateKey: string; items: ChatMessage[] }[] = [];
  for (const m of filtered) {
    const k = new Date(m.at).toDateString();
    const last = groups[groups.length - 1];
    if (last && last.dateKey === k) last.items.push(m);
    else groups.push({ dateKey: k, items: [m] });
  }

  const FilterPill = ({ id, label, count }: { id: Filter; label: string; count: number }) => (
    <button
      type="button"
      onClick={() => setFilter(id)}
      className={cn(
        "rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors",
        filter === id
          ? "bg-primary text-primary-foreground"
          : "bg-secondary/60 text-foreground hover:bg-secondary",
      )}
    >
      {label} <span className="opacity-60">{count}</span>
    </button>
  );

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="mb-2 flex shrink-0 flex-wrap items-center gap-1.5">
        <FilterPill id="all" label="Все" count={counts.all} />
        <FilterPill id="messages" label="Сообщения" count={counts.msgs} />
        <FilterPill id="calls" label="Звонки" count={counts.calls} />
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain rounded-xl bg-background/40 px-3 py-3">
        {filtered.length === 0 ? (
          <div className="grid h-full place-items-center text-center text-sm text-muted-foreground">
            {filter === "calls" ? "Звонков пока не было." : "Истории пока нет.\nНапишите или запишите звонок."}
          </div>
        ) : groups.map((g) => (
          <div key={g.dateKey} className="space-y-2">
            <div className="flex items-center justify-center">
              <span className="rounded-full bg-secondary/60 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                {fmtDateLabel(g.items[0].at)}
              </span>
            </div>
            {g.items.map((m) => m.kind === "call" ? renderCall(m) : (
              <div key={m.id} className={cn("flex", m.fromMe ? "justify-end" : "justify-start")}>
                <div className={cn(
                  "max-w-[min(80%,22rem)] rounded-2xl px-3 py-2 text-sm",
                  m.fromMe ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm bg-secondary",
                )}>
                  <ChatMediaBubble message={m} fromMe={m.fromMe} />
                  <div className="mt-1 flex items-center justify-end gap-1 text-[10px] opacity-70">
                    {m.templateKey && <span className="mr-1 rounded bg-background/30 px-1">шаблон</span>}
                    {new Date(m.at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                    {m.fromMe && <CheckCheck className="h-3 w-3" />}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="mt-2 shrink-0 space-y-2 border-t border-border/40 bg-background/95 pt-2 backdrop-blur-sm">
        <div className="flex flex-wrap items-center gap-1.5">
          <TemplatePicker
            lead={lead}
            onPick={(text, key) => {
              setDraft(text);
              inputRef.current?.focus();
              // store template key on next send via wrapping onSend call below
              (inputRef.current as HTMLInputElement & { dataset: DOMStringMap } | null)
                ?.setAttribute("data-template-key", key);
            }}
            trigger={
              <button
                type="button"
                className="inline-flex min-h-8 items-center gap-1 rounded-full border border-border/60 bg-secondary/60 px-2.5 py-1 text-[11px] font-medium hover:bg-secondary"
              >
                <FileText className="h-3 w-3" /> Шаблоны
              </button>
            }
          />
          {quickReplies.map((q, i) => (
            <span key={i} className="group inline-flex min-h-8 items-center gap-1 rounded-full border border-border/60 bg-secondary/60 pl-2.5 pr-1 py-1 text-[11px]">
              <button type="button" onClick={() => setDraft(q)} className="max-w-[180px] truncate text-left">{q}</button>
              <button
                type="button"
                onClick={() => removeReply(i)}
                className="grid h-6 w-6 place-items-center rounded-full opacity-70 transition-opacity hover:bg-secondary md:opacity-0 md:group-hover:opacity-100"
                title="Удалить"
                aria-label="Удалить шаблон"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {draft.trim() && (
            <button type="button" onClick={() => addReply(draft)} className="inline-flex min-h-8 items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary hover:bg-primary/20">
              <Plus className="h-3 w-3" /> в шаблоны
            </button>
          )}
        </div>

        <AiSuggestButton
          messages={sorted.map((c) => ({ fromMe: c.fromMe, text: c.text }))}
          stage={stageTitle}
          leadName={lead.name}
          channel={lead.channel}
          draft={draft}
          rejectReason={lead.rejectReason}
          service={lead.service}
          amount={lead.amount}
          onPick={(text) => setDraft(text)}
        />

        <div className="flex items-end gap-2 pb-[max(0px,env(safe-area-inset-bottom))]">
          {voiceMode && onSendVoice && whatsappConnected ? (
            <>
              <ChatVoiceButton
                key="lead-voice"
                className="min-w-0 flex-1"
                autoStart
                disabled={!whatsappConnected}
                onSend={async (payload) => {
                  try {
                    await onSendVoice(payload);
                    setVoiceMode(false);
                    toast.success("Голосовое отправлено");
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Не удалось отправить голосовое");
                    throw e;
                  }
                }}
              />
              <button
                type="button"
                onClick={() => setVoiceMode(false)}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border/60 text-muted-foreground hover:bg-secondary md:h-10 md:w-10"
                aria-label="К тексту"
              >
                <X className="h-4 w-4" />
              </button>
            </>
          ) : (
            <>
              {onSendVoice && whatsappConnected && !hasDraft && (
                <button
                  type="button"
                  onClick={() => setVoiceMode(true)}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border/60 bg-secondary/50 text-foreground hover:bg-secondary md:h-10 md:w-10"
                  aria-label="Голосовое"
                  title="Голосовое сообщение"
                >
                  <Mic className="h-4 w-4" />
                </button>
              )}
              <Input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    const t = draft.trim();
                    if (!t) return;
                    const tplKey = inputRef.current?.getAttribute("data-template-key") ?? undefined;
                    onSend(t, tplKey ? { templateKey: tplKey } : undefined);
                    inputRef.current?.removeAttribute("data-template-key");
                    setDraft("");
                  }
                }}
                placeholder={whatsappConnected ? "Сообщение… Enter — отправить" : "Подключите WhatsApp"}
                disabled={!whatsappConnected}
                className="h-11 flex-1 text-base md:h-10 md:text-sm"
              />
              <Button
                onClick={() => {
                  const t = draft.trim();
                  if (!t) return;
                  const tplKey = inputRef.current?.getAttribute("data-template-key") ?? undefined;
                  onSend(t, tplKey ? { templateKey: tplKey } : undefined);
                  inputRef.current?.removeAttribute("data-template-key");
                  setDraft("");
                }}
                disabled={!whatsappConnected || !hasDraft}
                className="h-11 w-11 shrink-0 rounded-full bg-gradient-primary p-0 text-primary-foreground md:h-10 md:w-10"
                aria-label="Отправить"
              >
                <Send className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
