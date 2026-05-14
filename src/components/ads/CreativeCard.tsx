import { useEffect } from "react";
import { Image as ImageIcon, Layers, MessageCircle, Play, TrendingDown, TrendingUp, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import { bestCreativeImage } from "@/lib/metaThumb";
import { supabase } from "@/integrations/supabase/client";
import type { MetaCreativeRow } from "@/hooks/useMetaStructure";

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
  const isVideo = row.creativeType === "video";
  const isCarousel = row.creativeType === "carousel";
  const src = bestCreativeImage({ thumbnailUrl: row.thumbnailUrl, imageUrl: row.imageUrl, size: 600 });
  const isActive = (row.effectiveStatus ?? "").toUpperCase() === "ACTIVE";

  // Авто-рефреш низкокачественного постера 64x64 для видео
  const looksLowRes = !!src && /p64x64/.test(src);
  useEffect(() => {
    if (!isVideo || !looksLowRes || !row.adId) return;
    if (refreshedPosters.has(row.adId)) return;
    refreshedPosters.add(row.adId);
    supabase.functions.invoke("meta-creative-refresh", { body: { ad_id: row.adId } }).catch(() => {
      refreshedPosters.delete(row.adId);
    });
  }, [isVideo, looksLowRes, row.adId]);

  const showCrm = metricsView === "crm";
  const metaLeadCount = isWhatsApp ? (row.messages || row.leads) : row.leads;
  const leadValue = row.crmLeads > 0 ? row.crmLeads : metaLeadCount;
  const leadLabel = row.crmLeads > 0 ? "Лиды CRM" : "Лиды Meta";
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
      {/* Poster 9:16 — full creative visible (no crop) */}
      <div className="relative aspect-[9/16] w-full overflow-hidden bg-black">
        {src ? (
          <>
            {/* blurred backdrop fills empty space */}
            <img
              src={src}
              alt=""
              aria-hidden
              className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-2xl"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
            <img
              src={src}
              alt={row.name}
              className="relative h-full w-full object-contain transition group-hover:scale-[1.02]"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          </>
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

        {/* ROMI bubble */}
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

        {/* Type icon */}
        <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-md bg-background/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider backdrop-blur">
          {isVideo ? <Video className="h-3 w-3" /> : isCarousel ? <Layers className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}
          {row.creativeType}
        </span>

        {isWhatsApp && showCrm && (
          <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-md bg-success/85 px-1.5 py-0.5 text-[10px] font-bold text-success-foreground backdrop-blur">
            <MessageCircle className="h-3 w-3" /> WA
          </span>
        )}

        {/* Compact play indicator (corner, не перекрывает контент) */}
        {isVideo && (
          <span className="absolute right-2 bottom-2 grid h-7 w-7 place-items-center rounded-full bg-background/85 backdrop-blur transition group-hover:scale-110 group-hover:bg-primary group-hover:text-primary-foreground">
            <Play className="h-3 w-3 fill-current" />
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
