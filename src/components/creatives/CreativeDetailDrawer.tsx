import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Loader2, MessageCircle, Phone, TrendingDown, TrendingUp } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CreativePreview } from "./CreativePreview";
import { useCreativeFunnel } from "@/hooks/useCreativeFunnel";
import type { MetaCreativeRow } from "@/hooks/useMetaStructure";
import type { ReportPeriodRange } from "@/hooks/useReportData";

const fmtNum = (n: number) => Math.round(n).toLocaleString("ru-RU");
const fmtTenge = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;
const pct = (n: number) => `${(Math.round(n * 10) / 10).toLocaleString("ru-RU")}%`;

interface Props {
  row: MetaCreativeRow | null;
  range: ReportPeriodRange;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreativeDetailDrawer({ row, range, open, onOpenChange }: Props) {
  const { data, loading } = useCreativeFunnel(open && row ? row.adId : null, range);

  const stages = useMemo(() => {
    if (!data?.stages) return [];
    return data.stages.filter((s) => !s.is_terminal || s.key === "paid" || s.key === "rejected");
  }, [data]);

  const maxCount = Math.max(1, ...stages.map((s) => s.count));

  if (!row) return null;

  const romiPositive = row.crmRomi >= 0;
  const RomiIcon = romiPositive ? TrendingUp : TrendingDown;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="line-clamp-2 text-left text-base">
            {row.name || "Креатив"}
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 grid grid-cols-[160px_1fr] gap-4">
          <CreativePreview row={row} className="aspect-[4/5] w-40" />
          <div className="space-y-2 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              <code className="rounded bg-secondary/60 px-1.5 py-0.5 tabular-nums">{row.adId}</code>
              {row.effectiveStatus && (
                <span className={cn(
                  "rounded px-1.5 py-0.5 font-bold uppercase",
                  row.effectiveStatus === "ACTIVE" ? "bg-success/15 text-success" : "bg-warning/15 text-warning",
                )}>
                  {row.effectiveStatus}
                </span>
              )}
              <span className="rounded bg-secondary/60 px-1.5 py-0.5 capitalize">{row.creativeType}</span>
            </div>
            {row.headline && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Заголовок</div>
                <div className="font-semibold">{row.headline}</div>
              </div>
            )}
            {row.primaryText && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Текст</div>
                <div className="line-clamp-3 text-muted-foreground">{row.primaryText}</div>
              </div>
            )}
            {row.destinationUrl && (
              <a
                href={row.destinationUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                Открыть посадочную <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>

        {/* Money */}
        <div className="mt-6 grid grid-cols-3 gap-2 text-sm sm:grid-cols-6">
          {[
            { label: "Расход", value: row.spend > 0 ? fmtTenge(row.spend) : "—" },
            { label: "Лиды Meta", value: fmtNum(row.leads) },
            { label: "Лиды CRM", value: fmtNum(row.crmLeads) },
            { label: "Продажи", value: fmtNum(row.crmSales) },
            { label: "Выручка", value: row.crmRevenue > 0 ? fmtTenge(row.crmRevenue) : "—" },
            {
              label: "ROMI",
              value: row.spend > 0 ? `${romiPositive ? "+" : ""}${Math.round(row.crmRomi)}%` : "—",
              cls: row.spend > 0 ? (romiPositive ? "text-success" : "text-destructive") : "",
            },
          ].map((k) => (
            <div key={k.label} className="rounded-xl border border-border/60 bg-card/60 p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{k.label}</div>
              <div className={cn("mt-1 text-sm font-bold tabular-nums", k.cls)}>{k.value}</div>
            </div>
          ))}
        </div>

        {/* Funnel */}
        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between text-xs">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Воронка по стадиям CRM
            </div>
            {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          </div>
          {stages.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/60 bg-secondary/10 p-6 text-center text-xs text-muted-foreground">
              {loading ? "Загружаем воронку…" : "За выбранный период лидов с этого креатива не было."}
            </div>
          ) : (
            <div className="space-y-1.5">
              {stages.map((s) => {
                const ratio = s.count / maxCount;
                return (
                  <div key={s.stage_id} className="grid grid-cols-[120px_1fr_48px] items-center gap-2 text-xs">
                    <div className="truncate text-muted-foreground" title={s.title}>{s.title}</div>
                    <div className="h-5 overflow-hidden rounded bg-secondary/40">
                      <div
                        className={cn(
                          "h-full rounded transition-all",
                          s.key === "paid" ? "bg-success" : s.key === "rejected" ? "bg-destructive/60" : "bg-primary",
                        )}
                        style={{ width: `${Math.max(4, ratio * 100)}%` }}
                      />
                    </div>
                    <div className="text-right font-bold tabular-nums">{fmtNum(s.count)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent leads */}
        <div className="mt-6">
          <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
            Последние лиды ({fmtNum(data?.total_leads ?? 0)} всего · {fmtNum(data?.paid_count ?? 0)} оплат на {fmtTenge(data?.revenue ?? 0)})
          </div>
          {data?.recent_leads && data.recent_leads.length > 0 ? (
            <div className="overflow-hidden rounded-xl border border-border/60">
              <table className="w-full text-xs">
                <thead className="bg-secondary/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Имя</th>
                    <th className="px-3 py-2 text-left">Телефон</th>
                    <th className="px-3 py-2 text-right">Сумма</th>
                    <th className="px-3 py-2 text-right">Дата</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent_leads.map((l) => (
                    <tr key={l.id} className="border-t border-border/30 hover:bg-secondary/20">
                      <td className="px-3 py-2 font-medium">
                        <Link to={`/crm?lead=${l.id}`} className="hover:text-primary">{l.name}</Link>
                        {l.paid && <span className="ml-1 rounded bg-success/15 px-1 text-[10px] font-bold text-success">оплачено</span>}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{l.phone}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.amount > 0 ? fmtTenge(l.amount) : "—"}</td>
                      <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">
                        {new Date(l.created_at).toLocaleDateString("ru-RU")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border/60 bg-secondary/10 p-4 text-center text-xs text-muted-foreground">
              {loading ? "…" : "Лидов пока нет."}
            </div>
          )}
        </div>

        {/* Attribution help */}
        <div className="mt-6 rounded-xl border border-primary/30 bg-primary/5 p-3 text-xs">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-primary">
            <MessageCircle className="h-3 w-3" /> Как добиться 100% привязки
          </div>
          <ul className="mt-2 space-y-1 text-muted-foreground">
            <li>• В Meta для сайта используйте UTM-шаблон с <code className="rounded bg-secondary/60 px-1">utm_content=&#123;&#123;ad.id&#125;&#125;</code> — лид с этой меткой привязывается к креативу автоматически.</li>
            <li>• Для WhatsApp атрибуция уже работает через Click-To-WhatsApp referral, ничего настраивать не нужно.</li>
            <li>• Ручные лиды (без рекламы) физически не могут быть привязаны к креативу — они учитываются в общей CRM, но не в этой воронке.</li>
          </ul>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" asChild>
            <Link to={`/ads?tab=creatives&ad=${row.adId}`}>
              Открыть в управлении рекламой <ExternalLink className="ml-1 h-3 w-3" />
            </Link>
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
