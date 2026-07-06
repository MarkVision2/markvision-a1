import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle, BarChart3, CalendarDays, CheckCircle2, Clock, ExternalLink, Film, FlaskConical,
  Images, Loader2, Pencil, RefreshCw, RotateCcw, Send, Sparkles, Trash2, Upload, X, Zap,
} from "lucide-react";
import { toast } from "sonner";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { clientConfigSupabase } from "@/integrations/clientConfig/client";
import { fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";

// Раздел «Автопостинг»: планировщик Instagram-публикаций (cf_scheduled_posts, клиентский Supabase).
// Медиа → публичный бакет autopost, публикует publisher по крону раз в минуту.
const CLIENT_URL = (import.meta.env.VITE_CLIENT_SUPABASE_URL as string | undefined) || "";
const CLIENT_KEY = (import.meta.env.VITE_CLIENT_SUPABASE_PUBLISHABLE_KEY as string | undefined) || "";
const BUCKET = "autopost";
const WD = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

type PostType = "IMAGE" | "REELS" | "CAROUSEL" | "STORIES";

interface QueuePost {
  id: string;
  media_type: string;
  media_url: string | null;
  thumbnail_url: string | null;
  child_urls: string[] | null;
  caption: string | null;
  scheduled_at: string;
  status: string;
  dry_run: boolean;
  published_ig_media_id: string | null;
  error: string | null;
}
interface Stats {
  total_posts: number;
  published_this_period: number;
  scheduled_upcoming: number;
  best_weekday: number | null;
  best_hour: number | null;
  by_weekday: { dow: number; posts: number; avg_reach: number; avg_inter: number }[];
  by_hour: { hour: number; posts: number; avg_reach: number; avg_inter: number }[];
}

const TYPE_META: Record<PostType, { label: string; icon: typeof Images; accept: string; multiple: boolean; hint: string }> = {
  IMAGE: { label: "Пост (фото)", icon: Images, accept: "image/jpeg,image/png,image/webp", multiple: false, hint: "JPEG/PNG. Квадрат 1:1 или 4:5." },
  REELS: { label: "Reels (видео)", icon: Film, accept: "video/mp4,video/quicktime", multiple: false, hint: "9:16, 5–90 сек, MP4 (H.264)." },
  CAROUSEL: { label: "Карусель", icon: Images, accept: "image/jpeg,image/png,image/webp,video/mp4", multiple: true, hint: "2–10 фото/видео." },
  STORIES: { label: "Сторис", icon: Clock, accept: "image/jpeg,image/png,image/webp,video/mp4", multiple: false, hint: "9:16. Фото или видео до 60 сек." },
};

const STATUS_META: Record<string, { label: string; cls: string; icon: typeof Clock }> = {
  queued: { label: "В очереди", cls: "bg-sky-500/10 text-sky-600", icon: Clock },
  processing: { label: "Обрабатывается", cls: "bg-amber-500/10 text-amber-600", icon: Loader2 },
  published: { label: "Опубликовано", cls: "bg-emerald-500/10 text-emerald-600", icon: CheckCircle2 },
  tested: { label: "Проверено (тест)", cls: "bg-violet-500/10 text-violet-600", icon: FlaskConical },
  failed: { label: "Ошибка", cls: "bg-destructive/10 text-destructive", icon: AlertCircle },
};

function buildISO(day: Date, hour: number, minute: number): string {
  const y = day.getFullYear(), m = String(day.getMonth() + 1).padStart(2, "0"), d = String(day.getDate()).padStart(2, "0");
  const hh = String(hour).padStart(2, "0"), mi = String(minute).padStart(2, "0");
  return new Date(`${y}-${m}-${d}T${hh}:${mi}:00+05:00`).toISOString();
}
function fmtAlmaty(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", { timeZone: "Asia/Almaty", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function fmtDay(d: Date): string {
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "long" });
}

async function schedulerApi<T = unknown>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (!CLIENT_URL) throw new Error("VITE_CLIENT_SUPABASE_URL не задан");
  const r = await fetch(`${CLIENT_URL}/functions/v1/content-scheduler`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-app-key": CLIENT_KEY },
    body: JSON.stringify({ action, ...payload }),
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
const monthRangeYmd = () => {
  const n = new Date();
  const from = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-01`;
  const last = new Date(n.getFullYear(), n.getMonth() + 1, 0);
  const to = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`;
  return { from, to };
};

// ——— Календарный выбор даты и времени ———
function DateTimePicker({ day, hour, minute, onChange, compact }: {
  day: Date | undefined; hour: number; minute: number;
  onChange: (day: Date | undefined, hour: number, minute: number) => void; compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const label = day ? `${fmtDay(day)}, ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` : "Выбрать дату и время";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn("flex h-10 w-full items-center gap-2 rounded-xl border border-border/60 bg-background px-3 text-sm", compact && "h-9")}
        >
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          <span className={cn(!day && "text-muted-foreground")}>{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-3">
        <Calendar mode="single" selected={day} onSelect={(d) => onChange(d ?? undefined, hour, minute)} initialFocus />
        <div className="mt-2 flex items-center gap-2 border-t border-border/40 pt-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <select value={hour} onChange={(e) => onChange(day, Number(e.target.value), minute)} className="h-9 flex-1 rounded-lg border border-border/60 bg-background px-2 text-sm">
            {Array.from({ length: 24 }, (_, i) => i).map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}</option>)}
          </select>
          <span className="text-muted-foreground">:</span>
          <select value={minute} onChange={(e) => onChange(day, hour, Number(e.target.value))} className="h-9 flex-1 rounded-lg border border-border/60 bg-background px-2 text-sm">
            {Array.from({ length: 12 }, (_, i) => i * 5).map((m) => <option key={m} value={m}>{String(m).padStart(2, "0")}</option>)}
          </select>
          <Button size="sm" className="h-9 rounded-lg" onClick={() => setOpen(false)}>ОК</Button>
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">Время по Алматы</p>
      </PopoverContent>
    </Popover>
  );
}

const AutoPost = () => {
  const [type, setType] = useState<PostType>("IMAGE");
  const [files, setFiles] = useState<File[]>([]);
  const [caption, setCaption] = useState("");
  const [day, setDay] = useState<Date | undefined>(() => new Date(Date.now() + 60 * 60 * 1000));
  const [hour, setHour] = useState<number>(() => new Date(Date.now() + 60 * 60 * 1000).getHours());
  const [minute, setMinute] = useState<number>(0);
  const [dryRun, setDryRun] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [posts, setPosts] = useState<QueuePost[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  // Редактирование
  const [editing, setEditing] = useState<QueuePost | null>(null);
  const [editCaption, setEditCaption] = useState("");
  const [editDay, setEditDay] = useState<Date | undefined>(undefined);
  const [editHour, setEditHour] = useState(12);
  const [editMinute, setEditMinute] = useState(0);
  const [savingEdit, setSavingEdit] = useState(false);

  const meta = TYPE_META[type];

  const loadAll = useCallback(async () => {
    try {
      const { from, to } = monthRangeYmd();
      const [q, s] = await Promise.all([
        schedulerApi<{ posts: QueuePost[] }>("list"),
        schedulerApi<{ stats: Stats }>("stats", { from, to }),
      ]);
      setPosts(q.posts ?? []);
      setStats(s.stats ?? null);
    } catch (e) {
      toast.error("Не удалось загрузить данные", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void loadAll(); }, [loadAll]);
  useEffect(() => {
    const pending = posts.some((p) => p.status === "queued" || p.status === "processing");
    if (!pending) return;
    const t = setInterval(() => void loadAll(), 20_000);
    return () => clearInterval(t);
  }, [posts, loadAll]);

  const onPickFiles = (list: FileList | null) => {
    if (!list) return;
    const arr = Array.from(list);
    setFiles(meta.multiple ? arr.slice(0, 10) : arr.slice(0, 1));
  };
  const removeFile = (i: number) => setFiles((f) => f.filter((_, idx) => idx !== i));

  const validate = (): string | null => {
    if (files.length === 0) return "Добавьте медиа";
    if (type === "CAROUSEL" && files.length < 2) return "Для карусели нужно минимум 2 файла";
    if (type === "REELS" && !isVideoFile(files[0])) return "Для Reels нужен видеофайл";
    if (type === "IMAGE" && isVideoFile(files[0])) return "Для поста нужно фото (для видео выберите Reels)";
    if (!day) return "Укажите дату и время";
    return null;
  };

  const submit = async (publishNow: boolean) => {
    const err = validate();
    if (err) { toast.error(err); return; }
    setSubmitting(true);
    try {
      const urls: string[] = [];
      for (const f of files) urls.push(await uploadToBucket(f));
      const payload: Record<string, unknown> = {
        media_type: type,
        caption: type === "STORIES" ? "" : caption,
        scheduled_at: publishNow ? new Date().toISOString() : buildISO(day!, hour, minute),
        dry_run: publishNow ? false : dryRun,
      };
      if (type === "CAROUSEL") {
        payload.child_urls = urls;
        payload.thumbnail_url = urls.find((_, i) => !isVideoFile(files[i])) ?? urls[0];
      } else {
        payload.media_url = urls[0];
        payload.thumbnail_url = isVideoFile(files[0]) ? null : urls[0];
      }
      const res = await schedulerApi<{ post: QueuePost }>("create", payload);
      if (publishNow && res.post?.id) await schedulerApi("publish_now", { id: res.post.id });
      toast.success(publishNow ? "Публикуем сейчас…" : dryRun ? "Добавлено в пробном режиме" : "Пост поставлен в очередь");
      setFiles([]); setCaption("");
      if (fileRef.current) fileRef.current.value = "";
      void loadAll();
    } catch (e) {
      toast.error("Не удалось", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSubmitting(false);
    }
  };

  const publishNow = async (id: string) => { try { await schedulerApi("publish_now", { id }); toast.success("Публикуем сейчас…"); void loadAll(); } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } };
  const retry = async (id: string) => { try { await schedulerApi("retry", { id }); toast.success("Повторяем"); void loadAll(); } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } };
  const del = async (id: string) => { try { await schedulerApi("delete", { id }); void loadAll(); } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } };

  const openEdit = (p: QueuePost) => {
    setEditing(p);
    setEditCaption(p.caption ?? "");
    const d = new Date(p.scheduled_at);
    // локальная дата/время в Алматы
    const alm = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Almaty" }));
    setEditDay(alm); setEditHour(alm.getHours()); setEditMinute(alm.getMinutes() - (alm.getMinutes() % 5));
  };
  const saveEdit = async () => {
    if (!editing || !editDay) return;
    setSavingEdit(true);
    try {
      await schedulerApi("update", { id: editing.id, caption: editCaption, scheduled_at: buildISO(editDay, editHour, editMinute) });
      toast.success("Сохранено");
      setEditing(null);
      void loadAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingEdit(false);
    }
  };

  const applyBestTime = () => {
    if (stats?.best_weekday == null || stats?.best_hour == null) return;
    const dow = stats.best_weekday, h = stats.best_hour;
    const now = new Date();
    for (let i = 0; i < 8; i++) {
      const c = new Date(now); c.setDate(now.getDate() + i); c.setHours(0, 0, 0, 0);
      if (c.getDay() === dow) {
        if (i === 0 && now.getHours() >= h) continue;
        setDay(c); setHour(h); setMinute(0);
        toast.success(`Выбрано лучшее время: ${WD[dow]}, ${String(h).padStart(2, "0")}:00`);
        return;
      }
    }
  };

  const publishedToday = useMemo(() => {
    const dayAgo = Date.now() - 24 * 3600 * 1000;
    return posts.filter((p) => p.status === "published" && new Date(p.scheduled_at).getTime() > dayAgo).length;
  }, [posts]);

  const maxWdReach = Math.max(1, ...(stats?.by_weekday ?? []).map((w) => w.avg_reach));

  return (
    <PageContainer>
      <PageHeader
        icon={CalendarDays}
        title="Автопостинг"
        description="Планируйте публикации в Instagram: фото, Reels, карусель, сторис. Время — по Алматы."
        actions={
          <Button variant="outline" size="icon" className="h-10 w-10 rounded-xl border-border/60" aria-label="Обновить" onClick={() => void loadAll()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        }
      />

      {/* Статистика за месяц */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Опубликовано за месяц", value: fmtNum(stats?.published_this_period ?? 0), cls: "text-emerald-600" },
          { label: "Запланировано", value: fmtNum(stats?.scheduled_upcoming ?? 0) },
          { label: "Постов в анализе", value: fmtNum(stats?.total_posts ?? 0) },
          { label: "Лучшее время", value: stats?.best_weekday != null && stats?.best_hour != null ? `${WD[stats.best_weekday]} ${String(stats.best_hour).padStart(2, "0")}:00` : "—" },
        ].map((k) => (
          <div key={k.label} className="rounded-2xl border border-border/60 bg-card/60 p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{k.label}</div>
            <div className={cn("mt-1 whitespace-nowrap text-lg font-bold tabular-nums", k.cls)}>{k.value}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
        {/* Левая колонка: форма + лучшее время */}
        <div className="space-y-6">
          {/* Форма */}
          <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
            <h2 className="text-sm font-semibold">Новая публикация</h2>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {(Object.keys(TYPE_META) as PostType[]).map((t) => {
                const M = TYPE_META[t]; const Icon = M.icon;
                return (
                  <button key={t} type="button" onClick={() => { setType(t); setFiles([]); if (fileRef.current) fileRef.current.value = ""; }}
                    className={cn("flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition",
                      type === t ? "border-primary/60 bg-primary/10 text-primary" : "border-border/60 bg-background hover:bg-secondary/40")}>
                    <Icon className="h-4 w-4" /> {M.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">{meta.hint}</p>

            <div className="mt-3">
              <input ref={fileRef} type="file" accept={meta.accept} multiple={meta.multiple} onChange={(e) => onPickFiles(e.target.files)} className="hidden" id="autopost-file" />
              <label htmlFor="autopost-file" className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 bg-background px-3 py-6 text-xs text-muted-foreground transition hover:bg-secondary/30">
                <Upload className="h-4 w-4" /> {meta.multiple ? "Выбрать файлы (2–10)" : "Выбрать файл"}
              </label>
              {files.length > 0 && (
                <div className="mt-2 space-y-1">
                  {files.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-lg bg-secondary/40 px-2 py-1 text-[11px]">
                      {isVideoFile(f) ? <Film className="h-3.5 w-3.5 shrink-0" /> : <Images className="h-3.5 w-3.5 shrink-0" />}
                      <span className="min-w-0 flex-1 truncate">{f.name}</span>
                      <span className="shrink-0 text-muted-foreground">{(f.size / 1024 / 1024).toFixed(1)} МБ</span>
                      <button type="button" onClick={() => removeFile(i)} className="shrink-0 text-muted-foreground hover:text-destructive"><X className="h-3.5 w-3.5" /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {type !== "STORIES" && (
              <div className="mt-3">
                <Textarea value={caption} onChange={(e) => setCaption(e.target.value.slice(0, 2200))} placeholder="Текст публикации, хэштеги…" className="min-h-[90px] rounded-xl border-border/60 text-sm" />
                <div className="mt-1 text-right text-[10px] text-muted-foreground">{caption.length}/2200</div>
              </div>
            )}

            <div className="mt-1">
              <label className="text-[11px] font-medium text-muted-foreground">Когда опубликовать</label>
              <div className="mt-1"><DateTimePicker day={day} hour={hour} minute={minute} onChange={(d, h, m) => { setDay(d); setHour(h); setMinute(m); }} /></div>
            </div>

            <label className="mt-3 flex items-center gap-2 text-xs">
              <Switch checked={dryRun} onCheckedChange={setDryRun} />
              <FlaskConical className="h-3.5 w-3.5 text-violet-500" />
              <span>Пробный режим <span className="text-muted-foreground">(проверить без публикации)</span></span>
            </label>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button className="rounded-xl" onClick={() => void submit(false)} disabled={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Send className="mr-2 h-4 w-4" /> В очередь</>}
              </Button>
              <Button variant="outline" className="rounded-xl border-primary/40 text-primary hover:bg-primary/10" onClick={() => void submit(true)} disabled={submitting || dryRun}>
                <Zap className="mr-2 h-4 w-4" /> Сейчас
              </Button>
            </div>
            <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
              Лимит Instagram — 25 публикаций за 24 часа. За сутки опубликовано: {publishedToday}.
            </p>
          </div>

          {/* Лучшее время */}
          <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold"><BarChart3 className="h-4 w-4" /> Лучшее время</h2>
              {stats?.best_weekday != null && (
                <Button size="sm" variant="ghost" className="h-7 rounded-lg text-xs text-primary" onClick={applyBestTime}>
                  <Sparkles className="mr-1 h-3.5 w-3.5" /> Применить
                </Button>
              )}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              По охвату прошлых публикаций. {stats?.best_weekday != null && stats?.best_hour != null
                ? <>Рекомендуем: <span className="font-semibold text-foreground">{WD[stats.best_weekday]}, {String(stats.best_hour).padStart(2, "0")}:00</span>.</>
                : "Данных пока мало — публикуйте в разное время, и рекомендация уточнится."}
            </p>
            <div className="mt-3 flex items-end justify-between gap-1.5" style={{ height: 90 }}>
              {(stats?.by_weekday ?? []).map((w) => (
                <div key={w.dow} className="flex flex-1 flex-col items-center gap-1">
                  <div className="flex w-full flex-1 items-end">
                    <div
                      className={cn("w-full rounded-t", w.dow === stats?.best_weekday ? "bg-primary" : "bg-primary/30")}
                      style={{ height: `${Math.max(6, (w.avg_reach / maxWdReach) * 100)}%` }}
                      title={`${WD[w.dow]}: охват ~${fmtNum(w.avg_reach)}, постов ${w.posts}`}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground">{WD[w.dow]}</span>
                </div>
              ))}
              {(stats?.by_weekday ?? []).length === 0 && <div className="w-full text-center text-xs text-muted-foreground">нет данных</div>}
            </div>
          </div>
        </div>

        {/* Правая колонка: очередь */}
        <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
          <h2 className="text-sm font-semibold">Очередь и история</h2>
          <div className="mt-3 space-y-2">
            {loading && posts.length === 0 && <div className="py-10 text-center text-sm text-muted-foreground">Загружаем…</div>}
            {!loading && posts.length === 0 && <div className="py-10 text-center text-sm text-muted-foreground">Пока пусто. Запланируйте первую публикацию слева.</div>}
            {posts.map((p) => {
              const s = STATUS_META[p.status] ?? { label: p.status, cls: "bg-secondary text-muted-foreground", icon: Clock };
              const SIcon = s.icon;
              const editable = p.status === "queued" || p.status === "failed" || p.status === "tested";
              return (
                <div key={p.id} className="flex items-start gap-3 rounded-xl border border-border/40 bg-background/60 p-2.5">
                  <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-secondary/50 ring-1 ring-border/40">
                    {p.thumbnail_url ? <img src={p.thumbnail_url} alt="" loading="lazy" className="h-full w-full object-cover" /> : <div className="grid h-full w-full place-items-center text-muted-foreground">{p.media_type === "REELS" ? <Film className="h-5 w-5" /> : <Images className="h-5 w-5" />}</div>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold", s.cls)}>
                        <SIcon className={cn("h-3 w-3", p.status === "processing" && "animate-spin")} /> {s.label}
                      </span>
                      {p.dry_run && p.status !== "tested" && <span className="rounded bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-600">пробный</span>}
                      <span className="rounded bg-secondary/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{TYPE_META[p.media_type as PostType]?.label ?? p.media_type}</span>
                      <span className="text-[10px] tabular-nums text-muted-foreground">{fmtAlmaty(p.scheduled_at)}</span>
                    </div>
                    <div className="mt-1 line-clamp-2 text-xs text-foreground/90">{p.caption || <span className="text-muted-foreground">Без подписи</span>}</div>
                    {p.status === "failed" && p.error && <div className="mt-1 line-clamp-2 text-[10px] text-destructive">{p.error}</div>}
                  </div>
                  <div className="flex shrink-0 flex-col items-center gap-1">
                    {editable && <button type="button" onClick={() => void publishNow(p.id)} className="rounded-lg p-1.5 text-muted-foreground hover:text-primary" title="Опубликовать сейчас"><Zap className="h-4 w-4" /></button>}
                    {editable && <button type="button" onClick={() => openEdit(p)} className="rounded-lg p-1.5 text-muted-foreground hover:text-primary" title="Редактировать"><Pencil className="h-4 w-4" /></button>}
                    {p.status === "failed" && <button type="button" onClick={() => void retry(p.id)} className="rounded-lg p-1.5 text-muted-foreground hover:text-primary" title="Повторить"><RotateCcw className="h-4 w-4" /></button>}
                    {p.status !== "published" && <button type="button" onClick={() => void del(p.id)} className="rounded-lg p-1.5 text-muted-foreground hover:text-destructive" title="Удалить"><Trash2 className="h-4 w-4" /></button>}
                    {p.status === "published" && <a href="https://www.instagram.com/" target="_blank" rel="noreferrer" className="rounded-lg p-1.5 text-muted-foreground hover:text-primary" title="Открыть Instagram"><ExternalLink className="h-4 w-4" /></a>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Диалог редактирования */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Редактировать публикацию</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-[11px] font-medium text-muted-foreground">Подпись</label>
              <Textarea value={editCaption} onChange={(e) => setEditCaption(e.target.value.slice(0, 2200))} className="mt-1 min-h-[100px] rounded-xl border-border/60 text-sm" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground">Когда опубликовать</label>
              <div className="mt-1"><DateTimePicker day={editDay} hour={editHour} minute={editMinute} onChange={(d, h, m) => { setEditDay(d); setEditHour(h); setEditMinute(m); }} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="rounded-xl" onClick={() => setEditing(null)}>Отмена</Button>
            <Button className="rounded-xl" onClick={() => void saveEdit()} disabled={savingEdit}>{savingEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : "Сохранить"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
};

export default AutoPost;
