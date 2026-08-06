import { useEffect, useMemo, useRef, useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  MessageCircle,
  Search,
  Send,
  Phone,
  CheckCheck,
  Plus,
  X,
  Mic,
} from "lucide-react";
import { toast } from "sonner";
import type { ChatMessage, Lead, LeadStage, WhatsAppConfig } from "@/types/crm";
import { resolveLeadSource } from "@/lib/leadSource";
import { getStageIcon, stageColorClasses } from "./StageIcon";
import { useQuickReplies } from "@/hooks/useQuickReplies";
import { AiSuggestButton } from "./AiSuggestButton";
import { ChatMediaBubble, chatPreviewText } from "./ChatMediaBubble";
import { ChatVoiceButton, type VoicePayload } from "./ChatVoiceButton";

interface ChatsViewProps {
  leads: Lead[];
  stages: LeadStage[];
  chats: ChatMessage[];
  whatsapp: WhatsAppConfig;
  onSend: (leadId: string, text: string) => void | Promise<void>;
  onSendVoice?: (leadId: string, payload: VoicePayload) => void | Promise<void>;
  onConnectWhatsApp: () => void;
}

function formatListTime(iso: string | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

export function ChatsView({
  leads,
  stages,
  chats,
  whatsapp,
  onSend,
  onSendVoice,
  onConnectWhatsApp,
}: ChatsViewProps) {
  const [activeStageId, setActiveStageId] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [activeLeadId, setActiveLeadId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const isMobile = useIsMobile();
  const { items: quickReplies, add: addReply, remove: removeReply } = useQuickReplies();
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const chatsByLeadId = useMemo(() => {
    const m = new Map<string, ChatMessage[]>();
    for (const c of chats) {
      const arr = m.get(c.leadId) ?? [];
      arr.push(c);
      m.set(c.leadId, arr);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => a.at.localeCompare(b.at));
    }
    return m;
  }, [chats]);

  const stageFilters = [{ id: "all", title: "Все" }, ...stages];

  const filteredLeads = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = leads.filter((l) => {
      const stageOk = activeStageId === "all" || l.stageId === activeStageId;
      const hasChat = (chatsByLeadId.get(l.id)?.length ?? 0) > 0;
      // Inbox: conversations only. Search also surfaces leads without history (write first).
      const inboxOk = hasChat || !!q;
      const searchOk =
        !q ||
        l.name.toLowerCase().includes(q) ||
        (l.phone ?? "").toLowerCase().includes(q);
      return stageOk && inboxOk && searchOk;
    });
    return list.sort((a, b) => {
      const aLast = chatsByLeadId.get(a.id)?.at(-1)?.at ?? a.lastActivityAt ?? a.createdAt ?? "";
      const bLast = chatsByLeadId.get(b.id)?.at(-1)?.at ?? b.lastActivityAt ?? b.createdAt ?? "";
      return bLast.localeCompare(aLast);
    });
  }, [leads, activeStageId, search, chatsByLeadId]);

  const activeLead = leads.find((l) => l.id === activeLeadId) ?? null;
  const activeChats = activeLeadId ? (chatsByLeadId.get(activeLeadId) ?? []) : [];
  const stageTitle = stages.find((s) => s.id === activeLead?.stageId)?.title;
  const hasDraft = !!draft.trim();

  useEffect(() => {
    setDraft("");
    setVoiceMode(false);
    setSending(false);
  }, [activeLeadId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [activeLeadId, activeChats.length]);

  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [draft]);

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || !activeLead || sending) return;
    setSending(true);
    try {
      await onSend(activeLead.id, text);
      setDraft("");
      requestAnimationFrame(() => composerRef.current?.focus());
    } finally {
      setSending(false);
    }
  };

  const handleVoice = async (payload: VoicePayload) => {
    if (!activeLead || !onSendVoice) return;
    try {
      await onSendVoice(activeLead.id, payload);
      setVoiceMode(false);
      toast.success("Голосовое отправлено");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось отправить голосовое");
      throw e;
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/60 bg-card/40">
      {!whatsapp.connected ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-primary/5 px-4 py-3">
          <div className="flex items-center gap-3 text-sm">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-success/15 text-success ring-1 ring-success/30">
              <MessageCircle className="h-4 w-4" />
            </span>
            <div>
              <div className="font-semibold">WhatsApp не подключён</div>
              <div className="text-xs text-muted-foreground">
                Подключите WhatsApp Web (QR) в Настройках — заявки и переписка появятся здесь.
              </div>
            </div>
          </div>
          <Button
            onClick={onConnectWhatsApp}
            className="bg-gradient-primary text-primary-foreground"
          >
            <MessageCircle className="h-4 w-4" />
            Подключить WhatsApp
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-3 border-b border-border/60 bg-success/5 px-4 py-2 text-sm">
          <span className="relative grid h-2.5 w-2.5 place-items-center">
            <span className="absolute h-2.5 w-2.5 animate-ping rounded-full bg-success opacity-60" />
            <span className="h-2 w-2 rounded-full bg-success" />
          </span>
          <span className="text-muted-foreground">
            WhatsApp:{" "}
            <span className="font-semibold text-foreground">{whatsapp.phone}</span>
          </span>
        </div>
      )}

      <div className="flex gap-1 overflow-x-auto touch-pan-x border-b border-border/60 px-3 py-2 scrollbar-none">
        {stageFilters.map((s) => {
          const active = activeStageId === s.id;
          const count =
            s.id === "all"
              ? filteredLeads.length
              : leads.filter((l) => l.stageId === s.id && (chatsByLeadId.get(l.id)?.length ?? 0) > 0).length;
          return (
            <button
              key={s.id}
              onClick={() => setActiveStageId(s.id)}
              className={cn(
                "flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                active
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-secondary/60",
              )}
            >
              {s.title}
              <span
                className={cn(
                  "rounded-full px-1.5 text-[10px] font-bold",
                  active ? "bg-primary/20" : "bg-secondary/80",
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[320px_1fr]">
        {/* list */}
        <div
          className={cn(
            "flex min-h-0 flex-col border-b border-border/60 md:border-b-0 md:border-r",
            isMobile && activeLeadId && "hidden",
          )}
        >
          <div className="shrink-0 p-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Имя или телефон…"
                className="h-11 pl-9 text-base sm:h-10 sm:text-sm"
              />
            </div>
          </div>
          <div
            ref={listRef}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3"
          >
            {filteredLeads.length === 0 ? (
              <div className="px-3 py-10 text-center text-sm text-muted-foreground">
                {search.trim()
                  ? "Никого не нашли по запросу."
                  : "Нет чатов с сообщениями."}
                <div className="mt-1 text-[11px]">
                  {search.trim()
                    ? "Попробуйте другое имя или телефон."
                    : "Входящие WhatsApp появятся здесь. Чтобы написать первым — найдите лида в поиске."}
                </div>
              </div>
            ) : (
              filteredLeads.map((lead) => {
                const stage = stages.find((s) => s.id === lead.stageId);
                const colors = stageColorClasses(stage?.color ?? "primary");
                const Icon = stage ? getStageIcon(stage) : MessageCircle;
                const leadChats = chatsByLeadId.get(lead.id);
                const last = leadChats?.[leadChats.length - 1];
                const active = activeLeadId === lead.id;
                const sourceMeta = resolveLeadSource(lead);
                const SourceIcon = sourceMeta.Icon;
                const lastAt = last?.at ?? lead.lastActivityAt ?? lead.createdAt;
                return (
                  <button
                    key={lead.id}
                    type="button"
                    onClick={() => setActiveLeadId(lead.id)}
                    className={cn(
                      "mb-1 flex w-full items-start gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors",
                      active
                        ? "bg-primary/10 ring-1 ring-primary/30"
                        : "hover:bg-secondary/60",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-semibold ring-1",
                        colors.bg,
                        colors.text,
                        colors.ring,
                      )}
                    >
                      {(lead.name || "?").slice(0, 1).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold">{lead.name}</span>
                        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                          {formatListTime(lastAt)}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <span
                          className={cn(
                            "inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-semibold",
                            sourceMeta.cls,
                          )}
                          title={sourceMeta.label}
                        >
                          <SourceIcon className="h-2.5 w-2.5" />
                          {sourceMeta.label}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {chatPreviewText(last, lead.phone)}
                        </span>
                      </div>
                      {stage?.title && (
                        <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Icon className="h-3 w-3" />
                          {stage.title}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* chat pane */}
        <div
          className={cn(
            "flex min-h-0 flex-col",
            isMobile && !activeLeadId && "hidden",
            isMobile && activeLeadId && "min-h-[calc(100dvh-10rem)]",
            !isMobile && "min-h-[560px]",
          )}
        >
          {activeLead ? (
            <>
              <div className="flex shrink-0 items-center gap-3 border-b border-border/60 px-3 py-2.5 sm:px-4">
                {isMobile && (
                  <button
                    type="button"
                    onClick={() => setActiveLeadId(null)}
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-full hover:bg-secondary"
                    aria-label="Назад к списку"
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </button>
                )}
                <span className="grid h-10 w-10 place-items-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
                  {activeLead.name.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{activeLead.name}</div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Phone className="h-3 w-3" />
                      {activeLead.phone || "нет номера"}
                    </span>
                    {stageTitle && (
                      <span className="rounded bg-secondary/70 px-1.5 py-0.5 font-medium text-foreground/80">
                        {stageTitle}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain bg-background/50 px-3 py-4 sm:px-4">
                {activeChats.length === 0 && (
                  <div className="grid h-full min-h-[200px] place-items-center text-center text-sm text-muted-foreground">
                    Напишите первым или отправьте голосовое.
                  </div>
                )}
                {activeChats.map((m) => (
                  <div
                    key={m.id}
                    className={cn("flex", m.fromMe ? "justify-end" : "justify-start")}
                  >
                    <div
                      className={cn(
                        "max-w-[min(88%,26rem)] rounded-2xl px-3 py-2 text-sm shadow-sm",
                        m.fromMe
                          ? "rounded-br-md bg-primary text-primary-foreground"
                          : "rounded-bl-md bg-card text-foreground ring-1 ring-border/50",
                      )}
                    >
                      <ChatMediaBubble message={m} fromMe={m.fromMe} />
                      <div className="mt-1 flex items-center justify-end gap-1 text-[10px] opacity-70">
                        {new Date(m.at).toLocaleTimeString("ru-RU", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {m.fromMe && <CheckCheck className="h-3 w-3" />}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>

              <div className="shrink-0 border-t border-border/60 bg-background/95 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-sm">
                {!voiceMode && (
                  <div className="flex flex-col gap-1.5 px-3 pt-2">
                    {(quickReplies.length > 0 || hasDraft) && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {quickReplies.map((q, i) => (
                          <span
                            key={i}
                            className="group inline-flex min-h-8 items-center gap-1 rounded-full border border-border/60 bg-secondary/60 py-1 pl-2.5 pr-1 text-[11px]"
                          >
                            <button
                              type="button"
                              onClick={() => setDraft(q)}
                              className="max-w-[160px] truncate text-left"
                            >
                              {q}
                            </button>
                            <button
                              type="button"
                              onClick={() => removeReply(i)}
                              className="grid h-6 w-6 place-items-center rounded-full opacity-70 hover:bg-secondary md:opacity-0 md:group-hover:opacity-100"
                              aria-label="Удалить шаблон"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        ))}
                        {hasDraft && (
                          <button
                            type="button"
                            onClick={() => addReply(draft)}
                            className="inline-flex min-h-8 items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary hover:bg-primary/20"
                          >
                            <Plus className="h-3 w-3" /> в шаблоны
                          </button>
                        )}
                      </div>
                    )}
                    <AiSuggestButton
                      messages={activeChats.map((c) => ({ fromMe: c.fromMe, text: c.text }))}
                      stage={stageTitle}
                      leadName={activeLead.name}
                      channel={activeLead.channel}
                      onPick={(text) => setDraft(text)}
                    />
                  </div>
                )}

                <div className="flex items-end gap-2 px-3 pb-3 pt-2">
                  {voiceMode && onSendVoice && whatsapp.connected ? (
                    <>
                      <ChatVoiceButton
                        key="voice-rec"
                        className="min-w-0 flex-1"
                        autoStart
                        disabled={!whatsapp.connected || sending}
                        onSend={handleVoice}
                      />
                      <button
                        type="button"
                        onClick={() => setVoiceMode(false)}
                        className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border/60 text-muted-foreground hover:bg-secondary sm:h-10 sm:w-10"
                        aria-label="К тексту"
                        title="Текстовое сообщение"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      {onSendVoice && whatsapp.connected && !hasDraft && (
                        <button
                          type="button"
                          onClick={() => setVoiceMode(true)}
                          className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border/60 bg-secondary/50 text-foreground hover:bg-secondary sm:h-10 sm:w-10"
                          aria-label="Голосовое"
                          title="Голосовое сообщение"
                        >
                          <Mic className="h-4 w-4" />
                        </button>
                      )}
                      <Textarea
                        ref={composerRef}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            void handleSend();
                          }
                        }}
                        placeholder={
                          whatsapp.connected
                            ? "Сообщение… Enter — отправить"
                            : "Подключите WhatsApp"
                        }
                        disabled={!whatsapp.connected || sending}
                        rows={1}
                        className="max-h-[140px] min-h-[44px] flex-1 resize-none overflow-y-auto rounded-2xl px-3 py-2.5 text-base leading-snug sm:min-h-[40px] sm:text-sm"
                      />
                      <Button
                        onClick={() => void handleSend()}
                        disabled={!whatsapp.connected || !hasDraft || sending}
                        className="h-11 w-11 shrink-0 rounded-full bg-gradient-primary p-0 text-primary-foreground sm:h-10 sm:w-10"
                        aria-label="Отправить"
                      >
                        <Send className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="grid flex-1 place-items-center px-8 py-16 text-center">
              <div>
                <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-success/10 text-success">
                  <MessageCircle className="h-7 w-7" />
                </span>
                <h3 className="mt-5 text-lg font-semibold">Выберите диалог</h3>
                <p className="mx-auto mt-2 max-w-xs text-sm text-muted-foreground">
                  Слева — лиды с перепиской. Откройте чат, чтобы ответить текстом или голосом.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
