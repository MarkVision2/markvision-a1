import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCheck, Plus, Send, X, Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing,
  FileText,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ChatMessage, Lead } from "@/types/crm";
import { useQuickReplies } from "@/hooks/useQuickReplies";
import { AiSuggestButton } from "../AiSuggestButton";
import { TemplatePicker } from "./TemplatePicker";

interface Props {
  lead: Lead;
  chats: ChatMessage[];
  whatsappConnected: boolean;
  stageTitle?: string;
  onSend: (text: string, opts?: { templateKey?: string }) => void;
  /** Trigger for the parent to focus chat (e.g. from Action panel "Написать"). */
  focusToken?: number;
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

export function LeadChatPanel({ lead, chats, whatsappConnected, stageTitle, onSend, focusToken }: Props) {
  const [draft, setDraft] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { items: quickReplies, add: addReply, remove: removeReply } = useQuickReplies();

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
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex items-center gap-1.5">
        <FilterPill id="all" label="Все" count={counts.all} />
        <FilterPill id="messages" label="Сообщения" count={counts.msgs} />
        <FilterPill id="calls" label="Звонки" count={counts.calls} />
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto rounded-xl bg-background/40 px-3 py-3">
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
                  "max-w-[80%] rounded-2xl px-3 py-2 text-sm",
                  m.fromMe ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm bg-secondary",
                )}>
                  <div className="whitespace-pre-wrap">{m.text}</div>
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

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
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
              className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-secondary/60 px-2.5 py-0.5 text-[11px] font-medium hover:bg-secondary"
            >
              <FileText className="h-3 w-3" /> Шаблоны
            </button>
          }
        />
        {quickReplies.map((q, i) => (
          <span key={i} className="group inline-flex items-center gap-1 rounded-full border border-border/60 bg-secondary/60 pl-2.5 pr-1 py-0.5 text-[11px]">
            <button onClick={() => setDraft(q)} className="max-w-[180px] truncate text-left">{q}</button>
            <button onClick={() => removeReply(i)} className="opacity-0 transition-opacity group-hover:opacity-100" title="Удалить">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {draft.trim() && (
          <button onClick={() => addReply(draft)} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary hover:bg-primary/20">
            <Plus className="h-3 w-3" /> в шаблоны
          </button>
        )}
      </div>

      <div className="mt-2">
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
      </div>

      <div className="mt-2 flex items-center gap-2">
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
          placeholder={whatsappConnected ? "Сообщение..." : "Подключите WhatsApp, чтобы отправлять"}
          disabled={!whatsappConnected}
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
          disabled={!whatsappConnected || !draft.trim()}
          className="bg-gradient-primary text-primary-foreground"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
