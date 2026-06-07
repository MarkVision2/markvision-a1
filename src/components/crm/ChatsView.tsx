import { useMemo, useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  MessageCircle,
  Search,
  Send,
  Phone,
  CheckCheck,
  Sparkles,
  Plus,
  X,
} from "lucide-react";
import type { ChatMessage, Lead, LeadStage, WhatsAppConfig } from "@/types/crm";
import { resolveLeadSource } from "@/lib/leadSource";
import { getStageIcon, stageColorClasses } from "./StageIcon";
import { useQuickReplies } from "@/hooks/useQuickReplies";
import { AiSuggestButton } from "./AiSuggestButton";

interface ChatsViewProps {
  leads: Lead[];
  stages: LeadStage[];
  chats: ChatMessage[];
  whatsapp: WhatsAppConfig;
  onSend: (leadId: string, text: string) => void;
  onConnectWhatsApp: () => void;
}

export function ChatsView({
  leads,
  stages,
  chats,
  whatsapp,
  onSend,
  onConnectWhatsApp,
}: ChatsViewProps) {
  const [activeStageId, setActiveStageId] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [activeLeadId, setActiveLeadId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const isMobile = useIsMobile();
  const { items: quickReplies, add: addReply, remove: removeReply } = useQuickReplies();

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
    return leads.filter((l) => {
      const stageOk = activeStageId === "all" || l.stageId === activeStageId;
      const q = search.trim().toLowerCase();
      const searchOk =
        !q ||
        l.name.toLowerCase().includes(q) ||
        l.phone.toLowerCase().includes(q);
      return stageOk && searchOk;
    });
  }, [leads, activeStageId, search]);

  const activeLead = leads.find((l) => l.id === activeLeadId) ?? null;
  const activeChats = activeLeadId ? (chatsByLeadId.get(activeLeadId) ?? []) : [];
  const stageTitle = stages.find((s) => s.id === activeLead?.stageId)?.title;

  const handleSend = () => {
    const text = draft.trim();
    if (!text || !activeLead) return;
    onSend(activeLead.id, text);
    setDraft("");
  };

  return (
    <div className="rounded-2xl border border-border/60 bg-card/40">
      {/* WhatsApp connection bar */}
      {!whatsapp.connected ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-primary/5 px-4 py-3">
          <div className="flex items-center gap-3 text-sm">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-success/15 text-success ring-1 ring-success/30">
              <MessageCircle className="h-4 w-4" />
            </span>
            <div>
              <div className="font-semibold">WhatsApp Business не подключён</div>
              <div className="text-xs text-muted-foreground">
                Подключите номер, чтобы получать заявки и переписку прямо в CRM.
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
        <div className="flex items-center gap-3 border-b border-border/60 bg-success/5 px-4 py-2.5 text-sm">
          <span className="relative grid h-2.5 w-2.5 place-items-center">
            <span className="absolute h-2.5 w-2.5 animate-ping rounded-full bg-success opacity-60" />
            <span className="h-2 w-2 rounded-full bg-success" />
          </span>
          <span className="text-muted-foreground">
            WhatsApp подключён:{" "}
            <span className="font-semibold text-foreground">
              {whatsapp.phone}
            </span>
          </span>
        </div>
      )}

      {/* status tabs */}
      <div className="flex flex-wrap gap-1 border-b border-border/60 px-3 py-2">
        {stageFilters.map((s) => {
          const active = activeStageId === s.id;
          const count =
            s.id === "all"
              ? leads.length
              : leads.filter((l) => l.stageId === s.id).length;
          return (
            <button
              key={s.id}
              onClick={() => setActiveStageId(s.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
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

      {/* layout */}
      <div className="grid grid-cols-1 md:grid-cols-[300px_1fr]">
        {/* list */}
        <div className={cn("border-b border-border/60 md:border-b-0 md:border-r", isMobile && activeLeadId && "hidden")}>
          <div className="p-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск..."
                className="pl-9"
              />
            </div>
          </div>
          <div className="max-h-[480px] overflow-y-auto px-2 pb-3">
            {filteredLeads.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                Нет чатов
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
                return (
                  <button
                    key={lead.id}
                    onClick={() => setActiveLeadId(lead.id)}
                    className={cn(
                      "mb-1 flex w-full items-start gap-3 rounded-xl px-2.5 py-2 text-left transition-colors",
                      active
                        ? "bg-primary/10 ring-1 ring-primary/30"
                        : "hover:bg-secondary/60",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl ring-1",
                        colors.bg,
                        colors.text,
                        colors.ring,
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold">
                          {lead.name}
                        </span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {stage?.title ?? "—"}
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
                          {last ? last.text : lead.phone}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* chat */}
        <div className={cn("flex min-h-[min(520px,65dvh)] flex-col md:min-h-[520px]", isMobile && !activeLeadId && "hidden")}>
          {activeLead ? (
            <>
              <div className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
                {isMobile && (
                  <button type="button" onClick={() => setActiveLeadId(null)} className="grid h-10 w-10 shrink-0 place-items-center rounded-full hover:bg-secondary" aria-label="Назад к списку">
                    <ArrowLeft className="h-5 w-5" />
                  </button>
                )}
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/15 text-primary">
                  {activeLead.name.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">
                    {activeLead.name}
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Phone className="h-3 w-3" />
                    {activeLead.phone}
                  </div>
                </div>
                <span className="hidden items-center gap-1 rounded-md bg-success/10 px-2 py-1 text-[10px] font-semibold text-success sm:inline-flex">
                  <Sparkles className="h-3 w-3" />
                  AI-агент on
                </span>
              </div>

              <div className="flex-1 space-y-2 overflow-y-auto bg-background/40 px-4 py-4">
                {activeChats.length === 0 && (
                  <div className="grid h-full place-items-center text-center text-sm text-muted-foreground">
                    Сообщений ещё нет.<br />
                    Напишите первым — AI-агент подхватит дальше.
                  </div>
                )}
                {activeChats.map((m) => (
                  <div
                    key={m.id}
                    className={cn(
                      "flex",
                      m.fromMe ? "justify-end" : "justify-start",
                    )}
                  >
                    <div
                      className={cn(
                        "max-w-[70%] rounded-2xl px-3 py-2 text-sm",
                        m.fromMe
                          ? "rounded-br-sm bg-primary text-primary-foreground"
                          : "rounded-bl-sm bg-secondary text-foreground",
                      )}
                    >
                      <div>{m.text}</div>
                      <div
                        className={cn(
                          "mt-1 flex items-center justify-end gap-1 text-[10px] opacity-70",
                        )}
                      >
                        {new Date(m.at).toLocaleTimeString("ru-RU", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {m.fromMe && <CheckCheck className="h-3 w-3" />}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2 border-t border-border/60 px-3 py-3">
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder={
                    whatsapp.connected
                      ? "Сообщение..."
                      : "Подключите WhatsApp, чтобы отправлять"
                  }
                  disabled={!whatsapp.connected}
                />
                <Button
                  onClick={handleSend}
                  disabled={!whatsapp.connected || !draft.trim()}
                  className="bg-gradient-primary text-primary-foreground"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
              {/* Quick replies + AI */}
              <div className="flex flex-col gap-2 border-t border-border/60 px-3 py-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {quickReplies.map((q, i) => (
                    <span key={i} className="group inline-flex items-center gap-1 rounded-full border border-border/60 bg-secondary/60 pl-2.5 pr-1 py-0.5 text-[11px]">
                      <button onClick={() => setDraft(q)} className="max-w-[180px] truncate text-left">
                        {q}
                      </button>
                      <button onClick={() => removeReply(i)} className="opacity-0 transition-opacity group-hover:opacity-100" title="Удалить">
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  {draft.trim() && (
                    <button
                      onClick={() => { addReply(draft); }}
                      className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary hover:bg-primary/20"
                      title="Сохранить как шаблон"
                    >
                      <Plus className="h-3 w-3" /> в шаблоны
                    </button>
                  )}
                </div>
                <AiSuggestButton
                  messages={activeChats.map((c) => ({ fromMe: c.fromMe, text: c.text }))}
                  stage={stageTitle}
                  leadName={activeLead.name}
                  channel={activeLead.channel}
                  onPick={(text) => setDraft(text)}
                />
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
                  Выберите лида из списка слева, чтобы просмотреть переписку и
                  управлять статусом
                </p>
                <div className="mt-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-success" />
                  AI-агент обрабатывает входящие автоматически
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}