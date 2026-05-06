import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Check, ChevronDown, ChevronUp, GitBranch, Pencil, Plus, Stethoscope, Trash2, X } from "lucide-react";

type Pipeline = { id: string; name: string; is_default: boolean };
type Stage = {
  id: string; pipeline_id: string; key: string; title: string;
  order_index: number; is_terminal: boolean; is_diagnostic: boolean; color: string;
};

export function PipelinesSettings() {
  const { isAdmin } = useAuth();
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [activePipeline, setActivePipeline] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [newStage, setNewStage] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const load = async () => {
    setLoading(true);
    const [{ data: ps, error: pe }, { data: ss, error: se }] = await Promise.all([
      supabase.from("pipelines").select("id, name, is_default").order("created_at"),
      supabase.from("pipeline_stages").select("id, pipeline_id, key, title, order_index, is_terminal, is_diagnostic, color").order("order_index"),
    ]);
    if (pe) toast.error(pe.message);
    if (se) toast.error(se.message);
    const piped = (ps ?? []) as Pipeline[];
    setPipelines(piped);
    setStages((ss ?? []) as Stage[]);
    if (!activePipeline && piped.length) {
      setActivePipeline(piped.find((p) => p.is_default)?.id ?? piped[0].id);
    }
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);
  useRealtimeTable("pipelines", () => void load());
  useRealtimeTable("pipeline_stages", () => void load());

  const currentStages = stages.filter((s) => s.pipeline_id === activePipeline);

  const addStage = async () => {
    if (!activePipeline) return;
    const title = newStage.trim();
    if (!title) { toast.error("Введите название стадии"); return; }
    const key = title.toLowerCase().replace(/\s+/g, "_").replace(/[^\w]/g, "").slice(0, 40) || `s_${Date.now()}`;
    const order_index = currentStages.length ? Math.max(...currentStages.map((s) => s.order_index)) + 1 : 0;
    const { error } = await supabase.from("pipeline_stages").insert({
      pipeline_id: activePipeline, key, title, order_index, color: "primary", icon: "zap", is_terminal: false,
    });
    if (error) { toast.error(error.message); return; }
    setNewStage("");
    toast.success("Этап добавлен");
    await load();
  };

  const removeStage = async (id: string) => {
    const { error } = await supabase.from("pipeline_stages").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { setStages((prev) => prev.filter((s) => s.id !== id)); toast.success("Стадия удалена"); }
  };

  const toggleDiagnostic = async (id: string, value: boolean) => {
    const { error } = await supabase.from("pipeline_stages").update({ is_diagnostic: value } as never).eq("id", id);
    if (error) toast.error(error.message);
    else {
      setStages((prev) => prev.map((s) => (s.id === id ? { ...s, is_diagnostic: value } : s)));
      toast.success(value ? "Этап помечен как диагностика" : "Снят флаг диагностики");
    }
  };

  const startRename = (s: Stage) => {
    setRenamingId(s.id);
    setRenameDraft(s.title);
  };

  const commitRename = async () => {
    if (!renamingId) return;
    const title = renameDraft.trim();
    if (!title) { toast.error("Название не может быть пустым"); return; }
    const { error } = await supabase.from("pipeline_stages").update({ title }).eq("id", renamingId);
    if (error) { toast.error(error.message); return; }
    setStages((prev) => prev.map((s) => (s.id === renamingId ? { ...s, title } : s)));
    toast.success("Название сохранено");
    setRenamingId(null);
  };

  const cancelRename = () => setRenamingId(null);

  const moveStage = async (id: string, dir: -1 | 1) => {
    const idx = currentStages.findIndex((s) => s.id === id);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= currentStages.length) return;
    const a = currentStages[idx];
    const b = currentStages[target];
    await Promise.all([
      supabase.from("pipeline_stages").update({ order_index: b.order_index }).eq("id", a.id),
      supabase.from("pipeline_stages").update({ order_index: a.order_index }).eq("id", b.id),
    ]);
    await load();
  };

  return (
    <section className="rounded-2xl border border-border/60 bg-card/40 p-5">
      <div className="mb-4 flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary/15 text-primary">
          <GitBranch className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-base font-semibold">Воронки и стадии</h2>
          <p className="text-xs text-muted-foreground">Управление этапами CRM-воронки</p>
        </div>
      </div>

      {!isAdmin && (
        <div className="mb-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          Только администратор может изменять воронки.
        </div>
      )}

      {loading ? (
        <div className="py-6 text-center text-xs text-muted-foreground">Загрузка…</div>
      ) : pipelines.length === 0 ? (
        <div className="grid place-items-center rounded-xl border border-dashed border-border/60 py-10 text-center text-xs text-muted-foreground">
          Воронки ещё не созданы.
        </div>
      ) : (
        <>
          {/* Pipeline selector */}
          <div className="mb-4 flex flex-wrap gap-2">
            {pipelines.map((p) => (
              <button
                key={p.id}
                onClick={() => setActivePipeline(p.id)}
                className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                  activePipeline === p.id
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border/60 hover:bg-secondary/40"
                }`}
              >
                {p.name}
                {p.is_default && <Badge variant="outline" className="ml-2 text-[9px]">по умолчанию</Badge>}
              </button>
            ))}
          </div>

          {/* Add new stage — admin only */}
          {isAdmin && (
            <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto]">
              <Input
                placeholder="Название нового этапа…"
                value={newStage}
                onChange={(e) => setNewStage(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void addStage()}
              />
              <Button onClick={() => void addStage()} className="gap-2">
                <Plus className="h-4 w-4" /> Добавить этап
              </Button>
            </div>
          )}

          {/* Stage list */}
          <div className="space-y-1.5">
            {currentStages.map((s, idx) => (
              <div
                key={s.id}
                className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-lg border border-border/60 bg-background/40 px-3 py-2"
              >
                {/* Index */}
                <span className="grid h-7 w-7 place-items-center rounded-md bg-secondary text-xs font-bold text-muted-foreground">
                  {idx + 1}
                </span>

                {/* Title / inline rename */}
                <div className="min-w-0">
                  {renamingId === s.id ? (
                    <div className="flex items-center gap-1">
                      <Input
                        autoFocus
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void commitRename();
                          if (e.key === "Escape") cancelRename();
                        }}
                        className="h-7 text-sm"
                      />
                      <button
                        onClick={() => void commitRename()}
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-success/15 text-success hover:bg-success/25"
                        aria-label="Сохранить"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={cancelRename}
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-secondary"
                        aria-label="Отмена"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium">{s.title}</span>
                      <span className="truncate text-[10px] text-muted-foreground">{s.key}</span>
                      {s.is_terminal && (
                        <Badge variant="outline" className="text-[9px]">терминальная</Badge>
                      )}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1">
                  {/* Move up */}
                  <button
                    onClick={() => void moveStage(s.id, -1)}
                    disabled={!isAdmin || idx === 0}
                    className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-secondary disabled:opacity-30"
                    aria-label="Выше"
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  {/* Move down */}
                  <button
                    onClick={() => void moveStage(s.id, 1)}
                    disabled={!isAdmin || idx === currentStages.length - 1}
                    className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-secondary disabled:opacity-30"
                    aria-label="Ниже"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>

                  {/* Diagnostic toggle */}
                  <button
                    onClick={() => void toggleDiagnostic(s.id, !s.is_diagnostic)}
                    disabled={!isAdmin}
                    className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[10px] uppercase tracking-wider transition-colors disabled:opacity-40 ${
                      s.is_diagnostic
                        ? "border-amber-400/60 bg-amber-400/10 text-amber-400"
                        : "border-border/60 text-muted-foreground hover:bg-secondary"
                    }`}
                    title="Считать переход в эту стадию диагностикой"
                  >
                    <Stethoscope className="h-3 w-3" />
                    Диагностика
                  </button>

                  {/* Rename */}
                  <button
                    onClick={() => startRename(s)}
                    disabled={!isAdmin || renamingId === s.id}
                    className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-secondary/60 disabled:opacity-30"
                    aria-label="Переименовать"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>

                  {/* Delete */}
                  <button
                    onClick={() => void removeStage(s.id)}
                    disabled={!isAdmin || s.is_terminal}
                    className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-30"
                    aria-label="Удалить"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}