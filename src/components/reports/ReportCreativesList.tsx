import {
  Eye, MousePointerClick, TrendingDown, TrendingUp, Wallet,
} from "lucide-react";
import { CreativePreview } from "@/components/creatives/CreativePreview";
import type { ReportCreative } from "@/hooks/useReportData";
import {
  buildReportCreativeSections,
  creativeCpl,
  creativeRomi,
  parseCreativeDisplayName,
} from "@/lib/reportCreatives";
import { cn } from "@/lib/utils";
import { reportFmt } from "./reportFormat";

interface Props {
  creatives: ReportCreative[];
}

interface CardProps {
  creative: ReportCreative;
  rank: number;
  variant: "revenue" | "active";
}

function MetricCell({
  label, value, emphasize, tone = "default",
}: {
  label: string;
  value: string;
  emphasize?: boolean;
  tone?: "default" | "success" | "muted" | "destructive";
}) {
  return (
    <div className="min-w-0">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "mt-0.5 truncate text-sm font-bold tabular-nums",
          emphasize && "text-base",
          tone === "success" && "text-success",
          tone === "destructive" && "text-destructive",
          tone === "muted" && "text-muted-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function CreativeCard({ creative, rank, variant }: CardProps) {
  const parsed = parseCreativeDisplayName(creative.name);
  const cpl = creativeCpl(creative);
  const romi = creativeRomi(creative);
  const hasRevenue = creative.crmRevenue > 0;
  const romiPositive = (romi ?? 0) >= 0;
  const RomiIcon = romiPositive ? TrendingUp : TrendingDown;
  const crmOnly = hasRevenue && creative.spend <= 0;

  return (
    <article
      className={cn(
        "overflow-hidden rounded-2xl border bg-card/40 transition-colors",
        variant === "revenue"
          ? "border-success/35 bg-success/[0.04]"
          : "border-border/45",
      )}
    >
      <div className="flex gap-4 p-4">
        <div className="flex shrink-0 flex-col items-center gap-2">
          <span
            className={cn(
              "grid h-8 w-8 place-items-center rounded-xl text-xs font-bold tabular-nums",
              rank === 1 && variant === "revenue"
                ? "bg-success/20 text-success"
                : "bg-secondary/60 text-muted-foreground",
            )}
          >
            {rank}
          </span>
          <CreativePreview
            row={{
              adId: creative.adId,
              name: creative.name,
              creativeType: creative.creativeType,
              thumbnailUrl: creative.thumbnailUrl,
              imageUrl: creative.imageUrl,
              posterUrl: creative.posterUrl,
              videoUrl: creative.videoUrl,
            }}
            compact
            className="h-20 w-16 rounded-lg"
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h3 className="line-clamp-2 text-sm font-semibold leading-snug" title={parsed.full}>
                {parsed.title}
              </h3>
              {parsed.tags.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {parsed.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-md border border-border/50 bg-secondary/30 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {hasRevenue && (
              <div className="shrink-0 rounded-xl border border-success/30 bg-success/10 px-3 py-2 text-right">
                <div className="text-[9px] font-semibold uppercase tracking-wider text-success/80">
                  Выручка CRM
                </div>
                <div className="text-lg font-bold tabular-nums text-success">
                  {reportFmt.fmtTenge(creative.crmRevenue)}
                </div>
              </div>
            )}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricCell
              label="Расход"
              value={creative.spend > 0 ? reportFmt.fmtTenge(creative.spend) : "—"}
              tone={crmOnly ? "muted" : "default"}
            />
            <MetricCell
              label="Заявки"
              value={reportFmt.fmtNum(creative.leads)}
            />
            <MetricCell
              label="Стоимость заявки"
              value={cpl !== null ? reportFmt.fmtTenge(cpl) : "—"}
              tone="muted"
            />
            <MetricCell
              label="CTR"
              value={creative.ctr > 0 ? reportFmt.fmtPct(creative.ctr) : "—"}
              tone={creative.ctr > 0 ? "success" : "muted"}
            />
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Eye className="h-3 w-3" />
              {reportFmt.fmtNum(creative.impressions)}
            </span>
            <span className="inline-flex items-center gap-1 tabular-nums">
              <MousePointerClick className="h-3 w-3" />
              {reportFmt.fmtNum(creative.clicks)}
            </span>
            {creative.crmSales > 0 && (
              <span className="font-semibold text-foreground/80">
                Продажи: {reportFmt.fmtNum(creative.crmSales)}
              </span>
            )}
            {romi !== null && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-bold tabular-nums",
                  romiPositive ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive",
                )}
              >
                <RomiIcon className="h-3 w-3" />
                ROMI {romiPositive ? "+" : ""}{Math.round(romi)}%
              </span>
            )}
            {crmOnly && (
              <span className="rounded-md border border-border/50 bg-secondary/30 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide">
                Выручка без расхода в периоде
              </span>
            )}
            {!hasRevenue && creative.spend > 0 && (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <Wallet className="h-3 w-3" />
                Нет выручки CRM
              </span>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function SectionBlock({
  title,
  subtitle,
  items,
  variant,
  emptyHint,
}: {
  title: string;
  subtitle: string;
  items: ReportCreative[];
  variant: "revenue" | "active";
  emptyHint?: string;
}) {
  if (items.length === 0) {
    if (!emptyHint) return null;
    return (
      <div className="rounded-2xl border border-dashed border-border/50 bg-secondary/10 px-5 py-8 text-center text-sm text-muted-foreground">
        {emptyHint}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold">{title}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <span className="rounded-full border border-border/50 bg-secondary/30 px-2.5 py-1 text-[10px] font-semibold tabular-nums text-muted-foreground">
          {items.length} креатив{items.length === 1 ? "" : items.length < 5 ? "а" : "ов"}
        </span>
      </div>
      <div className="space-y-3">
        {items.map((c, i) => (
          <CreativeCard key={c.adId} creative={c} rank={i + 1} variant={variant} />
        ))}
      </div>
    </div>
  );
}

export function ReportCreativesList({ creatives }: Props) {
  const sections = buildReportCreativeSections(creatives, 5);

  if (creatives.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border/50 bg-secondary/10 p-10 text-center text-sm italic text-muted-foreground">
        Креативы появятся после синхронизации Meta (
        <code className="rounded bg-secondary px-1 text-[11px] not-italic">meta-structure-sync</code>
        )
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/40 bg-secondary/15 px-4 py-3 text-xs text-muted-foreground">
        <span>
          Всего активных: <span className="font-bold text-foreground">{creatives.length}</span>
        </span>
        <span className="text-border">·</span>
        <span>
          С выручкой CRM:{" "}
          <span className="font-bold text-success">{sections.totalWithRevenue}</span>
        </span>
        <span className="text-border">·</span>
        <span>
          Без выручки: <span className="font-bold text-foreground">{sections.totalActive}</span>
        </span>
      </div>

      <SectionBlock
        title="Приносят выручку"
        subtitle="Креативы с подтверждённой выручкой CRM за период"
        items={sections.withRevenue}
        variant="revenue"
        emptyHint="За выбранный период ни один креатив не принёс выручку CRM. Ниже — самые активные по расходу и заявкам."
      />

      <SectionBlock
        title="Активные без выручки"
        subtitle="Топ по расходу и заявкам — кандидаты на оптимизацию"
        items={sections.topActive}
        variant="active"
        emptyHint={sections.withRevenue.length > 0
          ? undefined
          : "Нет креативов с расходом или заявками за период"}
      />
    </div>
  );
}
