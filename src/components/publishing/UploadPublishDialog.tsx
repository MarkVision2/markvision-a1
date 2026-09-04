/**
 * «Залить видео» — композер массовой публикации в две колонки:
 *   слева  — ролик, аккаунты, подпись и режим раскладки;
 *   справа — живой предпросмотр, как пост ляжет в ленту каждой площадки.
 *
 * Наверх уходит один вызов publish_video с явным account_ids — сервер
 * раскладывает задания по слотам (plan_publish_slots).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { FileVideo, Link2, Loader2, Monitor, Send, Smartphone, Upload, X } from "lucide-react";
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
import { PLATFORM_META, PUBLISH_MODE_META, type PublishMode } from "@/lib/publishingClient";
import { formatStep, isPublishable, planPreview } from "@/lib/publishingSelection";
import { ACCEPT_VIDEO, formatBytes, uploadPublishVideo, validateVideoFile } from "@/lib/publishingUpload";
import { cn } from "@/lib/utils";

const NO_GROUP = "__none";

/** Валидация ссылки на видео — зеркало проверки в publish-accounts. */
export function validateFileUrl(url: string): string | null {
  const u = url.trim();
  if (!u) return "Укажите ссылку на видео";
  if (!/^https:\/\/.+\.(mp4|mov|m4v)(\?|$)/i.test(u)) return "Нужна https-ссылка на файл .mp4 или .mov";
  return null;
}

function errMsg(e: unknown, fallback = "Ошибка"): string {
  return e instanceof Error ? e.message : fallback;
}

function splitCsv(s: string): string[] {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

function fmtTime(d: Date): string {
  return d.toLocaleString("ru-RU", { timeZone: "Asia/Almaty", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function UploadPublishDialog({ open, onClose, pub }: { open: boolean; onClose: () => void; pub: UsePublishing }) {
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
  const [hashtags, setHashtags] = useState("");
  const [mode, setMode] = useState<PublishMode>("drip");
  const [device, setDevice] = useState<"mobile" | "desktop">("mobile");
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const uploading = progress != null;
  const submitting = pub.busy === "publish_video";

  useEffect(() => {
    if (!open) return;
    setSource("file");
    setFile(null);
    setFileUrl("");
    setUploadedUrl(null);
    setProgress(null);
    setDragging(false);
    setAspect(null);
    // По умолчанию — все аккаунты, которые планировщик реально возьмёт.
    setSelected(new Set(pub.accounts.filter(isPublishable).map((a) => a.id)));
    setGroupId(NO_GROUP);
    setTitle("");
    setCaption("");
    setHashtags("");
    setMode("drip");
    setErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // blob:-ссылка на локальный файл для предпросмотра; отзываем, чтобы не течь.
  const localUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (localUrl) URL.revokeObjectURL(localUrl); }, [localUrl]);

  const previewUrl = source === "file" ? localUrl : fileUrl.trim() || null;

  // Пропорция исходника — предпросмотр должен показывать реальную обрезку кадра.
  useEffect(() => {
    setAspect(null);
    if (!previewUrl) return;
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      if (v.videoWidth && v.videoHeight) setAspect(v.videoWidth / v.videoHeight);
    };
    v.src = previewUrl;
  }, [previewUrl]);

  const selectedAccounts = useMemo(() => pub.accounts.filter((a) => selected.has(a.id)), [pub.accounts, selected]);
  const group = useMemo(() => pub.groups.find((g) => g.id === groupId) ?? null, [pub.groups, groupId]);
  const preview = useMemo(() => planPreview(selectedAccounts, mode, group), [selectedAccounts, mode, group]);

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
    if (!file || !pub.projectId) return null;
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
    if (source === "url") {
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
    if (!preview.eligible.length) {
      const m = "Не выбран ни один аккаунт, готовый к публикации";
      setErr(m);
      toast.error(m);
      return;
    }

    // Файл заливаем прямо здесь, если это ещё не сделано вручную.
    const url = source === "url" ? fileUrl.trim() : uploadedUrl ?? (await startUpload());
    if (!url) return;

    try {
      const r = await pub.publishVideo({
        file_url: url,
        title: title.trim() || undefined,
        caption: caption.trim() || undefined,
        hashtags: splitCsv(hashtags).map((h) => h.replace(/^#/, "")),
        mode,
        account_ids: preview.eligible.map((a) => a.id),
        ...(group ? { group_id: group.id } : {}),
      });
      toast.success(`Создано заданий: ${r.created}${r.skipped ? `, пропущено: ${r.skipped}` : ""}`);
      onClose();
    } catch (e) {
      setErr(errMsg(e));
      toast.error(errMsg(e));
    }
  };

  const busy = uploading || submitting;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="flex h-[88vh] max-w-6xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>Залить видео</DialogTitle>
          <DialogDescription>
            Один ролик → пачка аккаунтов. Справа — как пост ляжет в ленту каждой площадки.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
          {/* ── слева: настройка ── */}
          <ScrollArea className="min-h-0 border-r">
            <div className="space-y-4 p-5">
              <section className="space-y-2">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Куда публикуем</Label>
                <AccountChips accounts={pub.accounts} selected={selected} onChange={setSelected} />
              </section>

              <section className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Заголовок</Label>
                <Input value={title} placeholder="Заголовок" aria-label="Заголовок" onChange={(e) => setTitle(e.target.value)} />
              </section>

              <section className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Текст публикации</Label>
                <Textarea
                  rows={5}
                  value={caption}
                  placeholder="Текст публикации…"
                  aria-label="Текст публикации"
                  onChange={(e) => setCaption(e.target.value)}
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Хэштеги добавятся в конец подписи</span>
                  <span className="tabular-nums">{caption.length} симв.</span>
                </div>
              </section>

              {/* Видео */}
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">Видео</Label>
                  <div className="flex gap-1">
                    <Button type="button" size="sm" variant={source === "file" ? "secondary" : "ghost"} onClick={() => setSource("file")}>
                      <Upload className="mr-1.5 h-3.5 w-3.5" /> Файл
                    </Button>
                    <Button type="button" size="sm" variant={source === "url" ? "secondary" : "ghost"} onClick={() => setSource("url")}>
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
                      "rounded-2xl border-2 border-dashed p-5 text-center transition-colors",
                      dragging ? "border-primary bg-primary/5" : "border-muted-foreground/25",
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
                        <div className="flex items-center justify-center gap-2 text-sm font-medium">
                          <FileVideo className="h-4 w-4 text-muted-foreground" />
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
                      <div className="space-y-2">
                        <Upload className="mx-auto h-6 w-6 text-muted-foreground" />
                        <div className="text-sm">Перетащите ролик сюда</div>
                        <div className="text-xs text-muted-foreground">mp4 или mov · крупные файлы едут напрямую в R2</div>
                        <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
                          Выбрать файл
                        </Button>
                      </div>
                    )}
                  </div>
                ) : (
                  <Input
                    value={fileUrl}
                    placeholder="https://…/video.mp4"
                    aria-label="Ссылка на видео"
                    onChange={(e) => setFileUrl(e.target.value)}
                  />
                )}
              </section>

              <section className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Хэштеги (через запятую)</Label>
                <Input value={hashtags} placeholder="маркетинг, reels" aria-label="Хэштеги" onChange={(e) => setHashtags(e.target.value)} />
              </section>

              {/* Расписание */}
              <section className="grid gap-3 sm:grid-cols-2">
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
                  <Label className="text-xs text-muted-foreground">Темп по группе</Label>
                  <Select value={groupId} onValueChange={setGroupId}>
                    <SelectTrigger aria-label="Группа"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_GROUP}>Без группы (10/час)</SelectItem>
                      {pub.groups.map((g) => (
                        <SelectItem key={g.id} value={g.id}>{g.name} ({g.per_hour ?? 10}/час)</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </section>

              {/* План */}
              <section className="space-y-1.5 rounded-2xl border bg-muted/30 p-3 text-xs">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-medium">{preview.eligible.length} заданий</span>
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
          <div className="flex min-h-0 flex-col bg-muted/20">
            <div className="flex items-center justify-between border-b px-4 py-2">
              <span className="text-sm font-medium">Предпросмотр</span>
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
              <div className={cn("space-y-4 p-4", device === "mobile" && "mx-auto max-w-[22rem]")}>
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

        <div className="flex items-center justify-between gap-2 border-t px-5 py-3">
          <span className="text-xs text-muted-foreground">
            Выбрано аккаунтов: <span className="tabular-nums">{selected.size}</span>
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>Отмена</Button>
            <Button onClick={() => void submit()} disabled={busy || !preview.eligible.length}>
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
              {uploading ? `Загружаем ${progress ?? 0}%` : `Отправить на публикацию (${preview.eligible.length})`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
