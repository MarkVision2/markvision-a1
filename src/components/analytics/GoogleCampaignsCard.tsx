import { useEffect, useMemo, useState } from "react";
import { Search, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import type { ReportPeriodRange } from "@/hooks/useReportData";

// Отчёт по кампаниям Google Ads поверх google_campaign_daily (+ имена из
// google_campaigns). Данные пишет google-ads-structure-sync; чтение под RLS
// (члены проекта видят только свой проект). Показываем только если есть данные.
interface CampRow {
  campaign_id: string;
  name: string;
  status: string | null;
  spend: number;
  clicks: number;
  leads: number;
  revenue: number;
}

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;
const num = (n: number) => Math.round(n).toLocaleString("ru-RU");

export function GoogleCampaignsCard({ range }: { range: ReportPeriodRange }) {
  const { activeId: projectId } = useProjectsStore();
  const [rows, setRows] = useState<CampRow[]>([]);
  const [loading, setLoading] = useState(false);

  const since = ymd(range.from);
  const until = ymd(range.to);

  useEffect(() => {
    if (!projectId) { setRows([]); return; }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      // google_* таблицы созданы позже generated types — обращаемся нетипизированно.
      // deno-lint-ignore no-explicit-any
      const sb = supabase as any;
      const [dailyRes, campRes] = await Promise.all([
        sb.from("google_campaign_daily")
          .select("campaign_id, spend, clicks, leads, revenue")
          .eq("project_id", projectId).gte("date", since).lte("date", until),
        sb.from("google_campaigns")
          .select("campaign_id, name, status")
          .eq("project_id", projectId),
      ]);
      if (cancelled) return;
      const names = new Map<string, { name: string; status: string | null }>();
      for (const c of (campRes.data ?? []) as Array<{ campaign_id: string; name: string | null; status: string | null }>) {
        names.set(c.campaign_id, { name: c.name ?? c.campaign_id, status: c.status });
      }
      const agg = new Map<string, CampRow>();
      for (const r of (dailyRes.data ?? []) as Array<{ campaign_id: string; spend: number; clicks: number; leads: number; revenue: number }>) {
        const meta = names.get(r.campaign_id);
        const cur = agg.get(r.campaign_id) ?? {
          campaign_id: r.campaign_id, name: meta?.name ?? r.campaign_id, status: meta?.status ?? null,
          spend: 0, clicks: 0, leads: 0, revenue: 0,
        };
        cur.spend += Number(r.spend ?? 0);
        cur.clicks += Number(r.clicks ?? 0);
        cur.leads += Number(r.leads ?? 0);
        cur.revenue += Number(r.revenue ?? 0);
        agg.set(r.campaign_id, cur);
      }
      setRows(Array.from(agg.values()).sort((a, b) => b.spend - a.spend));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [projectId, since, until]);

  const totals = useMemo(() => rows.reduce(
    (t, r) => ({ spend: t.spend + r.spend, clicks: t.clicks + r.clicks, leads: t.leads + r.leads, revenue: t.revenue + r.revenue }),
    { spend: 0, clicks: 0, leads: 0, revenue: 0 },
  ), [rows]);

  // Секцию не показываем, если Google не подключён / нет данных за период.
  if (!loading && rows.length === 0) return null;

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#FBBC05]/15 text-[#EA4335]">
          <Search className="h-4 w-4" />
        </span>
        <h2 className="text-lg font-semibold">Кампании Google Ads</h2>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/60">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-secondary/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 text-left font-semibold">Кампания</th>
                <th className="px-3 py-2.5 text-right font-semibold">Расход</th>
                <th className="px-3 py-2.5 text-right font-semibold">Клики</th>
                <th className="px-3 py-2.5 text-right font-semibold">Конверсии</th>
                <th className="px-3 py-2.5 text-right font-semibold">CPL</th>
                <th className="px-3 py-2.5 text-right font-semibold">Выручка</th>
                <th className="px-3 py-2.5 text-right font-semibold">ROAS</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.campaign_id} className="border-t border-border/30">
                  <td className="px-3 py-2.5">
                    <div className="font-medium">{r.name}</div>
                    {r.status && <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{r.status}</div>}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{money(r.spend)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{num(r.clicks)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{num(r.leads)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{r.leads > 0 ? money(r.spend / r.leads) : "—"}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.revenue > 0 ? money(r.revenue) : "—"}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{r.spend > 0 && r.revenue > 0 ? `${(r.revenue / r.spend).toFixed(1)}x` : "—"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border/60 bg-secondary/20 font-semibold">
                <td className="px-3 py-2.5">Итого</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{money(totals.spend)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{num(totals.clicks)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{num(totals.leads)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{totals.leads > 0 ? money(totals.spend / totals.leads) : "—"}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{totals.revenue > 0 ? money(totals.revenue) : "—"}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{totals.spend > 0 && totals.revenue > 0 ? `${(totals.revenue / totals.spend).toFixed(1)}x` : "—"}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Данные Google Ads по кампаниям за период. Конверсии — из Google Ads; выручка — из офлайн-конверсий CRM, где настроено.
      </p>
    </section>
  );
}
