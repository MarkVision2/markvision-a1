import { useEffect, useRef, useState } from "react";
import { Image as ImageIcon, Layers, Loader2, MessageCircle, Play, TrendingDown, TrendingUp, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCreativeHqPreview } from "@/hooks/useCreativeHqPreview";
import type { MetaCreativeRow } from "@/hooks/useMetaStructure";

const fmtTenge = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;
const fmtNum = (n: number) => Math.round(n).toLocaleString("ru-RU");

interface Props {
  row: MetaCreativeRow;
  isWhatsApp?: boolean;
  onOpen: () => void;
  active?: boolean;
  /** Какие KPI показывать на карточке: meta-метрики или сквозные CRM. */
  metricsView?: "meta" | "crm";
}

export function CreativeCard({ row, isWhatsApp, onOpen, active, metricsView = "crm" }: Props) {
  const isCarousel = row.creativeType === "carousel";
  const {
    isVideo,
    displaySrc,
    previewVideoUrl,
    loadingHq,
    canPlayInline,
    forceRefresh,
  } = useCreativeHqPreview({
    adId: row.adId,
    name: row.name,
    creativeType: row.creativeType,
    thumbnailUrl: row.thumbnailUrl,
    imageUrl: row.imageUrl,
    posterUrl: row.posterUrl,
    videoUrl: row.videoUrl,
    effectiveStatus: row.effectiveStatus,
  });

  const [playVideo, setPlayVideo] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (playVideo && canPlayInline) void el.play().catch(() => {});
    else el.pause();
  }, [playVideo, canPlayInline]);

  const isActive = (row.effectiveStatus ?? "").toUpperCase() === "ACTIVE";
  const showVideo = canPlayInline && playVideo;

  const showCrm = metricsView === "crm";
  const metaLeadCount = isWhatsApp ? (row.messages || row.leads) : row.leads;
  const leadValue = row.crmLeads > 0 ? row.crmLeads : metaLeadCount;
  const leadLabel = "Лиды";
  const hasCrmRevenue = row.crmRevenue > 0;
  const romiPositive = hasCrmRevenue && row.crmRomi >= 0;
  const romiClass =
    row.spend === 0 || !hasCrmRevenue
      ? "text-muted-foreground"
      : row.crmRomi >= 100
        ? "text-success"
        : row.crmRomi >= 0
          ? "text-foreground"
          : "text-destructive";

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group flex flex-col overflow-hidden rounded-2xl border bg-card/60 text-left transition hover:border-primary/40 hover:shadow-lg",
        active ? "border-primary/60 ring-1 ring-primary/40" : "border-border/60",
      )}
    >
      <div
        className="relative aspect-[9/16] w-full overflow-hidden bg-background"
        onMouseEnter={() => setPlayVideo(true)}
        onMouseLeave={() => setPlayVideo(false)}
      >
        {showVideo ? (
          <video
            ref={videoRef}
            src={previewVideoUrl!}
            poster={displaySrc ?? undefined}
            muted
            playsInline
            loop
            preload="metadata"
            className="h-full w-full bg-background object-cover transition group-hover:scale-[1.01]"
            onError={() => {
              void forceRefresh();
            }}
          />
        ) : displaySrc ? (
          <img
            src={displaySrc}
            alt={row.name}
            className={cn(
              "h-full w-full transition group-hover:scale-[1.01]",
              isVideo ? "object-cover" : "object-contain",
            )}
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-secondary/20">
            {loadingHq && isVideo ? (
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/50" />
            ) : (
              <ImageIcon className="h-8 w-8 text-muted-foreground/40" />
            )}
          </div>
        )}

        <span
          className={cn(
            "absolute left-2 top-2 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase backdrop-blur",
            isActive ? "bg-success/85 text-success-foreground" : "bg-muted/85 text-muted-foreground",
          )}
        >
          {isActive ? "Активно" : (row.effectiveStatus ?? "—").toLowerCase()}
        </span>

        {showCrm && row.spend > 0 && hasCrmRevenue && (
          <span
            className={cn(
              "absolute right-2 top-2 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-bold backdrop-blur",
              row.crmRomi >= 100
                ? "bg-success/90 text-success-foreground"
                : row.crmRomi >= 0
                  ? "bg-background/85 text-foreground"
                  : "bg-destructive/85 text-destructive-foreground",
            )}
            title="ROMI = (Выручка − Расход) / Расход"
          >
            {romiPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            ROMI {row.crmRomi >= 0 ? "+" : ""}
            {Math.round(row.crmRomi)}%
          </span>
        )}

        {isWhatsApp && !showCrm && (
          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-success/85 px-1.5 py-0.5 text-[10px] font-bold text-success-foreground backdrop-blur">
            <MessageCircle className="h-3 w-3" /> WhatsApp
          </span>
        )}

        <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-md bg-background/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider backdrop-blur">
          {isVideo ? <Video className="h-3 w-3" /> : isCarousel ? <Layers className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}
          {row.creativeType}
        </span>

        {isWhatsApp && showCrm && (
          <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-md bg-success/85 px-1.5 py-0.5 text-[10px] font-bold text-success-foreground backdrop-blur">
            <MessageCircle className="h-3 w-3" /> WA
          </span>
        )}

        {isVideo && (
          <span className="absolute right-2 bottom-2 grid h-7 w-7 place-items-center rounded-full bg-background/85 backdrop-blur transition group-hover:scale-110 group-hover:bg-primary group-hover:text-primary-foreground">
            <Play className="h-3 w-3 fill-current" />
          </span>
        )}
      </div>

      <div className="flex-1 space-y-2 p-3">
        <div className="space-y-0.5">
          {row.headline ? (
            <>
              <div className="line-clamp-2 min-h-[2.4rem] text-xs font-bold leading-snug" title={row.headline}>
                {row.headline}
              </div>
              <div className="truncate text-[10px] text-muted-foreground" title={row.name}>
                {row.name || "—"}
              </div>
            </>
          ) : (
            <div className="line-clamp-2 min-h-[2.4rem] text-xs font-semibold leading-snug" title={row.name}>
              {row.name || "Без названия"}
            </div>
          )}
        </div>

        {showCrm ? (
          <div className="grid grid-cols-2 gap-1.5 text-[11px]">
            <div className="rounded-md bg-secondary/30 px-2 py-1">
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{leadLabel}</div>
              <div className="font-bold tabular-nums">{fmtNum(leadValue)}</div>
            </div>
            <div className="rounded-md bg-secondary/30 px-2 py-1">
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Продаж</div>
              <div className="font-bold tabular-nums text-success">{fmtNum(row.crmSales)}</div>
            </div>
            <div className="rounded-md bg-secondary/30 px-2 py-1">
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Расход</div>
              <div className="font-bold tabular-nums">{row.spend > 0 ? fmtTenge(row.spend) : "—"}</div>
            </div>
            <div className="rounded-md bg-secondary/30 px-2 py-1">
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Выручка</div>
              <div className={cn("font-bold tabular-nums", romiClass)}>
                {hasCrmRevenue ? fmtTenge(row.crmRevenue) : "нет продаж"}
              </div>
            </div>
          </div>
        ) : (
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
              <div className="font-bold tabular-nums">
                {fmtNum(isWhatsApp ? row.messages : row.leads)}
              </div>
            </div>
          </div>
        )}
      </div>
    </button>
  );
}
