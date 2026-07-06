import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle, CalendarClock, CheckCircle2, Clock, ExternalLink, Film, Images,
  Loader2, RefreshCw, RotateCcw, Send, Trash2, Upload, X,
} from "lucide-react";
import { toast } from "sonner";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { clientConfigSupabase } from "@/integrations/clientConfig/client";
import { cn } from "@/lib/utils";

// Раздел «Автопостинг» — планировщик публикаций в Instagram через cf_scheduled_posts
// (клиентский Supabase szfgdruhlebfvcmlvxdk). Медиа грузится в публичный бакет autopost,
// очередь публикует edge-функция publisher по крону каждые 10 минут.
const CLIENT_URL = (import.meta.env.VITE_CLIENT_SUPABASE_URL as string | undefined) || "";
const CLIENT_KEY = (import.meta.env.VITE_CLIENT_SUPABASE_PUBLISHABLE_KEY as string | undefined) || "";
const BUCKET = "autopost";

type PostType = "IMAGE" | "REELS" | "CAROUSEL" | "STORIES";

interface QueuePost {
  id: string;
  media_type: string;
  media_url: string | null;
  thumbnail_url: string | null;
  child_urls: string[] | null;
  caption: string | null;
  scheduled_at: string;
  status: "queued" | "processing" | "published" | "failed" | string;
  published_ig_media_id: string | null;
  error: string | null;
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
  failed: { label: "Ошибка", cls: "bg-destructive/10 text-destructive", icon: AlertCircle },
};

const ALMATY_OFFSET = "+05:00";

// Date -> строка для input[type=datetime-local] в часовом поясе Алматы (UTC+5)
function toAlmatyInput(d: Date): string {
  const a = new Date(d.getTime() + 5 * 3600 * 1000);
  return `${a.getUTCFullYear()}-${String(a.getUTCMonth() + 1).padStart(2, "0")}-${String(a.getUTCDate()).padStart(2, "0")}T${String(a.getUTCHours()).padStart(2, "0")}:${String(a.getUTCMinutes()).padStart(2, "0")}`;
}
function almatyInputToISO(v: string): string {
  return new Date(`${v}:00${ALMATY_OFFSET}`).toISOString();
}
function fmtAlmaty(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    timeZone: "Asia/Almaty", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit",
  });
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

const AutoPost = () => {
  const [type, setType] = useState<PostType>("IMAGE");
  const [files, setFiles] = useState<File[]>([]);
  const [caption, setCaption] = useState("");
  const [when, setWhen] = useState<string>(() => toAlmatyInput(new Date(Date.now() + 60 * 60 * 1000)));
  const [submitting, setSubmitting] = useState(false);
  const [posts, setPosts] = useState<QueuePost[]>([]);
  const [loading, setLoading] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  const meta = TYPE_META[type];

  const loadQueue = useCallback(async () => {
    try {
      const j = await schedulerApi<{ posts: QueuePost[] }>("list");
      setPosts(j.posts ?? []);
    } catch (e) {
      toast.error("Не удалось загрузить очередь", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadQueue(); }, [loadQueue]);

  // Автообновление, пока есть незавершённые
  useEffect(() => {
    const pending = posts.some((p) => p.status === "queued" || p.status === "processing");
    if (!pending) return;
    const t = setInterval(() => void loadQueue(), 30_000);
    return () => clearInterval(t);
  }, [posts, loadQueue]);

  const onPickFiles = (list: FileList | null) => {
    if (!list) return;
    const arr = Array.from(list);
    setFiles(meta.multiple ? arr.slice(0, 10) : arr.slice(0, 1));
  };
  const removeFile = (i: number) => setFiles((f) => f.filter((_, idx) => idx !== i));

  const publishedToday = useMemo(() => {
    const dayAgo = Date.now() - 24 * 3600 * 1000;
    return posts.filter((p) => p.status === "published" && new Date(p.scheduled_at).getTime() > dayAgo).length;
  }, [posts]);

  const submit = async () => {
    if (files.length === 0) { toast.error("Добавьте медиа"); return; }
    if (type === "CAROUSEL" && files.length < 2) { toast.error("Для карусели нужно минимум 2 файла"); return; }
    if ((type === "REELS") && !isVideoFile(files[0])) { toast.error("Для Reels нужен видеофайл"); return; }
    if (type === "IMAGE" && isVideoFile(files[0])) { toast.error("Для поста нужно фото (для видео выберите Reels)"); return; }
    if (!when) { toast.error("Укажите дату и время"); return; }

    setSubmitting(true);
    try {
      const urls: string[] = [];
      for (const f of files) urls.push(await uploadToBucket(f));

      const payload: Record<string, unknown> = {
        media_type: type,
        caption: type === "STORIES" ? "" : caption,
        scheduled_at: almatyInputToISO(when),
      };
      if (type === "CAROUSEL") {
        payload.child_urls = urls;
        payload.thumbnail_url = urls.find((_, i) => !isVideoFile(files[i])) ?? urls[0];
      } else {
        payload.media_url = urls[0];
        payload.thumbnail_url = isVideoFile(files[0]) ? null : urls[0];
      }
      await schedulerApi("create", payload);
      toast.success("Пост поставлен в очередь");
      setFiles([]);
      setCaption("");
      if (fileRef.current) fileRef.current.value = "";
      void loadQueue();
    } catch (e) {
      toast.error("Не удалось запланировать", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSubmitting(false);
    }
  };

  const retry = async (id: string) => { try { await schedulerApi("retry", { id }); toast.success("Повторяем"); void loadQueue(); } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } };
  const del = async (id: string) => { try { await schedulerApi("delete", { id }); void loadQueue(); } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } };

  return (
    <PageContainer>
      <PageHeader
        icon={CalendarClock}
        title="Автопостинг"
        description="Загрузите фото или видео, задайте текст и время — опубликуем в Instagram автоматически. Время — по Алматы."
        actions={
          <Button variant="outline" size="icon" className="h-10 w-10 rounded-xl border-border/60" aria-label="Обновить" onClick={() => void loadQueue()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        }
      />

      <div className="mt-6 grid gap-6 lg:grid-cols-[380px_1fr]">
        {/* Форма */}
        <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
          <h2 className="text-sm font-semibold">Новая публикация</h2>

          {/* Тип */}
          <div className="mt-3 grid grid-cols-2 gap-2">
            {(Object.keys(TYPE_META) as PostType[]).map((t) => {
              const M = TYPE_META[t];
              const Icon = M.icon;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => { setType(t); setFiles([]); if (fileRef.current) fileRef.current.value = ""; }}
                  className={cn(
                    "flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition",
                    type === t ? "border-primary/60 bg-primary/10 text-primary" : "border-border/60 bg-background hover:bg-secondary/40",
                  )}
                >
                  <Icon className="h-4 w-4" /> {M.label}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">{meta.hint}</p>

          {/* Загрузка медиа */}
          <div className="mt-3">
            <input
              ref={fileRef}
              type="file"
              accept={meta.accept}
              multiple={meta.multiple}
              onChange={(e) => onPickFiles(e.target.files)}
              className="hidden"
              id="autopost-file"
            />
            <label
              htmlFor="autopost-file"
              className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 bg-background px-3 py-6 text-xs text-muted-foreground transition hover:bg-secondary/30"
            >
              <Upload className="h-4 w-4" />
              {meta.multiple ? "Выбрать файлы (2–10)" : "Выбрать файл"}
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

          {/* Подпись */}
          {type !== "STORIES" && (
            <div className="mt-3">
              <Textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value.slice(0, 2200))}
                placeholder="Текст публикации, хэштеги…"
                className="min-h-[100px] rounded-xl border-border/60 text-sm"
              />
              <div className="mt-1 text-right text-[10px] text-muted-foreground">{caption.length}/2200</div>
            </div>
          )}

          {/* Время */}
          <div className="mt-1">
            <label className="text-[11px] font-medium text-muted-foreground">Дата и время (Алматы)</label>
            <input
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className="mt-1 h-10 w-full rounded-xl border border-border/60 bg-background px-3 text-sm"
            />
          </div>

          <Button className="mt-4 w-full rounded-xl" onClick={() => void submit()} disabled={submitting}>
            {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Загружаем…</> : <><Send className="mr-2 h-4 w-4" /> В очередь</>}
          </Button>

          <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
            Лимит Instagram — 25 публикаций за 24 часа. За последние сутки опубликовано: {publishedToday}.
          </p>
        </div>

        {/* Очередь */}
        <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
          <h2 className="text-sm font-semibold">Очередь и история</h2>
          <div className="mt-3 space-y-2">
            {loading && posts.length === 0 && (
              <div className="py-10 text-center text-sm text-muted-foreground">Загружаем…</div>
            )}
            {!loading && posts.length === 0 && (
              <div className="py-10 text-center text-sm text-muted-foreground">Пока пусто. Запланируйте первую публикацию слева.</div>
            )}
            {posts.map((p) => {
              const s = STATUS_META[p.status] ?? { label: p.status, cls: "bg-secondary text-muted-foreground", icon: Clock };
              const SIcon = s.icon;
              const thumb = p.thumbnail_url;
              const permalink = p.published_ig_media_id ? `https://www.instagram.com/` : null;
              return (
                <div key={p.id} className="flex items-start gap-3 rounded-xl border border-border/40 bg-background/60 p-2.5">
                  <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-secondary/50 ring-1 ring-border/40">
                    {thumb ? <img src={thumb} alt="" loading="lazy" className="h-full w-full object-cover" /> : <div className="grid h-full w-full place-items-center text-muted-foreground">{p.media_type === "REELS" ? <Film className="h-5 w-5" /> : <Images className="h-5 w-5" />}</div>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold", s.cls)}>
                        <SIcon className={cn("h-3 w-3", p.status === "processing" && "animate-spin")} /> {s.label}
                      </span>
                      <span className="rounded bg-secondary/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{TYPE_META[(p.media_type as PostType)] ? TYPE_META[p.media_type as PostType].label : p.media_type}</span>
                      <span className="text-[10px] tabular-nums text-muted-foreground">{fmtAlmaty(p.scheduled_at)}</span>
                    </div>
                    <div className="mt-1 line-clamp-2 text-xs text-foreground/90">{p.caption || <span className="text-muted-foreground">Без подписи</span>}</div>
                    {p.status === "failed" && p.error && <div className="mt-1 line-clamp-2 text-[10px] text-destructive">{p.error}</div>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {p.status === "published" && permalink && (
                      <a href={permalink} target="_blank" rel="noreferrer" className="rounded-lg p-1.5 text-muted-foreground hover:text-primary" title="Открыть в Instagram"><ExternalLink className="h-4 w-4" /></a>
                    )}
                    {p.status === "failed" && (
                      <button type="button" onClick={() => void retry(p.id)} className="rounded-lg p-1.5 text-muted-foreground hover:text-primary" title="Повторить"><RotateCcw className="h-4 w-4" /></button>
                    )}
                    {p.status !== "published" && (
                      <button type="button" onClick={() => void del(p.id)} className="rounded-lg p-1.5 text-muted-foreground hover:text-destructive" title="Удалить из очереди"><Trash2 className="h-4 w-4" /></button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </PageContainer>
  );
};

export default AutoPost;
