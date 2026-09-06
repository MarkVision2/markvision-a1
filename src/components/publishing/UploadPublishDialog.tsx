/**
 * «Залить видео» — композер массовой публикации в две колонки:
 *   слева  — ролик, аккаунты, подпись и режим раскладки;
 *   справа — живой предпросмотр, как пост ляжет в ленту каждой площадки.
 *
 * Наверх уходит один вызов publish_video с явным account_ids — сервер
 * раскладывает задания по слотам (plan_publish_slots).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, FileVideo, Link2, Loader2, Monitor, Send, Smartphone, Upload, Users, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AccountChips } from "@/components/publishing/AccountChips";
import { PostPreview, type PreviewContent } from "@/components/publishing/PostPreview";
import type { UsePublishing } from "@/hooks/usePublishing";
import { PLATFORM_META, PUBLISH_MODE_META, type PublishGroup, type PublishMode, type PublishStrategy, type PublishVideo } from "@/lib/publishingClient";
import { DEFAULT_PER_HOUR, almatyLocalNow, almatyLocalToIso, formatStep, isGroupMember, isPublishable, planPreview } from "@/lib/publishingSelection";
import { ACCEPT_VIDEO, formatBytes, uploadPublishVideo, validateVideoFile } from "@/lib/publishingUpload";
import { cn } from "@/lib/utils";

const NO_GROUP = "__none";

/** Валидация ссылки на видео — зеркало проверки в publish-accounts. */
export function validateFileUrl(url: string): string | null {
  const u = url.trim();
  if (!u) return "Укажите ссылку на видео";
  if (!/^https:\/\/.+\.(mp4|mov|m4v)(\?|$)/i.test(u)) return "Нужна https-ссылка на файл .mp4, .mov или .m4v";
  return null;
}

/** Стратегия группы → режим раскладки композера (те же три значения, другие имена). */
const STRATEGY_TO_MODE: Record<PublishStrategy, PublishMode> = { all_at_once: "now", drip: "drip", daily: "daily" };

function errMsg(e: unknown, fallback = "Ошибка"): string {
  return e instanceof Error ? e.message : fallback;
}

/** Варианты подписи: непустые строки, без дублей. */
export function splitLines(s: string): string[] {
  return Array.from(new Set(s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)));
}

function splitCsv(s: string): string[] {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

function fmtTime(d: Date): string {
  return d.toLocaleString("ru-RU", { timeZone: "Asia/Almaty", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/**
 * `video` — режим «Опубликовать ещё» из библиотеки: файл уже в publish_videos,
 * заливку и проверку ссылки пропускаем, текст подставляем из карточки, на сервер
 * уходит video_id + repost (второе задание в аккаунт, где ролик уже выходил).
 */
export function UploadPublishDialog({ open, onClose, pub, video = null }: { open: boolean; onClose: () => void; pub: UsePublishing; video?: PublishVideo | null }) {
  const repost = video != null;
  const [source, setSource] = useState<"file" | "url">("file");
  const [file, setFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState("");
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [aspect, setAspect] = useState<number | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [groupId, setGroupId] = useState<string>(NO_GROUP);
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  // Варианты подписи, по одному на строку: планировщик раздаёт их аккаунтам по кругу.
  const [variants, setVariants] = useState("");
  const [variantsOpen, setVariantsOpen] = useState(false);
  const [hashtags, setHashtags] = useState("");
  const [mode, setMode] = useState<PublishMode>("drip");
  // Пусто — «с этой минуты»; иначе время Алматы из <input type=datetime-local>
  // (браузер оператора может жить в другом поясе — переводим сами, см. almatyLocalToIso).
  const [startAt, setStartAt] = useState("");
  const [device, setDevice] = useState<"mobile" | "desktop">("mobile");
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const uploading = progress != null;
  const submitting = pub.busy === "publish_video";

  useEffect(() => {
    if (!open) return;
    // Повтор: ссылка ролика из библиотеки — предпросмотр работает как с готовой ссылкой.
    setSource(video ? "url" : "file");
    setFile(null);
    setFileUrl(video?.file_url ?? "");
    setUploadedUrl(null);
    setProgress(null);
    setDragging(false);
    setAspect(null);
    // По умолчанию — все аккаунты, которые планировщик реально возьмёт.
    setSelected(new Set(pub.accounts.filter(isPublishable).map((a) => a.id)));
    setGroupId(NO_GROUP);
    setTitle(video?.title ?? "");
    setCaption(video?.base_caption ?? "");
    setVariants("");
    setVariantsOpen(false);
    setHashtags((video?.hashtags ?? []).join(", "));
    setMode("drip");
    setStartAt("");
    setErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // blob:-ссылка на локальный файл для предпросмотра; отзываем, чтобы не течь.
  const localUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (localUrl) URL.revokeObjectURL(localUrl); }, [localUrl]);

  const previewUrl = source === "file" ? localUrl : fileUrl.trim() || null;

  // Пропорция исходника — предпросмотр должен показывать реальную обрезку кадра.
  // Ссылку зондируем с задержкой: иначе запрос уходил на каждый набранный символ.
  useEffect(() => {
    setAspect(null);
    if (!previewUrl) return;
    let v: HTMLVideoElement | null = null;
    const t = window.setTimeout(() => {
      v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () => {
        if (v && v.videoWidth && v.videoHeight) setAspect(v.videoWidth / v.videoHeight);
      };
      v.src = previewUrl;
    }, previewUrl.startsWith("blob:") ? 0 : 600);
    return () => {
      window.clearTimeout(t);
      if (v) {
        v.onloadedmetadata = null;
        v.removeAttribute("src");
        try { v.load(); } catch { /* jsdom не реализует load() — в браузере отменяет загрузку */ }
      }
    };
  }, [previewUrl]);

  const selectedAccounts = useMemo(() => pub.accounts.filter((a) => selected.has(a.id)), [pub.accounts, selected]);
  const group = useMemo(() => pub.groups.find((g) => g.id === groupId) ?? null, [pub.groups, groupId]);
  const projectPaused = Boolean(pub.settings?.settings.paused || pub.metrics?.publish?.paused);
  const startIso = useMemo(() => (startAt ? almatyLocalToIso(startAt) : null), [startAt]);
  const startDate = useMemo(() => (startIso ? new Date(startIso) : null), [startIso]);
  const preview = useMemo(
    () => planPreview(selectedAccounts, mode, group, startDate ?? new Date(), { projectPaused, groups: pub.groups }),
    [selectedAccounts, mode, group, startDate, projectPaused, pub.groups],
  );

  /**
   * Группа в композере — это и состав, и темп: plan_publish_slots оставит только её
   * членов нужной площадки. Поэтому выбор группы сразу отбирает её годных членов и
   * подставляет её стратегию как режим — оператор видит то, что реально создастся.
   */
  const onGroupChange = (id: string) => {
    setGroupId(id);
    const g: PublishGroup | null = pub.groups.find((x) => x.id === id) ?? null;
    if (!g) return;
    setSelected(new Set(pub.accounts.filter((a) => isGroupMember(a, g) && (!g.platform || a.platform === g.platform) && isPublishable(a)).map((a) => a.id)));
    setMode(STRATEGY_TO_MODE[g.publish_strategy] ?? "drip");
  };

  const content: PreviewContent = {
    mediaUrl: previewUrl,
    title,
    caption,
    hashtags: splitCsv(hashtags),
    aspect,
  };

  /* ── видео ── */

  const acceptFile = (f: File) => {
    const bad = validateVideoFile(f);
    if (bad) {
      setErr(bad);
      toast.error(bad);
      return;
    }
    setErr(null);
    setFile(f);
    setUploadedUrl(null);
    if (!title.trim()) setTitle(f.name.replace(/\.[^.]+$/, ""));
  };

  const startUpload = async (): Promise<string | null> => {
    if (!file) return null;
    if (!pub.projectId) {
      const m = "Выберите проект — без него видео некуда загружать";
      setErr(m);
      toast.error(m);
      return null;
    }
    setProgress(0);
    try {
      const { url } = await uploadPublishVideo(pub.projectId, file, setProgress);
      setUploadedUrl(url);
      toast.success("Видео загружено в хранилище");
      return url;
    } catch (e) {
      setErr(errMsg(e));
      toast.error(errMsg(e));
      return null;
    } finally {
      setProgress(null);
    }
  };

  /* ── отправка ── */

  const submit = async () => {
    if (repost) {
      // Ролик уже в библиотеке — файл не проверяем и не заливаем.
    } else if (source === "url") {
      const bad = validateFileUrl(fileUrl);
      if (bad) {
        setErr(bad);
        toast.error(bad);
        return;
      }
    } else if (!file) {
      const m = "Выберите видеофайл или переключитесь на готовую ссылку";
      setErr(m);
      toast.error(m);
      return;
    }
    if (projectPaused) {
      const m = "Публикации проекта на паузе — снимите её во вкладке «Настройки»";
      setErr(m);
      toast.error(m);
      return;
    }
    if (group?.review_mode === "paused") {
      const m = `Группа «${group.name}» на паузе — задания не создадутся`;
      setErr(m);
      toast.error(m);
      return;
    }
    if (!preview.eligible.length) {
      const m = preview.skipped[0]?.hint
        ? `Не выбран ни один аккаунт, готовый к публикации: ${preview.skipped[0].hint}`
        : "Не выбран ни один аккаунт, готовый к публикации";
      setErr(m);
      toast.error(m);
      return;
    }
    if (startAt && !startDate) {
      const m = "Не понял время старта — выберите дату и время заново";
      setErr(m);
      toast.error(m);
      return;
    }

    // Файл заливаем прямо здесь, если это ещё не сделано вручную.
    const url = video ? video.file_url : source === "url" ? fileUrl.trim() : uploadedUrl ?? (await startUpload());
    if (!url) return;

    try {
      const r = await pub.publishVideo({
        ...(video ? { video_id: video.id, repost: true } : { file_url: url }),
        // Повтор: пустая строка тоже уходит — так оператор может стереть текст карточки
        // (сервер пишет "" как null); при новой заливке пустое поле просто не шлём.
        title: repost ? title.trim() : title.trim() || undefined,
        caption: repost ? caption.trim() : caption.trim() || undefined,
        hashtags: splitCsv(hashtags).map((h) => h.replace(/^#/, "")),
        // Варианты шлём только когда они заданы: при повторе пустой список стёр бы старые.
        ...(splitLines(variants).length ? { caption_variants: splitLines(variants) } : {}),
        mode,
        account_ids: preview.eligible.map((a) => a.id),
        ...(group ? { group_id: group.id } : {}),
        ...(startIso ? { start_at: startIso } : {}),
      });
      if (!r.created) {
        // Повтор: created = 0 без причины значит, что во всех аккаунтах ролик уже стоит в очереди.
        const m = repost && r.skipped && !r.reason
          ? `Новых заданий нет — во всех ${r.skipped} аккаунтах этот ролик уже стоит в очереди`
          : `Заданий не создано${r.reason ? `: ${r.reason}` : ""}`;
        setErr(m);
        toast.error(m);
        return;
      }
      toast.success(`Создано заданий: ${r.created}${r.skipped ? `, уже стояли: ${r.skipped}` : ""}`);
      onClose();
    } catch (e) {
      setErr(errMsg(e));
      toast.error(errMsg(e));
    }
  };

  const busy = uploading || submitting;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="publishing-studio flex h-[92vh] max-w-7xl flex-col gap-0 overflow-hidden border-border/80 bg-background/95 p-0 shadow-elevated backdrop-blur-2xl sm:rounded-2xl">
        <DialogHeader className="border-b border-border/70 bg-card/30 px-7 py-5">
          <DialogTitle className="text-xl">{repost ? "Опубликовать ещё раз" : "Залить видео"}</DialogTitle>
          <DialogDescription className="mt-1">
            {repost
              ? "Ролик из библиотеки → пачка аккаунтов, в том числе те, где он уже выходил. Правки текста сохранятся в карточке видео."
              : "Один ролик → пачка аккаунтов. Справа — как пост ляжет в ленту каждой площадки."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1.65fr)_minmax(21rem,0.85fr)]">
          {/* ── слева: настройка ── */}
          <ScrollArea className="min-h-0 border-r border-border/70">
            <div className="space-y-6 p-7">
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground"><Users className="h-3.5 w-3.5" /> Куда публикуем</Label>
                  <span className="text-xs tabular-nums text-primary">{selected.size} выбрано</span>
                </div>
                <AccountChips accounts={pub.accounts} groups={pub.groups} selected={selected} onChange={setSelected} />
              </section>

              <section className="space-y-4 rounded-xl border border-border/70 bg-card/35 p-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Заголовок</Label>
                  <Input className="h-11 bg-background/60" value={title} placeholder="Название публикации" aria-label="Заголовок" onChange={(e) => setTitle(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Текст публикации</Label>
                <Textarea
                  rows={4}
                  className="min-h-28 resize-none bg-background/60"
                  value={caption}
                  placeholder="Текст публикации…"
                  aria-label="Текст публикации"
                  onChange={(e) => setCaption(e.target.value)}
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Хэштеги добавятся в конец подписи</span>
                  <span className="tabular-nums">{caption.length} симв.</span>
                </div>
                </div>
                {/* Один текст в десятки аккаунтов площадки метят как спам — варианты по кругу. */}
                {variantsOpen ? (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-muted-foreground">Варианты подписи — по одному на строку</Label>
                    <Textarea
                      rows={4}
                      className="min-h-24 resize-none bg-background/60"
                      value={variants}
                      placeholder={"Первый вариант текста\nВторой вариант текста"}
                      aria-label="Варианты подписи"
                      onChange={(e) => setVariants(e.target.value)}
                    />
                    <div className="text-xs text-muted-foreground">
                      {splitLines(variants).length
                        ? `${splitLines(variants).length} вариант(а) — аккаунты получат их по кругу, основной текст не используется`
                        : "Пусто — все аккаунты получат основной текст"}
                    </div>
                  </div>
                ) : (
                  <Button type="button" variant="link" className="h-auto p-0 text-xs" onClick={() => setVariantsOpen(true)}>
                    Разные подписи для разных аккаунтов…
                  </Button>
                )}
              </section>

              {/* Видео */}
              {video ? (
              <section className="flex items-center gap-3 rounded-xl border border-border/70 bg-card/35 p-4 text-sm">
                <FileVideo className="h-5 w-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold uppercase text-muted-foreground">Ролик из библиотеки</div>
                  <a href={video.file_url} target="_blank" rel="noreferrer" className="block truncate text-primary hover:underline">
                    {video.title || video.file_url.split("/").pop()}
                  </a>
                </div>
                {(video.published ?? 0) > 0 && <span className="shrink-0 text-xs text-muted-foreground">уже выходил: {video.published}</span>}
              </section>
              ) : (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold uppercase text-muted-foreground">Видео</Label>
                  <div className="flex rounded-lg border border-border/70 bg-secondary/30 p-1">
                    <Button type="button" size="sm" variant={source === "file" ? "secondary" : "ghost"} className="h-7" onClick={() => setSource("file")}>
                      <Upload className="mr-1.5 h-3.5 w-3.5" /> Файл
                    </Button>
                    <Button type="button" size="sm" variant={source === "url" ? "secondary" : "ghost"} className="h-7" onClick={() => setSource("url")}>
                      <Link2 className="mr-1.5 h-3.5 w-3.5" /> Ссылка
                    </Button>
                  </div>
                </div>

                {source === "file" ? (
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragging(false);
                      const f = e.dataTransfer.files?.[0];
                      if (f) acceptFile(f);
                    }}
                    className={cn(
                       "group rounded-xl border-2 border-dashed p-7 text-center transition-all duration-300",
                       dragging ? "border-primary bg-primary/10 shadow-glow" : "border-border bg-card/30 hover:border-primary/50 hover:bg-card/60",
                    )}
                  >
                    <input
                      ref={inputRef}
                      type="file"
                      accept={ACCEPT_VIDEO}
                      className="hidden"
                      aria-label="Видеофайл"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) acceptFile(f);
                        e.target.value = "";
                      }}
                    />
                    {file ? (
                      <div className="space-y-2">
                         <div className="flex items-center justify-center gap-2 text-sm font-semibold">
                           <FileVideo className="h-5 w-5 text-primary" />
                          <span className="truncate">{file.name}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatBytes(file.size)}
                          {uploadedUrl && " · загружено в хранилище"}
                        </div>
                        {uploading && (
                          <div className="mx-auto max-w-xs space-y-1">
                            <Progress value={progress ?? 0} className="h-2" aria-label="Прогресс загрузки" />
                            <div className="text-xs tabular-nums text-muted-foreground">Загружено {progress ?? 0}%</div>
                          </div>
                        )}
                        {!busy && (
                          <Button type="button" variant="ghost" size="sm" onClick={() => { setFile(null); setUploadedUrl(null); }}>
                            <X className="mr-1 h-3.5 w-3.5" /> Убрать файл
                          </Button>
                        )}
                      </div>
                    ) : (
                       <div className="space-y-3">
                         <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary transition-transform duration-300 group-hover:scale-105"><Upload className="h-6 w-6" /></span>
                         <div><div className="text-sm font-semibold">Перетащите ролик сюда</div><div className="mt-1 text-xs text-muted-foreground">MP4 или MOV · большие файлы загружаются напрямую</div></div>
                         <Button type="button" variant="outline" size="sm" className="border-primary/30 bg-primary/5 hover:bg-primary/10" onClick={() => inputRef.current?.click()}>Выбрать файл</Button>
                      </div>
                    )}
                  </div>
                ) : (
                  <Input className="h-11 bg-card/40"
                    value={fileUrl}
                    placeholder="https://…/video.mp4"
                    aria-label="Ссылка на видео"
                    onChange={(e) => setFileUrl(e.target.value)}
                  />
                )}
              </section>
              )}

              <section className="space-y-1.5 rounded-xl border border-border/70 bg-card/35 p-4">
                <Label className="text-xs text-muted-foreground">Хэштеги (через запятую)</Label>
                <Input className="bg-background/60" value={hashtags} placeholder="маркетинг, reels" aria-label="Хэштеги" onChange={(e) => setHashtags(e.target.value)} />
              </section>

              {/* Расписание */}
              <section className="grid gap-3 rounded-xl border border-border/70 bg-card/35 p-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Режим</Label>
                  <Select value={mode} onValueChange={(v) => setMode(v as PublishMode)}>
                    <SelectTrigger aria-label="Режим раскладки"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(PUBLISH_MODE_META) as PublishMode[]).map((m) => (
                        <SelectItem key={m} value={m}>{PUBLISH_MODE_META[m].label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Группа (состав и темп)</Label>
                  <Select value={groupId} onValueChange={onGroupChange}>
                    <SelectTrigger aria-label="Группа"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_GROUP}>Без группы ({DEFAULT_PER_HOUR}/час)</SelectItem>
                      {pub.groups.map((g) => (
                        <SelectItem key={g.id} value={g.id}>
                          {g.name} ({g.per_hour ?? DEFAULT_PER_HOUR}/час{g.review_mode === "paused" ? " · пауза" : ""})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {group && <p className="text-[11px] text-muted-foreground">Отобраны только участники группы{group.platform ? ` (${PLATFORM_META[group.platform].label})` : ""}; остальные планировщик пропустит.</p>}
                </div>
              </section>

              <section className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Старт раскладки (время Алматы)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="datetime-local"
                    value={startAt}
                    min={almatyLocalNow()}
                    aria-label="Время старта"
                    className="max-w-[240px]"
                    onChange={(e) => setStartAt(e.target.value)}
                  />
                  {startAt ? (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setStartAt("")}>Сейчас</Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">пусто — с этой минуты</span>
                  )}
                </div>
              </section>

              {(projectPaused || group?.review_mode === "paused") && (
                <div role="alert" className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{projectPaused ? "Публикации проекта на паузе — задания не создадутся, пока пауза не снята в «Настройках»." : `Группа «${group?.name}» на паузе — выберите другую группу или снимите паузу во вкладке «Группы».`}</span>
                </div>
              )}

              {/* План */}
              <section className="space-y-2 rounded-xl border border-primary/20 bg-primary/5 p-4 text-xs">
                <div className="flex items-baseline justify-between">
                  <span className="flex items-center gap-2 text-sm font-semibold"><CalendarClock className="h-4 w-4 text-primary" /> {preview.eligible.length} заданий</span>
                  <span className="text-muted-foreground">
                    {preview.byPlatform.map((p) => `${p.count} ${PLATFORM_META[p.platform]?.label ?? p.platform}`).join(" · ") || "—"}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Шаг между аккаунтами</span>
                  <span className="tabular-nums">{formatStep(preview.stepMinutes)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Последний слот ≈</span>
                  <span className="tabular-nums">{preview.lastSlotAt ? fmtTime(preview.lastSlotAt) : "—"}</span>
                </div>
                {preview.skipped.length > 0 && (
                  <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-2 text-amber-800">
                    Пропустим {preview.skipped.length}: {preview.skipped.slice(0, 3).map((s) => s.account.account_name).join(", ")}
                    {preview.skipped.length > 3 && " и др."}
                  </div>
                )}
                <p className="pt-0.5 text-muted-foreground">
                  Время ориентировочное: сервер ещё подвинет слоты по окну публикаций и дневным лимитам.
                </p>
              </section>

              {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
            </div>
          </ScrollArea>

          {/* ── справа: предпросмотр ── */}
          <div className="flex min-h-0 flex-col bg-card/20">
            <div className="flex items-center justify-between border-b border-border/70 px-5 py-3.5">
              <div><span className="text-sm font-semibold">Предпросмотр</span><p className="mt-0.5 text-[11px] text-muted-foreground">Обновляется в реальном времени</p></div>
              <div className="flex gap-0.5">
                <Button
                  type="button" size="icon" variant={device === "mobile" ? "secondary" : "ghost"} className="h-7 w-7"
                  aria-label="Мобильный предпросмотр" onClick={() => setDevice("mobile")}
                >
                  <Smartphone className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button" size="icon" variant={device === "desktop" ? "secondary" : "ghost"} className="h-7 w-7"
                  aria-label="Десктопный предпросмотр" onClick={() => setDevice("desktop")}
                >
                  <Monitor className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <ScrollArea className="min-h-0 flex-1">
               <div className={cn("space-y-4 p-5", device === "mobile" && "mx-auto max-w-[23rem]")}>
                {selectedAccounts.length === 0 ? (
                  <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                    Выберите аккаунты слева — здесь появится предпросмотр поста для каждой площадки.
                  </p>
                ) : (
                  selectedAccounts.map((a) => <PostPreview key={a.id} account={a} content={content} />)
                )}
              </div>
            </ScrollArea>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border/70 bg-card/45 px-7 py-4">
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <CheckCircle2 className={cn("h-4 w-4", preview.eligible.length ? "text-primary" : "text-muted-foreground")} />
            {preview.eligible.length ? `Готово к отправке в ${preview.eligible.length} аккаунтов` : "Выберите аккаунты и видео"}
          </span>
          <div className="flex gap-2">
             <Button variant="ghost" className="px-5" onClick={onClose} disabled={busy}>Отмена</Button>
             <Button className="h-11 px-6 font-semibold shadow-glow" onClick={() => void submit()} disabled={busy || !preview.eligible.length}>
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
              {uploading ? `Загружаем ${progress ?? 0}%` : `Отправить на публикацию (${preview.eligible.length})`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
