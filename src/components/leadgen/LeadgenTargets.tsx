import { useState } from "react";
import { MapPin, Plus, Stethoscope, Trash2, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { useLeadgenTargets } from "@/hooks/useLeadgenTargets";

function fmtDate(iso: string | null) {
  if (!iso) return "ещё не парсили";
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" });
}

export function LeadgenTargets({ projectId }: { projectId: string | null }) {
  const {
    cities, rubrics, loading,
    toggleCity, toggleRubric, addCity, addRubric, removeCity, removeRubric,
  } = useLeadgenTargets(projectId);
  const [newCity, setNewCity] = useState("");
  const [newRubric, setNewRubric] = useState("");

  const nextCity = cities.find((c) => c.enabled)?.city;

  const onAddCity = async () => {
    try { await addCity(newCity); setNewCity(""); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Не удалось добавить город"); }
  };
  const onAddRubric = async () => {
    try { await addRubric(newRubric, newRubric); setNewRubric(""); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Не удалось добавить направление"); }
  };

  if (loading) {
    return <div className="grid place-items-center py-16 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Парсер каждый прогон берёт <b className="text-foreground">следующий город по кругу</b> (наименее давно парсенный) и собирает по нему все включённые направления.
        {nextCity && <> Следующий на очереди — <b className="text-foreground">{nextCity}</b>.</>}
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Города */}
        <section className="rounded-2xl border border-border/60 bg-card/40 p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-success/15 text-success"><MapPin className="h-4 w-4" /></span>
            <div>
              <h3 className="text-sm font-semibold">Города</h3>
              <p className="text-[11px] text-muted-foreground">{cities.filter((c) => c.enabled).length} из {cities.length} включены</p>
            </div>
          </div>

          <div className="mb-3 flex gap-2">
            <Input value={newCity} onChange={(e) => setNewCity(e.target.value)}
              placeholder="Добавить город…" onKeyDown={(e) => e.key === "Enter" && onAddCity()} className="h-9" />
            <Button size="sm" onClick={onAddCity} className="h-9 gap-1"><Plus className="h-4 w-4" /></Button>
          </div>

          <div className="space-y-1.5">
            {cities.map((c) => (
              <div key={c.id} className="group flex items-center gap-3 rounded-lg border border-border/50 bg-background/40 px-3 py-2">
                <Switch checked={c.enabled} onCheckedChange={(v) => toggleCity(c.id, v)} />
                <span className={`flex-1 text-sm ${c.enabled ? "" : "text-muted-foreground line-through"}`}>{c.city}</span>
                <span className="font-mono text-[10px] text-muted-foreground">{fmtDate(c.last_parsed_at)}</span>
                <button onClick={() => removeCity(c.id)} className="grid h-7 w-7 place-items-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100" aria-label="Удалить">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {cities.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">Добавьте города для парсинга.</p>}
          </div>
        </section>

        {/* Направления */}
        <section className="rounded-2xl border border-border/60 bg-card/40 p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-success/15 text-success"><Stethoscope className="h-4 w-4" /></span>
            <div>
              <h3 className="text-sm font-semibold">Направления</h3>
              <p className="text-[11px] text-muted-foreground">{rubrics.filter((r) => r.enabled).length} из {rubrics.length} включены · рубрики 2ГИС</p>
            </div>
          </div>

          <div className="mb-3 flex gap-2">
            <Input value={newRubric} onChange={(e) => setNewRubric(e.target.value)}
              placeholder="Напр. стоматология…" onKeyDown={(e) => e.key === "Enter" && onAddRubric()} className="h-9" />
            <Button size="sm" onClick={onAddRubric} className="h-9 gap-1"><Plus className="h-4 w-4" /></Button>
          </div>

          <div className="space-y-1.5">
            {rubrics.map((r) => (
              <div key={r.id} className="group flex items-center gap-3 rounded-lg border border-border/50 bg-background/40 px-3 py-2">
                <Switch checked={r.enabled} onCheckedChange={(v) => toggleRubric(r.id, v)} />
                <span className={`flex-1 text-sm ${r.enabled ? "" : "text-muted-foreground line-through"}`}>{r.label}</span>
                <span className="font-mono text-[10px] text-muted-foreground">{r.rubric}</span>
                <button onClick={() => removeRubric(r.id)} className="grid h-7 w-7 place-items-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100" aria-label="Удалить">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {rubrics.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">Добавьте направления (ниши) для парсинга.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
