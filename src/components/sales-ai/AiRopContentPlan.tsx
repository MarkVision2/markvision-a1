import { useEffect, useMemo, useState } from "react";
import {
  Calendar,
  Check,
  CheckCircle2,
  FileText,
  Film,
  Image as ImageIcon,
  Lightbulb,
  Loader2,
  Plus,
  Sparkles,
  Target,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import {
  getContentIdeas,
  newId,
  saveContentIdeas,
  subscribeAiRop,
  type ContentIdea,
} from "@/lib/aiRopStorage";
import { useToast } from "@/hooks/use-toast";

const FORMAT_META: Record<ContentIdea["format"], { label: string; icon: typeof Film; color: string }> = {
  reels: { label: "Reels", icon: Film, color: "text-pink-400" },
  post: { label: "Пост", icon: ImageIcon, color: "text-blue-400" },
  story: { label: "Stories", icon: Calendar, color: "text-purple-400" },
  article: { label: "Статья", icon: FileText, color: "text-amber-400" },
  video: { label: "Видео", icon: Video, color: "text-red-400" },
};

const PRIORITY_META: Record<ContentIdea["priority"], { label: string; color: string }> = {
  high: { label: "High", color: "bg-destructive/15 text-destructive" },
  mid: { label: "Mid", color: "bg-warning/15 text-warning" },
  low: { label: "Low", color: "bg-secondary/60 text-muted-foreground" },
};

const STATUS_META: Record<ContentIdea["status"], { label: string; color: string }> = {
  idea: { label: "Идея", color: "text-muted-foreground" },
  in_progress: { label: "В работе", color: "text-primary" },
  published: { label: "Опубликовано", color: "text-success" },
  rejected: { label: "Отклонено", color: "text-destructive" },
};

export function AiRopContentPlan({ projectId }: { projectId?: string | null } = {}) {
  const { toast } = useToast();
  const [ideas, setIdeas] = useState<ContentIdea[]>(getContentIdeas);
  const [filterStatus, setFilterStatus] = useState<ContentIdea["status"] | "all">("all");
  const [generating, setGenerating] = useState(false);
  const [editing, setEditing] = useState<ContentIdea | null>(null);

  useEffect(() => {
    setIdeas(getContentIdeas());
    return subscribeAiRop("content-ideas", () => setIdeas(getContentIdeas()));
  }, []);


  const persist = (next: ContentIdea[]) => {
    setIdeas(next);
    saveContentIdeas(next);
  };

  const filtered = useMemo(() => {
    if (filterStatus === "all") return ideas;
    return ideas.filter((i) => i.status === filterStatus);
  }, [ideas, filterStatus]);

  const generate = async () => {
    if (!projectId) {
      toast({
        title: "Нет активного проекта",
        description: "Выберите проект, чтобы РОП мог сохранить идею в его контент-план.",
        variant: "destructive",
      });
      return;
    }
    setGenerating(true);
    try {
      const newIdea = await generateIdea(projectId);
      persist([newIdea, ...ideas]);
      toast({ title: "ИИ предложил новую идею", description: newIdea.title });
    } catch (e) {
      toast({
        title: "Ошибка",
        description: e instanceof Error ? e.message : "Не удалось сгенерировать",
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  };

  const onDelete = (id: string) => persist(ideas.filter((i) => i.id !== id));
  const onUpdateStatus = (id: string, status: ContentIdea["status"]) =>
    persist(ideas.map((i) => (i.id === id ? { ...i, status } : i)));

  const newIdea = () => {
    setEditing({
      id: newId("ci"),
      title: "",
      format: "reels",
      hook: "",
      body: "",
      basedOn: "Ручная идея",
      audience: "",
      cta: "",
      priority: "mid",
      status: "idea",
      createdAt: new Date().toISOString(),
    });
  };

  const onSave = (i: ContentIdea) => {
    const exists = ideas.find((x) => x.id === i.id);
    persist(exists ? ideas.map((x) => (x.id === i.id ? i : x)) : [i, ...ideas]);
    setEditing(null);
  };

  const stats = useMemo(() => {
    return {
      total: ideas.length,
      idea: ideas.filter((i) => i.status === "idea").length,
      inProgress: ideas.filter((i) => i.status === "in_progress").length,
      published: ideas.filter((i) => i.status === "published").length,
    };
  }, [ideas]);

  return (
    <div className="space-y-4">
      {/* Заголовок */}
      <div className="rounded-2xl border border-border/60 bg-gradient-to-br from-primary/10 to-card/40 p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/15 text-primary ring-1 ring-primary/30">
            <Lightbulb className="h-5 w-5" />
          </span>
          <div className="flex-1">
            <h3 className="text-base font-bold">Контент-план от ИИ-РОПа</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Идеи для соцсетей рождаются из реальных вопросов и возражений клиентов.
              Чем больше чатов и звонков — тем точнее попадают идеи в боль аудитории.
            </p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2">
          <Stat label="Всего" value={stats.total} />
          <Stat label="Идей" value={stats.idea} />
          <Stat label="В работе" value={stats.inProgress} color="text-primary" />
          <Stat label="Опубликовано" value={stats.published} color="text-success" />
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={generate}
          disabled={generating || !projectId}
          title={!projectId ? "Сначала выберите проект" : undefined}
          className={cn(
            "inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold",
            generating || !projectId
              ? "bg-secondary/60 text-muted-foreground"
              : "bg-primary text-primary-foreground hover:bg-primary/90",
          )}
        >
          {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          Сгенерировать идею
        </button>
        <button
          onClick={newIdea}
          className="inline-flex items-center gap-1 rounded-lg border border-border/60 px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
          Добавить вручную
        </button>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {(["all", "idea", "in_progress", "published"] as const).map((st) => (
            <button
              key={st}
              onClick={() => setFilterStatus(st)}
              className={cn(
                "rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors",
                filterStatus === st
                  ? "border-primary/40 bg-primary/15 text-primary"
                  : "border-border/60 bg-card/40 text-muted-foreground hover:bg-secondary/60",
              )}
            >
              {st === "all" ? "Все" : STATUS_META[st].label}
            </button>
          ))}
        </div>
      </div>

      {/* Список */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/60 bg-secondary/20 p-10 text-center">
          <Lightbulb className="mx-auto h-8 w-8 text-muted-foreground/60" />
          <p className="mt-2 text-sm font-semibold">Пока пусто</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Попросите ИИ сгенерировать идею — он использует данные ваших чатов и звонков.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {filtered.map((idea) => (
            <IdeaCard
              key={idea.id}
              idea={idea}
              onEdit={() => setEditing(idea)}
              onDelete={() => onDelete(idea.id)}
              onUpdateStatus={(s) => onUpdateStatus(idea.id, s)}
            />
          ))}
        </div>
      )}

      {editing && <IdeaEditor idea={editing} onSave={onSave} onCancel={() => setEditing(null)} />}
    </div>
  );
}

function IdeaCard({
  idea,
  onEdit,
  onDelete,
  onUpdateStatus,
}: {
  idea: ContentIdea;
  onEdit: () => void;
  onDelete: () => void;
  onUpdateStatus: (s: ContentIdea["status"]) => void;
}) {
  const f = FORMAT_META[idea.format];
  const p = PRIORITY_META[idea.priority];
  const s = STATUS_META[idea.status];
  const FIcon = f.icon;
  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <FIcon className={cn("h-4 w-4", f.color)} />
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {f.label}
          </span>
          <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-bold", p.color)}>
            {p.label}
          </span>
        </div>
        <span className={cn("text-[10px] font-bold", s.color)}>{s.label}</span>
      </div>
      <h4 className="mt-2 text-sm font-bold">{idea.title}</h4>
      {idea.hook && (
        <div className="mt-2 rounded-lg border border-border/40 bg-background/40 p-2 text-[11px] italic text-muted-foreground">
          💡 {idea.hook}
        </div>
      )}
      <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
        {idea.body}
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]">
        <div>
          <div className="font-bold uppercase tracking-wider text-muted-foreground">Источник</div>
          <div className="mt-0.5 text-muted-foreground">{idea.basedOn}</div>
        </div>
        {idea.audience && (
          <div>
            <div className="font-bold uppercase tracking-wider text-muted-foreground">Аудитория</div>
            <div className="mt-0.5 text-muted-foreground">{idea.audience}</div>
          </div>
        )}
      </div>
      {idea.cta && (
        <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary">
          <Target className="h-3 w-3" />
          {idea.cta}
        </div>
      )}
      <div className="mt-3 flex items-center gap-1.5">
        <select
          value={idea.status}
          onChange={(e) => onUpdateStatus(e.target.value as ContentIdea["status"])}
          className="rounded-lg border border-border/60 bg-background/40 px-2 py-1 text-[11px] outline-none"
        >
          <option value="idea">Идея</option>
          <option value="in_progress">В работе</option>
          <option value="published">Опубликовано</option>
          <option value="rejected">Отклонено</option>
        </select>
        <button
          onClick={onEdit}
          className="inline-flex items-center gap-1 rounded-lg border border-border/60 px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
        >
          Редактировать
        </button>
        <button
          onClick={onDelete}
          className="ml-auto inline-flex items-center gap-1 rounded-lg border border-border/60 px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function IdeaEditor({
  idea,
  onSave,
  onCancel,
}: {
  idea: ContentIdea;
  onSave: (i: ContentIdea) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<ContentIdea>(idea);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-4 backdrop-blur">
      <div className="w-full max-w-2xl rounded-2xl border border-border/60 bg-card p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold">{idea.title ? "Редактировать" : "Новая идея"}</h3>
          <button onClick={onCancel} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3">
          <Field
            label="Заголовок"
            value={draft.title}
            onChange={(v) => setDraft({ ...draft, title: v })}
          />
          <div className="grid grid-cols-2 gap-2">
            <SelectField
              label="Формат"
              value={draft.format}
              onChange={(v) => setDraft({ ...draft, format: v as ContentIdea["format"] })}
              options={Object.entries(FORMAT_META).map(([id, m]) => ({ id, label: m.label }))}
            />
            <SelectField
              label="Приоритет"
              value={draft.priority}
              onChange={(v) => setDraft({ ...draft, priority: v as ContentIdea["priority"] })}
              options={[
                { id: "high", label: "High" },
                { id: "mid", label: "Mid" },
                { id: "low", label: "Low" },
              ]}
            />
          </div>
          <Field
            label="Хук (зацепка)"
            value={draft.hook}
            onChange={(v) => setDraft({ ...draft, hook: v })}
          />
          <Field
            label="Тезисы / содержание"
            value={draft.body}
            onChange={(v) => setDraft({ ...draft, body: v })}
            multiline
          />
          <Field
            label="Аудитория"
            value={draft.audience}
            onChange={(v) => setDraft({ ...draft, audience: v })}
          />
          <Field label="CTA" value={draft.cta} onChange={(v) => setDraft({ ...draft, cta: v })} />
          <Field
            label="Источник идеи"
            value={draft.basedOn}
            onChange={(v) => setDraft({ ...draft, basedOn: v })}
          />
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg border border-border/60 px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
          >
            Отмена
          </button>
          <button
            onClick={() => onSave(draft)}
            disabled={!draft.title.trim()}
            className={cn(
              "inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold",
              !draft.title.trim()
                ? "bg-secondary/60 text-muted-foreground"
                : "bg-primary text-primary-foreground hover:bg-primary/90",
            )}
          >
            <Check className="h-3.5 w-3.5" />
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
}) {
  return (
    <div>
      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
          className="mt-1 w-full rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-sm outline-none focus:border-primary/50"
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 w-full rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-sm outline-none focus:border-primary/50"
        />
      )}
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { id: string; label: string }[];
}) {
  return (
    <div>
      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-sm outline-none focus:border-primary/50"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="rounded-xl border border-border/40 bg-background/40 p-2 text-center">
      <div className={cn("text-lg font-bold tabular-nums", color)}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

async function generateIdea(projectId: string | null): Promise<ContentIdea> {
  const { data, error } = await supabase.functions.invoke("ai-rop-generate-content", {
    body: { project_id: projectId ?? undefined },
  });
  if (error) throw error;
  const row = (data ?? {}) as {
    ok?: boolean;
    reason?: string;
    id?: string;
    title?: string;
    format?: ContentIdea["format"];
    priority?: ContentIdea["priority"];
    hook?: string;
    body?: string;
    audience?: string;
    cta?: string;
    based_on?: string;
    created_at?: string;
  };
  if (row.ok === false) {
    throw new Error(`Недостаточно данных для генерации: ${row.reason ?? "unknown"}`);
  }

  const allowedFormats = ["reels", "post", "story", "article", "video"] as const;
  const format: ContentIdea["format"] =
    row.format && (allowedFormats as readonly string[]).includes(row.format) ? row.format : "reels";
  const priority: ContentIdea["priority"] =
    row.priority === "high" ? "high" : row.priority === "low" ? "low" : "mid";

  return {
    id: row.id || newId("ci"),
    title: row.title || "Идея от ИИ",
    format,
    priority,
    hook: row.hook ?? "",
    body: row.body ?? "",
    audience: row.audience ?? "",
    cta: row.cta ?? "",
    basedOn: row.based_on || "Анализ ИИ",
    status: "idea",
    createdAt: row.created_at || new Date().toISOString(),
  };
}

