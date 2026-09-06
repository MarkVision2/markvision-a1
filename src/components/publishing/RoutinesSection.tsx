/**
 * «Рутины»: шаги вокруг публикации как данные — проверка аккаунта за N минут до,
 * снятие метрик через N минут/часов после. Назначаются группам (и аккаунтам через
 * меню аккаунта); рутина «по умолчанию» действует на всех остальных.
 */
import { useCallback, useEffect, useState } from "react";
import { ListChecks, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { UsePublishing } from "@/hooks/usePublishing";
import {
  formatOffset,
  publishingApi,
  roleAllows,
  ROUTINE_ACTION_LABELS,
  type PublishRoutine,
  type RoutineAction,
  type RoutineStep,
} from "@/lib/publishingClient";

interface StepDraft { action: RoutineAction; offset: string; unit: "min" | "h" | "d" }
interface Draft { id?: string; name: string; description: string; is_default: boolean; steps: StepDraft[]; group_ids: string[] }

const PRESET: StepDraft[] = [
  { action: "ACCOUNT_HEALTH_CHECK", offset: "-15", unit: "min" },
  { action: "METRICS_SYNC", offset: "20", unit: "min" },
  { action: "METRICS_SYNC", offset: "4", unit: "h" },
  { action: "METRICS_SYNC", offset: "1", unit: "d" },
];

function toMinutes(s: StepDraft): number {
  const n = Number(s.offset);
  return Math.round(n * (s.unit === "d" ? 1440 : s.unit === "h" ? 60 : 1));
}

function fromMinutes(m: number): StepDraft["unit"] {
  return m % 1440 === 0 && m !== 0 ? "d" : m % 60 === 0 && m !== 0 ? "h" : "min";
}

/** Черновик → шаги; ошибка — текст. */
export function stepsFromDraft(steps: StepDraft[]): { ok: true; steps: RoutineStep[] } | { ok: false; error: string } {
  const out: RoutineStep[] = [];
  for (const s of steps) {
    const m = toMinutes(s);
    if (!Number.isFinite(m) || m === 0) return { ok: false, error: "Смещение шага — ненулевое число" };
    if (s.action === "METRICS_SYNC" && m < 0) return { ok: false, error: "Метрики снимаются только после публикации" };
    if (s.action !== "METRICS_SYNC" && m > 0) return { ok: false, error: "Проверки идут до публикации — смещение отрицательное" };
    out.push({ action: s.action, offset_minutes: m });
  }
  if (!out.length) return { ok: false, error: "Добавьте хотя бы один шаг" };
  return { ok: true, steps: out.sort((a, b) => a.offset_minutes - b.offset_minutes) };
}

export function RoutinesSection({ pub }: { pub: UsePublishing }) {
  const projectId = pub.projectId;
  const [routines, setRoutines] = useState<PublishRoutine[]>([]);
  const [groupRoutine, setGroupRoutine] = useState<Map<string, string | null>>(new Map());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) { setRoutines([]); return; }
    try {
      const r = await publishingApi.routineList(projectId);
      setRoutines(r.routines ?? []);
      setGroupRoutine(new Map((r.groups ?? []).map((g) => [g.id, g.routine_id])));
    } catch { /* секция вторична */ }
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);

  const open = (r?: PublishRoutine) => setDraft({
    id: r?.id,
    name: r?.name ?? "IG_STANDARD",
    description: r?.description ?? "",
    is_default: r?.is_default ?? routines.length === 0,
    steps: r ? r.steps.map((s) => { const u = fromMinutes(s.offset_minutes); return { action: s.action, offset: String(s.offset_minutes / (u === "d" ? 1440 : u === "h" ? 60 : 1)), unit: u }; }) : PRESET,
    group_ids: r ? [...groupRoutine.entries()].filter(([, rid]) => rid === r.id).map(([gid]) => gid) : [],
  });

  const save = async () => {
    if (!draft || !projectId) return;
    if (!draft.name.trim()) { toast.error("Название обязательно"); return; }
    const parsed = stepsFromDraft(draft.steps);
    if (parsed.ok === false) { toast.error(parsed.error); return; }
    setBusy(true);
    try {
      const r = await publishingApi.routineUpsert(projectId, { routine_id: draft.id, name: draft.name.trim(), description: draft.description.trim() || null, steps: parsed.steps, is_default: draft.is_default });
      const previously = [...groupRoutine.entries()].filter(([, rid]) => rid === r.routine.id).map(([gid]) => gid);
      const toUnset = previously.filter((g) => !draft.group_ids.includes(g));
      if (draft.group_ids.length) await publishingApi.routineAssign(projectId, r.routine.id, { group_ids: draft.group_ids });
      if (toUnset.length) await publishingApi.routineAssign(projectId, null, { group_ids: toUnset });
      toast.success("Рутина сохранена");
      setDraft(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: PublishRoutine) => {
    if (!projectId) return;
    setBusy(true);
    try { await publishingApi.routineDelete(projectId, r.id); toast.success("Рутина удалена"); await load(); } catch (e) { toast.error(e instanceof Error ? e.message : "Ошибка"); } finally { setBusy(false); }
  };

  if (!projectId) return null;
  const canManage = roleAllows(pub.role, "manage");

  return (
    <section className="rounded-2xl border p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold"><ListChecks className="h-4 w-4" /> Рутины</h3>
          <p className="text-xs text-muted-foreground">Что происходит вокруг каждой публикации: проверка аккаунта до, снятие метрик после. Шаги ставятся в очередь задач автоматически при создании и после публикации задания.</p>
        </div>
        {canManage && <Button size="sm" onClick={() => open()}><Plus className="mr-1 h-4 w-4" /> Новая рутина</Button>}
      </div>
      {!routines.length ? <p className="text-sm text-muted-foreground">Рутин нет — публикации идут без дополнительных проверок и ранних метрик (стандартные точки h1/h6/d1/d3/d7 снимаются всегда).</p> : (
        <ul className="divide-y rounded-xl border">
          {routines.map((r) => {
            const groups = [...groupRoutine.entries()].filter(([, rid]) => rid === r.id).map(([gid]) => pub.groups.find((g) => g.id === gid)?.name ?? "группа");
            return (
              <li key={r.id} className="flex flex-wrap items-start gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <button type="button" className="hover:underline" onClick={() => canManage && open(r)}>{r.name}</button>
                    {r.is_default && <Badge variant="outline" className="border-transparent bg-sky-500/10 text-sky-700 dark:text-sky-300">по умолчанию</Badge>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                    {r.steps.map((s, i) => <span key={i} className="rounded-full bg-muted px-2 py-0.5">{ROUTINE_ACTION_LABELS[s.action]} {formatOffset(s.offset_minutes)}</span>)}
                  </div>
                  {groups.length > 0 && <div className="mt-1 text-xs text-muted-foreground">Группы: {groups.join(", ")}</div>}
                </div>
                {canManage && <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" disabled={busy} aria-label={`Удалить ${r.name}`} onClick={() => void remove(r)}><Trash2 className="h-3.5 w-3.5" /></Button>}
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={Boolean(draft)} onOpenChange={(o) => { if (!o) setDraft(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{draft?.id ? "Рутина" : "Новая рутина"}</DialogTitle><DialogDescription>Отрицательное смещение — до публикации, положительное — после.</DialogDescription></DialogHeader>
          {draft && (
            <div className="grid gap-3">
              <div className="grid gap-1.5"><Label htmlFor="r-name">Название</Label><Input id="r-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></div>
              <div className="grid gap-1.5"><Label htmlFor="r-desc">Описание</Label><Input id="r-desc" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></div>
              <div className="grid gap-1.5">
                <Label>Шаги</Label>
                {draft.steps.map((s, i) => (
                  <div key={i} className="grid grid-cols-[1fr_80px_90px_32px] items-center gap-2">
                    <Select value={s.action} onValueChange={(v) => setDraft({ ...draft, steps: draft.steps.map((x, j) => j === i ? { ...x, action: v as RoutineAction } : x) })}>
                      <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>{(Object.keys(ROUTINE_ACTION_LABELS) as RoutineAction[]).map((a) => <SelectItem key={a} value={a}>{ROUTINE_ACTION_LABELS[a]}</SelectItem>)}</SelectContent>
                    </Select>
                    <Input className="h-8" value={s.offset} aria-label={`Смещение шага ${i + 1}`} onChange={(e) => setDraft({ ...draft, steps: draft.steps.map((x, j) => j === i ? { ...x, offset: e.target.value } : x) })} />
                    <Select value={s.unit} onValueChange={(v) => setDraft({ ...draft, steps: draft.steps.map((x, j) => j === i ? { ...x, unit: v as StepDraft["unit"] } : x) })}>
                      <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="min">мин</SelectItem><SelectItem value="h">ч</SelectItem><SelectItem value="d">дн</SelectItem></SelectContent>
                    </Select>
                    <Button size="sm" variant="ghost" className="h-8 px-1.5" aria-label={`Убрать шаг ${i + 1}`} onClick={() => setDraft({ ...draft, steps: draft.steps.filter((_, j) => j !== i) })}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                ))}
                <Button size="sm" variant="outline" className="w-fit" onClick={() => setDraft({ ...draft, steps: [...draft.steps, { action: "METRICS_SYNC", offset: "60", unit: "min" }] })}><Plus className="mr-1 h-3.5 w-3.5" /> Шаг</Button>
              </div>
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={draft.is_default} onCheckedChange={(v) => setDraft({ ...draft, is_default: Boolean(v) })} /> Рутина по умолчанию для всех аккаунтов проекта без своей</label>
              {pub.groups.length > 0 && (
                <div className="grid gap-1.5">
                  <Label>Назначить группам</Label>
                  <div className="flex flex-wrap gap-3">
                    {pub.groups.map((g) => (
                      <label key={g.id} className="flex items-center gap-1.5 text-sm">
                        <Checkbox checked={draft.group_ids.includes(g.id)} onCheckedChange={(v) => setDraft({ ...draft, group_ids: v ? [...draft.group_ids, g.id] : draft.group_ids.filter((x) => x !== g.id) })} />
                        {g.name}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDraft(null)}>Отмена</Button>
            <Button onClick={() => void save()} disabled={busy}>Сохранить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
