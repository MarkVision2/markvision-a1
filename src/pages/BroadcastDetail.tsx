import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  MessageCircle,
  Pencil,
  Repeat2,
  Search,
  Send,
  Smartphone,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  BroadcastConversionStrip,
  BroadcastFunnelView,
  BroadcastHeroKpis,
} from "@/components/broadcasts/BroadcastFunnelView";
import { BroadcastDialog } from "@/components/broadcasts/BroadcastDialog";
import { BroadcastSendDialog } from "@/components/broadcasts/BroadcastSendDialog";
import { useBroadcastDetail } from "@/hooks/useBroadcastDetail";
import { useBroadcasts } from "@/hooks/useBroadcasts";
import { useLeadContacts } from "@/hooks/useLeadContacts";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { useWhatsAppConfig } from "@/hooks/useWhatsAppConfig";
import { matchRecipientLeads } from "@/lib/broadcastFunnel";
import { fetchNonResponders, type FollowUpExcluded, type RecipientRow } from "@/lib/broadcastServer";
import { fmtKzt } from "@/lib/format";
import {
  CHANNEL_META,
  STATUS_META,
  emptyBroadcastDraft,
  type BroadcastDraft,
} from "@/lib/broadcastStore";
import { cn } from "@/lib/utils";

/** Дата в формат <input type="datetime-local"> (локальное время). */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const STATUS_LABEL: Record<string, string> = {
  queued: "В очереди",
  sent: "Отправлено",
  delivered: "Получил",
  read: "Открыл",
  replied: "Ответил",
  converted: "Конверсия",
  failed: "Ошибка",
  skipped_optout: "Отписка",
};

const FILTERS: { id: string; label: string; match: (status: string) => boolean }[] = [
  { id: "all", label: "Все", match: () => true },
  { id: "delivered", label: "Получили", match: (s) => ["delivered", "read", "replied", "converted"].includes(s) },
  { id: "read", label: "Открыли", match: (s) => ["read", "replied", "converted"].includes(s) },
  { id: "replied", label: "Ответили", match: (s) => ["replied", "converted"].includes(s) },
  { id: "failed", label: "Ошибки", match: (s) => s === "failed" },
  { id: "crm", label: "Есть в CRM", match: () => true }, // special: handled below
];

export default function BroadcastDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { activeId } = useProjectsStore();
  const projectId = activeId || null;
  const { contacts: crmContacts } = useLeadContacts();
  const { create, update, remove, launch } = useBroadcasts(projectId, crmContacts);
  const { config: whatsapp } = useWhatsAppConfig();
  const { detail, loading, error, refetch } = useBroadcastDetail(id, projectId);

  const [editOpen, setEditOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");

  // Догоняющая рассылка (вторая волна по не отреагировавшим).
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [followUpBusy, setFollowUpBusy] = useState(false);
  const [followUpRows, setFollowUpRows] = useState<RecipientRow[]>([]);
  const [followUpMeta, setFollowUpMeta] = useState<{ sourceName: string; recipientCount: number; excluded: FollowUpExcluded } | null>(null);
  const [followUpDraft, setFollowUpDraft] = useState<BroadcastDraft | null>(null);

  const matched = useMemo(() => {
    if (!detail) return new Map();
    return matchRecipientLeads(detail.recipients, detail.leads);
  }, [detail]);

  const filteredRecipients = useMemo(() => {
    if (!detail) return [];
    const q = query.trim().toLowerCase();
    return detail.recipients.filter((r) => {
      const lead = matched.get(r.id);
      if (filter === "crm") {
        if (!lead) return false;
      } else {
        const f = FILTERS.find((x) => x.id === filter);
        if (f && !f.match(r.status)) return false;
      }
      if (!q) return true;
      return (
        (r.name || "").toLowerCase().includes(q) ||
        r.phone.toLowerCase().includes(q) ||
        (lead?.stageKey ?? "").toLowerCase().includes(q)
      );
    });
  }, [detail, filter, matched, query]);

  if (loading && !detail) {
    return (
      <PageContainer>
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Загрузка рассылки…
        </div>
      </PageContainer>
    );
  }

  if (!detail || error) {
    return (
      <PageContainer>
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">
          {error || "Рассылка не найдена."}{" "}
          <Link to="/broadcasts" className="underline">
            Вернуться к списку
          </Link>
        </div>
      </PageContainer>
    );
  }

  const { campaign, funnel, recipients } = detail;
  const status = STATUS_META[campaign.status];
  const ChannelIcon = campaign.channel === "sms" ? Smartphone : MessageCircle;
  const isDone =
    campaign.status === "sent" || campaign.status === "partial" || campaign.status === "failed";

  const handleSave = async (draft: BroadcastDraft) => {
    try {
      await update(campaign.id, draft);
      toast.success("Рассылка обновлена");
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить");
    }
  };

  // Собрать не отреагировавших и открыть диалог догоняющей.
  const startFollowUp = async () => {
    if (!projectId || followUpBusy) return;
    setFollowUpBusy(true);
    try {
      const { rows, total, excluded } = await fetchNonResponders(campaign.id, projectId);
      if (total === 0) {
        toast.success("Все получатели уже отреагировали — догонять некого 🎉");
        return;
      }
      const at = new Date(Date.now() + 2 * 86_400_000);
      at.setHours(11, 0, 0, 0); // через 2 дня в 11:00
      setFollowUpRows(rows);
      setFollowUpMeta({ sourceName: campaign.name, recipientCount: total, excluded });
      setFollowUpDraft({
        ...emptyBroadcastDraft(),
        name: `Догоняющая — ${campaign.name}`.slice(0, 80),
        channel: campaign.channel,
        title: campaign.title,
        message: "",
        targetUrl: campaign.targetUrl,
        groupId: campaign.groupId,
        sendPace: campaign.sendPace,
        schedule: { mode: "scheduled", at: toLocalInput(at) },
      });
      setFollowUpOpen(true);
      if (excluded.joined > 0) {
        toast.success(`${total} для дожима · ${excluded.joined} вступивших исключены`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось собрать аудиторию");
    } finally {
      setFollowUpBusy(false);
    }
  };

  const handleFollowUpSave = async (draft: BroadcastDraft) => {
    try {
      await create(draft, { explicitRows: followUpRows, parentCampaignId: campaign.id });
      toast.success(
        draft.schedule.mode === "scheduled" ? "Догоняющая запланирована" : "Догоняющая создана",
      );
      navigate("/broadcasts");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось создать догоняющую");
    }
  };

  return (
    <main className="flex h-[calc(100vh-3.5rem)] min-h-0 flex-col animate-fade-in-up">
      <header className="border-b border-border/60 bg-background/80 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto max-w-[1400px] space-y-3">
          <Button variant="ghost" size="sm" className="gap-1 -ml-2" asChild>
            <Link to="/broadcasts">
              <ArrowLeft className="h-4 w-4" />
              К рассылкам
            </Link>
          </Button>

          <div className="flex flex-wrap items-start gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-primary text-primary-foreground shadow-glow">
              <ChannelIcon className="h-6 w-6" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-xl font-bold sm:text-2xl">{campaign.name}</h1>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                    status.tone === "success" && "bg-success/15 text-success",
                    status.tone === "warning" && "bg-warning/15 text-warning",
                    status.tone === "destructive" && "bg-destructive/15 text-destructive",
                    status.tone === "primary" && "bg-primary/15 text-primary",
                    status.tone === "muted" && "bg-secondary text-muted-foreground",
                  )}
                >
                  {status.label}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 text-[10px] font-semibold">
                  <ChannelIcon className="h-3 w-3" />
                  {CHANNEL_META[campaign.channel].label}
                </span>
                {campaign.parentCampaignId && (
                  <Link
                    to={`/broadcasts/${campaign.parentCampaignId}`}
                    className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary hover:bg-primary/15"
                    title="Открыть исходную рассылку"
                  >
                    <Repeat2 className="h-3 w-3" />
                    Догоняющая
                  </Link>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  {funnel.total} получателей
                </span>
                <span>
                  {campaign.audienceSource === "upload" ? "Загруженный список" : "База CRM"}
                </span>
                {campaign.sentAt && (
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {new Date(campaign.sentAt).toLocaleString("ru-RU", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </span>
                )}
                <Link to="/crm" className="inline-flex items-center gap-1 text-primary hover:underline">
                  <ExternalLink className="h-3 w-3" />
                  CRM
                </Link>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSending(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-glow transition-opacity hover:opacity-90"
              >
                <Send className="h-3.5 w-3.5" />
                {isDone ? "Повторить" : "Отправить"}
              </button>
              {isDone && (
                <button
                  type="button"
                  onClick={startFollowUp}
                  disabled={followUpBusy}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-xs font-semibold text-primary transition-colors hover:bg-primary/10 disabled:opacity-60"
                  title="Вторая волна по тем, кто не отреагировал"
                >
                  {followUpBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Repeat2 className="h-3.5 w-3.5" />
                  )}
                  Догоняющая
                </button>
              )}
              <button
                type="button"
                onClick={() => setEditOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-card/60 px-3 py-2 text-xs font-semibold transition-colors hover:bg-secondary/60"
              >
                <Pencil className="h-3.5 w-3.5" />
                Изменить
              </button>
              <button
                type="button"
                onClick={() => setPendingDelete(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/30 px-3 py-2 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/10"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Удалить
              </button>
            </div>
          </div>
        </div>
      </header>

      <section className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4 sm:px-6">
        <div className="mx-auto w-full max-w-[1400px] space-y-5">
          <div className="space-y-3">
            <BroadcastHeroKpis funnel={funnel} />
            <BroadcastConversionStrip funnel={funnel} />
          </div>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
            <div className="space-y-5">
              <div>
                <BroadcastFunnelView funnel={funnel} />
                <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                  Доставка и открытия — из WhatsApp. Лиды и продажи — из CRM по телефону.
                  Клики появятся при трекинг-ссылках в тексте.
                </p>
              </div>

              <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
                <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
                  Текст сообщения
                </h2>
                {campaign.title ? (
                  <div className="mb-2 text-sm font-semibold">{campaign.title}</div>
                ) : null}
                <pre className="whitespace-pre-wrap break-words rounded-xl border border-border/40 bg-background/40 p-3 text-[13px] leading-relaxed text-foreground/90">
                  {campaign.message || "Текст не задан"}
                </pre>
              </div>
            </div>

            <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                  Получатели
                </h2>
                <span className="text-[11px] text-muted-foreground">
                  {filteredRecipients.length}/{recipients.length}
                </span>
              </div>

              <div className="relative mb-2">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Имя или телефон…"
                  className="h-9 pl-8 text-xs"
                />
              </div>

              <div className="mb-3 flex flex-wrap gap-1">
                {FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setFilter(f.id)}
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors",
                      filter === f.id
                        ? "bg-primary/15 text-primary"
                        : "bg-secondary/60 text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              <div className="max-h-[62vh] space-y-2 overflow-y-auto pr-1">
                {filteredRecipients.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">Никого не найдено</p>
                ) : (
                  filteredRecipients.map((r) => {
                    const lead = matched.get(r.id);
                    const st = STATUS_LABEL[r.status] ?? r.status;
                    return (
                      <div
                        key={r.id}
                        className="rounded-xl border border-border/50 bg-background/40 px-3 py-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold">
                              {r.name || "Без имени"}
                            </div>
                            <div className="truncate text-[11px] text-muted-foreground">{r.phone}</div>
                          </div>
                          <span
                            className={cn(
                              "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                              r.status === "failed" && "bg-destructive/15 text-destructive",
                              r.status === "replied" && "bg-success/15 text-success",
                              r.status === "read" && "bg-primary/15 text-primary",
                              (r.status === "delivered" || r.status === "sent") &&
                                "bg-secondary text-muted-foreground",
                              r.status === "queued" && "bg-secondary text-muted-foreground",
                            )}
                          >
                            {st}
                          </span>
                        </div>
                        {lead ? (
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                            <Link
                              to={`/crm?lead=${lead.id}`}
                              className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
                            >
                              <CheckCircle2 className="h-3 w-3" />
                              Открыть в CRM
                              {lead.stageKey ? ` · ${lead.stageKey}` : ""}
                            </Link>
                            {lead.paid ? (
                              <span className="text-success">оплата {fmtKzt(lead.amount)}</span>
                            ) : null}
                            {lead.webinarStatus ? <span>вебинар: {lead.webinarStatus}</span> : null}
                          </div>
                        ) : null}
                        {r.error ? (
                          <div className="mt-1 text-[10px] text-destructive">{r.error}</div>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      <BroadcastDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        broadcast={campaign}
        crmContacts={crmContacts}
        onSave={handleSave}
      />
      <BroadcastDialog
        open={followUpOpen}
        onOpenChange={setFollowUpOpen}
        broadcast={null}
        crmContacts={crmContacts}
        initialDraft={followUpDraft}
        followUp={followUpMeta}
        onSave={handleFollowUpSave}
      />
      <BroadcastSendDialog
        open={sending}
        onOpenChange={setSending}
        broadcast={campaign}
        whatsappConnected={whatsapp.connected}
        onLaunch={async () => {
          await launch(campaign.id);
          refetch();
        }}
      />
      <AlertDialog open={pendingDelete} onOpenChange={setPendingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить рассылку?</AlertDialogTitle>
            <AlertDialogDescription>
              «{campaign.name}» будет удалена вместе с историей получателей.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                await remove(campaign.id);
                toast.success("Рассылка удалена");
                navigate("/broadcasts");
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
