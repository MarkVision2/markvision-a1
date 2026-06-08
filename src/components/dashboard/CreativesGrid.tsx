import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Eye, Image as ImageIcon, MousePointerClick, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { pickCreativeTitle } from "@/lib/creativeDisplay";
import { CreativePreview } from "@/components/creatives/CreativePreview";
import type { MetaCreativeRow } from "@/hooks/useMetaStructure";

const fmtNum = (n: number) => Math.round(n).toLocaleString("ru-RU");
const fmtTenge = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;

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

const sortValue = (r: MetaCreativeRow, key: SortKey): number => {
  if (key === "cpl") return r.cpl > 0 ? -r.cpl : Number.NEGATIVE_INFINITY;
  return (r as Record<string, number>)[key] ?? 0;
};

const compareCreatives = (a: MetaCreativeRow, b: MetaCreativeRow, key: SortKey): number => {
  const primary = sortValue(b, key) - sortValue(a, key);
  if (primary !== 0) return primary;
  // При равной выручке — сначала креативы с продажами/диагностиками, потом по расходу.
  const crmDelta = (b.crmSales ?? 0) - (a.crmSales ?? 0);
  if (crmDelta !== 0) return crmDelta;
  return b.spend - a.spend;
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
    copy.sort((a, b) => compareCreatives(a, b, sortKey));
    return copy;
  }, [rows, sortKey]);

  const limit = topMode ? 6 : initialLimit;
  const visible = topMode || !showAll ? sorted.slice(0, limit) : sorted;
  const withRevenue = sorted.filter((r) => (r.crmRevenue ?? 0) > 0).length;

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
            <>
              Топ-{Math.min(limit, sorted.length)} креативов <span className="text-foreground/70">по выручке CRM</span>
              {withRevenue > 0 ? ` · с выручкой: ${withRevenue}` : " · выручка пока не привязана к креативам"}
              {" · "}всего {rows.length}
            </>
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {visible.map((row) => {
          const { title, subtitle } = pickCreativeTitle({ name: row.name, headline: row.headline });
          const hasCrmRevenue = (row.crmRevenue ?? 0) > 0;
          const leadValue = (row.crmLeads ?? 0) > 0 ? row.crmLeads : row.leads;
          const leadLabel = (row.crmLeads ?? 0) > 0 ? "Лиды CRM" : "Лиды Meta";
          const romiVal = hasCrmRevenue ? row.crmRomi : 0;
          const romiPositive = romiVal >= 0;
          const RomiIcon = romiPositive ? TrendingUp : TrendingDown;
          const cardInner = (
            <div className="group overflow-hidden rounded-2xl border border-border/60 bg-card/60 transition hover:border-primary/40 hover:bg-card">
              <CreativePreview
                row={{
                  adId: row.adId,
                  name: row.name,
                  creativeType: row.creativeType,
                  thumbnailUrl: row.thumbnailUrl,
                  imageUrl: row.imageUrl,
                  posterUrl: row.posterUrl,
                  videoUrl: row.videoUrl,
                  effectiveStatus: row.effectiveStatus,
                }}
                fit="contain"
                className="mx-auto aspect-[9/16] w-full max-h-[min(52vh,440px)] max-w-[min(100%,300px)] rounded-lg sm:max-h-none sm:max-w-none sm:rounded-none"
              />
              <div className="p-3">
                <div className="line-clamp-2 min-h-[2.5rem] text-xs font-semibold leading-snug" title={title}>
                  {title}
                </div>
                {subtitle && (
                  <div className="mt-1 line-clamp-1 text-[11px] text-muted-foreground" title={subtitle}>
                    {subtitle}
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
