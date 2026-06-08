import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  BarChart3,
  CheckCircle2,
  Eye,
  Loader2,
  MessageCircle,
  MousePointerClick,
  Phone,
  Stethoscope,
  Target,
  TrendingDown,
  TrendingUp,
  Wallet,
  XCircle,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { CreativePreview } from "./CreativePreview";
import { useCreativeFunnel, type FunnelLead } from "@/hooks/useCreativeFunnel";
import { classifyGoal, type MetaCreativeRow } from "@/hooks/useMetaStructure";
import type { ReportPeriodRange } from "@/hooks/useReportData";

const fmtNum = (n: number) => Math.round(n).toLocaleString("ru-RU");
const fmtTenge = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;
const fmtPct = (n: number) =>
  `${n >= 10 ? Math.round(n) : Math.round(n * 10) / 10}%`;

interface Props {
  row: MetaCreativeRow | null;
  range: ReportPeriodRange;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Если знаешь имя кампании — передай. Иначе drawer возьмёт из RPC. */
  campaignName?: string | null;
  /** Если знаешь, что это WA — передай. Иначе detect по destination/objective из RPC. */
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

function StageBadge({ lead }: { lead: FunnelLead }) {
  const key = lead.stage_key ?? "";
  const title = lead.stage_title ?? "—";
  const tone =
    key === "paid"
      ? "bg-success/15 text-success ring-success/30"
      : key === "rejected"
        ? "bg-destructive/15 text-destructive ring-destructive/30"
        : lead.is_diagnostic
          ? "bg-amber-500/15 text-amber-500 ring-amber-500/30"
          : key === "visit" || key === "scheduled"
            ? "bg-primary/15 text-primary ring-primary/30"
            : "bg-muted/40 text-muted-foreground ring-border/60";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1",
        tone,
      )}
    >
      {title}
    </span>
  );
}

export function CreativeDetailDrawer({
  row,
  range,
  open,
  onOpenChange,
  campaignName: campaignNameProp,
  isWhatsApp: isWhatsAppProp,
}: Props) {
  const { data, loading } = useCreativeFunnel(open && row ? row.adId : null, range);
  const [textExpanded, setTextExpanded] = useState(false);
  const [leadsExpanded, setLeadsExpanded] = useState(false);

  const campaignName = campaignNameProp ?? data?.campaign_name ?? null;
  const goal = useMemo(
    () => classifyGoal(data?.objective ?? null, data?.destination_type ?? null),
    [data?.objective, data?.destination_type],
  );
  const isWhatsApp =
    isWhatsAppProp ??
    (goal.key === "messages" ||
      (data?.destination_type ?? "").toUpperCase().includes("WHATSAPP") ||
      (data?.destination_type ?? "").toUpperCase().includes("MESSENGER") ||
      (data?.objective ?? "").toUpperCase().includes("MESSAGE"));

  const stages = useMemo(() => {
    if (!data?.stages) return [];
    // Не показываем терминальные кроме paid/rejected — чтобы воронка осталась линейной.
    return data.stages.filter((s) => !s.is_terminal || s.key === "paid" || s.key === "rejected");
  }, [data]);

  const maxCount = Math.max(1, ...stages.map((s) => s.count));
  // Конверсия по этапам: % от предыдущего ненулевого этапа (для информативности).
  const stageWithCR = useMemo(() => {
    let prev = 0;
    const first = stages.find((s) => s.count > 0)?.count ?? 0;
    return stages.map((s, idx) => {
      const fromPrev = prev > 0 ? (s.count / prev) * 100 : null;
      const fromFirst = first > 0 ? (s.count / first) * 100 : null;
      if (s.count > 0) prev = s.count;
      return { ...s, fromPrev, fromFirst, isFirst: idx === 0 };
    });
  }, [stages]);

  if (!row) return null;

  const isActive = (row.effectiveStatus ?? "").toUpperCase() === "ACTIVE";
  const romiPositive = row.crmRomi >= 0;
  const RomiIcon = romiPositive ? TrendingUp : TrendingDown;
  const metaLeadCount = isWhatsApp ? row.messages || row.leads : row.leads;
  const cpm = row.cpm > 0 ? row.cpm : 0;
  const cpc = row.cpc > 0 ? row.cpc : 0;

  const totalLeads = data?.total_leads ?? 0;
  const paidCount = data?.paid_count ?? 0;
  const diagnostics = data?.diagnostics ?? 0;
  const diagRevenue = data?.diagnostic_revenue ?? 0;
  const totalRevenue = (data?.revenue ?? 0) + diagRevenue;
  const leadToSaleCr = totalLeads > 0 ? (paidCount / totalLeads) * 100 : 0;
  const leadToDiagCr = totalLeads > 0 ? (diagnostics / totalLeads) * 100 : 0;

  const allLeads = data?.recent_leads ?? [];
  const visibleLeads = leadsExpanded ? allLeads : allLeads.slice(0, 8);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="h-[100dvh] w-full overflow-y-auto p-0 pb-[env(safe-area-inset-bottom)] sm:max-h-screen sm:max-w-[860px]">
        <SheetHeader className="sr-only">
          <SheetTitle>{row.name || "Креатив"}</SheetTitle>
        </SheetHeader>

        {/* Hero */}
        <div className="grid gap-0 md:grid-cols-[minmax(280px,360px)_1fr]">
          <div className="relative bg-black">
            <CreativePreview row={row} playable fit="contain" className="mx-auto aspect-[9/16] w-full max-h-[min(60vh,520px)] max-w-[min(100%,340px)] sm:max-h-none sm:max-w-none" />
          </div>

          <div className="space-y-3 p-5">
            {campaignName && (
              <div className="text-[11px] text-muted-foreground break-words">
                <span className="font-semibold text-foreground/80">Кампания:</span> {campaignName}
              </div>
            )}
            <h2 className="text-xl font-bold leading-tight break-words">{row.name || "Креатив"}</h2>
            {row.headline && (
              <p className="whitespace-pre-line text-sm font-semibold leading-relaxed text-foreground break-words">
                {row.headline}
              </p>
            )}
            {row.primaryText && (
              <div>
                <p
                  className={cn(
                    "whitespace-pre-line text-sm leading-relaxed text-muted-foreground break-words",
                    !textExpanded && "line-clamp-6",
                  )}
                >
                  {row.primaryText}
                </p>
                {row.primaryText.length > 240 && (
                  <button
                    type="button"
                    onClick={() => setTextExpanded((v) => !v)}
                    className="mt-1 text-xs font-semibold text-primary hover:underline"
                  >
                    {textExpanded ? "Свернуть" : "Показать полностью"}
                  </button>
                )}
              </div>
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
              {goal.key !== "other" && !isWhatsApp && (
                <span className="inline-flex items-center gap-1 rounded-md bg-primary/15 px-2 py-0.5 text-[11px] font-bold text-primary">
                  {goal.label}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Metrics grid (Meta) */}
        <div className="grid grid-cols-2 gap-2.5 px-5 pt-2 sm:grid-cols-3">
          <MetricTile icon={Wallet} label="Расход" value={row.spend > 0 ? fmtTenge(row.spend) : "—"} />
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
          <MetricTile icon={Target} label="CPL" value={row.cpl > 0 ? fmtTenge(row.cpl) : "—"} />
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
              {leadToSaleCr > 0 && (
                <div className="mt-0.5 text-[10px] text-muted-foreground">CR лид→оплата {fmtPct(leadToSaleCr)}</div>
              )}
            </div>
            <div className="rounded-xl border border-border/50 bg-card/60 p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Выручка</div>
              <div className="mt-1 text-base font-bold tabular-nums">
                {row.crmRevenue > 0 ? fmtTenge(row.crmRevenue) : "—"}
              </div>
              {diagRevenue > 0 && (
                <div className="mt-0.5 text-[10px] text-muted-foreground">+ диагностики {fmtTenge(diagRevenue)}</div>
              )}
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
          <div className="mb-2 flex items-center justify-between gap-2 text-xs">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Воронка по стадиям CRM
            </div>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              {totalLeads > 0 && (
                <>
                  <span className="inline-flex items-center gap-1">
                    <Stethoscope className="h-3 w-3 text-amber-500" />
                    диагностик {fmtNum(diagnostics)} ({fmtPct(leadToDiagCr)})
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-success" />
                    оплат {fmtNum(paidCount)} ({fmtPct(leadToSaleCr)})
                  </span>
                </>
              )}
              {loading && <Loader2 className="h-3 w-3 animate-spin" />}
            </div>
          </div>
          {stageWithCR.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/60 bg-secondary/10 p-6 text-center text-xs text-muted-foreground">
              {loading ? "Загружаем воронку…" : "За выбранный период лидов с этого креатива не было."}
            </div>
          ) : (
            <div className="space-y-1.5">
              {stageWithCR.map((s) => {
                const ratio = s.count / maxCount;
                return (
                  <div
                    key={s.stage_id}
                    className="grid grid-cols-[minmax(72px,1fr)_2fr_auto] items-center gap-2 text-xs sm:grid-cols-[130px_1fr_56px_56px]"
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
                              : s.is_diagnostic
                                ? "bg-amber-500"
                                : "bg-primary",
                        )}
                        style={{ width: `${Math.max(2, ratio * 100)}%` }}
                      />
                    </div>
                    <div className="text-right font-bold tabular-nums">{fmtNum(s.count)}</div>
                    <div className="hidden text-right text-[10px] text-muted-foreground tabular-nums sm:block">
                      {s.fromPrev != null && !s.isFirst ? fmtPct(s.fromPrev) : ""}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Leads list */}
        <div className="px-5 pb-6 pt-5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Лиды с креатива · всего {fmtNum(totalLeads)} · оплат {fmtNum(paidCount)} на {fmtTenge(totalRevenue)}
            </div>
            {allLeads.length > 8 && (
              <button
                type="button"
                onClick={() => setLeadsExpanded((v) => !v)}
                className="text-[11px] font-semibold text-primary hover:underline"
              >
                {leadsExpanded ? "Свернуть" : `Показать все (${allLeads.length})`}
              </button>
            )}
          </div>
          {visibleLeads.length > 0 ? (
            <div className="overflow-hidden rounded-xl border border-border/60">
              <table className="w-full text-xs">
                <thead className="bg-secondary/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Лид</th>
                    <th className="px-3 py-2 text-left">Этап</th>
                    <th className="px-3 py-2 text-right">Сумма</th>
                    <th className="px-3 py-2 text-right">Дата</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleLeads.map((l) => {
                    const total = (Number(l.amount) || 0) + (Number(l.diagnostic_amount) || 0);
                    const isPaid = l.paid || l.stage_key === "paid";
                    const isRejected = l.stage_key === "rejected";
                    return (
                      <tr key={l.id} className="border-t border-border/30 hover:bg-secondary/20">
                        <td className="px-3 py-2 font-medium">
                          <div className="flex items-center gap-1.5">
                            {isPaid ? (
                              <CheckCircle2 className="h-3 w-3 shrink-0 text-success" />
                            ) : isRejected ? (
                              <XCircle className="h-3 w-3 shrink-0 text-destructive" />
                            ) : l.is_diagnostic ? (
                              <Stethoscope className="h-3 w-3 shrink-0 text-amber-500" />
                            ) : null}
                            <Link to={`/crm?lead=${l.id}`} className="truncate hover:text-primary">
                              {l.name || "—"}
                            </Link>
                          </div>
                          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                            <Phone className="h-2.5 w-2.5" />
                            {l.phone || "—"}
                            {l.channel && (
                              <span className="rounded bg-secondary/60 px-1 py-px uppercase">{l.channel}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2"><StageBadge lead={l} /></td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {total > 0 ? fmtTenge(total) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">
                          {new Date(l.created_at).toLocaleDateString("ru-RU", { day: "2-digit", month: "short" })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border/60 bg-secondary/10 p-4 text-center text-xs text-muted-foreground">
              {loading ? "…" : "Лидов с креатива в этом периоде ещё нет."}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
