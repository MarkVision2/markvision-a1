/**
 * «Кампании»: период × аккаунты × очередь контента × правило публикации.
 * Планировщик (SQL plan_publish_campaigns, крон ежечасно) сам раскладывает
 * очередь по слотам на сегодня и завтра; здесь — список с метриками, форма
 * правил, очередь видео и действия start / pause / complete / plan now.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarRange, Play, Pause, Plus, RefreshCw, CheckCircle2, Archive, ListVideo } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { UsePublishing } from "@/hooks/usePublishing";
import {
  CAMPAIGN_STATUS_META,
  CAMPAIGN_TRANSITIONS,
  campaignSlotTimes,
  publishingApi,
  type CampaignItem,
  type CampaignMetrics,
  type CampaignStatus,
  type CampaignUpsertInput,
  type PublishCampaign,
} from "@/lib/publishingClient";
import { fmtExact, fmtRelative } from "@/lib/publishingFormat";
import { cn } from "@/lib/utils";

const NONE = "__none__";
const WEEKDAYS = [
  { value: 1, label: "пн" }, { value: 2, label: "вт" }, { value: 3, label: "ср" }, { value: 4, label: "чт" },
  { value: 5, label: "пт" }, { value: 6, label: "сб" }, { value: 7, label: "вс" },
];

interface Draft {
  id?: string;
  name: string;
  objective: string;
  start_date: string;
  end_date: string;
  group_id: string;
  posts_per_day: string;
  slot_times: string;
  weekdays: number[];
  mode: "drip" | "now";
  distribution: "fanout" | "spread";
}

function today(): string {
  return new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10); // Алматы
}

function toDraft(c?: PublishCampaign): Draft {
  return {
    id: c?.id,
    name: c?.name ?? "",
    objective: c?.objective ?? "",
    start_date: c?.start_date ?? today(),
    end_date: c?.end_date ?? "",
    group_id: c?.group_id ?? NONE,
    posts_per_day: String(c?.posts_per_day ?? 1),
    slot_times: (c?.slot_times ?? []).map((t) => t.slice(0, 5)).join(", "),
    weekdays: c?.weekdays ?? [1, 2, 3, 4, 5, 6, 7],
    mode: c?.mode ?? "drip",
    distribution: c?.distribution ?? "fanout",
  };
}

/** Черновик формы → тело запроса; ошибка — текст для тоста. */
export function draftToInput(d: Draft): { ok: true; input: CampaignUpsertInput } | { ok: false; error: string } {
  const name = d.name.trim();
  if (!name) return { ok: false, error: "Название кампании обязательно" };
  const posts = Number(d.posts_per_day);
  if (!Number.isInteger(posts) || posts < 1 || posts > 24) return { ok: false, error: "Постов в день — целое от 1 до 24" };
  const times = d.slot_times.split(/[,\s]+/).map((t) => t.trim()).filter(Boolean);
  if (times.some((t) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))) return { ok: false, error: "Времена — через запятую в формате ЧЧ:ММ" };
  if (!d.weekdays.length) return { ok: false, error: "Выберите хотя бы один день недели" };
  if (d.end_date && d.end_date < d.start_date) return { ok: false, error: "Дата окончания раньше начала" };
  return {
    ok: true,
    input: {
      ...(d.id ? { campaign_id: d.id } : {}),
      name,
      objective: d.objective.trim() || null,
      start_date: d.start_date,
      end_date: d.end_date || null,
      group_id: d.group_id === NONE ? null : d.group_id,
      posts_per_day: posts,
      slot_times: times,
      weekdays: d.weekdays,
      mode: d.mode,
      distribution: d.distribution,
    },
  };
}

export function CampaignsTab({ pub }: { pub: UsePublishing }) {
  const projectId = pub.projectId;
  const [campaigns, setCampaigns] = useState<PublishCampaign[]>([]);
  const [metrics, setMetrics] = useState<Map<string, CampaignMetrics>>(new Map());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) { setCampaigns([]); setMetrics(new Map()); return; }
    setLoading(true);
    try {
      const r = await publishingApi.campaignList(projectId);
      setCampaigns(r.campaigns ?? []);
      setMetrics(new Map((r.metrics ?? []).map((m) => [m.campaign_id, m])));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось загрузить кампании");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const act = async (key: string, label: string, fn: () => Promise<unknown>) => {
    if (!projectId) return;
    setBusy(key);
    try {
      await fn();
      toast.success(label);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!draft || !projectId) return;
    const parsed = draftToInput(draft);
    if (parsed.ok === false) { toast.error(parsed.error); return; }
    await act("save", draft.id ? "Кампания сохранена" : "Кампания создана", () => publishingApi.campaignUpsert(projectId, parsed.input));
    setDraft(null);
  };

  const setStatus = (c: PublishCampaign, status: CampaignStatus) =>
    act(`${c.id}:${status}`, `Статус: ${CAMPAIGN_STATUS_META[status].label}`, async () => {
      if (!projectId) return;
      const r = await publishingApi.campaignStatus(projectId, c.id, status);
      if (status === "active" && r.planned) toast.message(`Спланировано: видео ${r.planned.planned}, заданий ${r.planned.jobs_created}`);
    });

  const groupName = (id: string | null) => pub.groups.find((g) => g.id === id)?.name ?? null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Кампания = период, аккаунты, очередь видео и правило «N постов в день в заданные часы». Планировщик раскладывает очередь сам, каждый час на сегодня и завтра.
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => void load()} disabled={loading} aria-label="Обновить кампании"><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /></Button>
          <Button size="sm" onClick={() => setDraft(toDraft())} disabled={!projectId}><Plus className="mr-1 h-4 w-4" /> Новая кампания</Button>
        </div>
      </div>

      {!campaigns.length ? (
        <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          {loading ? "Загрузка…" : "Кампаний пока нет. Создайте первую: группа аккаунтов, 3 поста в день, очередь из готовых видео."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-9">Кампания</TableHead>
                <TableHead className="h-9 w-[110px]">Статус</TableHead>
                <TableHead className="h-9">Период</TableHead>
                <TableHead className="h-9">Правило</TableHead>
                <TableHead className="h-9 text-right">Очередь</TableHead>
                <TableHead className="h-9 text-right">Задания</TableHead>
                <TableHead className="h-9 text-right">Просмотры</TableHead>
                <TableHead className="h-9 w-[260px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((c) => {
                const m = metrics.get(c.id);
                const st = CAMPAIGN_STATUS_META[c.status];
                const can = (s: CampaignStatus) => CAMPAIGN_TRANSITIONS[c.status].includes(s);
                const rowBusy = busy?.startsWith(c.id) ?? false;
                return (
                  <TableRow key={c.id}>
                    <TableCell className="py-2">
                      <button type="button" className="text-left" onClick={() => setOpenId(c.id)}>
                        <div className="font-medium hover:underline">{c.name}</div>
                        <div className="text-xs text-muted-foreground">{groupName(c.group_id) ?? (c.account_ids.length ? `${c.account_ids.length} аккаунтов` : "все аккаунты проекта")} · годных {m?.accounts_eligible ?? "—"}</div>
                      </button>
                    </TableCell>
                    <TableCell className="py-2"><Badge variant="outline" className={cn("border-transparent font-medium", st.cls)}>{st.label}</Badge></TableCell>
                    <TableCell className="py-2 text-xs text-muted-foreground">{c.start_date}{c.end_date ? ` — ${c.end_date}` : " — ∞"}</TableCell>
                    <TableCell className="py-2 text-xs">
                      {c.posts_per_day}/день · {campaignSlotTimes(c.slot_times.map((t) => t.slice(0, 5)), c.posts_per_day).join(", ")}
                      <div className="text-muted-foreground">{c.distribution === "fanout" ? "каждое видео во все аккаунты" : "видео по кругу между аккаунтами"} · {c.mode}</div>
                    </TableCell>
                    <TableCell className="py-2 text-right text-sm tabular-nums">{m ? `${m.items_queued} / ${m.items_total}` : "—"}</TableCell>
                    <TableCell className="py-2 text-right text-sm tabular-nums">
                      {m ? <>{m.jobs_published}<span className="text-muted-foreground"> / {m.jobs_total}</span>{m.jobs_failed ? <span className="ml-1 text-destructive">✕{m.jobs_failed}</span> : null}</> : "—"}
                    </TableCell>
                    <TableCell className="py-2 text-right text-sm tabular-nums">{m ? new Intl.NumberFormat("ru-RU").format(m.views_total) : "—"}</TableCell>
                    <TableCell className="py-2 text-right">
                      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setOpenId(c.id)} aria-label={`Очередь ${c.name}`}><ListVideo className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setDraft(toDraft(c))} aria-label={`Изменить ${c.name}`}><CalendarRange className="h-3.5 w-3.5" /></Button>
                      {can("active") && <Button size="sm" variant="ghost" className="h-7 px-2 text-emerald-700 dark:text-emerald-300" disabled={rowBusy} onClick={() => void setStatus(c, "active")} aria-label={`Запустить ${c.name}`}><Play className="mr-1 h-3.5 w-3.5" />Запустить</Button>}
                      {can("paused") && <Button size="sm" variant="ghost" className="h-7 px-2" disabled={rowBusy} onClick={() => void setStatus(c, "paused")} aria-label={`Пауза ${c.name}`}><Pause className="mr-1 h-3.5 w-3.5" />Пауза</Button>}
                      {can("completed") && <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground" disabled={rowBusy} onClick={() => void setStatus(c, "completed")} aria-label={`Завершить ${c.name}`}><CheckCircle2 className="h-3.5 w-3.5" /></Button>}
                      {can("archived") && c.status !== "active" && <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground" disabled={rowBusy} onClick={() => void setStatus(c, "archived")} aria-label={`В архив ${c.name}`}><Archive className="h-3.5 w-3.5" /></Button>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={Boolean(draft)} onOpenChange={(o) => { if (!o) setDraft(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Правила кампании" : "Новая кампания"}</DialogTitle>
            <DialogDescription>Аккаунты берутся из группы (или все годные аккаунты проекта), очередь видео добавляется после создания.</DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="grid gap-3">
              <div className="grid gap-1.5"><Label htmlFor="c-name">Название</Label><Input id="c-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Dubai Supercars September" /></div>
              <div className="grid gap-1.5"><Label htmlFor="c-obj">Цель</Label><Input id="c-obj" value={draft.objective} onChange={(e) => setDraft({ ...draft, objective: e.target.value })} placeholder="охват / подписчики / лиды" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5"><Label htmlFor="c-start">Начало</Label><Input id="c-start" type="date" value={draft.start_date} onChange={(e) => setDraft({ ...draft, start_date: e.target.value })} /></div>
                <div className="grid gap-1.5"><Label htmlFor="c-end">Окончание</Label><Input id="c-end" type="date" value={draft.end_date} onChange={(e) => setDraft({ ...draft, end_date: e.target.value })} /></div>
              </div>
              <div className="grid gap-1.5">
                <Label>Группа аккаунтов</Label>
                <Select value={draft.group_id} onValueChange={(v) => setDraft({ ...draft, group_id: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Все годные аккаунты проекта</SelectItem>
                    {pub.groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5"><Label htmlFor="c-ppd">Постов в день</Label><Input id="c-ppd" type="number" min={1} max={24} value={draft.posts_per_day} onChange={(e) => setDraft({ ...draft, posts_per_day: e.target.value })} /></div>
                <div className="grid gap-1.5"><Label htmlFor="c-times">Времена (ЧЧ:ММ)</Label><Input id="c-times" value={draft.slot_times} onChange={(e) => setDraft({ ...draft, slot_times: e.target.value })} placeholder="10:00, 14:00, 19:00" /></div>
              </div>
              <div className="grid gap-1.5">
                <Label>Дни недели</Label>
                <div className="flex flex-wrap gap-3">
                  {WEEKDAYS.map((d) => (
                    <label key={d.value} className="flex items-center gap-1.5 text-sm">
                      <Checkbox checked={draft.weekdays.includes(d.value)} onCheckedChange={(v) => setDraft({ ...draft, weekdays: v ? [...draft.weekdays, d.value].sort() : draft.weekdays.filter((x) => x !== d.value) })} />
                      {d.label}
                    </label>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label>Распределение</Label>
                  <Select value={draft.distribution} onValueChange={(v) => setDraft({ ...draft, distribution: v as Draft["distribution"] })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fanout">Каждое видео во все аккаунты</SelectItem>
                      <SelectItem value="spread">Видео по кругу между аккаунтами</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label>Режим слота</Label>
                  <Select value={draft.mode} onValueChange={(v) => setDraft({ ...draft, mode: v as Draft["mode"] })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="drip">Разнести аккаунты (drip)</SelectItem>
                      <SelectItem value="now">Все в момент слота</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDraft(null)}>Отмена</Button>
            <Button onClick={() => void save()} disabled={busy === "save"}>Сохранить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CampaignDetailDialog pub={pub} campaignId={openId} onClose={() => { setOpenId(null); void load(); }} />
    </div>
  );
}

/* ───────────────────────────── очередь кампании ───────────────────────────── */

const ITEM_META: Record<CampaignItem["status"], { label: string; cls: string }> = {
  queued: { label: "в очереди", cls: "bg-muted text-muted-foreground" },
  planned: { label: "запланировано", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  skipped: { label: "пропущено", cls: "bg-amber-500/10 text-amber-700 dark:text-amber-300" },
};

function CampaignDetailDialog({ pub, campaignId, onClose }: { pub: UsePublishing; campaignId: string | null; onClose: () => void }) {
  const projectId = pub.projectId;
  const [campaign, setCampaign] = useState<PublishCampaign | null>(null);
  const [metrics, setMetrics] = useState<CampaignMetrics | null>(null);
  const [items, setItems] = useState<CampaignItem[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!projectId || !campaignId) return;
    try {
      const r = await publishingApi.campaignGet(projectId, campaignId);
      setCampaign(r.campaign); setMetrics(r.metrics); setItems(r.items ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось загрузить кампанию");
    }
  }, [projectId, campaignId]);

  useEffect(() => { setPicked(new Set()); void load(); }, [load]);

  const inQueue = useMemo(() => new Set(items.map((i) => i.video_id)), [items]);
  const library = (pub.metrics?.videos ?? []).filter((v) => !inQueue.has(v.id));

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); toast.success(label); await load(); } catch (e) { toast.error(e instanceof Error ? e.message : "Ошибка"); } finally { setBusy(false); }
  };

  return (
    <Dialog open={Boolean(campaignId)} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{campaign?.name ?? "Кампания"}</DialogTitle>
          <DialogDescription>
            {metrics ? `Очередь ${metrics.items_queued} из ${metrics.items_total} · заданий ${metrics.jobs_total} (опубликовано ${metrics.jobs_published}, открыто ${metrics.jobs_open}) · годных аккаунтов ${metrics.accounts_eligible}` : "Загрузка…"}
            {metrics?.next_slot_at ? ` · ближайший слот ${fmtRelative(metrics.next_slot_at)}` : ""}
          </DialogDescription>
        </DialogHeader>

        {campaign && (
          <div className="grid gap-4 md:grid-cols-2">
            <section className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Очередь контента</h4>
              {!items.length ? <p className="text-sm text-muted-foreground">Пусто — добавьте видео из библиотеки справа.</p> : (
                <ul className="max-h-72 space-y-1 overflow-y-auto rounded-xl border p-2 text-sm">
                  {items.map((i) => (
                    <li key={i.id} className="flex items-center gap-2">
                      <span className="w-6 text-right text-xs tabular-nums text-muted-foreground">{i.position}</span>
                      <span className="min-w-0 flex-1 truncate" title={i.publish_videos?.file_url}>{i.publish_videos?.title || i.publish_videos?.file_url?.split("/").pop() || i.video_id}</span>
                      <Badge variant="outline" className={cn("border-transparent text-[11px]", ITEM_META[i.status].cls)} title={i.note ?? (i.planned_at ? fmtExact(i.planned_at) : "")}>
                        {ITEM_META[i.status].label}{i.status === "planned" ? ` · ${i.jobs_count}` : ""}
                      </Badge>
                      {i.status === "queued" && (
                        <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs text-muted-foreground" disabled={busy} onClick={() => void run("Убрано из очереди", () => publishingApi.campaignItemsRemove(projectId!, campaign.id, [i.video_id]))}>убрать</Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2">
                {campaign.status === "active" && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void run("Планировщик отработал", async () => {
                    const r = await publishingApi.campaignPlanNow(projectId!, campaign.id);
                    toast.message(`Видео ${r.result.planned}, заданий ${r.result.jobs_created}`);
                  })}>Спланировать сейчас</Button>
                )}
              </div>
            </section>

            <section className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Библиотека видео</h4>
              {!library.length ? <p className="text-sm text-muted-foreground">Все загруженные видео уже в очереди. Новые — через «Залить видео» без выбора аккаунтов.</p> : (
                <ul className="max-h-72 space-y-1 overflow-y-auto rounded-xl border p-2 text-sm">
                  {library.map((v) => (
                    <li key={v.id}>
                      <label className="flex items-center gap-2">
                        <Checkbox checked={picked.has(v.id)} onCheckedChange={(on) => setPicked((s) => { const n = new Set(s); if (on) n.add(v.id); else n.delete(v.id); return n; })} />
                        <span className="min-w-0 flex-1 truncate" title={v.file_url}>{v.title || v.file_url.split("/").pop()}</span>
                        <span className="text-xs text-muted-foreground">{fmtRelative(v.created_at)}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              <Button size="sm" disabled={busy || !picked.size} onClick={() => void run("Добавлено в очередь", async () => {
                await publishingApi.campaignItemsAdd(projectId!, campaign.id, [...picked]);
                setPicked(new Set());
              })}>
                <Plus className="mr-1 h-4 w-4" /> Добавить выбранные ({picked.size})
              </Button>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
