import { useEffect, useState } from "react";
import { Image as ImageIcon, Layers, MessageCircle, Play, TrendingDown, TrendingUp, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import { bestCreativeImage } from "@/lib/metaThumb";
import { enqueuePosterCapture } from "@/lib/videoPosterCapture";
import { refreshMetaCreative } from "@/lib/metaCreativeRefresh";
import type { MetaCreativeRow } from "@/hooks/useMetaStructure";
import { useIsMobile } from "@/hooks/use-mobile";

// Глобальный набор уже запрошенных ad_id, чтобы не спамить рефреш постеров
const refreshedPosters = new Set<string>();

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
  const isMobile = useIsMobile();
  const isVideo = row.creativeType === "video";
  const isCarousel = row.creativeType === "carousel";

  // Локальный override постера, если мы только что захватили его из видео
  const [capturedPoster, setCapturedPoster] = useState<string | null>(null);
  const [refreshedThumb, setRefreshedThumb] = useState<string | null>(null);
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(row.videoUrl);
  const [mediaError, setMediaError] = useState(false);
  const src = bestCreativeImage({
    posterUrl: capturedPoster ?? row.posterUrl,
    thumbnailUrl: refreshedThumb ?? row.thumbnailUrl,
    imageUrl: row.imageUrl,
    size: 1080,
  });
  const isActive = (row.effectiveStatus ?? "").toUpperCase() === "ACTIVE";
  const showPoster = Boolean(src) && !mediaError;

  const refreshVideoPreview = async () => {
    if (!row.adId) return;
    const data = await refreshMetaCreative(row.adId);
    if (data?.thumbnail_url) setRefreshedThumb(data.thumbnail_url);
    if (data?.ok && data.video_url) setPreviewVideoUrl(data.video_url);
  };

  useEffect(() => {
    setPreviewVideoUrl(row.videoUrl);
    setRefreshedThumb(null);
    setCapturedPoster(null);
    setMediaError(false);
  }, [row.id, row.videoUrl]);

  useEffect(() => {
    setMediaError(false);
  }, [src]);

  const handleImageError = () => {
    setMediaError(true);
    if (!row.adId) return;
    void refreshMetaCreative(row.adId).then((data) => {
      if (data?.thumbnail_url) {
        setRefreshedThumb(data.thumbnail_url);
        setMediaError(false);
      }
    });
  };

  const playInlineVideo = isVideo && previewVideoUrl && !isMobile;

  // Для видео без HQ-постера: 1) гарантируем свежие video_url/thumbnail_url, 2) захватываем кадр
  const needsPoster = isVideo && !row.posterUrl;
  useEffect(() => {
    if (isMobile || !needsPoster || !row.adId) return;
    if (refreshedPosters.has(row.adId)) return;
    refreshedPosters.add(row.adId);

    let cancelled = false;
    void (async () => {
      let videoUrl = row.videoUrl;
      if (!videoUrl) {
        const data = await refreshMetaCreative(row.adId);
        if (!cancelled && data?.thumbnail_url) setRefreshedThumb(data.thumbnail_url);
        videoUrl = data?.ok ? data.video_url ?? null : null;
      }
      if (!cancelled && videoUrl) setPreviewVideoUrl(videoUrl);
      if (!videoUrl || cancelled) return;
      const poster = await enqueuePosterCapture(row.adId, videoUrl);
      if (poster && !cancelled) setCapturedPoster(poster);
    })().catch(() => { refreshedPosters.delete(row.adId); });

    return () => { cancelled = true; };
  }, [needsPoster, row.adId, row.videoUrl]);


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
      title={row.name || undefined}
      className={cn(
        "group flex flex-col overflow-hidden rounded-2xl border bg-card/60 text-left transition hover:border-primary/40 hover:shadow-lg",
        active ? "border-primary/60 ring-1 ring-primary/40" : "border-border/60",
      )}
    >
      {/* Poster 9:16 — без blur-слоёв: видео/кадр должны быть читаемыми */}
      <div className="relative aspect-[9/16] w-full overflow-hidden bg-background">
        {playInlineVideo ? (
          <video
            src={previewVideoUrl}
            poster={src ?? undefined}
            muted
            playsInline
            autoPlay
            loop
            preload="metadata"
            className="h-full w-full bg-background object-cover transition group-hover:scale-[1.01]"
            onError={() => {
              setPreviewVideoUrl(null);
              void refreshVideoPreview();
            }}
          />
        ) : showPoster ? (
          <img
            src={src!}
            alt=""
            className={cn(
              "h-full w-full transition group-hover:scale-[1.01]",
              isVideo ? "object-cover" : "object-contain",
            )}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={handleImageError}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <ImageIcon className="h-8 w-8 text-muted-foreground/40" />
          </div>
        )}

        {/* Status chip */}
        <span
          className={cn(
            "absolute left-2 top-2 z-10 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase shadow-sm backdrop-blur",
            isActive ? "bg-success/85 text-success-foreground" : "bg-muted/85 text-muted-foreground",
          )}
        >
          {isActive ? "Активно" : (row.effectiveStatus ?? "—").toLowerCase()}
        </span>

        {/* ROMI bubble */}
        {showCrm && row.spend > 0 && hasCrmRevenue && (
          <span
            className={cn(
              "absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-bold shadow-sm backdrop-blur",
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
          <span className="absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-md bg-success/85 px-1.5 py-0.5 text-[10px] font-bold text-success-foreground shadow-sm backdrop-blur">
            <MessageCircle className="h-3 w-3" /> WhatsApp
          </span>
        )}

        {/* Type icon */}
        <span className="absolute bottom-2 left-2 z-10 inline-flex items-center gap-1 rounded-md bg-background/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider shadow-sm backdrop-blur">
          {isVideo ? <Video className="h-3 w-3" /> : isCarousel ? <Layers className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}
          {row.creativeType}
        </span>

        {isWhatsApp && showCrm && (
          <span className="absolute bottom-2 right-2 z-10 inline-flex items-center gap-1 rounded-md bg-success/85 px-1.5 py-0.5 text-[10px] font-bold text-success-foreground shadow-sm backdrop-blur">
            <MessageCircle className="h-3 w-3" /> WA
          </span>
        )}

        {isVideo && (
          <span className="pointer-events-none absolute inset-0 z-[5] grid place-items-center bg-black/15">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-background/90 shadow-md backdrop-blur sm:h-7 sm:w-7">
              <Play className="h-5 w-5 fill-current sm:h-3 sm:w-3" />
            </span>
          </span>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 space-y-2 p-3">
        {/* Заголовок объявления (или название) */}
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
          // Сквозные CRM-метрики: лид → продажа → деньги
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
          // Чистые Meta-метрики
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
