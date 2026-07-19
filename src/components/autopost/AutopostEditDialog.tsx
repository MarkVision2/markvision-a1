import { Link } from "react-router-dom";
import { Loader2, Pencil, RotateCcw, Trash2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { STATUS_META, TYPE_META, type PostType } from "@/components/autopost/constants";
import { MediaThumb } from "@/components/autopost/MediaThumb";

const pad = (n: number) => String(n).padStart(2, "0");

export interface AutopostEditDialogProps {
  post: {
    id: string;
    media_type: string;
    media_url?: string | null;
    thumbnail_url: string | null;
    caption: string | null;
    scheduled_at: string;
    status: string;
    error: string | null;
  };
  busy: boolean;
  editable: boolean;
  caption: string;
  ymd: string;
  hour: number;
  minute: number;
  timeLabel: string;
  dayLabel: string;
  errorText: string | null;
  showReconnectLink: boolean;
  onClose: () => void;
  onCaptionChange: (v: string) => void;
  onYmdChange: (v: string) => void;
  onHourChange: (h: number) => void;
  onMinuteChange: (m: number) => void;
  onDelete: () => void;
  onRetry: () => void;
  onPublishNow: () => void;
  onSave: () => void;
}

export function AutopostEditDialog(props: AutopostEditDialogProps) {
  const {
    post, busy, editable, caption, ymd, hour, minute, timeLabel, dayLabel,
    errorText, showReconnectLink, onClose, onCaptionChange, onYmdChange,
    onHourChange, onMinuteChange, onDelete, onRetry, onPublishNow, onSave,
  } = props;

  const s = STATUS_META[post.status] ?? STATUS_META.queued;
  const type = (post.media_type ?? "IMAGE") as PostType;
  const typeLabel = TYPE_META[type]?.label ?? post.media_type;
  const isVertical = type === "REELS" || type === "STORIES";
  const hasMedia = !!(post.thumbnail_url || post.media_url);

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b border-border/60 px-5 py-4 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={cn("border-0", s.cls)}>
              <s.icon className={cn("mr-1 h-3 w-3", post.status === "processing" && "animate-spin")} />
              {s.label}
            </Badge>
            <span className="text-sm font-medium text-foreground">{typeLabel}</span>
            <span className="text-xs text-muted-foreground">{timeLabel} · {dayLabel}</span>
          </div>
          <DialogTitle className="mt-1 text-base">Публикация</DialogTitle>
          <DialogDescription className="sr-only">Редактирование запланированной публикации</DialogDescription>
        </DialogHeader>

        <ScrollArea className="min-h-0 flex-1 max-h-[calc(92vh-9rem)]">
          <div className="grid gap-5 p-5 sm:grid-cols-[minmax(140px,200px)_1fr]">
            {/* Полный кадр, без широкой «шапки» object-cover */}
            <div className="mx-auto w-full max-w-[200px]">
              <div
                data-testid="edit-preview-frame"
                data-aspect={isVertical ? "9/16" : "4/5"}
                className={cn(
                  "overflow-hidden rounded-2xl border border-border/60 bg-zinc-950 shadow-lg ring-1 ring-white/5",
                  isVertical ? "aspect-[9/16]" : "aspect-[4/5]",
                )}
              >
                {hasMedia ? (
                  <MediaThumb
                    thumbnailUrl={post.thumbnail_url}
                    mediaUrl={post.media_url}
                    mediaType={post.media_type}
                    className="h-full w-full"
                  />
                ) : (
                  <div className="grid h-full place-items-center text-xs text-muted-foreground">Нет превью</div>
                )}
              </div>
              <p className="mt-2 text-center text-[11px] text-muted-foreground">
                {isVertical ? "Кадр 9:16 · как в Reels" : "Кадр 4:5 · как в ленте"}
              </p>
            </div>

            <div className="space-y-4">
              {errorText && (
                <div className="space-y-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-3 text-sm text-destructive">
                  <p>{errorText}</p>
                  {showReconnectLink && (
                    <Link to="/settings?tab=meta-tokens" className="inline-flex text-xs font-semibold text-primary hover:underline">
                      Переподключить Instagram →
                    </Link>
                  )}
                </div>
              )}

              {editable ? (
                <>
                  {post.media_type !== "STORIES" && (
                    <div>
                      <div className="mb-1.5 text-xs font-semibold text-foreground">Подпись</div>
                      <Textarea
                        value={caption}
                        onChange={(e) => onCaptionChange(e.target.value.slice(0, 2200))}
                        className="min-h-[120px] resize-y rounded-xl border-border/60 text-sm"
                        placeholder="Текст публикации"
                      />
                    </div>
                  )}
                  <div>
                    <div className="mb-1.5 text-xs font-semibold text-foreground">Когда</div>
                    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-card/40 p-3">
                      <input
                        type="date"
                        value={ymd}
                        onChange={(e) => onYmdChange(e.target.value)}
                        className="h-9 rounded-lg border border-border/60 bg-background px-2 text-sm"
                        aria-label="Дата"
                      />
                      <select
                        value={hour}
                        onChange={(e) => onHourChange(Number(e.target.value))}
                        className="h-9 rounded-lg border border-border/60 bg-background px-2 text-sm tabular-nums"
                        aria-label="Час"
                      >
                        {Array.from({ length: 24 }, (_, i) => i).map((h) => (
                          <option key={h} value={h}>{pad(h)}</option>
                        ))}
                      </select>
                      <span className="text-muted-foreground">:</span>
                      <select
                        value={minute}
                        onChange={(e) => onMinuteChange(Number(e.target.value))}
                        className="h-9 rounded-lg border border-border/60 bg-background px-2 text-sm tabular-nums"
                        aria-label="Минуты"
                      >
                        {Array.from({ length: 12 }, (_, i) => i * 5).map((m) => (
                          <option key={m} value={m}>{pad(m)}</option>
                        ))}
                      </select>
                      <span className="text-[10px] text-muted-foreground">Алматы</span>
                    </div>
                  </div>
                </>
              ) : (
                post.caption && <p className="whitespace-pre-wrap text-sm leading-relaxed">{post.caption}</p>
              )}
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="shrink-0 gap-2 border-t border-border/60 bg-muted/20 px-5 py-4 sm:justify-between">
          <div className="flex gap-2">
            {post.status !== "published" && (
              <Button variant="ghost" size="sm" className="rounded-lg text-destructive hover:bg-destructive/10" onClick={onDelete} disabled={busy}>
                <Trash2 className="mr-1 h-4 w-4" /> Удалить
              </Button>
            )}
            {post.status === "failed" && (
              <Button variant="ghost" size="sm" className="rounded-lg" onClick={onRetry} disabled={busy}>
                <RotateCcw className="mr-1 h-4 w-4" /> Повторить
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            {editable && (
              <>
                <Button variant="outline" size="sm" className="rounded-lg border-primary/40 text-primary hover:bg-primary/10" onClick={onPublishNow} disabled={busy}>
                  <Zap className="mr-1 h-4 w-4" /> Сейчас
                </Button>
                <Button size="sm" className="rounded-lg" onClick={onSave} disabled={busy}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Pencil className="mr-1 h-4 w-4" /> Сохранить</>}
                </Button>
              </>
            )}
            {!editable && (
              <Button size="sm" className="rounded-lg" onClick={onClose}>Закрыть</Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
