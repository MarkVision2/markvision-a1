import { MessageCircle, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { pickCreativeTitle } from "@/lib/creativeDisplay";
import { CreativePreview } from "@/components/creatives/CreativePreview";
import type { MetaCreativeRow } from "@/hooks/useMetaStructure";

const fmtTenge = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;
const fmtNum = (n: number) => Math.round(n).toLocaleString("ru-RU");

interface Props {
  row: MetaCreativeRow;
  isWhatsApp?: boolean;
  onOpen: () => void;
  active?: boolean;
  layout?: "grid" | "list";
  metricsView?: "meta" | "crm";
}

function MetricPill({ label, value, tone }: { label: string; value: string; tone?: "success" | "muted" | "default" }) {
  return (
    <div className="min-w-0 rounded-lg bg-secondary/25 px-2 py-1.5 sm:bg-transparent sm:p-0">
      <div className="text-[11px] text-muted-foreground sm:text-[10px]">{label}</div>
      <div
        className={cn(
          "truncate text-base font-bold tabular-nums sm:text-sm",
          tone === "success" && "text-success",
          tone === "muted" && "text-muted-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}

export function CreativeCard({
  row,
  isWhatsApp,
  onOpen,
  active,
  layout = "grid",
  metricsView = "crm",
}: Props) {
  const { title, subtitle, tags } = pickCreativeTitle({ name: row.name, headline: row.headline });
  const showCrm = metricsView === "crm";
  const metaLeadCount = isWhatsApp ? (row.messages || row.leads) : row.leads;
  const leadValue = row.crmLeads > 0 ? row.crmLeads : metaLeadCount;
  const hasCrmRevenue = row.crmRevenue > 0;
  const romiPositive = hasCrmRevenue && row.crmRomi >= 0;

  const previewGrid = (
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
      playable
      className="mx-auto aspect-[9/16] w-full max-h-[min(52vh,440px)] max-w-[min(100%,300px)] rounded-lg sm:max-h-none sm:max-w-none sm:rounded-none"
    />
  );

  const previewList = (
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
      playable
      className="mx-auto aspect-[9/16] w-full max-w-[220px] rounded-lg sm:h-[168px] sm:w-[94px] sm:max-w-none sm:shrink-0 sm:rounded-lg"
    />
  );

  const metrics = showCrm ? (
    <>
      <MetricPill label="Заявки" value={fmtNum(leadValue)} />
      <MetricPill label="Расход" value={row.spend > 0 ? fmtTenge(row.spend) : "—"} />
      <MetricPill
        label="Выручка"
        value={hasCrmRevenue ? fmtTenge(row.crmRevenue) : "—"}
        tone={hasCrmRevenue ? "success" : "muted"}
      />
      <MetricPill label="CTR" value={row.ctr > 0 ? `${row.ctr.toFixed(2)}%` : "—"} />
    </>
  ) : (
    <>
      <MetricPill label="CTR" value={row.ctr > 0 ? `${row.ctr.toFixed(2)}%` : "—"} />
      <MetricPill label="CPL" value={row.cpl > 0 ? fmtTenge(row.cpl) : "—"} tone="success" />
      <MetricPill label="Расход" value={row.spend > 0 ? fmtTenge(row.spend) : "—"} />
      <MetricPill label={isWhatsApp ? "Сообщ." : "Заявки"} value={fmtNum(isWhatsApp ? row.messages : row.leads)} />
    </>
  );

  const metaBlock = (
    <div className="min-w-0 flex-1">
      <div className="line-clamp-3 text-base font-semibold leading-snug sm:line-clamp-2 sm:text-sm" title={title}>
        {title}
      </div>
      {subtitle && (
        <div className="mt-1 line-clamp-2 text-sm text-muted-foreground sm:line-clamp-1 sm:text-xs" title={subtitle}>
          {subtitle}
        </div>
      )}
      {(tags.length > 0 || isWhatsApp) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {isWhatsApp && (
            <span className="inline-flex items-center gap-1 rounded-md bg-success/15 px-2 py-0.5 text-[11px] font-semibold text-success">
              <MessageCircle className="h-3 w-3" /> WhatsApp
            </span>
          )}
          {tags.slice(0, 4).map((tag) => (
            <span
              key={tag}
              className="rounded-md border border-border/50 bg-secondary/30 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
      {showCrm && row.spend > 0 && hasCrmRevenue && (
        <div
          className={cn(
            "mt-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-bold tabular-nums sm:text-[10px]",
            romiPositive ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive",
          )}
        >
          {romiPositive ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
          ROMI {row.crmRomi >= 0 ? "+" : ""}{Math.round(row.crmRomi)}%
        </div>
      )}
    </div>
  );

  const cardBase = cn(
    "group w-full touch-manipulation rounded-2xl border bg-card/50 text-left transition active:scale-[0.99]",
    active ? "border-primary/60 ring-1 ring-primary/30" : "border-border/50",
  );

  if (layout === "list") {
    return (
      <button
        type="button"
        onClick={onOpen}
        className={cn(cardBase, "flex flex-col gap-3 p-3 sm:flex-row sm:items-stretch sm:gap-4 sm:hover:border-primary/40 sm:hover:bg-card/80")}
      >
        <div className="flex shrink-0 justify-center sm:block">{previewList}</div>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {metaBlock}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-x-4">{metrics}</div>
        </div>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(cardBase, "flex flex-col overflow-hidden sm:hover:border-primary/40 sm:hover:shadow-md")}
    >
      <div className="bg-zinc-950 px-2 pt-2 sm:px-0 sm:pt-0">{previewGrid}</div>
      <div className="flex flex-1 flex-col gap-3 p-3 sm:p-3">
        {metaBlock}
        <div className="mt-auto grid grid-cols-2 gap-2 border-t border-border/40 pt-3">{metrics}</div>
      </div>
    </button>
  );
}
