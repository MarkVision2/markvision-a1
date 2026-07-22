import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Loader2,
  MessageCircle,
  Pencil,
  Send,
  Smartphone,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";
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
  BroadcastFunnelView,
  BroadcastMetricsGrid,
} from "@/components/broadcasts/BroadcastFunnelView";
import { BroadcastDialog } from "@/components/broadcasts/BroadcastDialog";
import { BroadcastSendDialog } from "@/components/broadcasts/BroadcastSendDialog";
import { useBroadcastDetail } from "@/hooks/useBroadcastDetail";
import { useBroadcasts } from "@/hooks/useBroadcasts";
import { useLeadContacts } from "@/hooks/useLeadContacts";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { useWhatsAppConfig } from "@/hooks/useWhatsAppConfig";
import { matchRecipientLeads } from "@/lib/broadcastFunnel";
import { fmtKzt } from "@/lib/format";
import {
  CHANNEL_META,
  STATUS_META,
  type BroadcastDraft,
} from "@/lib/broadcastStore";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<string, string> = {
  queued: "В очереди",
  sent: "Отправлено",
  delivered: "Доставлено",
  read: "Прочитано",
  replied: "Ответил",
  converted: "Конверсия",
  failed: "Ошибка",
  skipped_optout: "Отписка",
};

export default function BroadcastDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { activeId } = useProjectsStore();
  const projectId = activeId || null;
  const { contacts: crmContacts } = useLeadContacts();
  const { update, remove, launch } = useBroadcasts(projectId, crmContacts);
  const { config: whatsapp } = useWhatsAppConfig();
  const { detail, loading, error, refetch } = useBroadcastDetail(id, projectId);

  const [editOpen, setEditOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);

  const matched = useMemo(() => {
    if (!detail) return new Map();
    return matchRecipientLeads(detail.recipients, detail.leads);
  }, [detail]);

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
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-primary text-primary-foreground shadow-glow">
              <ChannelIcon className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-lg font-bold sm:text-xl">{campaign.name}</h1>
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
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground sm:text-sm">
                {campaign.title ? `${campaign.title} · ` : ""}
                {campaign.message || "Текст не задан"}
              </p>
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
        <div className="mx-auto grid w-full max-w-[1400px] gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-4">
            <div>
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-muted-foreground">
                Сводка
              </h2>
              <BroadcastMetricsGrid funnel={funnel} />
            </div>

            <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-muted-foreground">
                Воронка рассылки
              </h2>
              <BroadcastFunnelView funnel={funnel} />
              <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
                Доставка и прочтения — из WhatsApp. Лиды, группа, вебинар и продажи —
                из CRM по связанным контактам (телефон / lead_id). Клики по ссылке
                появятся, когда в тексте будут трекинг-ссылки.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                  Получатели
                </h2>
                <span className="text-[11px] text-muted-foreground">{recipients.length}</span>
              </div>
              <div className="max-h-[70vh] space-y-2 overflow-y-auto pr-1">
                {recipients.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Список пуст</p>
                ) : (
                  recipients.map((r) => {
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
                            <div className="truncate text-[11px] text-muted-foreground">
                              {r.phone}
                            </div>
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
                          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                            <span className="inline-flex items-center gap-1 text-primary">
                              <CheckCircle2 className="h-3 w-3" />
                              CRM
                              {lead.stageKey ? ` · ${lead.stageKey}` : ""}
                            </span>
                            {lead.paid ? (
                              <span className="text-success">
                                оплата {fmtKzt(lead.amount)}
                              </span>
                            ) : null}
                            {lead.webinarStatus ? (
                              <span>вебинар: {lead.webinarStatus}</span>
                            ) : null}
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
