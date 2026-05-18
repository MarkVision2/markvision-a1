import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  BarChart3,
  Eye,
  Loader2,
  MessageCircle,
  MousePointerClick,
  Phone,
  Target,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { CreativePreview } from "./CreativePreview";
import { useCreativeFunnel } from "@/hooks/useCreativeFunnel";
import type { MetaCreativeRow } from "@/hooks/useMetaStructure";
import type { ReportPeriodRange } from "@/hooks/useReportData";

const fmtNum = (n: number) => Math.round(n).toLocaleString("ru-RU");
const fmtTenge = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;

interface Props {
  row: MetaCreativeRow | null;
  range: ReportPeriodRange;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignName?: string | null;
  isWhatsApp?: boolean;
}

function MetricTile({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-2xl border border-border/50 bg-card/60 p-3">
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/15 text-primary">
          <Icon className="h-3.5 w-3.5" />
        </span>
        {label}
      </div>
      <div className={cn("mt-2 text-xl font-bold leading-none tabular-nums", accent)}>{value}</div>
      {sub && <div className="mt-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function CreativeDetailDrawer({
  row,
  range,
  open,
  onOpenChange,
  campaignName,
  isWhatsApp,
}: Props) {
  const { data, loading } = useCreativeFunnel(open && row ? row.adId : null, range);

  const stages = useMemo(() => {
    if (!data?.stages) return [];
    return data.stages.filter((s) => !s.is_terminal || s.key === "paid" || s.key === "rejected");
  }, [data]);

  const maxCount = Math.max(1, ...stages.map((s) => s.count));

  if (!row) return null;

  const isActive = (row.effectiveStatus ?? "").toUpperCase() === "ACTIVE";
  const romiPositive = row.crmRomi >= 0;
  const RomiIcon = romiPositive ? TrendingUp : TrendingDown;
  const metaLeadCount = isWhatsApp ? row.messages || row.leads : row.leads;
  const cpm = row.cpm > 0 ? row.cpm : 0;
  const cpc = row.cpc > 0 ? row.cpc : 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-[860px]">
        <SheetHeader className="sr-only">
          <SheetTitle>{row.name || "Креатив"}</SheetTitle>
        </SheetHeader>

        {/* Hero: media + header */}
        <div className="grid gap-0 md:grid-cols-[minmax(280px,360px)_1fr]">
          <div className="relative bg-black">
            <CreativePreview row={row} className="aspect-[9/16] w-full" />
          </div>

          <div className="space-y-3 p-5">
            {campaignName && (
              <div className="text-[11px] text-muted-foreground">
                <span className="font-semibold text-foreground/80">Кампания:</span> {campaignName}
              </div>
            )}
            <h2 className="text-xl font-bold leading-tight">{row.name || "Креатив"}</h2>
            {(row.headline || row.primaryText) && (
              <p className="line-clamp-4 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                {row.primaryText || row.headline}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider",
                  isActive ? "bg-success/15 text-success" : "bg-muted/40 text-muted-foreground",
                )}
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", isActive ? "bg-success" : "bg-muted-foreground")} />
                {isActive ? "Active" : row.effectiveStatus ?? "—"}
              </span>
              <span className="text-[11px] text-muted-foreground">
                ID: <code className="rounded bg-secondary/60 px-1.5 py-0.5 tabular-nums">{row.adId}</code>
              </span>
              {isWhatsApp && (
                <span className="inline-flex items-center gap-1 rounded-md bg-success/15 px-2 py-0.5 text-[11px] font-bold text-success">
                  <MessageCircle className="h-3 w-3" /> WhatsApp
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Metrics grid (Meta) */}
        <div className="grid grid-cols-2 gap-2.5 px-5 pt-2 sm:grid-cols-3">
          <MetricTile
            icon={Wallet}
            label="Расход"
            value={row.spend > 0 ? fmtTenge(row.spend) : "—"}
          />
          <MetricTile
            icon={Eye}
            label="Показы"
            value={fmtNum(row.impressions)}
            sub={cpm > 0 ? `CPM ${fmtTenge(cpm)}` : undefined}
          />
          <MetricTile
            icon={MousePointerClick}
            label="Клики"
            value={fmtNum(row.clicks)}
            sub={cpc > 0 ? `CPC ${fmtTenge(cpc)}` : undefined}
          />
          <MetricTile icon={BarChart3} label="CTR" value={row.ctr > 0 ? `${row.ctr.toFixed(2)}%` : "—"} />
          <MetricTile
            icon={Target}
            label="CPL"
            value={row.cpl > 0 ? fmtTenge(row.cpl) : "—"}
          />
          <MetricTile
            icon={MessageCircle}
            label={isWhatsApp ? "Сообщения" : "Заявки"}
            value={fmtNum(metaLeadCount)}
            accent="text-success"
          />
        </div>

        {/* CRM revenue block */}
        <div className="mx-5 mt-4 rounded-2xl border border-primary/30 bg-primary/5 p-3">
          <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-primary">
            <TrendingUp className="h-3 w-3" />
            Сквозная аналитика CRM
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-xl border border-border/50 bg-card/60 p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Продажи</div>
              <div className="mt-1 text-base font-bold tabular-nums text-success">{fmtNum(row.crmSales)}</div>
            </div>
            <div className="rounded-xl border border-border/50 bg-card/60 p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Выручка</div>
              <div className="mt-1 text-base font-bold tabular-nums">
                {row.crmRevenue > 0 ? fmtTenge(row.crmRevenue) : "—"}
              </div>
            </div>
            <div className="rounded-xl border border-border/50 bg-card/60 p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Ср. чек</div>
              <div className="mt-1 text-base font-bold tabular-nums">
                {row.crmAvgCheck > 0 ? fmtTenge(row.crmAvgCheck) : "—"}
              </div>
            </div>
            <div className="rounded-xl border border-border/50 bg-card/60 p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">ROMI</div>
              <div
                className={cn(
                  "mt-1 inline-flex items-center gap-1 text-base font-bold tabular-nums",
                  row.spend > 0 && row.crmRevenue > 0
                    ? romiPositive
                      ? "text-success"
                      : "text-destructive"
                    : "text-muted-foreground",
                )}
              >
                {row.spend > 0 && row.crmRevenue > 0 ? (
                  <>
                    <RomiIcon className="h-4 w-4" />
                    {romiPositive ? "+" : ""}
                    {Math.round(row.crmRomi)}%
                  </>
                ) : (
                  "—"
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Funnel */}
        <div className="px-5 pt-5">
          <div className="mb-2 flex items-center justify-between text-xs">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
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
                  <div
                    key={s.stage_id}
                    className="grid grid-cols-[120px_1fr_48px] items-center gap-2 text-xs"
                  >
                    <div className="truncate text-muted-foreground" title={s.title}>
                      {s.title}
                    </div>
                    <div className="h-5 overflow-hidden rounded bg-secondary/40">
                      <div
                        className={cn(
                          "h-full rounded transition-all",
                          s.key === "paid"
                            ? "bg-success"
                            : s.key === "rejected"
                              ? "bg-destructive/60"
                              : "bg-primary",
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
        <div className="px-5 pb-6 pt-5">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Последние лиды · всего {fmtNum(data?.total_leads ?? 0)} · оплат{" "}
            {fmtNum(data?.paid_count ?? 0)} на {fmtTenge(data?.revenue ?? 0)}
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
                        <Link to={`/crm?lead=${l.id}`} className="hover:text-primary">
                          {l.name}
                        </Link>
                        {l.paid && (
                          <span className="ml-1 rounded bg-success/15 px-1 text-[10px] font-bold text-success">
                            оплачено
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {l.phone}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {l.amount > 0 ? fmtTenge(l.amount) : "—"}
                      </td>
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
      </SheetContent>
    </Sheet>
  );
}
