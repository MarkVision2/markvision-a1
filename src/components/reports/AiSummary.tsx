import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ReportData } from "@/hooks/useReportData";
import { buildReportExecutive } from "@/lib/reportExecutive";
import { reportFmt } from "./reportFormat";

interface Props {
  data: ReportData | null;
  rangeLabel: string;
}

export function AiSummary({ data, rangeLabel }: Props) {
  const [text, setText] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const fallback = useMemo(() => {
    if (!data) return "";
    const executive = buildReportExecutive({ data, comparing: Boolean(data.prev) });
    const bottleneck = executive.bottleneck
      ? ` Узкое место — ${executive.bottleneck.label.toLowerCase()} с конверсией ${executive.bottleneck.conversion.toFixed(1)}%.`
      : "";
    const action = executive.actions[0]
      ? ` Приоритет: ${executive.actions[0].title.toLowerCase()}.`
      : "";
    return `${executive.status.description} Чистый результат — ${reportFmt.fmtTenge(executive.profit)}, ROMI ${Math.round(data.totals.romi)}%.${bottleneck}${action}`;
  }, [data]);

  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data: resp, error } = await supabase.functions.invoke("report-ai-chat", {
          body: {
            mode: "summary",
            rangeLabel,
            totals: data.totals,
            prev: data.prev ?? null,
            scoring: data.scoring,
            channels: data.channels.slice(0, 5),
            creatives: data.creatives.slice(0, 5).map((creative) => ({
              name: creative.name,
              spend: creative.spend,
              leads: creative.leads,
              crmSales: creative.crmSales,
              crmRevenue: creative.crmRevenue,
              crmRomi: creative.crmRomi,
            })),
            daily: data.monthlyMeta.slice(-31),
          },
        });
        if (cancelled) return;
        if (error) throw error;
        setText((resp as { text?: string })?.text ?? "");
      } catch {
        if (!cancelled) setText(fallback);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [data, fallback, rangeLabel, refreshKey]);

  if (!data) return null;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-success/30 bg-success/[0.05] p-5 sm:p-6">
      <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-success/10 blur-3xl" />
      <div className="relative flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-success">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-success/15">
            <Sparkles className="h-4 w-4" />
          </span>
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.14em]">AI-разбор периода</div>
            <div className="mt-0.5 text-[10px] font-medium text-muted-foreground">Вывод на основе Meta, CRM и оплат</div>
          </div>
          {loading && <Loader2 className="ml-1 h-3.5 w-3.5 animate-spin" />}
        </div>
        <button
          type="button"
          onClick={() => setRefreshKey((key) => key + 1)}
          disabled={loading}
          className="grid h-9 w-9 place-items-center rounded-xl border border-border/50 bg-card/30 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          aria-label="Обновить AI-разбор"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="relative mt-4 whitespace-pre-wrap text-sm leading-7 text-foreground/90">
        {text || (loading ? "Анализирую изменения, воронку и точки роста..." : fallback)}
      </div>
    </div>
  );
}