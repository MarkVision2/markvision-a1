import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bot,
  Instagram,
  MessageCircle,
  MessagesSquare,
  MoreVertical,
  Pause,
  Pencil,
  Play,
  Plug,
  Plus,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { useAiAgents } from "@/hooks/useAiAgents";
import {
  CHANNEL_META,
  STATUS_META,
  type AgentChannel,
  type AiAgent,
} from "@/lib/aiAgentsStore";
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
import { AiAgentDialog } from "@/components/ai-agents/AiAgentDialog";
import { AiAgentTestDialog } from "@/components/ai-agents/AiAgentTestDialog";

const channelIcon: Record<AgentChannel, typeof MessageCircle> = {
  whatsapp: MessageCircle,
  instagram: Instagram,
};

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
  icon: typeof Bot;
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
    <div className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      {label}
    </div>
    <div className="mt-0.5 text-2xl font-bold tabular-nums">{value}</div>
    {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
  </div>
);

const AiAgents = () => {
  const navigate = useNavigate();
  const { activeId } = useProjectsStore();
  const { agents, stats, create, update, setStatus, remove, duplicate } = useAiAgents(activeId || null);

  const [editing, setEditing] = useState<AiAgent | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [testAgent, setTestAgent] = useState<AiAgent | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AiAgent | null>(null);

  const sorted = useMemo(
    () =>
      [...agents].sort((a, b) => {
        const order = { active: 0, paused: 1, draft: 2 };
        return order[a.status] - order[b.status] || a.name.localeCompare(b.name);
      }),
    [agents],
  );

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (agent: AiAgent) => {
    setEditing(agent);
    setDialogOpen(true);
  };

  const handleSave = (draft: Parameters<typeof create>[0]) => {
    if (editing) {
      update(editing.id, draft);
      toast.success("Агент обновлён");
    } else {
      create(draft);
      toast.success("Агент создан");
    }
  };

  const toggleStatus = (agent: AiAgent) => {
    if (agent.status === "active") {
      setStatus(agent.id, "paused");
      toast("Агент поставлен на паузу");
    } else {
      if (!agent.handle.trim()) {
        toast.error(`Укажите подключение (${CHANNEL_META[agent.channel].label}) перед запуском`);
        openEdit(agent);
        return;
      }
      setStatus(agent.id, "active");
      toast.success("Агент запущен — отвечает на входящие");
    }
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    remove(pendingDelete.id);
    toast.success("Агент удалён");
    setPendingDelete(null);
  };

  return (
    <main className="flex h-[calc(100vh-3.5rem)] min-h-0 flex-col animate-fade-in-up">
      {/* Header */}
      <header className="border-b border-border/60 bg-background/80 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-primary text-primary-foreground shadow-glow">
              <Bot className="h-5 w-5" />
            </span>
            <div className="leading-tight">
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold sm:text-xl">AI агенты</h1>
                <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                  Beta
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground sm:text-xs">
                ИИ-ассистенты отвечают на входящие в WhatsApp и Instagram по вашим промтам
              </p>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <span className="hidden items-center gap-1 rounded-full border border-border/60 bg-card/60 px-2 py-1 text-[11px] text-muted-foreground sm:inline-flex">
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
              {stats.active} активны
            </span>
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-glow transition-opacity hover:opacity-90"
            >
              <Plus className="h-4 w-4" />
              Создать агента
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <section className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4 sm:px-6">
        <div className="mx-auto w-full max-w-[1400px] space-y-4">
          {/* KPI */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label="Всего агентов" value={String(stats.total)} icon={Bot} />
            <StatTile
              label="Активных"
              value={String(stats.active)}
              hint={stats.paused ? `${stats.paused} на паузе` : "отвечают на входящие"}
              tone="success"
              icon={Zap}
            />
            <StatTile
              label="Каналов подключено"
              value={String(stats.connectedChannels)}
              hint="WhatsApp · Instagram"
              tone="primary"
              icon={Plug}
            />
            <StatTile
              label="Обработано сообщений"
              value={stats.handled > 0 ? String(stats.handled) : "—"}
              hint={stats.handled > 0 ? `${stats.resolvedPct.toFixed(0)}% закрыто без менеджера` : "пока нет диалогов"}
              tone="warning"
              icon={MessagesSquare}
            />
          </div>

          {/* Info banner */}
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border/60 bg-card/40 px-4 py-3 text-[11px] text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span>
              Агенты отвечают на базе ИИ. Подключите номер WhatsApp и аккаунт Instagram в разделе{" "}
              <button
                onClick={() => navigate("/settings/connection")}
                className="font-semibold text-primary underline-offset-2 hover:underline"
              >
                Подключения
              </button>
              , чтобы входящие вопросы попадали к агенту автоматически.
            </span>
          </div>

          {/* Empty state */}
          {sorted.length === 0 ? (
            <div className="grid place-items-center rounded-2xl border border-dashed border-border/60 bg-secondary/20 p-10 text-center">
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary">
                <Bot className="h-7 w-7" />
              </span>
              <h3 className="mt-4 text-base font-bold">Пока нет ни одного агента</h3>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Создайте ИИ-агента, задайте промт и подключите его к WhatsApp или Instagram — он
                начнёт отвечать на входящие вопросы вместо менеджера.
              </p>
              <button
                onClick={openCreate}
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-gradient-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-glow"
              >
                <Plus className="h-4 w-4" />
                Создать первого агента
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {sorted.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  onTest={() => setTestAgent(agent)}
                  onEdit={() => openEdit(agent)}
                  onToggle={() => toggleStatus(agent)}
                  onDuplicate={() => {
                    duplicate(agent.id);
                    toast.success("Агент скопирован");
                  }}
                  onDelete={() => setPendingDelete(agent)}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Dialogs */}
      <AiAgentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        agent={editing}
        onSave={handleSave}
      />
      <AiAgentTestDialog
        open={!!testAgent}
        onOpenChange={(v) => !v && setTestAgent(null)}
        agent={testAgent}
      />
      <AlertDialog open={!!pendingDelete} onOpenChange={(v) => !v && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить агента?</AlertDialogTitle>
            <AlertDialogDescription>
              «{pendingDelete?.name}» будет удалён без возможности восстановления.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
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

function AgentCard({
  agent,
  onTest,
  onEdit,
  onToggle,
  onDuplicate,
  onDelete,
}: {
  agent: AiAgent;
  onTest: () => void;
  onEdit: () => void;
  onToggle: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const ChannelIcon = channelIcon[agent.channel];
  const status = STATUS_META[agent.status];
  const isActive = agent.status === "active";

  return (
    <div className="flex flex-col rounded-2xl border border-border/60 bg-card/60 p-4 transition-colors hover:border-border">
      {/* Top row */}
      <div className="flex items-start gap-2.5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/30">
          <Bot className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold">{agent.name}</div>
          <div className="truncate text-[11px] text-muted-foreground">{agent.role}</div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground">
            <MoreVertical className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="mr-2 h-3.5 w-3.5" /> Изменить
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onTest}>
              <MessagesSquare className="mr-2 h-3.5 w-3.5" /> Тест диалога
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onDuplicate}>
              <Plus className="mr-2 h-3.5 w-3.5" /> Дублировать
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
              <Trash2 className="mr-2 h-3.5 w-3.5" /> Удалить
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Badges */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/40 px-2 py-0.5 text-[10px] font-semibold">
          <ChannelIcon className="h-3 w-3" />
          {CHANNEL_META[agent.channel].label}
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
            status.tone === "success" && "bg-success/15 text-success",
            status.tone === "warning" && "bg-warning/15 text-warning",
            status.tone === "muted" && "bg-secondary text-muted-foreground",
          )}
        >
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              status.tone === "success" && "bg-success animate-pulse",
              status.tone === "warning" && "bg-warning",
              status.tone === "muted" && "bg-muted-foreground",
            )}
          />
          {status.label}
        </span>
        {agent.handle ? (
          <span className="truncate text-[10px] text-muted-foreground">{agent.handle}</span>
        ) : (
          <span className="text-[10px] text-warning">не подключён</span>
        )}
      </div>

      {/* Prompt preview */}
      <p className="mt-3 line-clamp-3 flex-1 rounded-xl bg-background/40 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
        {agent.systemPrompt || "Промт не задан"}
      </p>

      {/* Stats */}
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Stat label="Диалогов" value={agent.stats.handled} />
        <Stat label="Закрыто" value={agent.stats.resolved} tone="success" />
        <Stat label="Менеджеру" value={agent.stats.handoff} tone="warning" />
      </div>

      {/* Actions */}
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={onToggle}
          className={cn(
            "inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors",
            isActive
              ? "border border-border/60 text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
              : "bg-success/15 text-success hover:bg-success/25",
          )}
        >
          {isActive ? (
            <>
              <Pause className="h-3.5 w-3.5" /> Пауза
            </>
          ) : (
            <>
              <Play className="h-3.5 w-3.5" /> Запустить
            </>
          )}
        </button>
        <button
          onClick={onTest}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border/60 px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-secondary/60"
        >
          <MessagesSquare className="h-3.5 w-3.5" /> Тест
        </button>
        <button
          onClick={onEdit}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border/60 text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
          aria-label="Изменить"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "success" | "warning";
}) {
  return (
    <div className="rounded-lg border border-border/40 bg-background/40 py-1.5">
      <div
        className={cn(
          "text-sm font-bold tabular-nums",
          tone === "success" && "text-success",
          tone === "warning" && "text-warning",
        )}
      >
        {value}
      </div>
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

export default AiAgents;
