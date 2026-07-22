import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CheckCircle2,
  Clock,
  MessageCircle,
  MoreVertical,
  Pencil,
  Send,
  Smartphone,
  Sparkles,
  Trash2,
  Users,
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

const StatTile = ({
  label,
  value,
  hint,
  tone = "primary",
  icon: Icon,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "primary" | "success" | "warning";
  icon: typeof Send;
}) => (
  <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
    <span
      className={cn(
        "grid h-9 w-9 place-items-center rounded-xl ring-1",
        tone === "primary" && "bg-primary/15 text-primary ring-primary/30",
        tone === "success" && "bg-success/15 text-success ring-success/30",
        tone === "warning" && "bg-warning/15 text-warning ring-warning/30",
      )}
    >
      <Icon className="h-4 w-4" />
    </span>
    <div className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
    <div className="mt-0.5 text-2xl font-bold tabular-nums">{value}</div>
    {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
  </div>
);

const Broadcasts = () => {
  const navigate = useNavigate();
  const { activeId } = useProjectsStore();
  const projectId = activeId || null;
  const { contacts: crmContacts } = useLeadContacts();
  const { broadcasts, stats, create, update, remove, launch } = useBroadcasts(projectId, crmContacts);
  const { config: whatsapp } = useWhatsAppConfig();

  const [editing, setEditing] = useState<Broadcast | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sending, setSending] = useState<Broadcast | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Broadcast | null>(null);

  const sorted = useMemo(
    () => [...broadcasts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [broadcasts],
  );

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (b: Broadcast) => {
    setEditing(b);
    setDialogOpen(true);
  };

  const handleSave = async (draft: BroadcastDraft, _recipientsCount: number) => {
    try {
      if (editing) {
        await update(editing.id, draft);
        toast.success("Рассылка обновлена");
      } else {
        await create(draft);
        toast.success(draft.schedule.mode === "scheduled" ? "Рассылка запланирована" : "Рассылка создана");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить рассылку");
    }
  };

  return (
    <main className="flex h-[calc(100vh-3.5rem)] min-h-0 flex-col animate-fade-in-up">
      {/* Header */}
      <header className="border-b border-border/60 bg-background/80 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-primary text-primary-foreground shadow-glow">
              <Send className="h-5 w-5" />
            </span>
            <div className="leading-tight">
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold sm:text-xl">Рассылка</h1>
                <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                  Beta
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground sm:text-xs">
                Массовые сообщения по базе CRM или списку контактов — через WhatsApp и SMS
              </p>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <span
              className={cn(
                "hidden items-center gap-1 rounded-full border px-2 py-1 text-[11px] sm:inline-flex",
                whatsapp.connected
                  ? "border-success/40 bg-success/10 text-success"
                  : "border-warning/40 bg-warning/10 text-warning",
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", whatsapp.connected ? "bg-success" : "bg-warning")} />
              WhatsApp {whatsapp.connected ? "подключён" : "не подключён"}
            </span>
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-glow transition-opacity hover:opacity-90"
            >
              <Send className="h-4 w-4" />
              Создать рассылку
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <section className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4 sm:px-6">
        <div className="mx-auto w-full max-w-[1400px] space-y-4">
          {/* KPI */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label="Всего рассылок" value={String(stats.total)} icon={Send} />
            <StatTile label="Отправлено" value={String(stats.sent)} tone="success" icon={CheckCircle2} />
            <StatTile label="Запланировано" value={String(stats.scheduled)} tone="warning" icon={Clock} />
            <StatTile
              label="Контактов в базе"
              value={String(crmContacts.length)}
              hint="доступно для рассылки"
              tone="primary"
              icon={Users}
            />
          </div>

          {/* Info banner */}
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border/60 bg-card/40 px-4 py-3 text-[11px] text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span>
              WhatsApp-рассылки уходят через ваш подключённый номер.{" "}
              <button
                onClick={() => navigate("/settings/connection")}
                className="font-semibold text-primary underline-offset-2 hover:underline"
              >
                Подключить WhatsApp
              </button>
              . SMS-канал станет доступен после подключения провайдера.
            </span>
          </div>

          {/* List / empty */}
          {sorted.length === 0 ? (
            <div className="grid place-items-center rounded-2xl border border-dashed border-border/60 bg-secondary/20 p-10 text-center">
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary">
                <Send className="h-7 w-7" />
              </span>
              <h3 className="mt-4 text-base font-bold">Рассылок пока нет</h3>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Создайте рассылку: выберите аудиторию из CRM или загрузите свой список, напишите текст
                и отправьте через WhatsApp — сразу или по расписанию.
              </p>
              <button
                onClick={openCreate}
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-gradient-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-glow"
              >
                <Send className="h-4 w-4" />
                Создать первую рассылку
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {sorted.map((b) => (
                <BroadcastRow
                  key={b.id}
                  broadcast={b}
                  onSend={() => setSending(b)}
                  onEdit={() => openEdit(b)}
                  onDelete={() => setPendingDelete(b)}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Dialogs */}
      <BroadcastDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        broadcast={editing}
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

function BroadcastRow({
  broadcast,
  onSend,
  onEdit,
  onDelete,
}: {
  broadcast: Broadcast;
  onSend: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const status = STATUS_META[broadcast.status];
  const ChannelIcon = broadcast.channel === "sms" ? Smartphone : MessageCircle;
  const isDone = broadcast.status === "sent" || broadcast.status === "partial" || broadcast.status === "failed";

  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 p-4 transition-colors hover:border-border">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/30">
          <ChannelIcon className="h-5 w-5" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-bold">{broadcast.name}</span>
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
            <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/40 px-2 py-0.5 text-[10px] font-semibold">
              <ChannelIcon className="h-3 w-3" />
              {CHANNEL_META[broadcast.channel].label}
            </span>
          </div>

          <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
            {broadcast.title ? `${broadcast.title} · ` : ""}
            {broadcast.message || "Текст не задан"}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Users className="h-3 w-3" />
              {broadcast.recipientsCount || broadcast.uploadedContacts.length || "—"} получателей
            </span>
            <span className="inline-flex items-center gap-1">
              {broadcast.audienceSource === "upload" ? "Загруженный список" : "База CRM"}
            </span>
            {broadcast.schedule.mode === "scheduled" && broadcast.schedule.at && (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {new Date(broadcast.schedule.at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}
              </span>
            )}
            {isDone && (
              <span className="inline-flex items-center gap-1 text-success">
                <CheckCircle2 className="h-3 w-3" />
                доставлено {broadcast.stats.sent}
                {broadcast.stats.failed > 0 && (
                  <span className="text-destructive"> · ошибок {broadcast.stats.failed}</span>
                )}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={onSend}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-glow transition-opacity hover:opacity-90"
          >
            <Send className="h-3.5 w-3.5" />
            {isDone ? "Повторить" : "Отправить"}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground">
              <MoreVertical className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="mr-2 h-3.5 w-3.5" /> Изменить
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
                <Trash2 className="mr-2 h-3.5 w-3.5" /> Удалить
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

export default Broadcasts;
