import { useEffect, useRef, useState } from "react";
import { Loader2, Plus, Send, Upload, X } from "lucide-react";
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
  // Asia/Almaty (+05) local wall clock for datetime-local
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
  // datetime-local is wall time; treat as Almaty (+05)
  const [date, time] = local.split("T");
  const [h, m] = (time || "12:00").split(":").map(Number);
  return new Date(`${date}T${pad(h || 0)}:${pad(m || 0)}:00+05:00`).toISOString();
}

export function ContentPlanComposerDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Called after successful schedule/publish (plan row mirrored). */
  onDone?: () => void;
}) {
  const { activeId: projectId } = useProjectsStore();
  const { account } = useInstagramAccount();

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<ContentPlanCategory>("content");
  const [contentType, setContentType] = useState<ContentPlanType>("REELS");
  const [description, setDescription] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [prompts, setPrompts] = useState("");
  const [codeword, setCodeword] = useState("");
  const [scheduledLocal, setScheduledLocal] = useState(() => toDatetimeLocalValue());
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploadLabel, setUploadLabel] = useState<string>();
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setTitle("");
    setCategory("content");
    setContentType("REELS");
    setDescription("");
    setHashtags("");
    setPrompts("");
    setCodeword("");
    setScheduledLocal(toDatetimeLocalValue());
    setFiles([]);
    setUploadLabel(undefined);
  };

  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => { urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, [files]);

  const onTypeChange = (t: ContentPlanType) => {
    setContentType(t);
    setFiles([]);
    if (fileRef.current) fileRef.current.value = "";
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
    if (contentType === "CAROUSEL") setFiles(arr.slice(0, 10));
    else setFiles(arr.slice(0, 1));
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
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Новая публикация</DialogTitle>
          <DialogDescription>
            Заполните ТЗ, загрузите медиа — сразу попадёт в контент-план и очередь автопостинга.
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
            <Label>Медиа для автопостинга</Label>
            <input
              ref={fileRef}
              type="file"
              accept={accept}
              multiple={contentType === "CAROUSEL"}
              className="hidden"
              onChange={(e) => pickFiles(e.target.files)}
            />
            {files.length === 0 ? (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className={cn(
                  "flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/70",
                  "bg-muted/30 px-4 py-8 text-sm text-muted-foreground transition hover:border-primary/40 hover:bg-primary/5",
                )}
              >
                <Upload className="h-6 w-6" />
                <span className="font-medium text-foreground">Загрузить файл</span>
                <span className="text-xs">
                  {contentType === "CAROUSEL"
                    ? "2–10 фото/видео"
                    : contentType === "REELS"
                      ? "Видео для Reels"
                      : "Фото"}
                </span>
              </button>
            ) : (
              <div className="space-y-2 rounded-xl border border-border/60 bg-background/50 p-3">
                <div className="flex flex-wrap gap-2">
                  {previews.map((src, i) => (
                    <div key={`${files[i]?.name}-${i}`} className="relative h-16 w-16 overflow-hidden rounded-lg border border-border/60 bg-muted">
                      {isVideoFile(files[i]) ? (
                        <video src={src} className="h-full w-full object-cover" muted />
                      ) : (
                        <img src={src} alt="" className="h-full w-full object-cover" />
                      )}
                      <button
                        type="button"
                        className="absolute right-0.5 top-0.5 rounded-full bg-black/70 p-0.5 text-white"
                        onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                        aria-label="Убрать файл"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
                <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => fileRef.current?.click()}>
                  <Upload className="h-3.5 w-3.5" />
                  Заменить
                </Button>
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
