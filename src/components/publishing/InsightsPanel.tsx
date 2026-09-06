/**
 * AI Content Analyst — что работает в проекте за период: лучшие часы и дни
 * в поясе аккаунта, площадки, лидеры и аутсайдеры среди аккаунтов, причины
 * отказов и рекомендации словами. Считается на сервере детерминированно
 * (publish-accounts action=analytics_insights, _lib/publishInsights.ts) —
 * те же числа, что в витринах, только сложенные.
 */
import { useCallback, useEffect, useState } from "react";
import { Copy, Lightbulb, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { publishingApi, type ContentInsights } from "@/lib/publishingClient";
import { fmtNum } from "@/lib/publishingFormat";
import { cn } from "@/lib/utils";

const PERIODS = [7, 14, 30, 90];
const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

export function InsightsPanel({ projectId, refreshKey }: { projectId: string | null; refreshKey?: number }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<ContentInsights | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const [replicating, setReplicating] = useState<string | null>(null);

  /** Автопилот руками: победитель → варианты по группам через конвейер. Причины пропусков — в тосте. */
  const replicate = async (contentId: string, title: string | null) => {
    if (!projectId) return;
    setReplicating(contentId);
    try {
      const r = await publishingApi.winnerReplicate(projectId, contentId);
      if (r.created.length) toast.success(`«${title ?? "Ролик"}»: варианты для ${r.created.map((c) => c.group_name).join(", ")}`);
      else toast.warning(`«${title ?? "Ролик"}»: размножать некуда — ${r.skipped.slice(0, 3).map((x) => `${x.name}: ${x.reason}`).join("; ") || "нет подходящих групп"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось размножить");
    } finally {
      setReplicating(null);
    }
  };

  const load = useCallback(async () => {
    if (!projectId) { setData(null); return; }
    setLoading(true);
    setError(null);
    try {
      const r = await publishingApi.insights(projectId, days);
      setData(r.insights);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось собрать инсайты");
    } finally {
      setLoading(false);
    }
  }, [projectId, days]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  return (
    <section className="rounded-2xl border bg-card p-4" aria-label="AI Content Analyst">
      <div className="flex flex-wrap items-center gap-2">
        <Lightbulb className="h-4 w-4 text-amber-500" aria-hidden />
        <h3 className="text-sm font-medium">Что работает</h3>
        <span className="text-xs text-muted-foreground">по публикациям с метриками, часы — в поясе аккаунта</span>
        <div className="ml-auto flex items-center gap-1.5">
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger className="h-7 w-[110px] text-xs" aria-label="Период инсайтов"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PERIODS.map((d) => <SelectItem key={d} value={String(d)}>{d} дней</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" variant="ghost" className="h-7 px-2" disabled={loading} onClick={() => void load()} aria-label="Пересчитать инсайты">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? "Свернуть" : "Развернуть"}
          </Button>
        </div>
      </div>

      {open && error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      {open && !error && !data && <p className="mt-2 text-xs text-muted-foreground">{loading ? "Считаем…" : "Выберите проект."}</p>}
      {open && data && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Публикаций <b className="text-foreground tabular-nums">{data.publications}</b></span>
            <span>С метриками <b className="text-foreground tabular-nums">{data.measured}</b></span>
            <span>Просмотров <b className="text-foreground tabular-nums">{fmtNum(data.views_total)}</b></span>
            {data.verified_rate != null && <span>Подтверждено <b className={cn("tabular-nums", data.verified_rate < 80 ? "text-amber-600 dark:text-amber-400" : "text-foreground")}>{data.verified_rate}%</b></span>}
            {data.best_hours.length > 0 && <span>Лучшие часы <b className="text-foreground tabular-nums">{data.best_hours.map((h) => `${String(h).padStart(2, "0")}:00`).join(", ")}</b></span>}
            {data.best_weekdays.length > 0 && <span>Сильные дни <b className="text-foreground">{data.best_weekdays.map((d) => WEEKDAYS[d]).join(", ")}</b></span>}
          </div>

          <ul className="space-y-1.5" aria-label="Рекомендации">
            {data.recommendations.map((r, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
                <span>{r}</span>
              </li>
            ))}
          </ul>

          {data.top_content.length > 0 && (
            <div className="rounded-xl border p-3 text-xs">
              <div className="mb-1.5 font-medium">Лучшие ролики периода</div>
              <ul className="divide-y divide-border/60">
                {data.top_content.map((c) => (
                  <li key={c.content_id} className="flex items-center gap-2 py-1">
                    <span className="min-w-0 flex-1 truncate">{c.title ?? c.content_id.slice(0, 8)}</span>
                    <span className="tabular-nums text-muted-foreground">{c.publications} публ.</span>
                    <span className="tabular-nums">score {c.score_avg ?? "—"}</span>
                    <Button
                      size="sm" variant="outline" className="h-7 px-2 text-xs"
                      disabled={replicating != null}
                      aria-label={`Размножить ${c.title ?? c.content_id.slice(0, 8)}`}
                      onClick={() => void replicate(c.content_id, c.title)}
                    >
                      {replicating === c.content_id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Copy className="mr-1 h-3 w-3" />}
                      По группам
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(data.by_platform.length > 0 || data.accounts_top.length > 0) && (
            <div className="grid gap-3 text-xs sm:grid-cols-2">
              {data.by_platform.length > 0 && (
                <div className="rounded-xl border p-3">
                  <div className="mb-1.5 font-medium">Площадки</div>
                  <table className="w-full">
                    <tbody>
                      {data.by_platform.map((b) => (
                        <tr key={b.key} className="border-t border-border/60">
                          <td className="py-1 pr-2">{b.key}</td>
                          <td className="py-1 pr-2 text-right tabular-nums text-muted-foreground">{b.publications} публ.</td>
                          <td className="py-1 pr-2 text-right tabular-nums">{b.views_avg != null ? `${fmtNum(b.views_avg)} просм.` : "—"}</td>
                          <td className="py-1 text-right tabular-nums">{b.score_avg != null ? `score ${b.score_avg}` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {data.accounts_top.length > 0 && (
                <div className="rounded-xl border p-3">
                  <div className="mb-1.5 font-medium">Лидеры среди аккаунтов</div>
                  <table className="w-full">
                    <tbody>
                      {data.accounts_top.map((a) => (
                        <tr key={a.account_id} className="border-t border-border/60">
                          <td className="max-w-[160px] truncate py-1 pr-2">{a.account_name}</td>
                          <td className="py-1 pr-2 text-right tabular-nums text-muted-foreground">{a.publications} публ.</td>
                          <td className="py-1 text-right tabular-nums">score {a.score_avg ?? "—"}</td>
                        </tr>
                      ))}
                      {data.accounts_bottom.map((a) => (
                        <tr key={a.account_id} className="border-t border-border/60 text-muted-foreground">
                          <td className="max-w-[160px] truncate py-1 pr-2">↓ {a.account_name}</td>
                          <td className="py-1 pr-2 text-right tabular-nums">{a.publications} публ.</td>
                          <td className="py-1 text-right tabular-nums">score {a.score_avg ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
