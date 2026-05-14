import { Image as ImageIcon, Layers, MessageCircle, Play, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MetaCreativeRow } from "@/hooks/useMetaStructure";

const fmtTenge = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;

interface Props {
  row: MetaCreativeRow;
  isWhatsApp?: boolean;
  onOpen: () => void;
  active?: boolean;
}

export function CreativeCard({ row, isWhatsApp, onOpen, active }: Props) {
  const isVideo = row.creativeType === "video";
  const isCarousel = row.creativeType === "carousel";
  const src = row.thumbnailUrl || row.imageUrl;
  const isActive = (row.effectiveStatus ?? "").toUpperCase() === "ACTIVE";

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group flex flex-col overflow-hidden rounded-2xl border bg-card/60 text-left transition hover:border-primary/40 hover:shadow-lg",
        active ? "border-primary/60 ring-1 ring-primary/40" : "border-border/60",
      )}
    >
      {/* Poster 9:16 */}
      <div className="relative aspect-[9/16] w-full overflow-hidden bg-secondary/30">
        {src ? (
          <img
            src={src}
            alt={row.name}
            className="h-full w-full object-cover transition group-hover:scale-[1.02]"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <ImageIcon className="h-8 w-8 text-muted-foreground/40" />
          </div>
        )}

        {/* Status chip */}
        <span
          className={cn(
            "absolute left-2 top-2 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase backdrop-blur",
            isActive ? "bg-success/85 text-success-foreground" : "bg-muted/85 text-muted-foreground",
          )}
        >
          {isActive ? "Активно" : (row.effectiveStatus ?? "—").toLowerCase()}
        </span>

        {/* Channel chip */}
        {isWhatsApp && (
          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-success/85 px-1.5 py-0.5 text-[10px] font-bold text-success-foreground backdrop-blur">
            <MessageCircle className="h-3 w-3" /> WhatsApp
          </span>
        )}

        {/* Type icon */}
        <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-md bg-background/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider backdrop-blur">
          {isVideo ? <Video className="h-3 w-3" /> : isCarousel ? <Layers className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}
          {row.creativeType}
        </span>

        {/* Play overlay */}
        {isVideo && (
          <span className="absolute inset-0 grid place-items-center">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-background/70 backdrop-blur transition group-hover:scale-110">
              <Play className="h-5 w-5 fill-foreground text-foreground" />
            </span>
          </span>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 space-y-2 p-3">
        <div className="line-clamp-2 min-h-[2.4rem] text-xs font-semibold leading-snug" title={row.name}>
          {row.name || "Без названия"}
        </div>
        <div className="grid grid-cols-2 gap-1.5 text-[11px]">
          <div className="rounded-md bg-secondary/30 px-2 py-1">
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground">CTR</div>
            <div className="font-bold tabular-nums">{row.ctr > 0 ? `${row.ctr.toFixed(2)}%` : "—"}</div>
          </div>
          <div className="rounded-md bg-secondary/30 px-2 py-1">
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground">CPL</div>
            <div className="font-bold tabular-nums text-success">{row.cpl > 0 ? fmtTenge(row.cpl) : "—"}</div>
          </div>
          <div className="rounded-md bg-secondary/30 px-2 py-1">
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Расход</div>
            <div className="font-bold tabular-nums">{row.spend > 0 ? fmtTenge(row.spend) : "—"}</div>
          </div>
          <div className="rounded-md bg-secondary/30 px-2 py-1">
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
              {isWhatsApp ? "Сообщ." : "Заявки"}
            </div>
            <div className="font-bold tabular-nums">{Math.round(isWhatsApp ? row.messages : row.leads).toLocaleString("ru-RU")}</div>
          </div>
        </div>
      </div>
    </button>
  );
}
