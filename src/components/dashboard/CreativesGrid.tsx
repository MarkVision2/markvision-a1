import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Eye, Image as ImageIcon, Layers, MousePointerClick, Play, TrendingDown, TrendingUp, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import { bestCreativeImage } from "@/lib/metaThumb";
import { enqueuePosterCapture } from "@/lib/videoPosterCapture";
import { supabase } from "@/integrations/supabase/client";
import type { MetaCreativeRow } from "@/hooks/useMetaStructure";

const fmtNum = (n: number) => Math.round(n).toLocaleString("ru-RU");
const fmtTenge = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;
const requestedDashboardPosters = new Set<string>();

type SortKey = "crmRevenue" | "crmRomi" | "spend" | "ctr" | "cpl" | "leads" | "romi";

const SORT_LABELS: Record<SortKey, string> = {
  crmRevenue: "по выручке CRM",
  crmRomi: "по окупаемости CRM",
  spend: "по расходу",
  ctr: "по CTR",
  cpl: "по CPL",
  leads: "по заявкам Meta",
  romi: "по ROMI Meta",
};

interface Props {
  rows: MetaCreativeRow[];
  initialLimit?: number;
  /** Топ-N режим для дашборда: фиксированный лимит, ссылка «все креативы». */
  topMode?: boolean;
  viewAllHref?: string;
}

function CreativePreview({ row }: { row: MetaCreativeRow }) {
  const isVideo = row.creativeType === "video";
  const isCarousel = row.creativeType === "carousel";
  const [capturedPoster, setCapturedPoster] = useState<string | null>(null);
  const [refreshedThumb, setRefreshedThumb] = useState<string | null>(null);
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(row.videoUrl);
  const src = bestCreativeImage({
    posterUrl: capturedPoster ?? row.posterUrl,
    thumbnailUrl: refreshedThumb ?? row.thumbnailUrl,
    imageUrl: row.imageUrl,
    size: 960,
  });

  const refreshVideoPreview = async () => {
    if (!row.adId) return;
    const { data } = await supabase.functions.invoke<{ ok: boolean; video_url?: string; thumbnail_url?: string }>(
      "meta-creative-refresh",
      { body: { ad_id: row.adId } },
    );
    if (data?.thumbnail_url) setRefreshedThumb(data.thumbnail_url);
    if (data?.ok && data.video_url) setPreviewVideoUrl(data.video_url);
  };

  useEffect(() => {
    setPreviewVideoUrl(row.videoUrl);
    setRefreshedThumb(null);
    setCapturedPoster(null);
  }, [row.id, row.videoUrl]);

  useEffect(() => {
    if (!isVideo || !row.adId || row.posterUrl || capturedPoster) return;
    if (requestedDashboardPosters.has(row.adId)) return;
    requestedDashboardPosters.add(row.adId);

    let cancelled = false;
    void (async () => {
      let videoUrl = row.videoUrl;
      if (!videoUrl) {
        const { data } = await supabase.functions.invoke<{ ok: boolean; video_url?: string; thumbnail_url?: string }>(
          "meta-creative-refresh",
          { body: { ad_id: row.adId } },
        );
        if (!cancelled && data?.thumbnail_url) setRefreshedThumb(data.thumbnail_url);
        videoUrl = data?.ok ? data.video_url ?? null : null;
      }
      if (!cancelled && videoUrl) setPreviewVideoUrl(videoUrl);
      if (!videoUrl || cancelled) return;
      const poster = await enqueuePosterCapture(row.adId, videoUrl);
      if (poster && !cancelled) setCapturedPoster(poster);
    })().catch(() => {
      requestedDashboardPosters.delete(row.adId);
    });

    return () => {
      cancelled = true;
    };
  }, [capturedPoster, isVideo, row.adId, row.posterUrl, row.videoUrl]);

  return (
    <div className="relative aspect-[4/5] w-full overflow-hidden rounded-xl bg-background">
      {isVideo && previewVideoUrl ? (
        <video
          src={previewVideoUrl}
          poster={src ?? undefined}
          muted
          playsInline
          autoPlay
          loop
          preload="metadata"
          className="h-full w-full bg-background object-cover transition duration-300 group-hover:scale-[1.01]"
          onError={() => {
            setPreviewVideoUrl(null);
            void refreshVideoPreview();
          }}
        />
      ) : src ? (
        <img
          src={src}
          alt={row.name}
          className={cn(
            "h-full w-full transition duration-300 group-hover:scale-[1.01]",
            isVideo ? "object-cover" : "object-cover",
          )}
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <ImageIcon className="h-8 w-8 text-muted-foreground/40" />
        </div>
      )}
      <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-background/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider backdrop-blur">
        {isVideo ? <Video className="h-3 w-3" /> : isCarousel ? <Layers className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}
        {row.creativeType}
      </span>
      {isVideo && (
        <span className="absolute inset-0 grid place-items-center">
          <span className="grid h-10 w-10 place-items-center rounded-full border border-border/40 bg-background/45 backdrop-blur-sm transition group-hover:scale-105 group-hover:bg-background/65">
            <Play className="h-4 w-4 text-foreground" />
          </span>
        </span>
      )}
      {row.effectiveStatus && row.effectiveStatus !== "ACTIVE" && (
        <span className="absolute right-2 top-2 rounded-md bg-warning/80 px-1.5 py-0.5 text-[10px] font-bold uppercase text-warning-foreground">
          {row.effectiveStatus}
        </span>
      )}
    </div>
  );
}

const sortValue = (r: MetaCreativeRow, key: SortKey): number => {
  if (key === "cpl") return r.cpl > 0 ? -r.cpl : Number.NEGATIVE_INFINITY;
  return (r as any)[key] ?? 0;
};

export function CreativesGrid({
  rows,
  initialLimit = 8,
  topMode = false,
  viewAllHref = "/ads?tab=creatives",
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>(topMode ? "crmRevenue" : "spend");
  const [showAll, setShowAll] = useState(false);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => sortValue(b, sortKey) - sortValue(a, sortKey));
    return copy;
  }, [rows, sortKey]);

  const limit = topMode ? 6 : initialLimit;
  const visible = topMode || !showAll ? sorted.slice(0, limit) : sorted;

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card/60 p-6 text-center text-sm text-muted-foreground">
        <ImageIcon className="mx-auto mb-2 h-5 w-5" />
        Креативы появятся здесь после первого запуска <code className="rounded bg-secondary px-1 text-[11px]">meta-structure-sync</code> по подключённому кабинету Meta.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">
          {topMode ? (
            <>Топ-{Math.min(limit, sorted.length)} креативов <span className="text-foreground/70">по выручке CRM</span> · всего {rows.length}</>
          ) : (
            <>Всего креативов: <span className="font-semibold text-foreground">{rows.length}</span></>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs">
          {!topMode && (
            <>
              <span className="text-muted-foreground">Сортировка:</span>
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                className="rounded-md border border-border/60 bg-background px-2 py-1 text-xs font-medium"
              >
                {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                  <option key={k} value={k}>{SORT_LABELS[k]}</option>
                ))}
              </select>
            </>
          )}
          {topMode && (
            <Link
              to={viewAllHref}
              className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background px-2.5 py-1 text-xs font-semibold hover:bg-secondary/50"
            >
              Все креативы <ArrowRight className="h-3 w-3" />
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-6">
        {visible.map((row) => {
          const hasCrmRevenue = (row.crmRevenue ?? 0) > 0;
          const leadValue = (row.crmLeads ?? 0) > 0 ? row.crmLeads : row.leads;
          const leadLabel = (row.crmLeads ?? 0) > 0 ? "Лиды CRM" : "Лиды Meta";
          const romiVal = hasCrmRevenue ? row.crmRomi : 0;
          const romiPositive = romiVal >= 0;
          const RomiIcon = romiPositive ? TrendingUp : TrendingDown;
          const cardInner = (
            <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/60 transition hover:border-primary/40 hover:bg-card">
              <CreativePreview row={row} />
              <div className="p-3">
                <div className="line-clamp-2 min-h-[2.5rem] text-xs font-semibold leading-snug" title={row.name}>
                  {row.name || "Без названия"}
                </div>
                {row.headline && (
                  <div className="mt-1 line-clamp-1 text-[11px] text-muted-foreground" title={row.headline}>
                    {row.headline}
                  </div>
                )}
                <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <div className="text-muted-foreground">Расход</div>
                    <div className="font-bold tabular-nums">{row.spend > 0 ? fmtTenge(row.spend) : "—"}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Выручка CRM</div>
                    <div className="font-bold tabular-nums">{hasCrmRevenue ? fmtTenge(row.crmRevenue) : "нет продаж"}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">{leadLabel}</div>
                    <div className="font-bold tabular-nums">{fmtNum(leadValue)}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Продажи</div>
                    <div className="font-bold tabular-nums">{fmtNum(row.crmSales ?? 0)}</div>
                  </div>
                </div>
                {row.spend > 0 && hasCrmRevenue && (
                  <div className={cn(
                    "mt-2 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
                    romiPositive ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive",
                  )}>
                    <RomiIcon className="h-3 w-3" />
                    ROMI CRM {romiPositive ? "+" : ""}{Math.round(romiVal)}%
                  </div>
                )}
                <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><Eye className="h-3 w-3" />{fmtNum(row.impressions)}</span>
                  <span className="inline-flex items-center gap-1"><MousePointerClick className="h-3 w-3" />{fmtNum(row.clicks)}</span>
                  {row.ctr > 0 && <span className="tabular-nums">CTR {row.ctr.toFixed(2)}%</span>}
                </div>
              </div>
            </div>
          );
          return topMode ? (
            <Link key={row.id} to={`${viewAllHref}&ad=${row.adId}`} className="block">{cardInner}</Link>
          ) : (
            <div key={row.id}>{cardInner}</div>
          );
        })}
      </div>

      {!topMode && sorted.length > limit && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="rounded-md border border-border/60 bg-background px-3 py-1.5 text-xs font-semibold hover:bg-secondary/50"
          >
            {showAll ? "Свернуть" : `Показать все (${sorted.length})`}
          </button>
        </div>
      )}
    </div>
  );
}
