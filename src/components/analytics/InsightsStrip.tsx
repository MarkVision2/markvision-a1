import { Link } from "react-router-dom";
import { ArrowRight, Crown, Film, Lightbulb, Radio, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AnalyticsInsight } from "@/lib/analyticsBreakdowns";

const KIND_ICON: Record<AnalyticsInsight["kind"], LucideIcon> = {
  channel: Radio,
  source: Crown,
  creative: Film,
  growth: Lightbulb,
};

export function InsightsStrip({ insights }: { insights: AnalyticsInsight[] }) {
  if (insights.length === 0) return null;

  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {insights.map((insight) => {
        const Icon = KIND_ICON[insight.kind];
        const inner = (
          <>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "grid h-8 w-8 shrink-0 place-items-center rounded-lg",
                  insight.tone === "success" && "bg-success/15 text-success",
                  insight.tone === "warning" && "bg-warning/15 text-warning",
                  insight.tone === "default" && "bg-primary/10 text-primary",
                )}
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {insight.title}
              </span>
              {insight.adId && <ArrowRight className="ml-auto h-3.5 w-3.5 text-muted-foreground" />}
            </div>
            <div className="mt-2 truncate text-sm font-bold" title={insight.value}>
              {insight.value}
            </div>
            <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{insight.detail}</div>
          </>
        );

        const className = cn(
          "rounded-2xl border px-3.5 py-3 text-left transition",
          insight.tone === "success" && "border-success/30 bg-success/5",
          insight.tone === "warning" && "border-warning/30 bg-warning/5",
          insight.tone === "default" && "border-border/60 bg-card/60",
          insight.adId && "hover:border-primary/50",
        );

        return insight.adId ? (
          <Link key={insight.kind} to={`/ads?tab=creatives&ad=${insight.adId}`} className={className}>
            {inner}
          </Link>
        ) : (
          <div key={insight.kind} className={className}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}
