import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { GitBranch, Plus, Stethoscope, Trash2 } from "lucide-react";

type Pipeline = { id: string; name: string; is_default: boolean };
type Stage = { id: string; pipeline_id: string; key: string; title: string; order_index: number; is_terminal: boolean; is_diagnostic: boolean; color: string };

export function PipelinesSettings() {
  const { isAdmin } = useAuth();
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [activePipeline, setActivePipeline] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [newStage, setNewStage] = useState("");

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

  return (
    <section className="rounded-2xl border border-border/60 bg-card/40 p-5">
      <div className="mb-4 flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary/15 text-primary">
          <GitBranch className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-base font-semibold">Воронки и стадии</h2>
          <p className="text-xs text-muted-foreground">Стадии Kanban для CRM</p>
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
          <div className="mb-4 flex flex-wrap gap-2">
            {pipelines.map((p) => (
              <button
                key={p.id}
                onClick={() => setActivePipeline(p.id)}
                className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                  activePipeline === p.id ? "border-primary bg-primary/10 text-primary" : "border-border/60 hover:bg-secondary/40"
                }`}
              >
                {p.name}
                {p.is_default && <Badge variant="outline" className="ml-2 text-[9px]">по умолчанию</Badge>}
              </button>
            ))}
          </div>

          <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_auto]">
            <Input
              placeholder="Новая стадия"
              value={newStage}
              onChange={(e) => setNewStage(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addStage()}
              disabled={!isAdmin}
            />
            <Button onClick={addStage} className="gap-2" disabled={!isAdmin}>
              <Plus className="h-4 w-4" /> Добавить стадию
            </Button>
          </div>

          <div className="space-y-1.5">
            {currentStages.map((s, idx) => (
              <div key={s.id} className="grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-3 rounded-lg border border-border/60 bg-background/40 px-3 py-2">
                <span className="grid h-7 w-7 place-items-center rounded-md bg-secondary text-xs font-bold text-muted-foreground">
                  {idx + 1}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm">{s.title}</div>
                  <div className="truncate text-[10px] text-muted-foreground">{s.key}</div>
                </div>
                <button
                  onClick={() => toggleDiagnostic(s.id, !s.is_diagnostic)}
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
                <div className="min-w-[80px] text-right">
                  {s.is_terminal && (
                    <Badge variant="outline" className="text-[9px]">терминальная</Badge>
                  )}
                </div>
                <button
                  onClick={() => removeStage(s.id)}
                  disabled={!isAdmin || s.is_terminal}
                  className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                  aria-label="Удалить"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}