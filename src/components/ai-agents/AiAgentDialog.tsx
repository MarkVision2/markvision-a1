import { useEffect, useState } from "react";
import {
  Bot,
  Instagram,
  MessageCircle,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  AGENT_TEMPLATES,
  CHANNEL_META,
  MODEL_OPTIONS,
  emptyAgentDraft,
  newId,
  type AgentChannel,
  type AgentDraft,
  type AiAgent,
} from "@/lib/aiAgentsStore";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Если передан — режим редактирования. */
  agent: AiAgent | null;
  onSave: (draft: AgentDraft) => void;
}

const CHANNELS: { id: AgentChannel; icon: typeof MessageCircle }[] = [
  { id: "whatsapp", icon: MessageCircle },
  { id: "instagram", icon: Instagram },
];

function draftFromAgent(agent: AiAgent): AgentDraft {
  const { id, createdAt, updatedAt, stats, ...rest } = agent;
  void id;
  void createdAt;
  void updatedAt;
  void stats;
  return rest;
}

export function AiAgentDialog({ open, onOpenChange, agent, onSave }: Props) {
  const [draft, setDraft] = useState<AgentDraft>(emptyAgentDraft);

  useEffect(() => {
    if (!open) return;
    setDraft(agent ? draftFromAgent(agent) : emptyAgentDraft());
  }, [open, agent]);

  const patch = <K extends keyof AgentDraft>(key: K, value: AgentDraft[K]) =>
    setDraft((p) => ({ ...p, [key]: value }));

  const applyTemplate = (id: string) => {
    const tpl = AGENT_TEMPLATES.find((t) => t.id === id);
    if (!tpl) return;
    setDraft((p) => ({
      ...p,
      name: p.name || tpl.title,
      role: tpl.role,
      channel: tpl.channel,
      systemPrompt: tpl.systemPrompt,
      greeting: tpl.greeting,
      knowledge: tpl.knowledge.map((k) => ({ id: newId(), ...k })),
    }));
  };

  const addKnowledge = () =>
    patch("knowledge", [...draft.knowledge, { id: newId(), question: "", answer: "" }]);
  const removeKnowledge = (id: string) =>
    patch("knowledge", draft.knowledge.filter((k) => k.id !== id));
  const patchKnowledge = (id: string, field: "question" | "answer", value: string) =>
    patch("knowledge", draft.knowledge.map((k) => (k.id === id ? { ...k, [field]: value } : k)));

  const canSave = draft.name.trim().length > 0 && draft.systemPrompt.trim().length > 0;

  const submit = () => {
    if (!canSave) return;
    onSave({ ...draft, name: draft.name.trim() });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[620px]">
        <DialogHeader className="border-b border-border/60 px-5 py-4">
          <DialogTitle className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-primary text-primary-foreground shadow-glow">
              <Bot className="h-4 w-4" />
            </span>
            {agent ? "Настройка ИИ-агента" : "Новый ИИ-агент"}
          </DialogTitle>
          <DialogDescription>
            Агент отвечает на входящие сообщения в мессенджере по вашему промту и базе знаний.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {/* Шаблоны (только при создании) */}
          {!agent && (
            <Field label="Шаблон для старта" hint="Заполнит роль, промт и приветствие — потом отредактируете">
              <div className="flex flex-wrap gap-1.5">
                {AGENT_TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => applyTemplate(t.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-background/40 px-2.5 py-1.5 text-xs font-medium transition-colors hover:border-primary/50 hover:bg-primary/5"
                  >
                    <span>{t.emoji}</span>
                    {t.title}
                  </button>
                ))}
              </div>
            </Field>
          )}

          {/* Название + роль */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Название агента">
              <input
                value={draft.name}
                onChange={(e) => patch("name", e.target.value)}
                placeholder="Например: Администратор клиники"
                maxLength={60}
                className={inputCls}
              />
            </Field>
            <Field label="Роль / специализация">
              <input
                value={draft.role}
                onChange={(e) => patch("role", e.target.value)}
                placeholder="Администратор клиники"
                maxLength={60}
                className={inputCls}
              />
            </Field>
          </div>

          {/* Канал */}
          <Field label="Канал" hint="Где агент отвечает на входящие">
            <div className="grid grid-cols-2 gap-2">
              {CHANNELS.map((c) => {
                const active = draft.channel === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => patch("channel", c.id)}
                    className={cn(
                      "flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors",
                      active
                        ? "border-primary/60 bg-primary/10 text-primary"
                        : "border-border/60 bg-background/40 text-muted-foreground hover:bg-secondary/40",
                    )}
                  >
                    <c.icon className="h-4 w-4" />
                    {CHANNEL_META[c.id].label}
                  </button>
                );
              })}
            </div>
          </Field>

          {/* Привязка канала */}
          <Field label={`Подключение · ${CHANNEL_META[draft.channel].label}`} hint={CHANNEL_META[draft.channel].hint}>
            <input
              value={draft.handle}
              onChange={(e) => patch("handle", e.target.value)}
              placeholder={CHANNEL_META[draft.channel].placeholder}
              maxLength={64}
              className={inputCls}
            />
          </Field>

          {/* Системный промт */}
          <Field
            label="Промт агента"
            hint="Главные инструкции: кто агент, как общается, что делает с заявкой"
          >
            <textarea
              value={draft.systemPrompt}
              onChange={(e) => patch("systemPrompt", e.target.value)}
              rows={7}
              placeholder="Ты — ИИ-ассистент компании. Отвечай на вопросы клиентов…"
              className={cn(inputCls, "min-h-[140px] resize-y leading-relaxed")}
            />
          </Field>

          {/* Приветствие + fallback */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Приветствие" hint="Первое сообщение в диалоге">
              <textarea
                value={draft.greeting}
                onChange={(e) => patch("greeting", e.target.value)}
                rows={3}
                className={cn(inputCls, "resize-y")}
              />
            </Field>
            <Field label="Если не знает ответа" hint="Запасная фраза / передача менеджеру">
              <textarea
                value={draft.fallback}
                onChange={(e) => patch("fallback", e.target.value)}
                rows={3}
                className={cn(inputCls, "resize-y")}
              />
            </Field>
          </div>

          {/* База знаний */}
          <Field label="База знаний" hint="Частые вопросы и точные ответы — агент будет опираться на них">
            <div className="space-y-2">
              {draft.knowledge.map((k) => (
                <div key={k.id} className="rounded-xl border border-border/60 bg-background/40 p-2.5">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 space-y-1.5">
                      <input
                        value={k.question}
                        onChange={(e) => patchKnowledge(k.id, "question", e.target.value)}
                        placeholder="Вопрос клиента"
                        className={cn(inputCls, "py-1.5 text-xs")}
                      />
                      <textarea
                        value={k.answer}
                        onChange={(e) => patchKnowledge(k.id, "answer", e.target.value)}
                        placeholder="Ответ агента"
                        rows={2}
                        className={cn(inputCls, "resize-y py-1.5 text-xs")}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeKnowledge(k.id)}
                      className="mt-1 text-muted-foreground transition-colors hover:text-destructive"
                      aria-label="Удалить"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={addKnowledge}
                className="inline-flex items-center gap-1 rounded-lg border border-dashed border-border/60 px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" />
                Добавить вопрос-ответ
              </button>
            </div>
          </Field>

          {/* Поведение */}
          <Field label="Поведение">
            <div className="space-y-2">
              <Toggle
                label="Отвечать автоматически на входящие"
                value={draft.autoReply}
                onChange={(v) => patch("autoReply", v)}
              />
              <Toggle
                label="Передавать менеджеру, если вопрос вне базы"
                value={draft.handoffOnUnknown}
                onChange={(v) => patch("handoffOnUnknown", v)}
              />
              <Toggle
                label="Отвечать только в рабочие часы"
                value={draft.workingHours.enabled}
                onChange={(v) => patch("workingHours", { ...draft.workingHours, enabled: v })}
              />
              {draft.workingHours.enabled && (
                <div className="flex items-center gap-2 pl-3 text-xs text-muted-foreground">
                  <span>с</span>
                  <input
                    type="time"
                    value={draft.workingHours.from}
                    onChange={(e) => patch("workingHours", { ...draft.workingHours, from: e.target.value })}
                    className={cn(inputCls, "w-28 py-1")}
                  />
                  <span>до</span>
                  <input
                    type="time"
                    value={draft.workingHours.to}
                    onChange={(e) => patch("workingHours", { ...draft.workingHours, to: e.target.value })}
                    className={cn(inputCls, "w-28 py-1")}
                  />
                </div>
              )}
            </div>
          </Field>

          {/* Модель */}
          <Field label="Режим ответов" hint="Баланс скорости и качества">
            <div className="grid grid-cols-2 gap-2">
              {MODEL_OPTIONS.map((m) => {
                const active = draft.model === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => patch("model", m.id)}
                    className={cn(
                      "rounded-xl border p-2.5 text-left text-xs transition-colors",
                      active
                        ? "border-primary/60 bg-primary/10"
                        : "border-border/60 bg-background/40 hover:bg-secondary/40",
                    )}
                  >
                    <div className="flex items-center gap-1.5 font-semibold">
                      <Sparkles className="h-3.5 w-3.5 text-primary" />
                      {m.label}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">{m.hint}</div>
                  </button>
                );
              })}
            </div>
          </Field>
        </div>

        <DialogFooter className="border-t border-border/60 px-5 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            onClick={submit}
            disabled={!canSave}
            className="bg-gradient-primary text-primary-foreground"
          >
            {agent ? "Сохранить" : "Создать агента"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const inputCls =
  "w-full rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-sm outline-none transition-colors focus:border-primary/50";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div>
        <label className="text-xs font-semibold">{label}</label>
        {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-xs">
      <span>{label}</span>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full transition-colors",
          value ? "bg-primary" : "bg-secondary/80",
        )}
        aria-pressed={value}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-background transition-transform",
            value ? "translate-x-[18px]" : "translate-x-0.5",
          )}
        />
      </button>
    </label>
  );
}
