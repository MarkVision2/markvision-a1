import { useEffect, useRef, useState } from "react";
import {
  CalendarClock, Camera, ChevronLeft, ChevronRight, Film, GripVertical, Loader2, Plus, Send, Sparkles, Trash2, Upload, X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  CONTENT_PLAN_TYPE_META,
  type ContentPlanType,
} from "@/lib/contentPlan";
import {
  AUTOPOST_MAX_FILE_BYTES,
  AUTOPOST_MAX_FILE_MB,
  createAutopostPublication,
  isVideoFile,
} from "@/lib/autopostClient";
import { captureFrameFromVideoFile, ensureJpegCoverFile, generateAutopostCaption } from "@/lib/autopostAiCaption";
import { upsertContentPlanFromAutopost } from "@/lib/contentPlanAutopostBridge";
import { useInstagramAccount } from "@/hooks/useInstagramAccount";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { cn } from "@/lib/utils";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

type ScheduleParts = { ymd: string; hour: number; minute: number };

function almatyParts(d = new Date()): ScheduleParts {
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
  const minute = Number(get("minute"));
  // Snap to nearest 5 minutes for the dropdown.
  const snapped = Math.min(55, Math.round(minute / 5) * 5);
  return {
    ymd: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: snapped,
  };
}

function scheduleToIso({ ymd, hour, minute }: ScheduleParts): string {
  return new Date(`${ymd}T${pad(hour)}:${pad(minute)}:00+05:00`).toISOString();
}

function addAlmatyDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function ymdToDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function dateToYmd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function startOfLocalDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function formatDayShort(ymd: string): string {
  const today = almatyParts().ymd;
  const tomorrow = addAlmatyDays(today, 1);
  if (ymd === today) return "Сегодня";
  if (ymd === tomorrow) return "Завтра";
  const [y, m, d] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat("ru-RU", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(y, m - 1, d));
}

function formatScheduleLabel({ ymd, hour, minute }: ScheduleParts): string {
  return `${formatDayShort(ymd)} · ${pad(hour)}:${pad(minute)} Алматы`;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);
/** Convenient time list inside the calendar popover. */
const TIME_SLOTS: { hour: number; minute: number }[] = Array.from({ length: 24 * 2 }, (_, i) => ({
  hour: Math.floor(i / 2),
  minute: (i % 2) * 30,
}));

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
  const [contentType, setContentType] = useState<ContentPlanType>(initialType);
  const [description, setDescription] = useState("");
  const [schedule, setSchedule] = useState<ScheduleParts>(() => almatyParts());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const [captionBusy, setCaptionBusy] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadLabel, setUploadLabel] = useState<string>();
  const [pickMode, setPickMode] = useState<PickMode>("replace");
  const pickModeRef = useRef<PickMode>("replace");
  const replaceAtRef = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const isCarousel = contentType === "CAROUSEL";
  const isReels = contentType === "REELS";
  const safeIdx = Math.min(activeIdx, Math.max(0, files.length - 1));
  const activeFile = files[safeIdx];
  const activePreview = previews[safeIdx];

  const clearCover = () => {
    setCoverFile(null);
    setCoverPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  };

  const applyCover = (file: File) => {
    setCoverFile(file);
    setCoverPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
  };

  const reset = () => {
    setTitle("");
    setContentType(initialType);
    setDescription("");
    setSchedule(almatyParts());
    setCalendarOpen(false);
    setFiles([]);
    setActiveIdx(0);
    clearCover();
    setCaptionBusy(false);
    setCoverBusy(false);
    setDragFrom(null);
    setDragOver(null);
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

  // Auto cover for Reels: grab a mid-early frame when video changes.
  useEffect(() => {
    if (!isReels || !files[0] || !isVideoFile(files[0])) {
      if (!isReels) clearCover();
      return;
    }
    let cancelled = false;
    setCoverBusy(true);
    void captureFrameFromVideoFile(files[0], 0.22)
      .then((frame) => {
        if (cancelled) return;
        applyCover(frame.file);
      })
      .catch(() => {
        if (!cancelled) toast.message("Не удалось автоматически снять обложку — выберите кадр вручную");
      })
      .finally(() => {
        if (!cancelled) setCoverBusy(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run on video identity
  }, [isReels, files[0]?.name, files[0]?.size, files[0]?.lastModified]);

  const onTypeChange = (t: ContentPlanType) => {
    setContentType(t);
    setFiles([]);
    setActiveIdx(0);
    clearCover();
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

  const reorderSlide = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= files.length || to >= files.length) return;
    setFiles((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
    setActiveIdx(to);
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
    const parts = [title.trim(), description.trim()].filter(Boolean);
    return parts.join("\n\n");
  };

  const generateDescription = async () => {
    if (files.length === 0) {
      toast.error("Сначала загрузите медиа");
      return;
    }
    setCaptionBusy(true);
    try {
      const caption = await generateAutopostCaption({
        mediaType: contentType,
        title,
        files,
        projectId,
      });
      setDescription(caption);
      toast.success("Описание готово — можно поправить перед публикацией");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сгенерировать описание");
    } finally {
      setCaptionBusy(false);
    }
  };

  const recaptureCover = async (atRatio = 0.35) => {
    if (!files[0] || !isVideoFile(files[0])) return;
    setCoverBusy(true);
    try {
      const frame = await captureFrameFromVideoFile(files[0], atRatio);
      applyCover(frame.file);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось снять кадр");
    } finally {
      setCoverBusy(false);
    }
  };

  const applyPreset = (kind: "now" | "today-evening" | "tomorrow-morning" | "plus1h") => {
    const now = almatyParts();
    if (kind === "now") {
      setSchedule(now);
      return;
    }
    if (kind === "plus1h") {
      const next = new Date(Date.now() + 60 * 60 * 1000);
      setSchedule(almatyParts(next));
      return;
    }
    if (kind === "today-evening") {
      setSchedule({ ymd: now.ymd, hour: 19, minute: 0 });
      return;
    }
    setSchedule({ ymd: addAlmatyDays(now.ymd, 1), hour: 10, minute: 0 });
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
    if (!publishNow && !schedule.ymd) {
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
        scheduledAt: scheduleToIso(schedule),
        publishNow,
        coverFile: isReels ? coverFile : null,
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
        description: description.trim() || null,
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
                  <div className="mb-2 flex items-baseline justify-between gap-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Порядок слайдов
                    </div>
                    <div className="text-[11px] text-muted-foreground">Перетащите карточки</div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {files.map((f, i) => (
                      <div
                        key={`${f.name}-${i}-${f.size}`}
                        draggable
                        onDragStart={(e) => {
                          setDragFrom(i);
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", String(i));
                          // Soften drag ghost a bit.
                          if (e.currentTarget instanceof HTMLElement) {
                            e.dataTransfer.setDragImage(e.currentTarget, 40, 40);
                          }
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                          if (dragOver !== i) setDragOver(i);
                        }}
                        onDragLeave={() => {
                          if (dragOver === i) setDragOver(null);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          const raw = e.dataTransfer.getData("text/plain");
                          const from = Number.parseInt(raw || String(dragFrom ?? -1), 10);
                          reorderSlide(from, i);
                          setDragFrom(null);
                          setDragOver(null);
                        }}
                        onDragEnd={() => {
                          setDragFrom(null);
                          setDragOver(null);
                        }}
                        className={cn(
                          "group relative overflow-hidden rounded-xl border bg-card/60 transition",
                          "cursor-grab active:cursor-grabbing",
                          i === safeIdx ? "border-primary/60 ring-2 ring-primary/25" : "border-border/60",
                          dragFrom === i && "opacity-50",
                          dragOver === i && dragFrom !== i && "border-primary ring-2 ring-primary/40",
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
                                <video src={previews[i]} className="pointer-events-none h-full w-full object-cover" muted />
                                <span className="absolute inset-0 grid place-items-center">
                                  <span className="grid h-7 w-7 place-items-center rounded-full bg-black/55 text-white">
                                    <Film className="h-3.5 w-3.5" />
                                  </span>
                                </span>
                              </>
                            ) : (
                              <img src={previews[i]} alt="" className="pointer-events-none h-full w-full object-cover" draggable={false} />
                            )}
                            <span className="absolute left-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-black/75 text-[10px] font-bold text-white">
                              {i + 1}
                            </span>
                            <span className="absolute bottom-1.5 left-1.5 grid h-6 w-6 place-items-center rounded-md bg-black/55 text-white/90">
                              <GripVertical className="h-3.5 w-3.5" />
                            </span>
                          </div>
                        </button>
                        <div className="absolute right-1 top-1 flex gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                          <button
                            type="button"
                            disabled={i === 0}
                            onClick={(e) => { e.stopPropagation(); moveSlide(i, -1); }}
                            onPointerDown={(e) => e.stopPropagation()}
                            className="grid h-6 w-6 place-items-center rounded-md bg-black/70 text-white disabled:opacity-30"
                            aria-label="Левее"
                          >
                            <ChevronLeft className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={i === files.length - 1}
                            onClick={(e) => { e.stopPropagation(); moveSlide(i, 1); }}
                            onPointerDown={(e) => e.stopPropagation()}
                            className="grid h-6 w-6 place-items-center rounded-md bg-black/70 text-white disabled:opacity-30"
                            aria-label="Правее"
                          >
                            <ChevronRight className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); removeSlide(i); }}
                            onPointerDown={(e) => e.stopPropagation()}
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
                    onClick={() => { setFiles([]); setActiveIdx(0); clearCover(); }}
                  >
                    <X className="h-3.5 w-3.5" />
                    Убрать
                  </Button>
                </div>
                {isReels && (
                  <div className="space-y-2 rounded-xl border border-dashed border-border/70 bg-muted/20 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-semibold text-foreground">Обложка Reels</div>
                        <p className="text-[11px] text-muted-foreground">
                          Снимаем кадр автоматически — можно переснять или загрузить свою.
                        </p>
                      </div>
                      {coverBusy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                    </div>
                    <div className="flex flex-wrap items-start gap-3">
                      <div className="relative h-28 w-20 overflow-hidden rounded-lg border border-border/60 bg-zinc-950">
                        {coverPreview ? (
                          <img src={coverPreview} alt="Обложка" className="h-full w-full object-cover" />
                        ) : (
                          <div className="grid h-full place-items-center text-[10px] text-muted-foreground">нет кадра</div>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="gap-1"
                          disabled={coverBusy || !files[0]}
                          onClick={() => void recaptureCover(0.35)}
                        >
                          <Camera className="h-3.5 w-3.5" />
                          Другой кадр
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="gap-1"
                          onClick={() => coverInputRef.current?.click()}
                        >
                          <Upload className="h-3.5 w-3.5" />
                          Своя картинка
                        </Button>
                        {coverFile && (
                          <Button type="button" variant="ghost" size="sm" onClick={clearCover}>
                            Убрать
                          </Button>
                        )}
                      </div>
                    </div>
                    <input
                      ref={coverInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) {
                          void ensureJpegCoverFile(f)
                            .then(applyCover)
                            .catch(() => applyCover(f));
                        }
                        e.target.value = "";
                      }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <Label>Когда публиковать</Label>
              <span className="text-[11px] text-muted-foreground">{formatScheduleLabel(schedule)}</span>
            </div>
            <div className="space-y-2 rounded-xl border border-border/60 bg-card/40 p-3">
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ["now", "Сейчас"],
                    ["plus1h", "+1 час"],
                    ["today-evening", "Сегодня 19:00"],
                    ["tomorrow-morning", "Завтра 10:00"],
                  ] as const
                ).map(([kind, label]) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => applyPreset(kind)}
                    className="rounded-lg border border-border/60 bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
                  >
                    {label}
                  </button>
                ))}
              </div>
              <Popover open={calendarOpen} onOpenChange={setCalendarOpen} modal>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 w-full justify-start gap-2 rounded-xl border-border/60 bg-background px-3 text-left font-normal"
                    aria-label="Дата публикации"
                  >
                    <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium text-foreground">{formatDayShort(schedule.ymd)}</span>
                      <span className="text-muted-foreground">
                        {" · "}
                        {pad(schedule.hour)}:{pad(schedule.minute)} Алматы
                      </span>
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="w-auto max-w-[calc(100vw-2rem)] p-0"
                  onOpenAutoFocus={(e) => e.preventDefault()}
                >
                  <div className="flex flex-col sm:flex-row">
                    <div className="border-b border-border/60 sm:border-b-0 sm:border-r">
                      <Calendar
                        mode="single"
                        selected={ymdToDate(schedule.ymd)}
                        onSelect={(d) => {
                          if (!d) return;
                          setSchedule((s) => ({ ...s, ymd: dateToYmd(d) }));
                        }}
                        disabled={(d) => d < startOfLocalDay()}
                        initialFocus
                        className="pointer-events-auto p-3"
                      />
                    </div>
                    <div className="flex w-full flex-col p-3 sm:w-[148px]">
                      <div className="mb-2 text-xs font-semibold text-muted-foreground">
                        Время · {formatDayShort(schedule.ymd)}
                      </div>
                      <div className="grid max-h-[260px] grid-cols-3 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-1">
                        {TIME_SLOTS.map((slot) => {
                          const active =
                            schedule.hour === slot.hour && schedule.minute === slot.minute;
                          const label = `${pad(slot.hour)}:${pad(slot.minute)}`;
                          return (
                            <button
                              key={label}
                              type="button"
                              onClick={() => {
                                setSchedule((s) => ({
                                  ...s,
                                  hour: slot.hour,
                                  minute: slot.minute,
                                }));
                                setCalendarOpen(false);
                              }}
                              className={cn(
                                "rounded-lg border px-2 py-1.5 text-sm tabular-nums transition",
                                active
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-border/60 bg-background text-foreground hover:border-primary/40",
                              )}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                      <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
                        Точнее — час и минуты ниже
                      </p>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={schedule.hour}
                  onChange={(e) => setSchedule((s) => ({ ...s, hour: Number(e.target.value) }))}
                  className="h-10 rounded-lg border border-border/60 bg-background px-2 text-sm tabular-nums"
                  aria-label="Час"
                >
                  {HOURS.map((h) => (
                    <option key={h} value={h}>{pad(h)}</option>
                  ))}
                </select>
                <span className="text-muted-foreground">:</span>
                <select
                  value={schedule.minute}
                  onChange={(e) => setSchedule((s) => ({ ...s, minute: Number(e.target.value) }))}
                  className="h-10 rounded-lg border border-border/60 bg-background px-2 text-sm tabular-nums"
                  aria-label="Минуты"
                >
                  {MINUTES.map((m) => (
                    <option key={m} value={m}>{pad(m)}</option>
                  ))}
                </select>
                <span className="text-[11px] text-muted-foreground">Алматы</span>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label>Описание</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5"
                disabled={captionBusy || saving || files.length === 0}
                onClick={() => void generateDescription()}
              >
                {captionBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Сгенерировать описание
              </Button>
            </div>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder={
                isCarousel || isReels
                  ? "Или нажмите «Сгенерировать» — AI прочитает текст на слайдах/кадре"
                  : "Текст поста / подпись к публикации"
              }
            />
            <p className="text-[11px] text-muted-foreground">
              AI смотрит на загруженные картинки (карусель) или кадр из видео (Reels) и пишет короткую подпись.
            </p>
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
