import { Sparkles, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ReportData } from "@/hooks/useReportData";

interface Props {
  data: ReportData | null;
  rangeLabel: string;
}

export function AiSummary({ data, rangeLabel }: Props) {
  const [text, setText] = useState<string>("");
  const [loading, setLoading] = useState(false);

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
          },
        });
        if (cancelled) return;
        if (error) throw error;
        setText((resp as { text?: string })?.text ?? "");
      } catch {
        if (!cancelled) setText("");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [data, rangeLabel]);

  if (!data) return null;

  return (
    <div className="rounded-2xl border border-success/30 bg-success/5 p-4">
      <div className="flex items-center gap-2 text-success">
        <Sparkles className="h-4 w-4" />
        <span className="text-xs font-bold uppercase tracking-wider">AI Generated</span>
        {loading && <Loader2 className="ml-1 h-3 w-3 animate-spin" />}
      </div>
      <div className="mt-2 text-sm leading-relaxed text-foreground/90">
        {text || (loading ? "Анализирую данные..." : "Нет данных для анализа.")}
      </div>
    </div>
  );
}