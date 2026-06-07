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
    <div className="min-w-0">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div
        className={cn(
          "truncate text-sm font-bold tabular-nums",
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

  const preview = (
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
      className={layout === "list" ? "h-[168px] w-[94px] shrink-0 rounded-lg" : "aspect-[9/16] w-full rounded-none"}
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
      <div className="line-clamp-2 text-sm font-semibold leading-snug" title={title}>
        {title}
      </div>
      {subtitle && (
        <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground" title={subtitle}>
          {subtitle}
        </div>
      )}
      {(tags.length > 0 || isWhatsApp) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {isWhatsApp && (
            <span className="inline-flex items-center gap-1 rounded-md bg-success/15 px-1.5 py-0.5 text-[10px] font-semibold text-success">
              <MessageCircle className="h-3 w-3" /> WA
            </span>
          )}
          {tags.map((tag) => (
            <span
              key={tag}
              className="rounded-md border border-border/50 bg-secondary/30 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
      {showCrm && row.spend > 0 && hasCrmRevenue && (
        <div
          className={cn(
            "mt-2 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
            romiPositive ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive",
          )}
        >
          {romiPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          ROMI {row.crmRomi >= 0 ? "+" : ""}{Math.round(row.crmRomi)}%
        </div>
      )}
    </div>
  );

  if (layout === "list") {
    return (
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "group flex w-full gap-4 rounded-2xl border bg-card/50 p-3 text-left transition hover:border-primary/40 hover:bg-card/80",
          active ? "border-primary/60 ring-1 ring-primary/30" : "border-border/50",
        )}
      >
        {preview}
        <div className="flex min-w-0 flex-1 flex-col justify-between gap-3 sm:flex-row sm:items-center">
          {metaBlock}
          <div className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">{metrics}</div>
        </div>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group flex h-full flex-col overflow-hidden rounded-2xl border bg-card/50 text-left transition hover:border-primary/40 hover:shadow-md",
        active ? "border-primary/60 ring-1 ring-primary/30" : "border-border/50",
      )}
    >
      {preview}
      <div className="flex flex-1 flex-col gap-3 p-3">
        {metaBlock}
        <div className="mt-auto grid grid-cols-2 gap-2 border-t border-border/40 pt-3">{metrics}</div>
      </div>
    </button>
  );
}
