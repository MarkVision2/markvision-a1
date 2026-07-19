import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft, ChevronRight, Film, Loader2, Plus, Send, Trash2, Upload, X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CONTENT_PLAN_CATEGORY_META,
  CONTENT_PLAN_TYPE_META,
  type ContentPlanCategory,
  type ContentPlanType,
} from "@/lib/contentPlan";
import {
  AUTOPOST_MAX_FILE_BYTES,
  AUTOPOST_MAX_FILE_MB,
  createAutopostPublication,
  isVideoFile,
} from "@/lib/autopostClient";
import { upsertContentPlanFromAutopost } from "@/lib/contentPlanAutopostBridge";
import { useInstagramAccount } from "@/hooks/useInstagramAccount";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { cn } from "@/lib/utils";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function toDatetimeLocalValue(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Almaty",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function scheduledLocalToIso(local: string): string {
  const [date, time] = local.split("T");
  const [h, m] = (time || "12:00").split(":").map(Number);
  return new Date(`${date}T${pad(h || 0)}:${pad(m || 0)}:00+05:00`).toISOString();
}

type PickMode = "replace" | "append" | "replaceAt";

export function ContentPlanComposerDialog({
  open,
  onOpenChange,
  onDone,
  initialType = "REELS",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone?: () => void;
  /** Prefill content type (e.g. open directly on carousel). */
  initialType?: ContentPlanType;
}) {
  const { activeId: projectId } = useProjectsStore();
  const { account } = useInstagramAccount();

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<ContentPlanCategory>("content");
  const [contentType, setContentType] = useState<ContentPlanType>(initialType);
  const [description, setDescription] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [prompts, setPrompts] = useState("");
  const [codeword, setCodeword] = useState("");
  const [scheduledLocal, setScheduledLocal] = useState(() => toDatetimeLocalValue());
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [saving, setSaving] = useState(false);
  const [uploadLabel, setUploadLabel] = useState<string>();
  const [pickMode, setPickMode] = useState<PickMode>("replace");
  const pickModeRef = useRef<PickMode>("replace");
  const replaceAtRef = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const isCarousel = contentType === "CAROUSEL";
  const safeIdx = Math.min(activeIdx, Math.max(0, files.length - 1));
  const activeFile = files[safeIdx];
  const activePreview = previews[safeIdx];

  const reset = () => {
    setTitle("");
    setCategory("content");
    setContentType(initialType);
    setDescription("");
    setHashtags("");
    setPrompts("");
    setCodeword("");
    setScheduledLocal(toDatetimeLocalValue());
    setFiles([]);
    setActiveIdx(0);
    setUploadLabel(undefined);
  };

  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => { urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, [files]);

  useEffect(() => {
    if (files.length === 0) setActiveIdx(0);
    else if (activeIdx >= files.length) setActiveIdx(files.length - 1);
  }, [files.length, activeIdx]);

  const onTypeChange = (t: ContentPlanType) => {
    setContentType(t);
    setFiles([]);
    setActiveIdx(0);
    if (fileRef.current) fileRef.current.value = "";
  };

  const openPicker = (mode: PickMode, at = 0) => {
    pickModeRef.current = mode;
    setPickMode(mode);
    replaceAtRef.current = at;
    if (fileRef.current) fileRef.current.value = "";
    // Defer click so `multiple` updates before the native picker opens.
    requestAnimationFrame(() => fileRef.current?.click());
  };

  const pickFiles = (list: FileList | null) => {
    if (!list?.length) return;
    const arr = Array.from(list);
    const tooBig = arr.find((f) => f.size > AUTOPOST_MAX_FILE_BYTES);
    if (tooBig) {
      toast.error(`Файл «${tooBig.name}» слишком большой`, {
        description: `Максимум ${AUTOPOST_MAX_FILE_MB} МБ на файл.`,
      });
      return;
    }

    const mode = pickModeRef.current;
    if (!isCarousel) {
      setFiles(arr.slice(0, 1));
      setActiveIdx(0);
      return;
    }

    if (mode === "append") {
      setFiles((prev) => {
        const next = [...prev, ...arr].slice(0, 10);
        setActiveIdx(Math.min(prev.length, next.length - 1));
        return next;
      });
      return;
    }

    if (mode === "replaceAt") {
      const at = replaceAtRef.current;
      const file = arr[0];
      if (!file) return;
      setFiles((prev) => {
        const next = [...prev];
        next[at] = file;
        return next;
      });
      setActiveIdx(at);
      return;
    }

    // replace all
    setFiles(arr.slice(0, 10));
    setActiveIdx(0);
  };

  const moveSlide = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= files.length) return;
    setFiles((prev) => {
      const next = [...prev];
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
    setActiveIdx(j);
  };

  const removeSlide = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
    setActiveIdx((cur) => {
      if (cur > idx) return cur - 1;
      if (cur === idx) return Math.max(0, cur - 1);
      return cur;
    });
  };

  const buildCaption = () => {
    const parts = [title.trim(), description.trim(), hashtags.trim()].filter(Boolean);
    return parts.join("\n\n");
  };

  const submit = async (publishNow: boolean) => {
    if (!projectId) {
      toast.error("Сначала выберите проект");
      return;
    }
    if (!account) {
      toast.error("Подключите Instagram к проекту", { description: "Настройки → Instagram" });
      return;
    }
    if (!title.trim()) {
      toast.error("Введите название");
      return;
    }
    if (files.length === 0) {
      toast.error("Загрузите медиа для автопостинга");
      return;
    }
    if (isCarousel && files.length < 2) {
      toast.error("Карусель: минимум 2 слайда");
      return;
    }
    if (!publishNow && !scheduledLocal) {
      toast.error("Укажите дату и время публикации");
      return;
    }

    setSaving(true);
    try {
      const created = await createAutopostPublication({
        projectId,
        mediaType: contentType,
        files,
        caption: buildCaption(),
        scheduledAt: scheduledLocalToIso(scheduledLocal),
        publishNow,
        onProgress: setUploadLabel,
      });

      await upsertContentPlanFromAutopost({
        projectId,
        autopostId: created.id,
        mediaType: contentType,
        caption: created.caption,
        mediaUrl: created.mediaUrl,
        thumbnailUrl: created.thumbnailUrl,
        childUrls: created.childUrls,
        scheduledAt: created.scheduledAt,
        status: created.status,
        title: title.trim(),
        category,
        codeword: codeword.trim() || null,
        hashtags: hashtags.trim() || null,
        description: description.trim() || null,
        prompts: prompts.trim() || null,
      });

      toast.success(publishNow ? "Публикуем сейчас…" : "Добавлено в план и автопостинг");
      reset();
      onOpenChange(false);
      onDone?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось создать публикацию");
    } finally {
      setSaving(false);
      setUploadLabel(undefined);
    }
  };

  const accept =
    contentType === "REELS"
      ? "video/*"
      : contentType === "IMAGE" || contentType === "STORIES"
        ? "image/*"
        : "image/*,video/*";

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && !saving) {
          reset();
          onOpenChange(false);
        } else if (v) {
          onOpenChange(true);
        }
      }}
    >
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Новая публикация</DialogTitle>
          <DialogDescription>
            Заполните ТЗ, загрузите медиа — сразу попадёт в контент-план и очередь автопостинга.
            {isCarousel && " Для карусели можно менять порядок слайдов и смотреть превью."}
            {!account && (
              <span className="mt-1 block text-amber-600">Instagram не подключён — сначала Настройки → Instagram.</span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Название</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="3 вещи которые должен автоматизировать маркетолог"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Тип</Label>
              <Select value={contentType} onValueChange={(v) => onTypeChange(v as ContentPlanType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(CONTENT_PLAN_TYPE_META) as ContentPlanType[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {CONTENT_PLAN_TYPE_META[k].emoji} {CONTENT_PLAN_TYPE_META[k].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Категория</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as ContentPlanCategory)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(CONTENT_PLAN_CATEGORY_META) as ContentPlanCategory[]).map((k) => (
                    <SelectItem key={k} value={k}>{CONTENT_PLAN_CATEGORY_META[k].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <Label>Медиа для автопостинга</Label>
              {isCarousel && files.length > 0 && (
                <span className="text-[11px] text-muted-foreground">
                  Слайд {safeIdx + 1} из {files.length} · до 10
                </span>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept={accept}
              multiple={isCarousel && pickMode !== "replaceAt"}
              className="hidden"
              onChange={(e) => pickFiles(e.target.files)}
            />

            {files.length === 0 ? (
              <button
                type="button"
                onClick={() => openPicker("replace")}
                className={cn(
                  "flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/70",
                  "bg-muted/30 px-4 py-8 text-sm text-muted-foreground transition hover:border-primary/40 hover:bg-primary/5",
                )}
              >
                <Upload className="h-6 w-6" />
                <span className="font-medium text-foreground">Загрузить файл</span>
                <span className="text-xs">
                  {isCarousel
                    ? "2–10 фото/видео"
                    : contentType === "REELS"
                      ? "Видео для Reels"
                      : "Фото"}
                </span>
              </button>
            ) : isCarousel ? (
              <div className="space-y-3 rounded-xl border border-border/60 bg-background/50 p-3">
                {/* Large preview */}
                <div className="relative mx-auto w-full max-w-[280px] overflow-hidden rounded-2xl border border-border/60 bg-zinc-950 shadow-lg">
                  <div className="aspect-[4/5] bg-zinc-900">
                    {activeFile && isVideoFile(activeFile) ? (
                      <video
                        key={activePreview}
                        src={activePreview}
                        className="h-full w-full object-contain"
                        controls
                        playsInline
                      />
                    ) : (
                      <img
                        src={activePreview}
                        alt={`Слайд ${safeIdx + 1}`}
                        className="h-full w-full object-contain"
                      />
                    )}
                  </div>
                  <div className="absolute inset-x-0 top-0 flex items-center justify-between p-2">
                    <span className="rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-semibold text-white">
                      {safeIdx + 1} / {files.length}
                    </span>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        disabled={safeIdx === 0}
                        onClick={() => setActiveIdx(safeIdx - 1)}
                        className="grid h-8 w-8 place-items-center rounded-full bg-black/65 text-white disabled:opacity-30"
                        aria-label="Предыдущий слайд"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        disabled={safeIdx >= files.length - 1}
                        onClick={() => setActiveIdx(safeIdx + 1)}
                        className="grid h-8 w-8 place-items-center rounded-full bg-black/65 text-white disabled:opacity-30"
                        aria-label="Следующий слайд"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <div className="flex justify-center gap-1.5 pb-3 pt-1">
                    {files.map((_, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setActiveIdx(i)}
                        className={cn(
                          "h-1.5 rounded-full transition",
                          i === safeIdx ? "w-4 bg-primary" : "w-1.5 bg-white/35",
                        )}
                        aria-label={`Слайд ${i + 1}`}
                      />
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => openPicker("replaceAt", safeIdx)}>
                    <Upload className="h-3.5 w-3.5" />
                    Заменить слайд
                  </Button>
                  {files.length < 10 && (
                    <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => openPicker("append")}>
                      <Plus className="h-3.5 w-3.5" />
                      Ещё слайд
                    </Button>
                  )}
                  <Button type="button" variant="ghost" size="sm" className="gap-1 text-muted-foreground" onClick={() => openPicker("replace")}>
                    Заменить все
                  </Button>
                </div>

                {/* Order grid */}
                <div>
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Порядок слайдов
                  </div>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {files.map((f, i) => (
                      <div
                        key={`${f.name}-${i}-${f.size}`}
                        className={cn(
                          "group relative overflow-hidden rounded-xl border bg-card/60 transition",
                          i === safeIdx ? "border-primary/60 ring-2 ring-primary/25" : "border-border/60",
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => setActiveIdx(i)}
                          className="block w-full text-left"
                        >
                          <div className="relative aspect-[4/5] bg-zinc-900">
                            {isVideoFile(f) ? (
                              <>
                                <video src={previews[i]} className="h-full w-full object-cover" muted />
                                <span className="absolute inset-0 grid place-items-center">
                                  <span className="grid h-7 w-7 place-items-center rounded-full bg-black/55 text-white">
                                    <Film className="h-3.5 w-3.5" />
                                  </span>
                                </span>
                              </>
                            ) : (
                              <img src={previews[i]} alt="" className="h-full w-full object-cover" />
                            )}
                            <span className="absolute left-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-black/75 text-[10px] font-bold text-white">
                              {i + 1}
                            </span>
                          </div>
                        </button>
                        <div className="absolute right-1 top-1 flex gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                          <button
                            type="button"
                            disabled={i === 0}
                            onClick={() => moveSlide(i, -1)}
                            className="grid h-6 w-6 place-items-center rounded-md bg-black/70 text-white disabled:opacity-30"
                            aria-label="Левее"
                          >
                            <ChevronLeft className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={i === files.length - 1}
                            onClick={() => moveSlide(i, 1)}
                            className="grid h-6 w-6 place-items-center rounded-md bg-black/70 text-white disabled:opacity-30"
                            aria-label="Правее"
                          >
                            <ChevronRight className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeSlide(i)}
                            className="grid h-6 w-6 place-items-center rounded-md bg-black/70 text-white hover:bg-destructive/80"
                            aria-label="Удалить"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                    {files.length < 10 && (
                      <button
                        type="button"
                        onClick={() => openPicker("append")}
                        className="flex aspect-[4/5] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border/70 text-muted-foreground transition hover:border-primary/40 hover:text-primary"
                      >
                        <Plus className="h-5 w-5" />
                        <span className="text-[11px] font-medium">Ещё</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-2 rounded-xl border border-border/60 bg-background/50 p-3">
                <div className="relative mx-auto max-w-[220px] overflow-hidden rounded-xl border border-border/60 bg-zinc-950">
                  <div className="aspect-[4/5]">
                    {isVideoFile(files[0]) ? (
                      <video src={previews[0]} className="h-full w-full object-contain" controls playsInline />
                    ) : (
                      <img src={previews[0]} alt="" className="h-full w-full object-contain" />
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => openPicker("replace")}>
                    <Upload className="h-3.5 w-3.5" />
                    Заменить
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="gap-1 text-muted-foreground"
                    onClick={() => { setFiles([]); setActiveIdx(0); }}
                  >
                    <X className="h-3.5 w-3.5" />
                    Убрать
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Дата / время публикации (Алматы)</Label>
            <Input
              type="datetime-local"
              value={scheduledLocal}
              onChange={(e) => setScheduledLocal(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Код-слово (опционально)</Label>
            <Input
              value={codeword}
              onChange={(e) => setCodeword(e.target.value)}
              placeholder="хаб"
              className="font-mono uppercase"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Описание</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>
          <div className="space-y-1.5">
            <Label>Хэштеги</Label>
            <Input value={hashtags} onChange={(e) => setHashtags(e.target.value)} placeholder="#marketing #ai" />
          </div>
          <div className="space-y-1.5">
            <Label>Промпты</Label>
            <Textarea value={prompts} onChange={(e) => setPrompts(e.target.value)} rows={2} />
          </div>

          {uploadLabel && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {uploadLabel}
            </p>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            variant="secondary"
            disabled={saving}
            className="gap-1"
            onClick={() => void submit(true)}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Сейчас
          </Button>
          <Button disabled={saving} className="gap-1" onClick={() => void submit(false)}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            В план + автопост
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
