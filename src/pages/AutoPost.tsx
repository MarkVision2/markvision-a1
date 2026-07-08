import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle, AlertTriangle, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock, Film, FlaskConical,
  Camera, Flame, Images, ListChecks, Loader2, Pencil, Plus, RefreshCw, RotateCcw, Send, Sparkles, Trash2, Upload, X, Zap,
} from "lucide-react";
import { toast } from "sonner";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { clientConfigSupabase } from "@/integrations/clientConfig/client";
import { clientSupabasePublishableKey, clientSupabaseUrl } from "@/lib/supabaseConfig";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { useInstagramAccount } from "@/hooks/useInstagramAccount";
import { fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";

// Раздел «Автопостинг» — календарь + очередь публикаций Instagram (cf_scheduled_posts,
// клиентский Supabase). Медиа → публичный бакет autopost, публикует publisher по крону
// раз в минуту. Время — Алматы.
const CLIENT_URL = clientSupabaseUrl;
const CLIENT_KEY = clientSupabasePublishableKey;
const BUCKET = "autopost";
const WD_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const WD_FROM_DOW = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];

type PostType = "IMAGE" | "REELS" | "CAROUSEL" | "STORIES";
type ViewMode = "calendar" | "queue";
type StatusFilter = "all" | "queued" | "processing" | "published" | "tested" | "failed";

interface QueuePost {
  id: string; media_type: string; media_url: string | null; thumbnail_url: string | null;
  child_urls: string[] | null; caption: string | null; scheduled_at: string; status: string;
  dry_run: boolean; published_ig_media_id: string | null; error: string | null;
}
interface Stats {
  total_posts: number; published_this_period: number; scheduled_upcoming: number;
  best_weekday: number | null; best_hour: number | null;
  by_weekday: { dow: number; posts: number; avg_reach: number }[];
  by_hour: { hour: number; posts: number; avg_reach: number }[];
  heatmap: { dow: number; hour: number; posts: number; avg_reach: number }[];
  best_slots: { dow: number; hour: number; posts: number; avg_reach: number }[];
}

const TYPE_META: Record<PostType, { label: string; icon: typeof Images; accept: string; multiple: boolean; hint: string }> = {
  IMAGE: { label: "Пост", icon: Images, accept: "image/jpeg,image/png,image/webp", multiple: false, hint: "JPEG/PNG, 1:1 или 4:5." },
  REELS: { label: "Reels", icon: Film, accept: "video/mp4,video/quicktime", multiple: false, hint: "9:16, 5–90 сек, MP4." },
  CAROUSEL: { label: "Карусель", icon: Images, accept: "image/jpeg,image/png,image/webp,video/mp4", multiple: true, hint: "2–10 фото/видео." },
  STORIES: { label: "Сторис", icon: Clock, accept: "image/jpeg,image/png,image/webp,video/mp4", multiple: false, hint: "9:16, фото или видео." },
};
const STATUS_META: Record<string, { label: string; dot: string; cls: string; icon: typeof Clock }> = {
  queued: { label: "В очереди", dot: "bg-sky-500", cls: "bg-sky-500/10 text-sky-600", icon: Clock },
  processing: { label: "Обрабатывается", dot: "bg-amber-500", cls: "bg-amber-500/10 text-amber-600", icon: Loader2 },
  published: { label: "Опубликовано", dot: "bg-emerald-500", cls: "bg-emerald-500/10 text-emerald-600", icon: CheckCircle2 },
  tested: { label: "Проверено (тест)", dot: "bg-violet-500", cls: "bg-violet-500/10 text-violet-600", icon: FlaskConical },
  failed: { label: "Ошибка", dot: "bg-destructive", cls: "bg-destructive/10 text-destructive", icon: AlertCircle },
};
const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "Все" },
  { key: "queued", label: "В очереди" },
  { key: "processing", label: "Обрабатывается" },
  { key: "published", label: "Опубликовано" },
  { key: "tested", label: "Тест" },
  { key: "failed", label: "Ошибка" },
];

const pad = (n: number) => String(n).padStart(2, "0");
const almatyYmd = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Almaty" });
const almatyHm = (iso: string) => new Date(iso).toLocaleTimeString("ru-RU", { timeZone: "Asia/Almaty", hour: "2-digit", minute: "2-digit" });
const buildISO = (ymd: string, hour: number, minute: number) => new Date(`${ymd}T${pad(hour)}:${pad(minute)}:00+05:00`).toISOString();
const todayAlmatyYmd = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Almaty" });
const ymdOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const prettyDay = (ymd: string) => { const [y, m, d] = ymd.split("-").map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
const timeUntil = (iso: string) => {
  const diffMin = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (diffMin <= 0) return "прямо сейчас";
  if (diffMin < 60) return `через ${diffMin} мин`;
  const h = Math.floor(diffMin / 60), m = diffMin % 60;
  if (h < 24) return m ? `через ${h} ч ${m} мин` : `через ${h} ч`;
  return `через ${Math.floor(h / 24)} дн`;
};

async function schedulerApi<T = unknown>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (!CLIENT_URL) throw new Error("VITE_CLIENT_SUPABASE_URL не задан");
  const r = await fetch(`${CLIENT_URL}/functions/v1/content-scheduler`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-app-key": CLIENT_KEY }, body: JSON.stringify({ action, ...payload }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j as T;
}
async function uploadToBucket(file: File): Promise<string> {
  if (!clientConfigSupabase) throw new Error("Хранилище не настроено (VITE_CLIENT_SUPABASE_*)");
  const ext = (file.name.split(".").pop() || "bin").toLowerCase();
  const path = `posts/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await clientConfigSupabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw new Error(`Загрузка не удалась: ${error.message}`);
  return clientConfigSupabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
const isVideoFile = (f: File) => f.type.startsWith("video/");
const monthRangeYmd = (view: Date) => {
  const from = `${view.getFullYear()}-${pad(view.getMonth() + 1)}-01`;
  const last = new Date(view.getFullYear(), view.getMonth() + 1, 0);
  return { from, to: ymdOf(last) };
};

const AutoPost = () => {
  const { activeId: projectId } = useProjectsStore();
  const { account: igAccount } = useInstagramAccount();
  const [view, setView] = useState(() => new Date());
  const [viewMode, setViewMode] = useState<ViewMode>("calendar");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [posts, setPosts] = useState<QueuePost[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialLoading, setInitialLoading] = useState(true);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const loadAll = useCallback(async (v: Date) => {
    setLoading(true);
    try {
      const { from, to } = monthRangeYmd(v);
      const [q, s] = await Promise.all([
        schedulerApi<{ posts: QueuePost[] }>("list", { project_id: projectId }),
        schedulerApi<{ stats: Stats }>("stats", { from, to, project_id: projectId }),
      ]);
      setPosts(q.posts ?? []); setStats(s.stats ?? null);
    } catch (e) { toast.error("Не удалось загрузить", { description: e instanceof Error ? e.message : String(e) }); }
    finally { setLoading(false); setInitialLoading(false); }
  }, [projectId]);
  useEffect(() => { void loadAll(view); }, [loadAll, view]);
  useEffect(() => {
    const pending = posts.some((p) => p.status === "queued" || p.status === "processing");
    if (!pending) return;
    const t = setInterval(() => void loadAll(view), 20_000);
    return () => clearInterval(t);
  }, [posts, loadAll, view]);

  const byDay = useMemo(() => {
    const m: Record<string, QueuePost[]> = {};
    for (const p of posts) { const d = almatyYmd(p.scheduled_at); (m[d] ||= []).push(p); }
    for (const k of Object.keys(m)) m[k].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
    return m;
  }, [posts]);

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of posts) c[p.status] = (c[p.status] ?? 0) + 1;
    return c;
  }, [posts]);

  // Сетка месяца (недели с понедельника)
  const cells = useMemo(() => {
    const first = new Date(view.getFullYear(), view.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(view.getFullYear(), view.getMonth(), 1 - offset);
    const today = todayAlmatyYmd();
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const ymd = ymdOf(d);
      return { ymd, day: d.getDate(), inMonth: d.getMonth() === view.getMonth(), isToday: ymd === today, isPast: ymd < today };
    });
  }, [view]);

  // Диалоги
  const [addDay, setAddDay] = useState<string | null>(null);
  const [editing, setEditing] = useState<QueuePost | null>(null);

  const hourReach = useMemo(() => { const m = new Map<number, number>(); for (const h of stats?.by_hour ?? []) m.set(h.hour, h.avg_reach); return m; }, [stats]);
  const topSlot = stats?.best_slots?.[0] ?? null;
  const bestDow = topSlot?.dow ?? null;
  const bestHour = topSlot?.hour ?? null;
  const openAdd = (ymd: string) => setAddDay(ymd);
  const monthLabel = `${MONTHS[view.getMonth()]} ${view.getFullYear()}`;

  const quickAction = async (id: string, action: "publish_now" | "delete" | "retry") => {
    if (action === "delete" && !confirm("Удалить публикацию?")) return;
    setBusyIds((s) => new Set(s).add(id));
    try {
      await schedulerApi(action, { id });
      toast.success(action === "delete" ? "Удалено" : action === "publish_now" ? "Публикуем сейчас…" : "Повторяем");
      await loadAll(view);
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setBusyIds((s) => { const n = new Set(s); n.delete(id); return n; }); }
  };

  return (
    <PageContainer wide>
      <PageHeader
        icon={CalendarDays}
        title="Автопостинг"
        description="Календарь и очередь публикаций в Instagram. Кликните день или пост, чтобы запланировать/отредактировать. Время — по Алматы."
        meta={
          igAccount ? (
            <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-card/60 px-3 py-1.5">
              {igAccount.profilePictureUrl ? (
                <img src={igAccount.profilePictureUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
              ) : (
                <span className="grid h-6 w-6 place-items-center rounded-full bg-pink-500/15 text-pink-500"><CheckCircle2 className="h-3.5 w-3.5" /></span>
              )}
              <span className="text-sm font-medium">@{igAccount.username}</span>
              <span className="hidden text-xs text-muted-foreground sm:inline">{fmtNum(igAccount.followersCount)} подписч.</span>
            </div>
          ) : (
            <Link
              to="/settings?tab=meta-tokens"
              className="flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-600 transition hover:bg-amber-500/20"
            >
              <AlertTriangle className="h-3.5 w-3.5" /> Instagram не подключён — настроить
            </Link>
          )
        }
        actions={
          <Button variant="outline" size="icon" className="h-10 w-10 rounded-xl border-border/60" aria-label="Обновить" onClick={() => void loadAll(view)} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        }
      />

      {/* Статистика */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Опубликовано за месяц", value: fmtNum(stats?.published_this_period ?? 0), cls: "text-emerald-600", icon: CheckCircle2 },
          { label: "Запланировано", value: fmtNum(stats?.scheduled_upcoming ?? 0), cls: "text-sky-600", icon: Clock },
          { label: "Постов в анализе", value: fmtNum(stats?.total_posts ?? 0), cls: "text-foreground", icon: Images },
          { label: "Лучшее время", value: bestDow != null && bestHour != null ? `${WD_FROM_DOW[bestDow]} ${pad(bestHour)}:00` : "—", cls: "text-orange-600", icon: Flame },
        ].map((k) => (
          <div key={k.label} className="rounded-2xl border border-border/60 bg-card/60 p-3">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground"><k.icon className="h-3 w-3 shrink-0" />{k.label}</div>
            <div className={cn("mt-1 whitespace-nowrap text-lg font-bold tabular-nums", k.cls)}>{k.value}</div>
          </div>
        ))}
      </div>

      {!initialLoading && <NextUpRail posts={posts} onEdit={setEditing} />}

      {/* Тулбар: вид + фильтры + действие */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
          <TabsList>
            <TabsTrigger value="calendar" className="gap-1.5"><CalendarDays className="h-4 w-4" /> Календарь</TabsTrigger>
            <TabsTrigger value="queue" className="gap-1.5"><ListChecks className="h-4 w-4" /> Очередь</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button className="rounded-xl" onClick={() => openAdd(todayAlmatyYmd())}><Plus className="mr-1.5 h-4 w-4" /> Новая публикация</Button>
      </div>

      {viewMode === "calendar" ? (
        <>
          {/* Тулбар месяца */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" className="h-9 w-9 rounded-lg" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}><ChevronLeft className="h-4 w-4" /></Button>
              <div className="min-w-[150px] text-center text-lg font-bold capitalize">{monthLabel}</div>
              <Button variant="outline" size="icon" className="h-9 w-9 rounded-lg" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}><ChevronRight className="h-4 w-4" /></Button>
              <Button variant="ghost" size="sm" className="h-9 rounded-lg text-xs" onClick={() => setView(new Date())}>Сегодня</Button>
            </div>
            {bestDow != null && bestHour != null && (
              <span className="hidden items-center gap-1 text-[11px] text-muted-foreground sm:inline-flex">
                <Sparkles className="h-3.5 w-3.5 text-primary" /> Лучшее время: <b className="text-foreground">{WD_FROM_DOW[bestDow]} {pad(bestHour)}:00</b>
              </span>
            )}
          </div>

          {initialLoading ? (
            <CalendarSkeleton />
          ) : (
            <div className="mt-3 overflow-hidden rounded-2xl border border-border/60 bg-card/60">
              <div className="grid grid-cols-7 border-b border-border/50 bg-secondary/30 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {WD_SHORT.map((w) => <div key={w} className="px-2 py-2 text-center">{w}</div>)}
              </div>
              <div className="grid grid-cols-7">
                {cells.map((c, i) => {
                  const dayPosts = byDay[c.ymd] ?? [];
                  return (
                    <div
                      key={c.ymd + i}
                      className={cn(
                        "group relative min-h-[118px] border-b border-r border-border/40 p-1.5 transition",
                        !c.inMonth && "bg-secondary/20",
                        c.inMonth && "hover:bg-secondary/20",
                        i % 7 === 6 && "border-r-0",
                      )}
                      onClick={() => openAdd(c.ymd)}
                      role="button"
                    >
                      <div className="flex items-center justify-between">
                        <span className={cn(
                          "grid h-6 w-6 place-items-center rounded-full text-xs font-semibold tabular-nums",
                          c.isToday ? "bg-primary text-primary-foreground" : c.inMonth ? "text-foreground" : "text-muted-foreground/50",
                        )}>{c.day}</span>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); openAdd(c.ymd); }}
                          className="opacity-0 transition group-hover:opacity-100"
                          title="Добавить публикацию"
                        ><Plus className="h-3.5 w-3.5 text-muted-foreground hover:text-primary" /></button>
                      </div>
                      <div className="mt-1 max-h-[74px] space-y-1 overflow-y-auto pr-0.5">
                        {dayPosts.map((p) => {
                          const s = STATUS_META[p.status] ?? STATUS_META.queued;
                          return (
                            <button
                              key={p.id}
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setEditing(p); }}
                              className={cn("flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left text-[10px] transition hover:brightness-95", s.cls)}
                              title={`${s.label} · ${almatyHm(p.scheduled_at)}`}
                            >
                              {p.thumbnail_url ? (
                                <img src={p.thumbnail_url} alt="" className="h-4 w-4 shrink-0 rounded object-cover" />
                              ) : (
                                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", s.dot)} />
                              )}
                              <span className="shrink-0 font-semibold tabular-nums">{almatyHm(p.scheduled_at)}</span>
                              <span className="min-w-0 flex-1 truncate opacity-90">{TYPE_META[p.media_type as PostType]?.label ?? p.media_type}{p.caption ? ` · ${p.caption}` : ""}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <p className="mt-3 text-[11px] text-muted-foreground">Лимит Instagram — 25 публикаций за 24 часа. Клик по дню — добавить пост, клик по посту — открыть и отредактировать.</p>
        </>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map((f) => {
              const count = f.key === "all" ? posts.length : statusCounts[f.key] ?? 0;
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setStatusFilter(f.key)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
                    statusFilter === f.key ? "border-primary/50 bg-primary/10 text-primary" : "border-border/60 bg-background text-muted-foreground hover:bg-secondary/40",
                  )}
                >
                  {f.label}{count > 0 ? ` · ${count}` : ""}
                </button>
              );
            })}
          </div>
          {initialLoading ? (
            <div className="mt-3 space-y-1.5">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[60px] w-full rounded-xl" />)}
            </div>
          ) : (
            <QueueView
              posts={posts}
              statusFilter={statusFilter}
              busyIds={busyIds}
              onEdit={setEditing}
              onPublishNow={(id) => void quickAction(id, "publish_now")}
              onDelete={(id) => void quickAction(id, "delete")}
            />
          )}
        </>
      )}

      {stats && stats.heatmap && stats.heatmap.length > 0 && (
        <div className="mt-4 rounded-2xl border border-border/60 bg-card/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold"><Flame className="h-4 w-4 text-orange-500" /> Лучшее время для публикаций</h2>
            {bestDow != null && bestHour != null && (
              <span className="text-[11px] text-muted-foreground">Рекомендуем: <b className="text-foreground">{WD_FROM_DOW[bestDow]}, {pad(bestHour)}:00</b></span>
            )}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">Строки — дни недели, столбцы — часы (0–23). Чем ярче ячейка, тем выше средний охват прошлых постов в это время (Алматы).</p>
          {(stats.best_slots ?? []).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(stats.best_slots ?? []).map((slot, i) => (
                <span key={`${slot.dow}-${slot.hour}`} className={cn("inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium", i === 0 ? "bg-primary/15 text-primary" : "bg-secondary/60 text-foreground/80")}>
                  {i === 0 && <Sparkles className="h-3 w-3" />}{WD_FROM_DOW[slot.dow]} {pad(slot.hour)}:00 · охват ~{fmtNum(slot.avg_reach)}
                </span>
              ))}
            </div>
          )}
          <div className="mt-3"><Heatmap cells={stats.heatmap} bestDow={bestDow} bestHour={bestHour} /></div>
        </div>
      )}

      {addDay && <AddDialog day={addDay} hourReach={hourReach} bestHour={bestHour} onClose={() => setAddDay(null)} onDone={() => { setAddDay(null); void loadAll(view); }} />}
      {editing && <EditDialog post={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); void loadAll(view); }} />}
    </PageContainer>
  );
};

// ——— Скелетон календаря на время первой загрузки ———
function CalendarSkeleton() {
  return (
    <div className="mt-3 overflow-hidden rounded-2xl border border-border/60 bg-card/60">
      <div className="grid grid-cols-7 border-b border-border/50 bg-secondary/30">
        {WD_SHORT.map((w) => <div key={w} className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{w}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {Array.from({ length: 42 }).map((_, i) => (
          <div key={i} className="min-h-[118px] border-b border-r border-border/40 p-1.5">
            <Skeleton className="h-5 w-5 rounded-full" />
            <Skeleton className="mt-3 h-3 w-3/4" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ——— Ближайшие публикации (горизонтальная лента) ———
function NextUpRail({ posts, onEdit }: { posts: QueuePost[]; onEdit: (p: QueuePost) => void }) {
  const upcoming = useMemo(() => posts
    .filter((p) => (p.status === "queued" || p.status === "processing") && new Date(p.scheduled_at).getTime() > Date.now())
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
    .slice(0, 8), [posts]);
  if (upcoming.length === 0) return null;
  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Clock className="h-3.5 w-3.5" /> Ближайшие публикации
      </div>
      <div className="flex gap-2.5 overflow-x-auto pb-1">
        {upcoming.map((p) => {
          const M = TYPE_META[p.media_type as PostType];
          const Icon = M?.icon ?? Images;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onEdit(p)}
              className="flex w-[168px] shrink-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-card/60 text-left transition hover:border-primary/40 hover:shadow-sm"
            >
              <div className="relative h-24 w-full bg-secondary/40">
                {p.thumbnail_url ? (
                  <img src={p.thumbnail_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="grid h-full w-full place-items-center text-muted-foreground"><Icon className="h-6 w-6" /></div>
                )}
                <span className="absolute left-1.5 top-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">{M?.label ?? p.media_type}</span>
              </div>
              <div className="p-2">
                <div className="text-xs font-semibold">{timeUntil(p.scheduled_at)}</div>
                <div className="truncate text-[10px] text-muted-foreground">{almatyHm(p.scheduled_at)} · {prettyDay(almatyYmd(p.scheduled_at))}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ——— Вид «Очередь»: хронологический список с фильтрами и быстрыми действиями ———
function QueueView({ posts, statusFilter, busyIds, onEdit, onPublishNow, onDelete }: {
  posts: QueuePost[]; statusFilter: StatusFilter; busyIds: Set<string>;
  onEdit: (p: QueuePost) => void; onPublishNow: (id: string) => void; onDelete: (id: string) => void;
}) {
  const filtered = useMemo(() => {
    const f = statusFilter === "all" ? posts : posts.filter((p) => p.status === statusFilter);
    return [...f].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  }, [posts, statusFilter]);
  const groups = useMemo(() => {
    const m: Record<string, QueuePost[]> = {};
    for (const p of filtered) { const d = almatyYmd(p.scheduled_at); (m[d] ||= []).push(p); }
    return Object.entries(m).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  if (filtered.length === 0) {
    return (
      <div className="mt-3 rounded-2xl border border-dashed border-border/60 bg-card/40 p-10 text-center">
        <CalendarDays className="mx-auto h-8 w-8 text-muted-foreground/50" />
        <p className="mt-2 text-sm text-muted-foreground">Публикаций не найдено</p>
      </div>
    );
  }
  const today = todayAlmatyYmd();
  return (
    <div className="mt-3 space-y-4">
      {groups.map(([ymd, list]) => (
        <div key={ymd}>
          <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {ymd === today && <span className="rounded bg-primary/15 px-1.5 py-0.5 text-primary">Сегодня</span>}
            <span>{prettyDay(ymd)}</span>
          </div>
          <div className="space-y-1.5">
            {list.map((p) => (
              <QueueRow
                key={p.id}
                post={p}
                busy={busyIds.has(p.id)}
                onEdit={() => onEdit(p)}
                onPublishNow={() => onPublishNow(p.id)}
                onDelete={() => onDelete(p.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function QueueRow({ post, busy, onEdit, onPublishNow, onDelete }: {
  post: QueuePost; busy: boolean; onEdit: () => void; onPublishNow: () => void; onDelete: () => void;
}) {
  const s = STATUS_META[post.status] ?? STATUS_META.queued;
  const M = TYPE_META[post.media_type as PostType];
  const Icon = M?.icon ?? Images;
  const canPublishNow = post.status === "queued" || post.status === "failed" || post.status === "tested";
  const canDelete = post.status !== "published";
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-card/50 p-2.5 transition hover:border-border">
      <button type="button" onClick={onEdit} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        {post.thumbnail_url ? (
          <img src={post.thumbnail_url} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover" />
        ) : (
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-secondary/60 text-muted-foreground"><Icon className="h-4 w-4" /></div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold tabular-nums">{almatyHm(post.scheduled_at)}</span>
            <span className="text-muted-foreground">{M?.label ?? post.media_type}</span>
            <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold", s.cls)}>
              <s.icon className={cn("h-3 w-3", post.status === "processing" && "animate-spin")} /> {s.label}
            </span>
          </div>
          {post.caption && <div className="truncate text-xs text-muted-foreground">{post.caption}</div>}
          {post.status === "failed" && post.error && <div className="truncate text-xs text-destructive">{post.error}</div>}
        </div>
      </button>
      <div className="flex shrink-0 items-center gap-1">
        {canPublishNow && (
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-primary hover:bg-primary/10" title="Опубликовать сейчас" onClick={onPublishNow} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
          </Button>
        )}
        {canDelete && (
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Удалить" onClick={onDelete} disabled={busy}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

// ——— Теплокарта день × час ———
function Heatmap({ cells, bestDow, bestHour }: { cells: { dow: number; hour: number; posts: number; avg_reach: number }[]; bestDow: number | null; bestHour: number | null }) {
  const map = new Map<string, { posts: number; avg_reach: number }>();
  let max = 1;
  for (const c of cells) { map.set(`${c.dow}-${c.hour}`, c); if (c.avg_reach > max) max = c.avg_reach; }
  const dows = [1, 2, 3, 4, 5, 6, 0];
  const hours = Array.from({ length: 24 }, (_, h) => h);
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[560px]">
        <div className="flex pl-8">
          {hours.map((h) => <div key={h} className="flex-1 text-center text-[8px] text-muted-foreground">{h % 6 === 0 ? h : ""}</div>)}
        </div>
        <div className="mt-0.5 space-y-0.5">
          {dows.map((dw) => (
            <div key={dw} className="flex items-center gap-0.5">
              <div className="w-8 shrink-0 text-[10px] text-muted-foreground">{WD_FROM_DOW[dw]}</div>
              {hours.map((h) => {
                const c = map.get(`${dw}-${h}`);
                const intensity = c ? Math.max(0.18, c.avg_reach / max) : 0;
                const isBest = dw === bestDow && h === bestHour;
                return (
                  <div
                    key={h}
                    title={c ? `${WD_FROM_DOW[dw]} ${pad(h)}:00 · охват ~${fmtNum(c.avg_reach)}, постов ${c.posts}` : `${WD_FROM_DOW[dw]} ${pad(h)}:00 · нет данных`}
                    className={cn("h-4 flex-1 rounded-[3px]", isBest && "ring-2 ring-primary")}
                    style={{ backgroundColor: c ? `hsl(var(--primary) / ${intensity})` : "hsl(var(--muted) / 0.5)" }}
                  />
                );
              })}
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2 pl-8 text-[9px] text-muted-foreground">
          <span>меньше</span>
          <div className="flex gap-0.5">
            {[0.18, 0.4, 0.6, 0.8, 1].map((o) => <div key={o} className="h-3 w-4 rounded-[2px]" style={{ backgroundColor: `hsl(var(--primary) / ${o})` }} />)}
          </div>
          <span>больше охват</span>
        </div>
      </div>
    </div>
  );
}

// ——— Диалог добавления публикации на конкретный день ———
function AddDialog({ day, hourReach, bestHour, onClose, onDone }: { day: string; hourReach: Map<number, number>; bestHour: number | null; onClose: () => void; onDone: () => void }) {
  const { activeId: projectId } = useProjectsStore();
  const [type, setType] = useState<PostType>("IMAGE");
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [caption, setCaption] = useState("");
  const [hour, setHour] = useState(12);
  const [minute, setMinute] = useState(0);
  const [dryRun, setDryRun] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [seek, setSeek] = useState(0);
  const [duration, setDuration] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const meta = TYPE_META[type];

  useEffect(() => () => { if (videoSrc) URL.revokeObjectURL(videoSrc); if (coverPreview) URL.revokeObjectURL(coverPreview); }, [videoSrc, coverPreview]);
  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => { urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, [files]);

  const clearCover = () => { setCoverFile(null); setCoverPreview((p) => { if (p) URL.revokeObjectURL(p); return null; }); };
  const applyCover = (fl: File) => { setCoverPreview((p) => { if (p) URL.revokeObjectURL(p); return URL.createObjectURL(fl); }); setCoverFile(fl); };

  const pick = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const a = Array.from(list);
    const next = meta.multiple ? a.slice(0, 10) : a.slice(0, 1);
    setFiles(next); clearCover();
    setVideoSrc((prev) => { if (prev) URL.revokeObjectURL(prev); return (type === "REELS" && next[0]?.type.startsWith("video/")) ? URL.createObjectURL(next[0]) : null; });
    setSeek(0); setDuration(0);
  };
  const moveFile = (idx: number, dir: -1 | 1) => {
    setFiles((prev) => {
      const j = idx + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };
  const captureFrame = () => {
    const v = videoRef.current; if (!v) return;
    const cvs = document.createElement("canvas");
    cvs.width = v.videoWidth || 720; cvs.height = v.videoHeight || 1280;
    const ctx = cvs.getContext("2d"); if (!ctx) return;
    ctx.drawImage(v, 0, 0, cvs.width, cvs.height);
    cvs.toBlob((blob) => { if (blob) applyCover(new File([blob], `cover-${Date.now()}.jpg`, { type: "image/jpeg" })); }, "image/jpeg", 0.92);
  };

  const validate = (): string | null => {
    if (files.length === 0) return "Добавьте медиа";
    if (type === "CAROUSEL" && files.length < 2) return "Карусель: минимум 2 файла";
    if (type === "REELS" && !isVideoFile(files[0])) return "Reels — только видео";
    if (type === "IMAGE" && isVideoFile(files[0])) return "Пост — только фото (видео → Reels)";
    return null;
  };
  const submit = async (now: boolean) => {
    const err = validate(); if (err) { toast.error(err); return; }
    setBusy(true);
    try {
      const urls: string[] = [];
      for (const f of files) urls.push(await uploadToBucket(f));
      let coverUrl: string | null = null;
      if (type === "REELS" && coverFile) coverUrl = await uploadToBucket(coverFile);
      const payload: Record<string, unknown> = {
        media_type: type, caption: type === "STORIES" ? "" : caption,
        scheduled_at: now ? new Date().toISOString() : buildISO(day, hour, minute), dry_run: now ? false : dryRun,
        project_id: projectId,
      };
      if (type === "CAROUSEL") { payload.child_urls = urls; payload.thumbnail_url = urls.find((_, i) => !isVideoFile(files[i])) ?? urls[0]; }
      else {
        payload.media_url = urls[0];
        if (type === "REELS") { if (coverUrl) { payload.cover_url = coverUrl; payload.thumbnail_url = coverUrl; } }
        else payload.thumbnail_url = isVideoFile(files[0]) ? null : urls[0];
      }
      const res = await schedulerApi<{ post: QueuePost }>("create", payload);
      if (now && res.post?.id) await schedulerApi("publish_now", { id: res.post.id });
      toast.success(now ? "Публикуем сейчас…" : dryRun ? "Добавлено в пробном режиме" : "Запланировано");
      onDone();
    } catch (e) { toast.error("Не удалось", { description: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  };

  const reachHint = hourReach.get(hour);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>Публикация на {prettyDay(day)}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-2">
            {(Object.keys(TYPE_META) as PostType[]).map((t) => {
              const M = TYPE_META[t]; const Icon = M.icon;
              return (
                <button key={t} type="button" onClick={() => { setType(t); setFiles([]); clearCover(); setVideoSrc((p) => { if (p) URL.revokeObjectURL(p); return null; }); if (fileRef.current) fileRef.current.value = ""; }}
                  className={cn("flex flex-col items-center gap-1 rounded-xl border px-2 py-2 text-[11px] font-medium transition",
                    type === t ? "border-primary/60 bg-primary/10 text-primary" : "border-border/60 bg-background hover:bg-secondary/40")}>
                  <Icon className="h-4 w-4" /> {M.label}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">{meta.hint}</p>

          <input ref={fileRef} type="file" accept={meta.accept} multiple={meta.multiple} onChange={(e) => pick(e.target.files)} className="hidden" id="add-file" />
          <label
            htmlFor="add-file"
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(e) => { e.preventDefault(); setDragActive(false); pick(e.dataTransfer.files); }}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed px-3 py-6 text-xs transition",
              dragActive ? "border-primary bg-primary/5 text-primary" : "border-border/70 bg-background text-muted-foreground hover:bg-secondary/30",
            )}
          >
            <Upload className="h-5 w-5" />
            {meta.multiple ? "Перетащите файлы сюда или выберите (2–10)" : "Перетащите файл сюда или выберите"}
          </label>

          {files.length > 0 && (
            <div className={cn("grid gap-2", meta.multiple ? "grid-cols-3 sm:grid-cols-4" : "grid-cols-1")}>
              {files.map((f, i) => (
                <div key={i} className="group relative overflow-hidden rounded-lg border border-border/60 bg-secondary/30">
                  {isVideoFile(f) ? (
                    <video src={previews[i]} className={cn("w-full object-cover", meta.multiple ? "h-24" : "h-40")} muted />
                  ) : (
                    <img src={previews[i]} alt="" className={cn("w-full object-cover", meta.multiple ? "h-24" : "h-40")} />
                  )}
                  <button type="button" onClick={() => setFiles((x) => x.filter((_, idx) => idx !== i))} className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/60 text-white opacity-0 transition group-hover:opacity-100">
                    <X className="h-3 w-3" />
                  </button>
                  {meta.multiple && files.length > 1 && (
                    <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/50 px-1 py-0.5">
                      <button type="button" disabled={i === 0} onClick={() => moveFile(i, -1)} className="text-white disabled:opacity-30"><ChevronLeft className="h-3 w-3" /></button>
                      <span className="text-[9px] text-white/80">{i + 1}</span>
                      <button type="button" disabled={i === files.length - 1} onClick={() => moveFile(i, 1)} className="text-white disabled:opacity-30"><ChevronRight className="h-3 w-3" /></button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {type === "REELS" && videoSrc && (
            <div className="rounded-xl border border-border/60 p-3">
              <div className="text-[11px] font-semibold">Обложка Reels</div>
              <div className="mt-2 flex gap-3">                <video ref={videoRef} src={videoSrc} onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)} className="h-32 w-auto rounded-lg bg-black" muted playsInline />
                {coverPreview
                  ? <img src={coverPreview} alt="обложка" className="h-32 w-auto rounded-lg object-cover ring-2 ring-primary/50" />
                  : <div className="grid h-32 w-24 place-items-center rounded-lg border border-dashed border-border/60 text-[10px] text-muted-foreground">нет обложки</div>}
              </div>
              <input type="range" min={0} max={duration || 0} step={0.1} value={seek} onChange={(e) => { const t = Number(e.target.value); setSeek(t); if (videoRef.current) videoRef.current.currentTime = t; }} className="mt-2 w-full accent-primary" />
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="rounded-lg" onClick={captureFrame}><Camera className="mr-1 h-4 w-4" /> Взять этот кадр</Button>
                <input ref={coverRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) applyCover(f); }} />
                <Button size="sm" variant="outline" className="rounded-lg" onClick={() => coverRef.current?.click()}><Upload className="mr-1 h-4 w-4" /> Загрузить обложку</Button>
                {coverPreview && <Button size="sm" variant="ghost" className="rounded-lg text-muted-foreground" onClick={clearCover}>Убрать</Button>}
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">Двигайте ползунок и нажмите «Взять этот кадр», либо загрузите свою картинку. Без обложки Instagram выберет кадр сам.</p>
            </div>
          )}

          {type !== "STORIES" && (
            <div>
              <Textarea value={caption} onChange={(e) => setCaption(e.target.value.slice(0, 2200))} placeholder="Текст публикации, хэштеги…" className="min-h-[80px] rounded-xl border-border/60 text-sm" />
              <div className="mt-1 text-right text-[10px] text-muted-foreground">{caption.length} / 2200</div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Время:</span>
            <select value={hour} onChange={(e) => setHour(Number(e.target.value))} className="h-9 rounded-lg border border-border/60 bg-background px-2 text-sm">
              {Array.from({ length: 24 }, (_, i) => i).map((h) => <option key={h} value={h}>{pad(h)}</option>)}
            </select>
            <span>:</span>
            <select value={minute} onChange={(e) => setMinute(Number(e.target.value))} className="h-9 rounded-lg border border-border/60 bg-background px-2 text-sm">
              {Array.from({ length: 12 }, (_, i) => i * 5).map((m) => <option key={m} value={m}>{pad(m)}</option>)}
            </select>
            {bestHour != null && (
              <button
                type="button"
                onClick={() => { setHour(bestHour); setMinute(0); }}
                className="inline-flex items-center gap-1 rounded-lg border border-primary/40 bg-primary/5 px-2 py-1 text-[10px] font-medium text-primary transition hover:bg-primary/10"
              >
                <Sparkles className="h-3 w-3" /> Лучшее ({pad(bestHour)}:00)
              </button>
            )}
            <label className="ml-auto flex items-center gap-1.5 text-xs">
              <Switch checked={dryRun} onCheckedChange={setDryRun} />
              <FlaskConical className="h-3.5 w-3.5 text-violet-500" /> Пробный
            </label>
          </div>
          {reachHint ? <p className="text-[10px] text-muted-foreground">≈ средний охват в это время по прошлым постам: <b className="text-foreground">{fmtNum(reachHint)}</b></p> : null}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="rounded-xl border-primary/40 text-primary hover:bg-primary/10" onClick={() => void submit(true)} disabled={busy || dryRun}><Zap className="mr-1.5 h-4 w-4" /> Сейчас</Button>
          <Button className="rounded-xl" onClick={() => void submit(false)} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Send className="mr-1.5 h-4 w-4" /> Запланировать</>}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ——— Диалог просмотра/редактирования поста ———
function EditDialog({ post, onClose, onDone }: { post: QueuePost; onClose: () => void; onDone: () => void }) {
  const s = STATUS_META[post.status] ?? STATUS_META.queued;
  const editable = post.status === "queued" || post.status === "failed" || post.status === "tested";
  const alm = new Date(new Date(post.scheduled_at).toLocaleString("en-US", { timeZone: "Asia/Almaty" }));
  const [caption, setCaption] = useState(post.caption ?? "");
  const [ymd, setYmd] = useState(almatyYmd(post.scheduled_at));
  const [hour, setHour] = useState(alm.getHours());
  const [minute, setMinute] = useState(alm.getMinutes() - (alm.getMinutes() % 5));
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<unknown>, okMsg?: string) => {
    setBusy(true);
    try { await fn(); if (okMsg) toast.success(okMsg); onDone(); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle className="flex items-center gap-2">
          <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold", s.cls)}><s.icon className={cn("h-3 w-3", post.status === "processing" && "animate-spin")} /> {s.label}</span>
          <span className="text-sm font-normal text-muted-foreground">{TYPE_META[post.media_type as PostType]?.label ?? post.media_type}</span>
        </DialogTitle></DialogHeader>

        <div className="space-y-3">
          {post.thumbnail_url && (
            <img src={post.thumbnail_url} alt="" className="max-h-52 w-full rounded-xl object-cover ring-1 ring-border/40" />
          )}
          {post.status === "failed" && post.error && <div className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{post.error}</div>}

          {editable ? (
            <>
              {post.media_type !== "STORIES" && (
                <Textarea value={caption} onChange={(e) => setCaption(e.target.value.slice(0, 2200))} className="min-h-[90px] rounded-xl border-border/60 text-sm" />
              )}
              <div className="flex items-center gap-2">
                <input type="date" value={ymd} onChange={(e) => setYmd(e.target.value)} className="h-9 rounded-lg border border-border/60 bg-background px-2 text-sm" />
                <select value={hour} onChange={(e) => setHour(Number(e.target.value))} className="h-9 rounded-lg border border-border/60 bg-background px-2 text-sm">
                  {Array.from({ length: 24 }, (_, i) => i).map((h) => <option key={h} value={h}>{pad(h)}</option>)}
                </select><span>:</span>
                <select value={minute} onChange={(e) => setMinute(Number(e.target.value))} className="h-9 rounded-lg border border-border/60 bg-background px-2 text-sm">
                  {Array.from({ length: 12 }, (_, i) => i * 5).map((m) => <option key={m} value={m}>{pad(m)}</option>)}
                </select>
                <span className="text-[10px] text-muted-foreground">Алматы</span>
              </div>
            </>
          ) : (
            <div className="text-sm">
              <div className="text-muted-foreground">{almatyHm(post.scheduled_at)} · {prettyDay(almatyYmd(post.scheduled_at))}</div>
              {post.caption && <div className="mt-1 whitespace-pre-wrap">{post.caption}</div>}
            </div>
          )}
        </div>

        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <div className="flex gap-2">
            {post.status !== "published" && <Button variant="ghost" size="sm" className="rounded-lg text-destructive hover:bg-destructive/10" onClick={() => void act(() => schedulerApi("delete", { id: post.id }))} disabled={busy}><Trash2 className="mr-1 h-4 w-4" /> Удалить</Button>}
            {post.status === "failed" && <Button variant="ghost" size="sm" className="rounded-lg" onClick={() => void act(() => schedulerApi("retry", { id: post.id }), "Повторяем")} disabled={busy}><RotateCcw className="mr-1 h-4 w-4" /> Повторить</Button>}
          </div>
          <div className="flex gap-2">
            {editable && <Button variant="outline" size="sm" className="rounded-lg border-primary/40 text-primary hover:bg-primary/10" onClick={() => void act(() => schedulerApi("publish_now", { id: post.id }), "Публикуем сейчас…")} disabled={busy}><Zap className="mr-1 h-4 w-4" /> Сейчас</Button>}
            {editable && <Button size="sm" className="rounded-lg" onClick={() => void act(() => schedulerApi("update", { id: post.id, caption, scheduled_at: buildISO(ymd, hour, minute) }), "Сохранено")} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Pencil className="mr-1 h-4 w-4" /> Сохранить</>}</Button>}
            {!editable && <Button size="sm" className="rounded-lg" onClick={onClose}>Закрыть</Button>}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default AutoPost;
