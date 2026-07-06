import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock, Film, FlaskConical,
  Images, Loader2, Pencil, Plus, RefreshCw, RotateCcw, Send, Sparkles, Trash2, Upload, X, Zap,
} from "lucide-react";
import { toast } from "sonner";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { clientConfigSupabase } from "@/integrations/clientConfig/client";
import { fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";

// Раздел «Автопостинг» — календарь публикаций Instagram (cf_scheduled_posts, клиентский Supabase).
// Медиа → публичный бакет autopost, публикует publisher по крону раз в минуту. Время — Алматы.
const CLIENT_URL = (import.meta.env.VITE_CLIENT_SUPABASE_URL as string | undefined) || "";
const CLIENT_KEY = (import.meta.env.VITE_CLIENT_SUPABASE_PUBLISHABLE_KEY as string | undefined) || "";
const BUCKET = "autopost";
const WD_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const WD_FROM_DOW = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];

type PostType = "IMAGE" | "REELS" | "CAROUSEL" | "STORIES";

interface QueuePost {
  id: string; media_type: string; media_url: string | null; thumbnail_url: string | null;
  child_urls: string[] | null; caption: string | null; scheduled_at: string; status: string;
  dry_run: boolean; published_ig_media_id: string | null; error: string | null;
}
interface Stats {
  total_posts: number; published_this_period: number; scheduled_upcoming: number;
  best_weekday: number | null; best_hour: number | null;
  by_weekday: { dow: number; posts: number; avg_reach: number }[];
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

const pad = (n: number) => String(n).padStart(2, "0");
const almatyYmd = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Almaty" });
const almatyHm = (iso: string) => new Date(iso).toLocaleTimeString("ru-RU", { timeZone: "Asia/Almaty", hour: "2-digit", minute: "2-digit" });
const buildISO = (ymd: string, hour: number, minute: number) => new Date(`${ymd}T${pad(hour)}:${pad(minute)}:00+05:00`).toISOString();
const todayAlmatyYmd = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Almaty" });
const ymdOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const prettyDay = (ymd: string) => { const [y, m, d] = ymd.split("-").map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };

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
  const [view, setView] = useState(() => new Date());
  const [posts, setPosts] = useState<QueuePost[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async (v: Date) => {
    try {
      const { from, to } = monthRangeYmd(v);
      const [q, s] = await Promise.all([
        schedulerApi<{ posts: QueuePost[] }>("list"),
        schedulerApi<{ stats: Stats }>("stats", { from, to }),
      ]);
      setPosts(q.posts ?? []); setStats(s.stats ?? null);
    } catch (e) { toast.error("Не удалось загрузить", { description: e instanceof Error ? e.message : String(e) }); }
    finally { setLoading(false); }
  }, []);
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

  const openAdd = (ymd: string) => setAddDay(ymd);
  const monthLabel = `${MONTHS[view.getMonth()]} ${view.getFullYear()}`;

  return (
    <PageContainer wide>
      <PageHeader
        icon={CalendarDays}
        title="Автопостинг"
        description="Календарь публикаций в Instagram. Кликните день, чтобы запланировать пост. Время — по Алматы."
        actions={
          <Button variant="outline" size="icon" className="h-10 w-10 rounded-xl border-border/60" aria-label="Обновить" onClick={() => void loadAll(view)} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        }
      />

      {/* Статистика */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Опубликовано за месяц", value: fmtNum(stats?.published_this_period ?? 0), cls: "text-emerald-600" },
          { label: "Запланировано", value: fmtNum(stats?.scheduled_upcoming ?? 0) },
          { label: "Постов в анализе", value: fmtNum(stats?.total_posts ?? 0) },
          { label: "Лучшее время", value: stats?.best_weekday != null && stats?.best_hour != null ? `${WD_FROM_DOW[stats.best_weekday]} ${pad(stats.best_hour)}:00` : "—" },
        ].map((k) => (
          <div key={k.label} className="rounded-2xl border border-border/60 bg-card/60 p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{k.label}</div>
            <div className={cn("mt-1 whitespace-nowrap text-lg font-bold tabular-nums", k.cls)}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Тулбар месяца */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-9 w-9 rounded-lg" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}><ChevronLeft className="h-4 w-4" /></Button>
          <div className="min-w-[150px] text-center text-lg font-bold capitalize">{monthLabel}</div>
          <Button variant="outline" size="icon" className="h-9 w-9 rounded-lg" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}><ChevronRight className="h-4 w-4" /></Button>
          <Button variant="ghost" size="sm" className="h-9 rounded-lg text-xs" onClick={() => setView(new Date())}>Сегодня</Button>
          {stats?.best_weekday != null && stats?.best_hour != null && (
            <span className="ml-2 hidden items-center gap-1 text-[11px] text-muted-foreground sm:inline-flex">
              <Sparkles className="h-3.5 w-3.5 text-primary" /> Лучшее время: <b className="text-foreground">{WD_FROM_DOW[stats.best_weekday]} {pad(stats.best_hour)}:00</b>
            </span>
          )}
        </div>
        <Button className="rounded-xl" onClick={() => openAdd(todayAlmatyYmd())}><Plus className="mr-1.5 h-4 w-4" /> Новая публикация</Button>
      </div>

      {/* Календарь */}
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
                <div className="mt-1 space-y-1">
                  {dayPosts.slice(0, 4).map((p) => {
                    const s = STATUS_META[p.status] ?? STATUS_META.queued;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setEditing(p); }}
                        className={cn("flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left text-[10px] transition hover:brightness-95", s.cls)}
                        title={`${s.label} · ${almatyHm(p.scheduled_at)}`}
                      >
                        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", s.dot)} />
                        <span className="shrink-0 font-semibold tabular-nums">{almatyHm(p.scheduled_at)}</span>
                        <span className="min-w-0 flex-1 truncate opacity-90">{TYPE_META[p.media_type as PostType]?.label ?? p.media_type}{p.caption ? ` · ${p.caption}` : ""}</span>
                      </button>
                    );
                  })}
                  {dayPosts.length > 4 && <div className="px-1.5 text-[10px] text-muted-foreground">+{dayPosts.length - 4} ещё</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <p className="mt-3 text-[11px] text-muted-foreground">Лимит Instagram — 25 публикаций за 24 часа. Клик по дню — добавить пост, клик по посту — открыть и отредактировать.</p>

      {addDay && <AddDialog day={addDay} onClose={() => setAddDay(null)} onDone={() => { setAddDay(null); void loadAll(view); }} />}
      {editing && <EditDialog post={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); void loadAll(view); }} />}
    </PageContainer>
  );
};

// ——— Диалог добавления публикации на конкретный день ———
function AddDialog({ day, onClose, onDone }: { day: string; onClose: () => void; onDone: () => void }) {
  const [type, setType] = useState<PostType>("IMAGE");
  const [files, setFiles] = useState<File[]>([]);
  const [caption, setCaption] = useState("");
  const [hour, setHour] = useState(12);
  const [minute, setMinute] = useState(0);
  const [dryRun, setDryRun] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const meta = TYPE_META[type];

  const pick = (list: FileList | null) => { if (!list) return; const a = Array.from(list); setFiles(meta.multiple ? a.slice(0, 10) : a.slice(0, 1)); };
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
      const payload: Record<string, unknown> = {
        media_type: type, caption: type === "STORIES" ? "" : caption,
        scheduled_at: now ? new Date().toISOString() : buildISO(day, hour, minute), dry_run: now ? false : dryRun,
      };
      if (type === "CAROUSEL") { payload.child_urls = urls; payload.thumbnail_url = urls.find((_, i) => !isVideoFile(files[i])) ?? urls[0]; }
      else { payload.media_url = urls[0]; payload.thumbnail_url = isVideoFile(files[0]) ? null : urls[0]; }
      const res = await schedulerApi<{ post: QueuePost }>("create", payload);
      if (now && res.post?.id) await schedulerApi("publish_now", { id: res.post.id });
      toast.success(now ? "Публикуем сейчас…" : dryRun ? "Добавлено в пробном режиме" : "Запланировано");
      onDone();
    } catch (e) { toast.error("Не удалось", { description: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Публикация на {prettyDay(day)}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-2">
            {(Object.keys(TYPE_META) as PostType[]).map((t) => {
              const M = TYPE_META[t]; const Icon = M.icon;
              return (
                <button key={t} type="button" onClick={() => { setType(t); setFiles([]); if (fileRef.current) fileRef.current.value = ""; }}
                  className={cn("flex flex-col items-center gap-1 rounded-xl border px-2 py-2 text-[11px] font-medium transition",
                    type === t ? "border-primary/60 bg-primary/10 text-primary" : "border-border/60 bg-background hover:bg-secondary/40")}>
                  <Icon className="h-4 w-4" /> {M.label}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">{meta.hint}</p>

          <input ref={fileRef} type="file" accept={meta.accept} multiple={meta.multiple} onChange={(e) => pick(e.target.files)} className="hidden" id="add-file" />
          <label htmlFor="add-file" className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 bg-background px-3 py-5 text-xs text-muted-foreground transition hover:bg-secondary/30">
            <Upload className="h-4 w-4" /> {meta.multiple ? "Выбрать файлы (2–10)" : "Выбрать файл"}
          </label>
          {files.length > 0 && (
            <div className="space-y-1">
              {files.map((f, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg bg-secondary/40 px-2 py-1 text-[11px]">
                  {isVideoFile(f) ? <Film className="h-3.5 w-3.5 shrink-0" /> : <Images className="h-3.5 w-3.5 shrink-0" />}
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <span className="shrink-0 text-muted-foreground">{(f.size / 1024 / 1024).toFixed(1)} МБ</span>
                  <button type="button" onClick={() => setFiles((x) => x.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-destructive"><X className="h-3.5 w-3.5" /></button>
                </div>
              ))}
            </div>
          )}

          {type !== "STORIES" && (
            <Textarea value={caption} onChange={(e) => setCaption(e.target.value.slice(0, 2200))} placeholder="Текст публикации, хэштеги…" className="min-h-[80px] rounded-xl border-border/60 text-sm" />
          )}

          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Время:</span>
            <select value={hour} onChange={(e) => setHour(Number(e.target.value))} className="h-9 rounded-lg border border-border/60 bg-background px-2 text-sm">
              {Array.from({ length: 24 }, (_, i) => i).map((h) => <option key={h} value={h}>{pad(h)}</option>)}
            </select>
            <span>:</span>
            <select value={minute} onChange={(e) => setMinute(Number(e.target.value))} className="h-9 rounded-lg border border-border/60 bg-background px-2 text-sm">
              {Array.from({ length: 12 }, (_, i) => i * 5).map((m) => <option key={m} value={m}>{pad(m)}</option>)}
            </select>
            <label className="ml-auto flex items-center gap-1.5 text-xs">
              <Switch checked={dryRun} onCheckedChange={setDryRun} />
              <FlaskConical className="h-3.5 w-3.5 text-violet-500" /> Пробный
            </label>
          </div>
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
