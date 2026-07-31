import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock,
  Copy,
  MessageCircle,
  MoreVertical,
  Pencil,
  Radio,
  Repeat2,
  Search,
  Send,
  ShoppingCart,
  Smartphone,
  Trash2,
  UserPlus,
  Users,
  Video,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { useLeadContacts } from "@/hooks/useLeadContacts";
import { useBroadcasts } from "@/hooks/useBroadcasts";
import { useWhatsAppConfig } from "@/hooks/useWhatsAppConfig";
import {
  CHANNEL_META,
  STATUS_META,
  type Broadcast,
  type BroadcastDraft,
} from "@/lib/broadcastStore";
import { fetchRecipientContacts } from "@/lib/broadcastServer";
import { funnelStepRate } from "@/lib/broadcastFunnel";
import { fmtNum } from "@/lib/format";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { BroadcastDialog } from "@/components/broadcasts/BroadcastDialog";
import { BroadcastSendDialog } from "@/components/broadcasts/BroadcastSendDialog";
import { BroadcastSafetyPanel } from "@/components/broadcasts/BroadcastSafetyPanel";
import { GroupInviteStatsPanel } from "@/components/broadcasts/GroupInviteStatsPanel";

const Broadcasts = () => {
  const navigate = useNavigate();
  const { activeId } = useProjectsStore();
  const projectId = activeId || null;
  const { contacts: crmContacts } = useLeadContacts();
  const { broadcasts, stats, create, duplicate, update, remove, launch } = useBroadcasts(projectId, crmContacts);
  const { config: whatsapp } = useWhatsAppConfig();

  const [editing, setEditing] = useState<Broadcast | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit" | "duplicate">("create");
  const [seedContacts, setSeedContacts] = useState<{ name: string; phone: string }[]>([]);
  const [sending, setSending] = useState<Broadcast | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Broadcast | null>(null);
  const [query, setQuery] = useState("");

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...broadcasts]
      .filter((b) => {
        if (!q) return true;
        return (
          b.name.toLowerCase().includes(q) ||
          (b.title || "").toLowerCase().includes(q) ||
          (b.message || "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [broadcasts, query]);

  const portfolio = useMemo(
    () => [
      {
        key: "reached",
        label: "Отправлено",
        value: stats.reached,
        hint: "сообщений ушло",
        icon: Send,
        tone: "primary" as const,
      },
      {
        key: "joined",
        label: "В группе",
        value: stats.joined,
        hint: "вступили из рассылок",
        icon: UserPlus,
        tone: "success" as const,
      },
      {
        key: "webinar",
        label: "Вебинар",
        value: stats.webinarAttended,
        hint: "посетили (CRM)",
        icon: Video,
        tone: "primary" as const,
      },
      {
        key: "sales",
        label: "Оплаты",
        value: stats.sales,
        hint: "полные оплаты CRM",
        icon: ShoppingCart,
        tone: "success" as const,
      },
    ],
    [stats],
  );

  const openCreate = () => {
    setEditing(null);
    setDialogMode("create");
    setSeedContacts([]);
    setDialogOpen(true);
  };

  const openEdit = async (b: Broadcast) => {
    setEditing(b);
    setDialogMode("edit");
    try {
      setSeedContacts(await fetchRecipientContacts(b.id));
    } catch {
      setSeedContacts([]);
    }
    setDialogOpen(true);
  };

  const openDuplicate = async (b: Broadcast) => {
    setEditing(b);
    setDialogMode("duplicate");
    try {
      setSeedContacts(await fetchRecipientContacts(b.id));
    } catch {
      setSeedContacts([]);
    }
    setDialogOpen(true);
  };

  const handleSave = async (draft: BroadcastDraft, _recipientsCount: number) => {
    try {
      if (dialogMode === "duplicate") {
        const created = await duplicate(draft);
        if (!created) throw new Error("Не удалось создать копию");
        toast.success(`Копия создана · ${created.recipientsCount} получателей`);
        navigate(`/broadcasts/${created.id}`);
        return;
      }
      if (editing) {
        const locked = !["draft", "scheduled"].includes(editing.status);
        if (locked && draft.audienceSource === "upload") {
          const created = await duplicate({
            ...draft,
            name: draft.name.startsWith("Копия:") ? draft.name : `Копия: ${draft.name}`,
          });
          if (!created) throw new Error("Не удалось создать копию");
          toast.success(`Создана копия с новой базой (${created.recipientsCount} чел.)`);
          navigate(`/broadcasts/${created.id}`);
          return;
        }
        await update(editing.id, draft);
        toast.success("Рассылка обновлена");
      } else {
        const created = await create(draft);
        toast.success(draft.schedule.mode === "scheduled" ? "Рассылка запланирована" : "Рассылка создана");
        if (created) navigate(`/broadcasts/${created.id}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить рассылку");
      throw e;
    }
  };

  const handleSendClick = (b: Broadcast) => {
    const done = b.status === "sent" || b.status === "partial" || b.status === "failed";
    if (done) {
      void openDuplicate(b);
      toast.message("Дублируйте рассылку, добавьте базу и отправьте копию");
      return;
    }
    setSending(b);
  };

  return (
    <main className="relative flex h-[calc(100vh-3.5rem)] min-h-0 flex-col animate-fade-in-up">
      {/* Atmosphere */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(ellipse_at_top,_hsl(162_70%_45%_/_0.14),_transparent_55%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,hsl(var(--border)/0.35)_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--border)/0.35)_1px,transparent_1px)] bg-[size:48px_48px] opacity-[0.35] [mask-image:linear-gradient(to_bottom,black,transparent_70%)]"
      />

      <header className="relative z-10 border-b border-border/50 bg-background/70 px-4 py-4 backdrop-blur-xl sm:px-6">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-end gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/35 bg-primary/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">
                <Radio className="h-3 w-3" />
                WhatsApp · CRM
              </span>
              <span className="rounded-full border border-border/60 bg-card/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Beta
              </span>
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">Рассылка</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Эффективность одной цепочкой: отправка → группа → вебинар → оплата. Цифры живые из WhatsApp и CRM.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-medium",
                whatsapp.connected
                  ? "border-success/40 bg-success/10 text-success"
                  : "border-warning/40 bg-warning/10 text-warning",
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  whatsapp.connected ? "bg-success shadow-[0_0_8px_hsl(var(--success))]" : "bg-warning",
                )}
              />
              WhatsApp {whatsapp.connected ? "онлайн" : "не подключён"}
            </span>
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow transition-transform hover:scale-[1.02] active:scale-[0.98]"
            >
              <Send className="h-4 w-4" />
              Создать рассылку
            </button>
          </div>
        </div>
      </header>

      <section className="relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto w-full max-w-[1400px] space-y-5">
          {/* Portfolio KPIs */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {portfolio.map((k, i) => {
              const Icon = k.icon;
              const prev = i === 0 ? null : portfolio[i - 1].value;
              const rate = prev != null ? funnelStepRate(prev, k.value) : null;
              return (
                <div
                  key={k.key}
                  className={cn(
                    "group relative overflow-hidden rounded-2xl border border-border/60 bg-card/50 p-4 backdrop-blur-sm transition-colors hover:border-primary/40",
                    k.tone === "success" && "hover:border-success/40",
                  )}
                >
                  <div
                    aria-hidden
                    className={cn(
                      "absolute -right-6 -top-6 h-24 w-24 rounded-full opacity-40 blur-2xl transition-opacity group-hover:opacity-70",
                      k.tone === "success" ? "bg-success/25" : "bg-primary/25",
                    )}
                  />
                  <div className="relative flex items-start justify-between gap-2">
                    <span
                      className={cn(
                        "grid h-9 w-9 place-items-center rounded-xl ring-1",
                        k.tone === "success"
                          ? "bg-success/15 text-success ring-success/30"
                          : "bg-primary/15 text-primary ring-primary/30",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    {rate != null ? (
                      <span className="rounded-full border border-border/50 bg-background/40 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                        {rate}%
                      </span>
                    ) : null}
                  </div>
                  <div className="relative mt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {k.label}
                  </div>
                  <div className="relative mt-1 text-3xl font-bold tabular-nums tracking-tight">{fmtNum(k.value)}</div>
                  <div className="relative mt-1 text-[11px] text-muted-foreground">{k.hint}</div>
                </div>
              );
            })}
          </div>

          <GroupInviteStatsPanel />

          {/* Meta strip */}
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <MetaChip icon={Send} label={`${stats.total} рассылок`} />
            <MetaChip icon={CheckCircle2} label={`${stats.sent} завершено`} tone="success" />
            {stats.sending > 0 ? <MetaChip icon={Radio} label={`${stats.sending} идёт сейчас`} tone="warning" /> : null}
            {stats.scheduled > 0 ? <MetaChip icon={CalendarClock} label={`${stats.scheduled} в плане`} /> : null}
            <MetaChip icon={Users} label={`${crmContacts.length} в CRM-базе`} />
            <span className="ml-auto hidden text-[11px] sm:inline">
              Клик по карточке → полный отчёт и воронка
            </span>
          </div>

          <BroadcastSafetyPanel projectId={projectId} />

          {broadcasts.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Кампании
              </h2>
              <div className="relative w-full max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Найти рассылку…"
                  className="h-10 border-border/60 bg-card/40 pl-9 backdrop-blur-sm"
                />
              </div>
            </div>
          ) : null}

          {broadcasts.length === 0 ? (
            <div className="relative overflow-hidden rounded-3xl border border-dashed border-primary/30 bg-card/40 p-10 text-center">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,_hsl(162_70%_45%_/_0.12),_transparent_60%)]"
              />
              <span className="relative mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-gradient-primary text-primary-foreground shadow-glow">
                <Send className="h-7 w-7" />
              </span>
              <h3 className="relative mt-5 text-lg font-bold">Запустите первую рассылку</h3>
              <p className="relative mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                База из CRM или свой список → текст с кнопкой в группу → отправка. Дальше система сама
                считает вступления, вебинар и оплаты.
              </p>
              <button
                type="button"
                onClick={openCreate}
                className="relative mt-5 inline-flex items-center gap-1.5 rounded-xl bg-gradient-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow"
              >
                <Send className="h-4 w-4" />
                Создать рассылку
              </button>
            </div>
          ) : sorted.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/60 bg-secondary/20 p-8 text-center text-sm text-muted-foreground">
              Ничего не найдено по запросу «{query}»
            </div>
          ) : (
            <div className="space-y-3">
              {sorted.map((b) => (
                <BroadcastRow
                  key={b.id}
                  broadcast={b}
                  onOpen={() => navigate(`/broadcasts/${b.id}`)}
                  onSend={() => handleSendClick(b)}
                  onEdit={() => void openEdit(b)}
                  onDuplicate={() => void openDuplicate(b)}
                  onDelete={() => setPendingDelete(b)}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      <BroadcastDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        broadcast={editing}
        mode={dialogMode}
        seedContacts={seedContacts}
        crmContacts={crmContacts}
        onSave={handleSave}
      />
      <BroadcastSendDialog
        open={!!sending}
        onOpenChange={(v) => !v && setSending(null)}
        broadcast={sending}
        whatsappConnected={whatsapp.connected}
        onLaunch={async () => {
          if (sending) await launch(sending.id);
        }}
      />
      <AlertDialog open={!!pendingDelete} onOpenChange={(v) => !v && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить рассылку?</AlertDialogTitle>
            <AlertDialogDescription>
              «{pendingDelete?.name}» будет удалена. История отправки сохранена не будет.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDelete) {
                  remove(pendingDelete.id);
                  toast.success("Рассылка удалена");
                }
                setPendingDelete(null);
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
};

function MetaChip({
  icon: Icon,
  label,
  tone,
}: {
  icon: typeof Send;
  label: string;
  tone?: "success" | "warning";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/40 px-2.5 py-1 font-medium backdrop-blur-sm",
        tone === "success" && "border-success/35 bg-success/10 text-success",
        tone === "warning" && "border-warning/35 bg-warning/10 text-warning",
      )}
    >
      <Icon className="h-3 w-3 shrink-0 opacity-80" />
      {label}
    </span>
  );
}

function BroadcastRow({
  broadcast,
  onOpen,
  onSend,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  broadcast: Broadcast;
  onOpen: () => void;
  onSend: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const status = STATUS_META[broadcast.status];
  const ChannelIcon = broadcast.channel === "sms" ? Smartphone : MessageCircle;
  const isDone = broadcast.status === "sent" || broadcast.status === "partial" || broadcast.status === "failed";
  const showFunnel = isDone || broadcast.status === "sending";
  const total = broadcast.recipientsCount || broadcast.stats.total || 0;

  const sent = broadcast.stats.sent || 0;
  const joined = broadcast.stats.joined ?? 0;
  const webinar = broadcast.stats.webinarAttended ?? 0;
  const sales = broadcast.stats.sales ?? broadcast.stats.converted ?? 0;
  const failed = broadcast.stats.failed || 0;

  const stages = [
    { key: "sent", label: "Отправлено", value: sent, icon: Send, bar: "from-sky-400 to-sky-600" },
    { key: "joined", label: "В группе", value: joined, icon: UserPlus, bar: "from-emerald-400 to-emerald-600" },
    { key: "webinar", label: "Вебинар", value: webinar, icon: Video, bar: "from-teal-400 to-teal-600" },
    { key: "sales", label: "Оплата", value: sales, icon: ShoppingCart, bar: "from-amber-400 to-amber-600" },
  ] as const;
  const maxStage = Math.max(1, ...stages.map((s) => s.value));

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="group relative cursor-pointer overflow-hidden rounded-2xl border border-border/60 bg-card/55 backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/45 hover:bg-card/80 hover:shadow-[0_12px_40px_-20px_hsl(162_70%_45%_/_0.45)]"
    >
      <div
        aria-hidden
        className={cn(
          "absolute inset-y-0 left-0 w-1 transition-all",
          status.tone === "success" && "bg-success",
          status.tone === "warning" && "bg-warning",
          status.tone === "destructive" && "bg-destructive",
          status.tone === "primary" && "bg-primary",
          status.tone === "muted" && "bg-muted-foreground/40",
        )}
      />

      <div className="flex flex-col gap-4 p-4 pl-5 sm:flex-row sm:items-stretch sm:gap-5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/25">
              <ChannelIcon className="h-4 w-4" />
            </span>
            <h3 className="truncate text-base font-bold tracking-tight">{broadcast.name}</h3>
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
              {broadcast.status === "sending" ? (
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
              ) : null}
              {status.label}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/40 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
              <ChannelIcon className="h-3 w-3" />
              {CHANNEL_META[broadcast.channel].label}
            </span>
            {broadcast.parentCampaignId && (
              <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                <Repeat2 className="h-3 w-3" />
                Догоняющая
              </span>
            )}
          </div>

          <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">
            {broadcast.title ? <span className="font-medium text-foreground/80">{broadcast.title} · </span> : null}
            {broadcast.message || "Текст не задан"}
          </p>

          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1 font-medium text-foreground/70">
              <Users className="h-3 w-3" />
              {fmtNum(total)} получателей
            </span>
            <span>{broadcast.audienceSource === "upload" ? "Загруженный список" : "База CRM"}</span>
            {broadcast.schedule.mode === "scheduled" && broadcast.schedule.at ? (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {new Date(broadcast.schedule.at).toLocaleString("ru-RU", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </span>
            ) : null}
            {failed > 0 ? (
              <span className="font-semibold text-destructive">ошибок: {fmtNum(failed)}</span>
            ) : null}
          </div>

          {showFunnel ? (
            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Воронка эффективности
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-primary opacity-80 transition-opacity group-hover:opacity-100">
                  Полный отчёт
                  <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {stages.map((stage, i) => {
                  const Icon = stage.icon;
                  const prev = i === 0 ? null : stages[i - 1].value;
                  const rate = prev != null ? funnelStepRate(prev, stage.value) : null;
                  const width = Math.max(stage.value > 0 ? (stage.value / maxStage) * 100 : 0, stage.value > 0 ? 10 : 0);
                  return (
                    <div
                      key={stage.key}
                      className="rounded-xl border border-border/50 bg-background/35 p-2.5"
                      title={rate != null ? `${stages[i - 1].label} → ${stage.label}: ${rate}%` : undefined}
                    >
                      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        <Icon className="h-3 w-3 shrink-0" />
                        <span className="truncate">{stage.label}</span>
                      </div>
                      <div className="mt-1.5 flex items-baseline justify-between gap-1">
                        <span className="text-xl font-bold tabular-nums leading-none">{fmtNum(stage.value)}</span>
                        {rate != null ? (
                          <span className="text-[10px] font-semibold tabular-nums text-muted-foreground">{rate}%</span>
                        ) : null}
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary/60">
                        <div
                          className={cn("h-full rounded-full bg-gradient-to-r transition-all duration-500", stage.bar)}
                          style={{ width: `${width}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-primary/80">
              Открыть и настроить
              <ChevronRight className="h-3.5 w-3.5" />
            </div>
          )}
        </div>

        <div
          className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-stretch sm:justify-center"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={onSend}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-primary px-3.5 py-2.5 text-xs font-semibold text-primary-foreground shadow-glow transition-opacity hover:opacity-90"
          >
            <Send className="h-3.5 w-3.5" />
            {isDone ? "На новую базу" : "Отправить"}
          </button>
          <div className="flex items-center gap-1 sm:justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger className="grid h-9 w-9 place-items-center rounded-xl border border-border/60 text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground">
                <MoreVertical className="h-4 w-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={onOpen}>Открыть отчёт</DropdownMenuItem>
                <DropdownMenuItem onClick={onDuplicate}>
                  <Copy className="mr-2 h-3.5 w-3.5" /> Дублировать
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onEdit}>
                  <Pencil className="mr-2 h-3.5 w-3.5" /> Изменить
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
                  <Trash2 className="mr-2 h-3.5 w-3.5" /> Удалить
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <ChevronRight className="hidden h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-0.5 sm:block" />
          </div>
        </div>
      </div>
    </article>
  );
}

export default Broadcasts;
