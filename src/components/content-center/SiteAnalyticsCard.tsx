import { useEffect, useState } from "react";
import { Globe2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fmtNum } from "@/lib/format";

interface SiteRow {
  site: string;
  visitors: number;
  leads: number;
  cr_visit_lead_pct: number;
}

export function SiteAnalyticsCard({ projectId }: { projectId: string | null }) {
  const [rows, setRows] = useState<SiteRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectId) {
      setRows([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.rpc as any)("get_site_analytics", { p_project_id: projectId })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then(({ data, error }: { data: any; error: any }) => {
        if (cancelled) return;
        if (error) {
          console.error("get_site_analytics error", error);
          setRows([]);
        } else {
          setRows(Array.isArray(data) ? (data as SiteRow[]) : []);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
      <div className="flex items-center gap-2">
        <Globe2 className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Аналитика сайтов</h2>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Трафик и конверсия по лендингам, куда мы рандомно (A/B) отправляем людей по кодовому слову.
      </p>

      <div className="mt-3">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">Пока нет данных</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr className="border-b border-border/60">
                  <th className="px-3 py-2 text-left font-medium">Сайт</th>
                  <th className="px-3 py-2 text-right font-medium">Посетители</th>
                  <th className="px-3 py-2 text-right font-medium">Лиды</th>
                  <th className="px-3 py-2 text-right font-medium">Визит → лид</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.site} className="border-b border-border/40 last:border-0">
                    <td className="px-3 py-2 font-medium">{r.site}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtNum(Number(r.visitors) || 0)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtNum(Number(r.leads) || 0)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {Number(r.cr_visit_lead_pct ?? 0).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
