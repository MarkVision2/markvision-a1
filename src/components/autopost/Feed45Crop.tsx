import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Move, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Fit, ViewParams } from "@/lib/cropMedia";

export const FEED_45_RATIO = "4:5" as const;
export const FEED_45_FRAME = { w: 1080, h: 1350 };

export function fileCropKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function defaultFeed45View(): ViewParams {
  return {
    ratio: FEED_45_RATIO,
    fit: "cover",
    zoom: 1,
    pos: { x: 0, y: 0 },
    frame: { ...FEED_45_FRAME },
  };
}

type Props = {
  file: File;
  previewUrl: string;
  value?: ViewParams | null;
  onChange: (view: ViewParams) => void;
  className?: string;
  /** Компактный режим для сетки слайдов. */
  compact?: boolean;
};

/**
 * Интерактивный кадр ленты Instagram 4:5: Fill/Fit, зум, перетаскивание.
 * При публикации запекается через cropImageFile.
 */
export function Feed45Crop({ file, previewUrl, value, onChange, className, compact }: Props) {
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);
  const [fit, setFit] = useState<Fit>(value?.fit ?? "cover");
  const [zoom, setZoom] = useState(value?.zoom ?? 1);
  const [pos, setPos] = useState(value?.pos ?? { x: 0, y: 0 });
  const [frameSize, setFrameSize] = useState(value?.frame ?? { ...FEED_45_FRAME });

  useEffect(() => {
    setFit(value?.fit ?? "cover");
    setZoom(value?.zoom ?? 1);
    setPos(value?.pos ?? { x: 0, y: 0 });
    if (value?.frame?.w) setFrameSize(value.frame);
  }, [file.name, file.size, file.lastModified]); // reset when file identity changes

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setFrameSize({ w: r.width, h: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [previewUrl]);

  useEffect(() => {
    onChange({
      ratio: FEED_45_RATIO,
      fit,
      zoom,
      pos,
      frame: frameSize.w > 0 ? frameSize : { ...FEED_45_FRAME },
    });
  }, [fit, zoom, pos, frameSize.w, frameSize.h]); // eslint-disable-line react-hooks/exhaustive-deps

  const canDrag = fit === "cover" || zoom > 1;
  const mediaStyle: CSSProperties = {
    transform: `translate(${pos.x}px, ${pos.y}px) scale(${zoom})`,
    transformOrigin: "center center",
  };

  return (
    <div className={cn("space-y-2", className)}>
      {!compact && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] font-medium text-muted-foreground">
            Кадр публикации · <span className="text-foreground">4:5</span>
            <span className="ml-1.5 inline-flex items-center gap-1 text-[10px]">
              <Move className="h-3 w-3" /> двигайте · зумом обрезайте
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setFit((f) => (f === "contain" ? "cover" : "contain"))}
              className="rounded-md border border-border/60 bg-background/60 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
            >
              {fit === "contain" ? "Вписать" : "Заполнить"}
            </button>
            <button
              type="button"
              onClick={() => {
                setZoom(1);
                setPos({ x: 0, y: 0 });
                setFit("cover");
              }}
              className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/60 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="h-3 w-3" /> Сброс
            </button>
          </div>
        </div>
      )}

      <div
        ref={frameRef}
        className={cn(
          "relative w-full overflow-hidden rounded-2xl border-2 border-dashed border-primary/35 bg-zinc-950",
          "aspect-[4/5]",
          canDrag && "cursor-grab active:cursor-grabbing",
        )}
        onPointerDown={(e) => {
          if (!canDrag) return;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          dragRef.current = { sx: e.clientX, sy: e.clientY, px: pos.x, py: pos.y };
        }}
        onPointerMove={(e) => {
          if (!dragRef.current) return;
          setPos({
            x: dragRef.current.px + (e.clientX - dragRef.current.sx),
            y: dragRef.current.py + (e.clientY - dragRef.current.sy),
          });
        }}
        onPointerUp={() => {
          dragRef.current = null;
        }}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
      >
        <img
          src={previewUrl}
          alt={file.name}
          draggable={false}
          className={cn(
            "pointer-events-none absolute inset-0 h-full w-full select-none",
            fit === "cover" ? "object-cover" : "object-contain",
          )}
          style={mediaStyle}
        />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/50 to-transparent px-2 py-1.5 text-[10px] text-white/90">
          Так уйдёт в Instagram · 4:5
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="w-8 text-[10px] text-muted-foreground">Зум</span>
        <input
          type="range"
          min={1}
          max={3}
          step={0.01}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-secondary [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
        />
        <span className="w-8 text-right text-[10px] tabular-nums text-muted-foreground">{zoom.toFixed(2)}×</span>
      </div>
    </div>
  );
}
