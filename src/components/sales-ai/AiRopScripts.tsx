import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Check,
  Copy,
  Edit3,
  Filter,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import {
  getScripts,
  newId,
  saveScripts,
  SCRIPT_CATEGORIES,
  subscribeAiRop,
  type RopScript,
  type ScriptCategory,
} from "@/lib/aiRopStorage";
import { useToast } from "@/hooks/use-toast";

export function AiRopScripts({ projectId }: { projectId?: string | null } = {}) {
  const { toast } = useToast();
  const [scripts, setScripts] = useState<RopScript[]>(getScripts);
  const [filter, setFilter] = useState<ScriptCategory | "all">("all");
  const [editing, setEditing] = useState<RopScript | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    setScripts(getScripts());
    return subscribeAiRop("scripts", () => setScripts(getScripts()));
  }, []);



  const filtered = useMemo(() => {
    if (filter === "all") return scripts;
    return scripts.filter((s) => s.category === filter);
  }, [scripts, filter]);

  const persist = (next: RopScript[]) => {
    setScripts(next);
    saveScripts(next);
  };

  const onSave = (s: RopScript) => {
    const exists = scripts.find((x) => x.id === s.id);
    const next = exists
      ? scripts.map((x) => (x.id === s.id ? { ...s, updatedAt: new Date().toISOString() } : x))
      : [s, ...scripts];
    persist(next);
    setEditing(null);
    toast({ title: exists ? "Скрипт обновлён" : "Скрипт добавлен" });
  };

  const onDelete = (id: string) => {
    persist(scripts.filter((s) => s.id !== id));
    toast({ title: "Скрипт удалён" });
  };

  const onCopy = (s: RopScript) => {
    navigator.clipboard.writeText(s.body);
    toast({ title: "Скопировано", description: s.title });
  };

  const onGenerateNew = async () => {
    if (!projectId) {
      toast({
        title: "Нет активного проекта",
        description: "Выберите проект, чтобы РОП мог сохранить скрипт в его библиотеку.",
        variant: "destructive",
      });
      return;
    }
    setGenerating(true);
    try {
      const newScript = await generateScript(scripts, projectId);
      persist([newScript, ...scripts]);
      toast({
        title: "ИИ создал новый скрипт",
        description: newScript.title,
      });
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


  const newScript = () => {
    setEditing({
      id: newId("scr"),
      category: "custom",
      title: "",
      body: "",
      tags: [],
      source: "manual",
      usageCount: 0,
      effectiveness: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  };

  return (
    <div className="space-y-4">
      {/* Заголовок и actions */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border/60 bg-card/60 p-3">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/30">
          <BookOpen className="h-4 w-4" />
        </span>
        <div className="mr-auto">
          <h3 className="text-sm font-bold">Библиотека скриптов</h3>
          <p className="text-[11px] text-muted-foreground">
            {scripts.length} скриптов · {scripts.filter((s) => s.source === "ai").length} от ИИ
          </p>
        </div>
        <button
          onClick={onGenerateNew}
          disabled={generating || !projectId}
          title={!projectId ? "Сначала выберите проект" : undefined}
          className={cn(
            "inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold",
            generating || !projectId
              ? "bg-secondary/60 text-muted-foreground"
              : "bg-primary/15 text-primary hover:bg-primary/25",
          )}
        >
          {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          Сгенерировать ИИ
        </button>
        <button
          onClick={newScript}
          className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-3.5 w-3.5" />
          Добавить
        </button>
      </div>

      {/* Фильтр категорий */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          <Filter className="h-3 w-3" />
          Категория
        </span>
        <CategoryChip active={filter === "all"} onClick={() => setFilter("all")}>
          Все ({scripts.length})
        </CategoryChip>
        {SCRIPT_CATEGORIES.map((c) => {
          const count = scripts.filter((s) => s.category === c.id).length;
          if (count === 0 && filter !== c.id) return null;
          return (
            <CategoryChip key={c.id} active={filter === c.id} onClick={() => setFilter(c.id)}>
              {c.emoji} {c.label} ({count})
            </CategoryChip>
          );
        })}
      </div>

      {/* Список скриптов */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/60 bg-secondary/20 p-10 text-center">
          <BookOpen className="mx-auto h-8 w-8 text-muted-foreground/60" />
          <p className="mt-2 text-sm font-semibold">В этой категории пока пусто</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Добавьте скрипт вручную или попросите ИИ сгенерировать его на основе ваших чатов.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {filtered.map((s) => (
            <ScriptCard
              key={s.id}
              script={s}
              onEdit={() => setEditing(s)}
              onCopy={() => onCopy(s)}
              onDelete={() => onDelete(s.id)}
            />
          ))}
        </div>
      )}

      {editing && (
        <ScriptEditor script={editing} onSave={onSave} onCancel={() => setEditing(null)} />
      )}
    </div>
  );
}

function ScriptCard({
  script,
  onEdit,
  onCopy,
  onDelete,
}: {
  script: RopScript;
  onEdit: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const cat = SCRIPT_CATEGORIES.find((c) => c.id === script.category);
  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
      <div className="flex items-start gap-2">
        <span className="text-base leading-none">{cat?.emoji ?? "📝"}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {cat?.label ?? "Свой"}
            </span>
            {script.source === "ai" && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold text-primary">
                <Sparkles className="h-2.5 w-2.5" />
                AI
              </span>
            )}
            {script.effectiveness !== null && (
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold",
                  script.effectiveness >= 70
                    ? "bg-success/15 text-success"
                    : script.effectiveness >= 40
                      ? "bg-warning/15 text-warning"
                      : "bg-destructive/15 text-destructive",
                )}
              >
                <TrendingUp className="h-2.5 w-2.5" />
                {script.effectiveness}%
              </span>
            )}
          </div>
          <h4 className="mt-1 text-sm font-bold">{script.title}</h4>
        </div>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
        {script.body}
      </p>
      {script.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {script.tags.map((t) => (
            <span
              key={t}
              className="rounded-full bg-secondary/60 px-1.5 py-0.5 text-[10px] text-muted-foreground"
            >
              #{t}
            </span>
          ))}
        </div>
      )}
      <div className="mt-3 flex items-center gap-1.5">
        <button
          onClick={onCopy}
          className="inline-flex items-center gap-1 rounded-lg border border-border/60 px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
        >
          <Copy className="h-3 w-3" />
          Копировать
        </button>
        <button
          onClick={onEdit}
          className="inline-flex items-center gap-1 rounded-lg border border-border/60 px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
        >
          <Edit3 className="h-3 w-3" />
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

function ScriptEditor({
  script,
  onSave,
  onCancel,
}: {
  script: RopScript;
  onSave: (s: RopScript) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<RopScript>(script);
  const [tagInput, setTagInput] = useState("");

  const addTag = () => {
    const t = tagInput.trim().replace(/^#/, "");
    if (!t || draft.tags.includes(t)) return;
    setDraft({ ...draft, tags: [...draft.tags, t] });
    setTagInput("");
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-4 backdrop-blur">
      <div className="w-full max-w-2xl rounded-2xl border border-border/60 bg-card p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold">
            {script.title ? "Редактировать скрипт" : "Новый скрипт"}
          </h3>
          <button onClick={onCancel} className="text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Категория
            </label>
            <select
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value as ScriptCategory })}
              className="mt-1 w-full rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-sm outline-none focus:border-primary/50"
            >
              {SCRIPT_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.emoji} {c.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Название
            </label>
            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="Например: Возражение по сроку лечения"
              className="mt-1 w-full rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-sm outline-none focus:border-primary/50"
            />
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Текст скрипта
            </label>
            <textarea
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              rows={8}
              placeholder="Подсказка: используйте {имя}, {клиника}, {слот_1} как переменные"
              className="mt-1 w-full rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-sm leading-relaxed outline-none focus:border-primary/50"
            />
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Теги
            </label>
            <div className="mt-1 flex flex-wrap gap-1">
              {draft.tags.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 rounded-full bg-secondary/60 px-2 py-0.5 text-[11px]"
                >
                  #{t}
                  <button
                    onClick={() => setDraft({ ...draft, tags: draft.tags.filter((x) => x !== t) })}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTag())}
                placeholder="новый тег…"
                className="flex-1 min-w-[100px] rounded-full bg-background/40 px-2 py-0.5 text-[11px] outline-none focus:bg-background"
              />
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="inline-flex items-center gap-1 rounded-lg border border-border/60 px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
          >
            Отмена
          </button>
          <button
            onClick={() => onSave(draft)}
            disabled={!draft.title.trim() || !draft.body.trim()}
            className={cn(
              "inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold",
              !draft.title.trim() || !draft.body.trim()
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

function CategoryChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors",
        active
          ? "border-primary/40 bg-primary/15 text-primary"
          : "border-border/60 bg-card/40 text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

async function generateScript(
  existing: RopScript[],
  projectId: string | null,
): Promise<RopScript> {
  const { data, error } = await supabase.functions.invoke("ai-rop-generate-script", {
    body: { project_id: projectId ?? undefined },
  });
  if (error) throw error;
  const row = (data ?? {}) as {
    ok?: boolean;
    reason?: string;
    id?: string;
    category?: ScriptCategory;
    title?: string;
    body?: string;
    tags?: string[];
    source?: string;
    created_at?: string;
    updated_at?: string;
  };
  if (row.ok === false) {
    throw new Error(`Недостаточно данных для генерации: ${row.reason ?? "unknown"}`);
  }
  return {
    id: row.id || newId("scr"),
    category:
      row.category && SCRIPT_CATEGORIES.find((c) => c.id === row.category)
        ? row.category
        : "custom",
    title: row.title || "Новый скрипт от ИИ",
    body: row.body || "",
    tags: row.tags ?? [],
    source: "ai",
    usageCount: 0,
    effectiveness: null,
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at || new Date().toISOString(),
  };
}

