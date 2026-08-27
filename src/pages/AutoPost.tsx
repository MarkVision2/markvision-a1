import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock, Film, Flame, Images, Instagram, ListChecks, Loader2, Plus, RefreshCw, Sparkles, Trash2, Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { useInstagramAccount } from "@/hooks/useInstagramAccount";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { clientConfigSupabase } from "@/integrations/clientConfig/client";
import { supabase } from "@/integrations/supabase/client";
import { clientSupabasePublishableKey, clientSupabaseUrl } from "@/lib/supabaseConfig";
import { fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AutopostComposerDialog } from "@/components/autopost/AutopostComposerDialog";
import { AutopostEditDialog } from "@/components/autopost/AutopostEditDialog";
import { AutopostUpcomingRail } from "@/components/autopost/AutopostUpcomingRail";
import { MediaThumb } from "@/components/autopost/MediaThumb";
import { defaultFeed45View, fileCropKey } from "@/components/autopost/Feed45Crop";
import { STATUS_META, TYPE_META, type PostType } from "@/components/autopost/constants";
import { upsertContentPlanFromAutopost } from "@/lib/contentPlanAutopostBridge";
import { captureFrameFromVideoFile, ensureJpegCoverFile, generateAutopostCaption } from "@/lib/autopostAiCaption";
import { cropImageFile, type ViewParams } from "@/lib/cropMedia";

// Раздел «Автопостинг» — календарь + очередь публикаций Instagram (cf_scheduled_posts,
// клиентский Supabase). Медиа → публичный бакет autopost, публикует publisher по крону
// раз в минуту. Время — Алматы.
const CLIENT_URL = clientSupabaseUrl;
const CLIENT_KEY = clientSupabasePublishableKey;
const BUCKET = "autopost";
// Free-план Supabase жёстко ограничивает Storage 50 МБ на файл вне зависимости
// от bucket-level file_size_limit — превышение даёт нечитаемую ошибку
// "The object exceeded the maximum allowed size". Файлы до этого порога грузим
// напрямую в Supabase (как раньше); больше — через presigned URL в Cloudflare
// R2 (r2-presign-upload), у которого такого лимита нет.
const SUPABASE_DIRECT_MAX_MB = 50;
const SUPABASE_DIRECT_MAX_BYTES = SUPABASE_DIRECT_MAX_MB * 1024 * 1024;
const MAX_FILE_MB = 500;
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;
const WD_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const WD_FROM_DOW = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];

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
function formatPublishError(raw: string | null | undefined): string {
  if (!raw) return "Неизвестная ошибка публикации";
  try {
    const j = JSON.parse(raw) as { error?: { message?: string; code?: number } };
    if (j.error?.code === 190 || /Invalid OAuth access token|Cannot parse access token/i.test(j.error?.message ?? "")) {
      return "Токен Instagram устарел. Переподключите Facebook в Настройках → Meta и нажмите «Повторить».";
    }
    if (j.error?.message) return j.error.message;
  } catch {
    if (/Invalid OAuth access token|Cannot parse access token|code.?190/i.test(raw)) {
      return "Токен Instagram устарел. Переподключите Facebook в Настройках → Meta и нажмите «Повторить».";
    }
  }
  return raw.length > 240 ? `${raw.slice(0, 240)}…` : raw;
}

// "Failed to fetch" intermittent (~2/10) на автопостинге — сервер (edge-логи)
// не видит ни одного упавшего запроса, значит обрыв всегда чисто сетевой
// (мобильная сеть/wifi моргнули) на этапе транспорта, а не в бизнес-логике.
// Ретраим сами fetch-вызовы к presign и PUT в R2 — они идемпотентны (просто
// перезаливают те же байты в тот же ключ), поэтому безопасны для повтора.
async function fetchWithRetry(input: RequestInfo | URL, init: RequestInit, attempts = 3): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(input, init);
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Сетевая ошибка");
}
/**
 * Заголовки для edge-функций контент-завода: JWT пользователя вместо
 * публикуемого ключа, который был вшит в бандл (см. src/lib/autopostClient.ts).
 */
async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Сессия истекла — войдите заново");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
  if (CLIENT_KEY) headers.apikey = CLIENT_KEY;
  return headers;
}

async function schedulerApi<T = unknown>(action: string, payload: Record<string, unknown> = {}, projectId?: string | null): Promise<T> {
  if (!CLIENT_URL) throw new Error("VITE_CLIENT_SUPABASE_URL не задан");
  const r = await fetch(`${CLIENT_URL}/functions/v1/content-scheduler`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ action, ...(projectId ? { project_id: projectId } : {}), ...payload }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j as T;
}
async function presignR2(filename: string, contentType: string, size: number): Promise<{ uploadUrl: string; publicUrl: string }> {
  if (!CLIENT_URL) throw new Error("VITE_CLIENT_SUPABASE_URL не задан");
  const res = await fetchWithRetry(`${CLIENT_URL}/functions/v1/r2-presign-upload`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ filename, contentType, size }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.error || `Не удалось получить ссылку для загрузки (HTTP ${res.status})`);
  return { uploadUrl: j.uploadUrl as string, publicUrl: j.publicUrl as string };
}
async function uploadToR2(file: File): Promise<string> {
  const { uploadUrl, publicUrl } = await presignR2(file.name, file.type || "application/octet-stream", file.size);
  const put = await fetchWithRetry(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!put.ok) throw new Error(`Загрузка в хранилище не удалась (HTTP ${put.status})`);
  return publicUrl;
}

// Прогоняем каждое загруженное видео через ffmpeg-нормализацию (Vercel-функция
// api/autopost/normalize) перед публикацией: самая частая причина отказа
// Instagram "не смог обработать медиа" (код 2207052) — атом moov в конце файла
// вместо начала, что бывает почти у любого экспорта не через ffmpeg. Это
// защитный слой, а не обязательное условие: если нормализация не удалась
// (сеть, экзотический формат, файл слишком большой) — публикуем исходное
// видео как раньше, лучше без гарантии faststart, чем вообще не опубликовать.
async function normalizeVideoForInstagram(sourceUrl: string, contentType: string, sizeHint: number): Promise<string> {
  try {
    const { uploadUrl, publicUrl } = await presignR2(`normalized-${Date.now()}.mp4`, contentType || "video/mp4", sizeHint);
    const res = await fetchWithRetry("/api/autopost/normalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_url: sourceUrl, upload_url: uploadUrl }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j?.error) throw new Error(j?.error || `HTTP ${res.status}`);
    return publicUrl;
  } catch (e) {
    console.warn("normalizeVideoForInstagram failed, publishing raw upload instead", e);
    return sourceUrl;
  }
}

async function uploadToBucket(file: File): Promise<string> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`Файл ${(file.size / 1024 / 1024).toFixed(0)} МБ — максимум ${MAX_FILE_MB} МБ. Сожмите видео или уменьшите разрешение/битрейт.`);
  }
  // Файлы > 50 МБ Supabase Storage на Free-плане не принимает — грузим через R2.
  if (file.size > SUPABASE_DIRECT_MAX_BYTES) return uploadToR2(file);
  if (!clientConfigSupabase) throw new Error("Хранилище не настроено (VITE_CLIENT_SUPABASE_*)");
  const ext = (file.name.split(".").pop() || "bin").toLowerCase();
  const path = `posts/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const attempts = 3;
  let lastMessage = "";
  for (let i = 0; i < attempts; i++) {
    // upsert:true с попытки №2 — предыдущая попытка могла упасть уже после
    // того, как объект частично записался, а "Failed to fetch" — это тот же
    // чисто сетевой обрыв, что и в R2-ветке (см. fetchWithRetry выше), просто
    // здесь его кидает сам Supabase SDK, а не наш fetch.
    const { error } = await clientConfigSupabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: i > 0 });
    if (!error) return clientConfigSupabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    if (/exceeded the maximum allowed size/i.test(error.message)) {
      // Порог 50 МБ уже проверен выше, но на всякий случай — реальная платформенная
      // ошибка означает то же самое: пробуем через R2 вместо провала загрузки.
      return uploadToR2(file);
    }
    lastMessage = error.message;
    if (/failed to fetch/i.test(error.message) && i < attempts - 1) {
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
      continue;
    }
    break;
  }
  throw new Error(`Загрузка не удалась: ${lastMessage}`);
}
const isVideoFile = (f: File) => f.type.startsWith("video/");
const monthRangeYmd = (view: Date) => {
  const from = `${view.getFullYear()}-${pad(view.getMonth() + 1)}-01`;
  const last = new Date(view.getFullYear(), view.getMonth() + 1, 0);
  return { from, to: ymdOf(last) };
};

const AutoPost = ({ embedded = false }: { embedded?: boolean } = {}) => {
  const { active, activeId: projectId } = useProjectsStore();
  const { account, loading: accountLoading } = useInstagramAccount();
  const [view, setView] = useState(() => new Date());
  const [viewMode, setViewMode] = useState<ViewMode>("calendar");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [posts, setPosts] = useState<QueuePost[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialLoading, setInitialLoading] = useState(true);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const loadAll = useCallback(async (v: Date) => {
    if (!projectId) {
      setPosts([]);
      setStats(null);
      setLoading(false);
      setInitialLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { from, to } = monthRangeYmd(v);
      const [q, s] = await Promise.all([
        schedulerApi<{ posts: QueuePost[] }>("list", {}, projectId),
        schedulerApi<{ stats: Stats }>("stats", { from, to }, projectId),
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

  const stuckCount = useMemo(
    () => posts.filter((p) => p.status !== "published").length,
    [posts],
  );

  const clearStuckPosts = async () => {
    if (!projectId || stuckCount === 0) return;
    const failed = statusCounts.failed ?? 0;
    const queued = statusCounts.queued ?? 0;
    const other = stuckCount - failed - queued;
    const msg = [
      `Удалить ${stuckCount} зависших публикаций этого проекта?`,
      "",
      "Будут удалены посты в очереди, с ошибкой и неопубликованные — они уже не выйдут в старый Instagram.",
      "Опубликованные записи останутся.",
      "",
      failed ? `· с ошибкой: ${failed}` : null,
      queued ? `· в очереди: ${queued}` : null,
      other ? `· прочие: ${other}` : null,
    ].filter(Boolean).join("\n");
    if (!confirm(msg)) return;
    setLoading(true);
    try {
      const res = await schedulerApi<{ deleted: number }>("clear_stuck", { mode: "unpublished", include_legacy: true }, projectId);
      toast.success(`Очищено: ${res.deleted ?? stuckCount} публикаций`);
      await loadAll(view);
    } catch (e) {
      toast.error("Не удалось очистить", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading(false);
    }
  };

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
      await schedulerApi(action, { id }, projectId);
      toast.success(action === "delete" ? "Удалено" : action === "publish_now" ? "Публикуем сейчас…" : "Повторяем");
      await loadAll(view);
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setBusyIds((s) => { const n = new Set(s); n.delete(id); return n; }); }
  };

  const body = (
    <>
      {!embedded && (
      <PageHeader
        icon={CalendarDays}
        title="Автопостинг"
        description={
          <span>
            Календарь и очередь публикаций в Instagram
            {active?.name ? <> для проекта «{active.name}»</> : null}
            {account?.username ? <> · публикации идут в @{account.username}</> : null}
            . Кликните день или пост, чтобы запланировать/отредактировать. Время — по Алматы.
          </span>
        }
        actions={
          <Button variant="outline" size="icon" className="h-10 w-10 rounded-xl border-border/60" aria-label="Обновить" onClick={() => void loadAll(view)} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        }
      />
      )}

      <div className="mt-4">
        {accountLoading && !account ? (
          <div className="flex items-center gap-2 rounded-2xl border border-border/60 bg-card/60 px-4 py-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Загружаем аккаунт Instagram…
          </div>
        ) : account ? (
          <div className="flex flex-wrap items-center gap-4 overflow-hidden rounded-2xl border border-pink-500/20 bg-gradient-to-r from-pink-500/[0.08] via-card/80 to-primary/[0.05] px-5 py-4 shadow-sm">
            {account.profilePictureUrl ? (
              <img src={account.profilePictureUrl} alt="" className="h-12 w-12 rounded-full object-cover ring-2 ring-pink-500/40" />
            ) : (
              <span className="grid h-12 w-12 place-items-center rounded-full bg-pink-500/15 text-pink-500">
                <Instagram className="h-6 w-6" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">Публикации идут в Instagram</span>
                {account.active && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
              </div>
              <div className="mt-0.5 text-sm">
                <span className="font-medium">@{account.username ?? account.name ?? account.igUserId}</span>
                {account.pageName ? (
                  <span className="text-muted-foreground"> · страница Facebook «{account.pageName}»</span>
                ) : null}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {fmtNum(account.followersCount)} подписчиков · {fmtNum(account.mediaCount)} публикаций в аккаунте
              </div>
            </div>
            <Link
              to="/settings?tab=meta-tokens"
              className="text-xs text-primary hover:underline shrink-0"
            >
              Сменить аккаунт
            </Link>
          </div>
        ) : (
          <div className="flex flex-wrap items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="text-sm font-medium">Instagram не подключён к проекту</div>
              <p className="text-xs text-muted-foreground">
                Без привязанного аккаунта публикации не смогут выйти в Instagram. Подключите страницу Facebook с Instagram в настройках.
              </p>
            </div>
            <Button asChild size="sm" variant="outline" className="shrink-0 rounded-lg">
              <Link to="/settings?tab=meta-tokens">Подключить Instagram</Link>
            </Button>
          </div>
        )}
      </div>

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

      {!initialLoading && <AutopostUpcomingRail posts={posts} onEdit={(p) => setEditing(p as unknown as QueuePost)} />}

      {/* Тулбар: вид + фильтры + действие */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
          <TabsList>
            <TabsTrigger value="calendar" className="gap-1.5"><CalendarDays className="h-4 w-4" /> Календарь</TabsTrigger>
            <TabsTrigger value="queue" className="gap-1.5"><ListChecks className="h-4 w-4" /> Очередь</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex flex-wrap items-center gap-2">
          {stuckCount > 0 && (
            <Button variant="outline" className="rounded-xl border-destructive/40 text-destructive hover:bg-destructive/10" onClick={() => void clearStuckPosts()} disabled={loading || !projectId}>
              <Trash2 className="mr-1.5 h-4 w-4" />
              Очистить зависшие ({stuckCount})
            </Button>
          )}
          <Button className="rounded-xl" onClick={() => openAdd(todayAlmatyYmd())}><Plus className="mr-1.5 h-4 w-4" /> Новая публикация</Button>
        </div>
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
                              {p.thumbnail_url || p.media_url ? (
                                <MediaThumb
                                  thumbnailUrl={p.thumbnail_url}
                                  mediaUrl={p.media_url}
                                  mediaType={p.media_type}
                                  className="h-4 w-4 shrink-0 rounded"
                                />
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

      {addDay && (
        <AddDialog
          day={addDay}
          hourReach={hourReach}
          bestHour={bestHour}
          projectId={projectId}
          hasAccount={!!account}
          onClose={() => setAddDay(null)}
          onDone={() => { setAddDay(null); void loadAll(view); }}
        />
      )}
      {editing && (
        <EditDialog
          post={editing}
          projectId={projectId}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); void loadAll(view); }}
        />
      )}
    </>
  );

  if (embedded) return body;
  return <PageContainer wide>{body}</PageContainer>;
};

// ——— Скелетон

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
        {post.thumbnail_url || post.media_url ? (
          <MediaThumb
            thumbnailUrl={post.thumbnail_url}
            mediaUrl={post.media_url}
            mediaType={post.media_type}
            className="h-11 w-11 shrink-0 rounded-lg"
          />
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
          {post.status === "failed" && post.error && <div className="truncate text-xs text-destructive">{formatPublishError(post.error)}</div>}
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

// ——— Диалог добавления публикации ———
// Экспорт: Контент-план открывает тот же композер (медиа + расписание + зеркало в план).
export function AutopostAddDialog({ day, hourReach, bestHour, projectId, hasAccount, onClose, onDone }: {
  day: string; hourReach: Map<number, number>; bestHour: number | null; projectId: string | null; hasAccount: boolean;
  onClose: () => void; onDone: () => void;
}) {
  const [type, setType] = useState<PostType>("IMAGE");
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [caption, setCaption] = useState("");
  const [captionBusy, setCaptionBusy] = useState(false);
  const [ymd, setYmd] = useState(day);
  const [hour, setHour] = useState(12);
  const [minute, setMinute] = useState(0);
  const [dryRun, setDryRun] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploadLabel, setUploadLabel] = useState<string>();
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  /** upload = своя картинка; frame = кадр с видео; null = ещё не фиксировали */
  const [coverSource, setCoverSource] = useState<"upload" | "frame" | null>(null);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [seek, setSeek] = useState(0);
  const [duration, setDuration] = useState(0);
  const [cropByKey, setCropByKey] = useState<Record<string, ViewParams>>({});
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

  const resetTypeMedia = (t: PostType) => {
    setType(t);
    setFiles([]);
    setCropByKey({});
    setCoverFile(null);
    setCoverSource(null);
    setCoverPreview((p) => { if (p) URL.revokeObjectURL(p); return null; });
    setVideoSrc((p) => { if (p) URL.revokeObjectURL(p); return null; });
    if (fileRef.current) fileRef.current.value = "";
    setSeek(0);
    setDuration(0);
  };

  const clearCover = () => {
    setCoverFile(null);
    setCoverSource(null);
    setCoverPreview((p) => { if (p) URL.revokeObjectURL(p); return null; });
  };
  const applyCover = (fl: File, source: "upload" | "frame") => {
    setCoverPreview((p) => { if (p) URL.revokeObjectURL(p); return URL.createObjectURL(fl); });
    setCoverFile(fl);
    setCoverSource(source);
  };

  const pick = (list: FileList | null, mode: "replace" | "append" = "replace") => {
    if (!list || list.length === 0) return;
    const a = Array.from(list);
    const tooBig = a.find((f) => f.size > MAX_FILE_BYTES);
    if (tooBig) {
      toast.error(`Файл «${tooBig.name}» слишком большой (${(tooBig.size / 1024 / 1024).toFixed(0)} МБ)`, {
        description: `Максимум ${MAX_FILE_MB} МБ на файл.`,
      });
      return;
    }
    setFiles((prev) => {
      let next: File[];
      if (meta.multiple && mode === "append") {
        next = [...prev, ...a].slice(0, 10);
      } else {
        next = meta.multiple ? a.slice(0, 10) : a.slice(0, 1);
      }
      clearCover();
      setVideoSrc((old) => {
        if (old) URL.revokeObjectURL(old);
        return (type === "REELS" && next[0]?.type.startsWith("video/")) ? URL.createObjectURL(next[0]) : null;
      });
      setSeek(0);
      setDuration(0);
      return next;
    });
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

  const captureFrame = async () => {
    const v = videoRef.current;
    if (!v) return;
    const snapFromVideo = () =>
      new Promise<File | null>((resolve) => {
        if (!v.videoWidth) {
          resolve(null);
          return;
        }
        const cvs = document.createElement("canvas");
        cvs.width = v.videoWidth || 720;
        cvs.height = v.videoHeight || 1280;
        const ctx = cvs.getContext("2d");
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(v, 0, 0, cvs.width, cvs.height);
        cvs.toBlob(
          (blob) => {
            if (!blob) {
              resolve(null);
              return;
            }
            resolve(new File([blob], `cover-${Date.now()}.jpg`, { type: "image/jpeg" }));
          },
          "image/jpeg",
          0.92,
        );
      });

    try {
      if (Math.abs((v.currentTime || 0) - seek) > 0.08) {
        await new Promise<void>((resolve, reject) => {
          const onSeeked = () => {
            v.removeEventListener("seeked", onSeeked);
            resolve();
          };
          v.addEventListener("seeked", onSeeked);
          try {
            v.currentTime = seek;
          } catch (e) {
            v.removeEventListener("seeked", onSeeked);
            reject(e);
          }
          window.setTimeout(() => {
            v.removeEventListener("seeked", onSeeked);
            resolve();
          }, 1500);
        });
      }
      let file = await snapFromVideo();
      if (!file && files[0] && isVideoFile(files[0])) {
        const frame = await captureFrameFromVideoFile(files[0], { seconds: seek });
        file = frame.file;
      }
      if (file) applyCover(file, "frame");
    } catch {
      if (files[0] && isVideoFile(files[0])) {
        try {
          const frame = await captureFrameFromVideoFile(files[0], { seconds: seek });
          applyCover(frame.file, "frame");
        } catch {
          toast.error("Не удалось снять кадр обложки");
        }
      }
    }
  };

  // Перемотка = фиксация обложки (если не загружена своя картинка).
  useEffect(() => {
    if (type !== "REELS" || coverSource === "upload") return;
    if (!files[0] || !isVideoFile(files[0])) return;
    const timer = window.setTimeout(() => {
      void captureFrameFromVideoFile(files[0], { seconds: seek })
        .then((frame) => applyCover(frame.file, "frame"))
        .catch(() => { /* кадр снимем при публикации */ });
    }, 320);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только seek/видео
  }, [seek, type, files, coverSource]);

  const validate = (): string | null => {
    if (files.length === 0) return "Добавьте медиа";
    if (type === "CAROUSEL" && files.length < 2) return "Карусель: минимум 2 файла";
    if (type === "REELS" && !isVideoFile(files[0])) return "Reels — только видео";
    if (type === "IMAGE" && isVideoFile(files[0])) return "Пост — только фото (видео → Reels)";
    return null;
  };

  const generateCaption = async () => {
    if (files.length === 0) {
      toast.error("Сначала загрузите медиа");
      return;
    }
    setCaptionBusy(true);
    try {
      const text = await generateAutopostCaption({
        mediaType: type,
        files,
        projectId,
      });
      setCaption(text.slice(0, 2200));
      toast.success("Описание готово — можно поправить перед публикацией");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сгенерировать описание");
    } finally {
      setCaptionBusy(false);
    }
  };

  const submit = async (now: boolean) => {
    if (!projectId) { toast.error("Сначала выберите проект"); return; }
    if (!hasAccount) { toast.error("Подключите Instagram к проекту", { description: "Настройки → Meta / Facebook" }); return; }
    const err = validate();
    if (err) { toast.error(err); return; }
    setBusy(true);
    try {
      const urls: string[] = [];
      for (let i = 0; i < files.length; i++) {
        setUploadLabel(`Загрузка ${i + 1} из ${files.length}…`);
        const f = files[i];
        let uploadFile = f;
        if ((type === "IMAGE" || type === "CAROUSEL") && !isVideoFile(f)) {
          setUploadLabel(`Обрезка 4:5 · ${i + 1} из ${files.length}…`);
          const view = cropByKey[fileCropKey(f)] ?? defaultFeed45View();
          uploadFile = await cropImageFile(f, view);
        }
        const rawUrl = await uploadToBucket(uploadFile);
        urls.push(isVideoFile(f) ? await normalizeVideoForInstagram(rawUrl, f.type, f.size) : rawUrl);
      }
      let coverUrl: string | null = null;
      let thumbOffsetMs: number | null = null;
      if (type === "REELS") {
        let cover = coverFile;
        // Своя картинка — как есть; кадр с видео — всегда заново с позиции ползунка.
        if (files[0] && isVideoFile(files[0]) && (!cover || coverSource !== "upload")) {
          setUploadLabel("Снимаем выбранный кадр обложки…");
          try {
            const frame = await captureFrameFromVideoFile(files[0], { seconds: seek });
            cover = frame.file;
            applyCover(frame.file, "frame");
          } catch {
            /* без обложки Instagram возьмёт thumb_offset / кадр 0 */
          }
        }
        if (cover) {
          setUploadLabel("Загрузка обложки…");
          try {
            cover = await ensureJpegCoverFile(cover);
          } catch {
            /* грузим как есть */
          }
          coverUrl = await uploadToBucket(cover);
        }
        thumbOffsetMs = Math.max(0, Math.round(seek * 1000));
      }
      setUploadLabel("Сохраняем в очередь…");
      const payload: Record<string, unknown> = {
        media_type: type,
        caption: type === "STORIES" ? "" : caption,
        scheduled_at: now ? new Date().toISOString() : buildISO(ymd, hour, minute),
        dry_run: now ? false : dryRun,
      };
      if (type === "CAROUSEL") {
        payload.child_urls = urls;
        payload.thumbnail_url = urls.find((_, i) => !isVideoFile(files[i])) ?? urls[0];
      } else {
        payload.media_url = urls[0];
        if (type === "REELS") {
          if (coverUrl) { payload.cover_url = coverUrl; payload.thumbnail_url = coverUrl; }
          if (thumbOffsetMs != null) payload.thumb_offset_ms = thumbOffsetMs;
        } else {
          payload.thumbnail_url = isVideoFile(files[0]) ? null : urls[0];
        }
      }
      const res = await schedulerApi<{ post: QueuePost }>("create", payload, projectId);
      if (now && res.post?.id) await schedulerApi("publish_now", { id: res.post.id }, projectId);
      if (res.post?.id) {
        await upsertContentPlanFromAutopost({
          projectId,
          autopostId: res.post.id,
          mediaType: type,
          caption: typeof payload.caption === "string" ? payload.caption : null,
          mediaUrl: typeof payload.media_url === "string" ? payload.media_url : null,
          thumbnailUrl: typeof payload.thumbnail_url === "string" ? payload.thumbnail_url : null,
          childUrls: Array.isArray(payload.child_urls) ? (payload.child_urls as string[]) : null,
          scheduledAt: String(payload.scheduled_at),
          status: now ? "published" : "scheduled",
        }).catch(() => {});
      }
      toast.success(now ? "Публикуем сейчас…" : dryRun ? "Добавлено в пробном режиме" : "Запланировано");
      onDone();
    } catch (e) {
      toast.error("Не удалось", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
      setUploadLabel(undefined);
    }
  };

  return (
    <AutopostComposerDialog
      day={ymd}
      dayLabel={prettyDay(ymd)}
      onDayChange={setYmd}
      hourReach={hourReach}
      bestHour={bestHour}
      hasAccount={hasAccount}
      busy={busy}
      uploadLabel={uploadLabel}
      onClose={onClose}
      onSubmitNow={() => void submit(true)}
      onSubmitSchedule={() => void submit(false)}
      type={type}
      onTypeChange={resetTypeMedia}
      files={files}
      previews={previews}
      onPickFiles={pick}
      onRemoveFile={(idx) => setFiles((x) => x.filter((_, i) => i !== idx))}
      onMoveFile={moveFile}
      caption={caption}
      onCaptionChange={setCaption}
      captionBusy={captionBusy}
      onGenerateCaption={() => void generateCaption()}
      hour={hour}
      minute={minute}
      onHourChange={setHour}
      onMinuteChange={setMinute}
      dryRun={dryRun}
      onDryRunChange={setDryRun}
      videoSrc={videoSrc}
      coverPreview={coverPreview}
      seek={seek}
      duration={duration}
      onSeekChange={setSeek}
      onDurationChange={setDuration}
      onCaptureFrame={() => { void captureFrame(); }}
      onPickCover={(f) => { void ensureJpegCoverFile(f).then((jpeg) => applyCover(jpeg, "upload")).catch(() => applyCover(f, "upload")); }}
      onClearCover={clearCover}
      videoRef={videoRef}
      fileInputRef={fileRef}
      coverInputRef={coverRef}
      cropByKey={cropByKey}
      onCropChange={(key, view) => setCropByKey((prev) => ({ ...prev, [key]: view }))}
    />
  );
}

// ——— Диалог просмотра/редактирования ———
function EditDialog({ post, projectId, onClose, onDone }: { post: QueuePost; projectId: string | null; onClose: () => void; onDone: () => void }) {
  const editable = post.status === "queued" || post.status === "failed" || post.status === "tested";
  const alm = new Date(new Date(post.scheduled_at).toLocaleString("en-US", { timeZone: "Asia/Almaty" }));
  const [caption, setCaption] = useState(post.caption ?? "");
  const [ymd, setYmd] = useState(almatyYmd(post.scheduled_at));
  const [hour, setHour] = useState(alm.getHours());
  const [minute, setMinute] = useState(alm.getMinutes() - (alm.getMinutes() % 5));
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<unknown>, okMsg?: string) => {
    setBusy(true);
    try {
      await fn();
      if (okMsg) toast.success(okMsg);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const errorText = post.status === "failed" && post.error ? formatPublishError(post.error) : null;

  return (
    <AutopostEditDialog
      post={post}
      busy={busy}
      editable={editable}
      caption={caption}
      ymd={ymd}
      hour={hour}
      minute={minute}
      timeLabel={almatyHm(post.scheduled_at)}
      dayLabel={prettyDay(almatyYmd(post.scheduled_at))}
      errorText={errorText}
      showReconnectLink={!!post.error && /токен|token|OAuth|190/i.test(post.error)}
      onClose={onClose}
      onCaptionChange={setCaption}
      onYmdChange={setYmd}
      onHourChange={setHour}
      onMinuteChange={setMinute}
      onDelete={() => void act(() => schedulerApi("delete", { id: post.id }, projectId))}
      onRetry={() => void act(() => schedulerApi("retry", { id: post.id }, projectId), "Повторяем")}
      onPublishNow={() => void act(() => schedulerApi("publish_now", { id: post.id }, projectId), "Публикуем сейчас…")}
      onSave={() => void act(() => schedulerApi("update", { id: post.id, caption, scheduled_at: buildISO(ymd, hour, minute) }, projectId), "Сохранено")}
    />
  );
}
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

const AddDialog = AutopostAddDialog;

export default AutoPost;
