import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Camera, ChevronLeft, ChevronRight, Clock, Film, FlaskConical, Images, Loader2, Send, Sparkles, Upload, X, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { fmtNum } from "@/lib/format";
import { TYPE_META, type PostType } from "@/components/autopost/constants";

const pad = (n: number) => String(n).padStart(2, "0");
const isVideoFile = (f: File) => f.type.startsWith("video/");
const fmtDuration = (s: number) => {
  const total = Math.max(0, Math.floor(s));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

function PhoneFrame({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="mx-auto w-full max-w-[240px]">
      <div className="relative rounded-[2rem] border-[3px] border-border/70 bg-zinc-950 p-2 shadow-2xl shadow-black/40 ring-1 ring-white/5">
        <div className="absolute left-1/2 top-3 z-10 h-1 w-14 -translate-x-1/2 rounded-full bg-zinc-700/80" />
        <div className="aspect-[9/16] overflow-hidden rounded-[1.35rem] bg-zinc-900">{children}</div>
      </div>
      {label && <p className="mt-2 text-center text-[11px] font-medium text-muted-foreground">{label}</p>}
    </div>
  );
}

function FieldLabel({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-2">
      <span className="text-xs font-semibold text-foreground">{children}</span>
      {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

export interface AutopostComposerDialogProps {
  day: string;
  dayLabel: string;
  hourReach: Map<number, number>;
  bestHour: number | null;
  hasAccount: boolean;
  busy: boolean;
  uploadLabel?: string;
  onClose: () => void;
  onSubmitNow: () => void;
  onSubmitSchedule: () => void;
  // controlled-ish state via render props would be overkill — parent owns submit logic
  type: PostType;
  onTypeChange: (t: PostType) => void;
  files: File[];
  previews: string[];
  onPickFiles: (list: FileList | null) => void;
  onRemoveFile: (idx: number) => void;
  onMoveFile: (idx: number, dir: -1 | 1) => void;
  caption: string;
  onCaptionChange: (v: string) => void;
  hour: number;
  minute: number;
  onHourChange: (h: number) => void;
  onMinuteChange: (m: number) => void;
  dryRun: boolean;
  onDryRunChange: (v: boolean) => void;
  // reels cover
  videoSrc: string | null;
  coverPreview: string | null;
  seek: number;
  duration: number;
  onSeekChange: (t: number) => void;
  onDurationChange: (d: number) => void;
  onCaptureFrame: () => void;
  onPickCover: (f: File) => void;
  onClearCover: () => void;
  videoRef: React.RefObject<HTMLVideoElement>;
  fileInputRef: React.RefObject<HTMLInputElement>;
  coverInputRef: React.RefObject<HTMLInputElement>;
}

export function AutopostComposerDialog(props: AutopostComposerDialogProps) {
  const {
    dayLabel, hourReach, bestHour, hasAccount, busy, uploadLabel, onClose,
    onSubmitNow, onSubmitSchedule,
    type, onTypeChange, files, previews, onPickFiles, onRemoveFile, onMoveFile,
    caption, onCaptionChange, hour, minute, onHourChange, onMinuteChange,
    dryRun, onDryRunChange,
    videoSrc, coverPreview, seek, duration, onSeekChange, onDurationChange,
    onCaptureFrame, onPickCover, onClearCover, videoRef, fileInputRef, coverInputRef,
  } = props;

  const [dragActive, setDragActive] = useState(false);
  const [previewMode, setPreviewMode] = useState<"media" | "cover">("media");
  const meta = TYPE_META[type];
  const reachHint = hourReach.get(hour);
  const progressPct = duration > 0 ? Math.min(100, (seek / duration) * 100) : 0;
  const hasMedia = files.length > 0;

  useEffect(() => {
    if (type !== "REELS" || !videoSrc) setPreviewMode("media");
  }, [type, videoSrc]);

  const openFilePicker = () => fileInputRef.current?.click();

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="flex max-h-[95vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="shrink-0 border-b border-border/60 bg-gradient-to-r from-primary/[0.07] via-background to-pink-500/[0.06] px-6 py-4 text-left">
          <div className="flex items-start justify-between gap-3">
            <div>
              <DialogTitle className="text-lg">Новая публикация</DialogTitle>
              <DialogDescription className="mt-1">
                {dayLabel} · время по Алматы
                {!hasAccount && (
                  <span className="ml-2 text-amber-600">· Instagram не подключён</span>
                )}
              </DialogDescription>
            </div>
            <Badge variant="outline" className="shrink-0 rounded-lg border-border/60 bg-background/80 font-normal">
              {meta.label}
            </Badge>
          </div>
        </DialogHeader>

        <div className="relative flex min-h-0 flex-1 flex-col">
        <ScrollArea className="min-h-0 max-h-[calc(95vh-10rem)]">
          <div className="grid gap-6 p-6 lg:grid-cols-[minmax(220px,260px)_1fr]">
            {/* —— Превью (мобильный макет) —— */}
            <div className="space-y-3">
              <FieldLabel hint={meta.aspect}>Предпросмотр</FieldLabel>
              <PhoneFrame label={hasMedia ? "Так увидят в ленте" : "Загрузите медиа"}>
                {!hasMedia ? (
                  <button
                    type="button"
                    onClick={openFilePicker}
                    onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                    onDragLeave={() => setDragActive(false)}
                    onDrop={(e) => { e.preventDefault(); setDragActive(false); onPickFiles(e.dataTransfer.files); }}
                    className={cn(
                      "flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center transition",
                      dragActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-white/[0.03]",
                    )}
                  >
                    <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/5 ring-1 ring-white/10">
                      <Upload className="h-5 w-5" />
                    </span>
                    <span className="text-xs font-medium">Нажмите или перетащите файл</span>
                  </button>
                ) : type === "REELS" && videoSrc && previewMode === "cover" && coverPreview ? (
                  <img src={coverPreview} alt="" className="h-full w-full object-cover" />
                ) : isVideoFile(files[0]) ? (
                  <video
                    ref={videoRef}
                    src={videoSrc ?? previews[0]}
                    onLoadedMetadata={(e) => onDurationChange(e.currentTarget.duration || 0)}
                    className="h-full w-full object-cover"
                    muted
                    playsInline
                  />
                ) : meta.multiple && files.length > 1 ? (
                  <div className="grid h-full grid-cols-2 gap-0.5 bg-black p-0.5">
                    {previews.slice(0, 4).map((src, i) => (
                      <img key={i} src={src} alt="" className="h-full w-full object-cover" />
                    ))}
                  </div>
                ) : (
                  <img src={previews[0]} alt="" className="h-full w-full object-cover" />
                )}
              </PhoneFrame>

              {hasMedia && (
                <div className="flex flex-wrap justify-center gap-2">
                  <Button type="button" variant="outline" size="sm" className="h-8 rounded-lg text-xs" onClick={openFilePicker}>
                    Заменить
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="h-8 rounded-lg text-xs text-muted-foreground hover:text-destructive" onClick={() => onRemoveFile(0)}>
                    Убрать
                  </Button>
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept={meta.accept}
                multiple={meta.multiple}
                className="hidden"
                onChange={(e) => onPickFiles(e.target.files)}
              />
            </div>

            {/* —— Форма —— */}
            <div className="space-y-5">
              <div>
                <FieldLabel>Формат</FieldLabel>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {(Object.keys(TYPE_META) as PostType[]).map((t) => {
                    const M = TYPE_META[t];
                    const Icon = M.icon;
                    const active = type === t;
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => onTypeChange(t)}
                        className={cn(
                          "flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition",
                          active
                            ? "border-primary/50 bg-primary/10 text-primary shadow-sm ring-1 ring-primary/20"
                            : "border-border/60 bg-card/40 hover:border-border hover:bg-secondary/30",
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        {M.label}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">{meta.hint}</p>
              </div>

              {meta.multiple && files.length > 0 && (
                <div>
                  <FieldLabel hint={`${files.length} из 10`}>Порядок слайдов</FieldLabel>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {files.map((f, i) => (
                      <div key={i} className="group relative shrink-0 w-16">
                        {isVideoFile(f) ? (
                          <video src={previews[i]} className="h-16 w-16 rounded-lg object-cover ring-1 ring-border/50" muted />
                        ) : (
                          <img src={previews[i]} alt="" className="h-16 w-16 rounded-lg object-cover ring-1 ring-border/50" />
                        )}
                        <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[9px] font-bold text-white">{i + 1}</span>
                        <div className="absolute inset-x-0 bottom-0 flex justify-between rounded-b-lg bg-black/55 px-0.5 opacity-0 transition group-hover:opacity-100">
                          <button type="button" disabled={i === 0} onClick={() => onMoveFile(i, -1)} className="p-0.5 text-white disabled:opacity-30"><ChevronLeft className="h-3 w-3" /></button>
                          <button type="button" disabled={i === files.length - 1} onClick={() => onMoveFile(i, 1)} className="p-0.5 text-white disabled:opacity-30"><ChevronRight className="h-3 w-3" /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {type === "REELS" && videoSrc && (
                <div className="rounded-2xl border border-border/60 bg-card/50 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <FieldLabel hint="необязательно">Обложка Reels</FieldLabel>
                    <div className="flex rounded-lg border border-border/60 bg-background p-0.5 text-[10px] font-medium">
                      <button type="button" onClick={() => setPreviewMode("media")} className={cn("rounded-md px-2 py-1 transition", previewMode === "media" ? "bg-secondary text-foreground" : "text-muted-foreground")}>Видео</button>
                      <button type="button" onClick={() => setPreviewMode("cover")} className={cn("rounded-md px-2 py-1 transition", previewMode === "cover" ? "bg-secondary text-foreground" : "text-muted-foreground")}>Обложка</button>
                    </div>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={duration || 0}
                    step={0.1}
                    value={seek}
                    onChange={(e) => {
                      const t = Number(e.target.value);
                      onSeekChange(t);
                      if (videoRef.current) videoRef.current.currentTime = t;
                    }}
                    style={{ background: `linear-gradient(to right, hsl(var(--primary)) ${progressPct}%, hsl(var(--secondary)) ${progressPct}%)` }}
                    className="h-1.5 w-full cursor-pointer appearance-none rounded-full [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-md"
                  />
                  <div className="mt-1 flex justify-between text-[10px] tabular-nums text-muted-foreground">
                    <span>{fmtDuration(seek)}</span>
                    <span>{fmtDuration(duration)}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="secondary" className="h-8 gap-1.5 rounded-lg text-xs" onClick={onCaptureFrame}>
                      <Camera className="h-3.5 w-3.5" /> Кадр с видео
                    </Button>
                    <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 rounded-lg text-xs" onClick={() => coverInputRef.current?.click()}>
                      <Upload className="h-3.5 w-3.5" /> Своя картинка
                    </Button>
                    {coverPreview && (
                      <Button type="button" size="sm" variant="ghost" className="h-8 gap-1 text-xs text-muted-foreground" onClick={onClearCover}>
                        <X className="h-3.5 w-3.5" /> Сбросить
                      </Button>
                    )}
                  </div>
                  <input ref={coverInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onPickCover(f); }} />
                </div>
              )}

              {type !== "STORIES" && (
                <div>
                  <FieldLabel hint={`${caption.length} / 2200`}>Подпись</FieldLabel>
                  <Textarea
                    value={caption}
                    onChange={(e) => onCaptionChange(e.target.value.slice(0, 2200))}
                    placeholder="Текст, хэштеги, призыв к действию…"
                    className="min-h-[100px] resize-none rounded-xl border-border/60 bg-background/80 text-sm leading-relaxed"
                  />
                </div>
              )}

              <div>
                <FieldLabel hint="Asia/Almaty">Время публикации</FieldLabel>
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-card/40 p-3">
                  <div className="flex items-center gap-1.5">
                    <select value={hour} onChange={(e) => onHourChange(Number(e.target.value))} className="h-9 rounded-lg border border-border/60 bg-background px-3 text-sm font-medium tabular-nums">
                      {Array.from({ length: 24 }, (_, i) => i).map((h) => <option key={h} value={h}>{pad(h)}</option>)}
                    </select>
                    <span className="text-muted-foreground">:</span>
                    <select value={minute} onChange={(e) => onMinuteChange(Number(e.target.value))} className="h-9 rounded-lg border border-border/60 bg-background px-3 text-sm font-medium tabular-nums">
                      {Array.from({ length: 12 }, (_, i) => i * 5).map((m) => <option key={m} value={m}>{pad(m)}</option>)}
                    </select>
                  </div>
                  {bestHour != null && (
                    <button
                      type="button"
                      onClick={() => { onHourChange(bestHour); onMinuteChange(0); }}
                      className="inline-flex items-center gap-1 rounded-lg border border-primary/30 bg-primary/5 px-2.5 py-1.5 text-[11px] font-medium text-primary transition hover:bg-primary/10"
                    >
                      <Sparkles className="h-3 w-3" /> Лучшее · {pad(bestHour)}:00
                    </button>
                  )}
                  <label className="ml-auto flex cursor-pointer items-center gap-2 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs">
                    <Switch checked={dryRun} onCheckedChange={onDryRunChange} />
                    <FlaskConical className="h-3.5 w-3.5 text-violet-500" />
                    <span>Пробный режим</span>
                  </label>
                </div>
                {reachHint ? (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Средний охват в это время: <span className="font-semibold text-foreground">{fmtNum(reachHint)}</span>
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </ScrollArea>

        {busy && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background/85 backdrop-blur-[2px]">
            <Loader2 className="h-9 w-9 animate-spin text-primary" />
            <p className="mt-3 text-sm font-medium">{uploadLabel ?? "Загружаем и планируем…"}</p>
          </div>
        )}
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t border-border/60 bg-muted/20 px-6 py-4 sm:justify-between">
          <Button type="button" variant="ghost" className="rounded-xl" onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="rounded-xl border-primary/40 text-primary hover:bg-primary/10" onClick={onSubmitNow} disabled={busy || dryRun || !hasAccount}>
              <Zap className="mr-1.5 h-4 w-4" /> Опубликовать сейчас
            </Button>
            <Button type="button" className="rounded-xl px-5" onClick={onSubmitSchedule} disabled={busy || !hasAccount}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Send className="mr-1.5 h-4 w-4" /> Запланировать</>}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
