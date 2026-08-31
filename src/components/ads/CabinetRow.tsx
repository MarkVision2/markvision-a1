import { useMemo, useState } from "react";
import {
  AlertCircle,
  BarChart3,
  CalendarClock,
  ChevronDown,
  Copy,
  Loader2,
  Megaphone,
  MoreHorizontal,
  Power,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { AdCabinet } from "@/types/ads";
import { useMetaInsights } from "@/hooks/useMetaInsights";
import { useLeadsLite } from "@/hooks/useLeadsLite";
import { useStageChangeEvents } from "@/hooks/useStageChangeEvents";
import {
  buildAdsCabinetCrmDaily,
  sumAdsCabinetCrmDaily,
} from "@/lib/adsCabinetCrmDaily";
import { supabase } from "@/integrations/supabase/client";
import { formatMetaSyncMessages, syncMetaFull } from "@/lib/metaSync";
import { resolveCdiMetric } from "@/lib/cdiManualOverride";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AutoLaunchDialog } from "@/components/ads/AutoLaunchDialog";

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  KZT: "₸",
  RUB: "₽",
  UAH: "₴",
  GBP: "£",
  TRY: "₺",
  BYN: "Br",
};
const formatMoney = (n: number, currency: string) => {
  const sym = CURRENCY_SYMBOLS[currency] ?? currency;
  const isPrefix = ["$", "€", "£"].includes(sym);
  const num = Math.round(n).toLocaleString("ru-RU");
  return isPrefix ? `${sym}${num}` : `${num} ${sym}`;
};
const formatNumber = (n: number) => Math.round(n).toLocaleString("ru-RU");

const MONTHS_RU_SHORT = [
  "янв",
  "фев",
  "мар",
  "апр",
  "май",
  "июн",
  "июл",
  "авг",
  "сен",
  "окт",
  "ноя",
  "дек",
];

const Metric = ({
  label,
  value,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
}) => (
  <div className="rounded-xl border border-border/40 bg-background/35 px-3 py-2.5">
    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
      {label}
    </div>
    <div className="mt-1 text-base font-semibold tabular-nums leading-none tracking-tight">
      {value}
    </div>
    {sub != null && (
      <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>
    )}
  </div>
);

interface Props {
  cabinet: AdCabinet;
  expanded: boolean;
  onToggle: () => void;
  monthCursor: Date;
  onToggleOnline: (id: string) => void;
  onRemove: (id: string) => void;
  onSynced?: () => void;
  /** У проекта один Meta-кабинет — считать unattributed Meta-лиды своими. */
  soleMetaCabinet?: boolean;
  /** Сохранение настроек кабинета — нужно для диалога авто-запуска. */
  onUpdate?: (id: string, patch: Partial<AdCabinet>) => Promise<void> | void;
}

const CabinetRow = ({ cabinet, expanded, onToggle, monthCursor, onToggleOnline, onRemove, onSynced, soleMetaCabinet, onUpdate }: Props) => {
  const [autoLaunchOpen, setAutoLaunchOpen] = useState(false);
  const monthParam = `${monthCursor.getFullYear()}-${String(
    monthCursor.getMonth() + 1,
  ).padStart(2, "0")}`;

  const { data, loading, error, refresh } = useMetaInsights(
    cabinet.externalId,
    monthParam,
    true,
    cabinet.id,
  );

  const crmPeriod = useMemo(() => {
    const year = monthCursor.getFullYear();
    const month = monthCursor.getMonth();
    return {
      from: new Date(year, month, 1),
      to: new Date(year, month + 1, 0, 23, 59, 59, 999),
    };
  }, [monthCursor]);

  const { leads: allLeads } = useLeadsLite();
  const { events: stageEvents } = useStageChangeEvents(crmPeriod, true);

  const crmByDay = useMemo(() => {
    const since = `${monthCursor.getFullYear()}-${String(monthCursor.getMonth() + 1).padStart(2, "0")}-01`;
    const last = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 0).getDate();
    const until = `${monthCursor.getFullYear()}-${String(monthCursor.getMonth() + 1).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
    return buildAdsCabinetCrmDaily(allLeads, stageEvents, cabinet.id, since, until, {
      soleMetaCabinet: !!soleMetaCabinet,
    });
  }, [allLeads, stageEvents, cabinet.id, monthCursor, soleMetaCabinet]);

  const crmTotals = useMemo(() => sumAdsCabinetCrmDaily(crmByDay), [crmByDay]);

  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    if (!cabinet.adAccountId && !cabinet.externalId) {
      toast.error("Не указан Ad Account кабинета");
      return;
    }
    setSyncing(true);
    try {
      const since = `${monthCursor.getFullYear()}-${String(monthCursor.getMonth() + 1).padStart(2, "0")}-01`;
      const lastDayOfMonth = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 0);
      const today = new Date();
      const end = lastDayOfMonth < today ? lastDayOfMonth : today;
      const until = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
      const result = await syncMetaFull({
        since,
        until,
        cabinet_id: cabinet.id,
        insights_only: true,
      });
      const messages = formatMetaSyncMessages(result);
      if (messages.success) {
        toast.success(messages.success);
        refresh();
        onSynced?.();
      }
      if (messages.error) toast.error(messages.error);
      for (const w of messages.warnings) toast.warning(w);
    } catch (e) {
      toast.error((e as Error).message || "Ошибка синхронизации");
    } finally {
      setSyncing(false);
    }
  };

  const totals = data?.totals;
  const currency = data?.currency ?? cabinet.currency ?? "USD";
  const hasDailyData = !!data?.daily.length;
  const dailyByDate = useMemo(() => {
    const map = new Map<string, NonNullable<typeof data>["daily"][number]>();
    for (const d of data?.daily ?? []) {
      map.set(d.date, d);
    }
    return map;
  }, [data]);

  const monthDays = useMemo(() => {
    const year = monthCursor.getFullYear();
    const month = monthCursor.getMonth();
    const last = new Date(year, month + 1, 0).getDate();
    const monthShort = MONTHS_RU_SHORT[month];
    return Array.from({ length: last }, (_, i) => {
      const day = i + 1;
      const isoDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      return {
        key: isoDate,
        label: `${day} ${monthShort}`,
        iso: isoDate,
      };
    });
  }, [monthCursor]);

  const cplCrm =
    totals && crmTotals.crmLeads > 0 ? totals.spend / crmTotals.crmLeads : 0;
  const resolvedCrmTotals = useMemo(() => {
    let sales = 0;
    let salesRevenue = 0;
    for (const d of monthDays) {
      const row = dailyByDate.get(d.iso);
      const crm = crmByDay.get(d.iso);
      sales += resolveCdiMetric(row?.manualSalesRaw, crm?.sales ?? 0);
      salesRevenue += resolveCdiMetric(row?.manualSalesRevenueRaw, crm?.salesRevenue ?? 0);
    }
    return { sales, salesRevenue };
  }, [crmByDay, dailyByDate, monthDays]);

  const upsertManual = async (
    isoDate: string,
    patch: Record<string, number>,
  ) => {
    try {
      const { data: existing } = await supabase
        .from("cabinet_daily_insights")
        .select("id")
        .eq("cabinet_id", cabinet.id)
        .eq("date", isoDate)
        .maybeSingle();
      if (existing?.id) {
        const { error } = await (supabase as any)
          .from("cabinet_daily_insights")
          .update(patch)
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any)
          .from("cabinet_daily_insights")
          .insert({
            cabinet_id: cabinet.id,
            external_id: cabinet.externalId,
            project_id: (cabinet as { projectId?: string }).projectId ?? null,
            date: isoDate,
            ...patch,
          });
        if (error) throw error;
      }
      toast.success("Сохранено");
      refresh();
    } catch (e) {
      toast.error((e as Error).message || "Не удалось сохранить");
    }
  };

  const handleManualSales = (isoDate: string, v: number) =>
    upsertManual(isoDate, { manual_sales: v });
  const handleManualRevenue = (isoDate: string, v: number) =>
    upsertManual(isoDate, { manual_revenue: v });

  return (
    <article
      className={cn(
        "group overflow-hidden rounded-2xl border border-border/50 bg-card/50 transition-colors",
        "hover:border-border hover:bg-card/70",
        cabinet.online && "border-l-[3px] border-l-success",
      )}
    >
      <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:gap-5">
        <div className="flex min-w-0 items-center gap-3.5 lg:w-[min(100%,280px)] lg:shrink-0">
          <span
            className={cn(
              "grid h-11 w-11 shrink-0 place-items-center rounded-xl",
              cabinet.online ? "bg-success/15 text-success" : "bg-muted/60 text-muted-foreground",
            )}
          >
            <Megaphone className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <h3 className="truncate text-[15px] font-semibold tracking-tight">{cabinet.name}</h3>
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                  cabinet.online
                    ? "bg-success/15 text-success"
                    : "bg-muted/50 text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    cabinet.online ? "bg-success" : "bg-muted-foreground/60",
                  )}
                />
                {cabinet.online ? "Online" : "Пауза"}
              </span>
              <span className="rounded-md border border-border/50 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                {cabinet.type === "Агентский" || /агент/i.test(String(cabinet.type))
                  ? "агентский"
                  : "личный"}
              </span>
              {cabinet.type === "Агентский" && (
                <span
                  title="Агентский кабинет: данные не попадают в Дашборд / CRM / Аналитику"
                  className="rounded-md border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning"
                >
                  Только список
                </span>
              )}
              {loading && (
                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Загрузка…
                </span>
              )}
            </div>
            <button
              type="button"
              className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              title="Скопировать ID"
              onClick={() => {
                navigator.clipboard.writeText(cabinet.externalId);
                toast.success("ID скопирован");
              }}
            >
              {cabinet.externalId}
            </button>
          </div>
        </div>

        <div className="grid min-w-0 flex-1 grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          <Metric
            label="Расход"
            value={formatMoney(totals?.spend ?? 0, currency)}
          />
          <Metric
            label="Лиды Meta"
            value={formatNumber(totals?.leads ?? 0)}
          />
          <Metric
            label="Лиды CRM"
            value={formatNumber(crmTotals.crmLeads)}
            sub={cplCrm > 0 ? `CPL ${formatMoney(cplCrm, currency)}` : "—"}
          />
          <Metric
            label="Диагностика"
            value={
              <span className="text-cyan-400">
                {formatNumber(crmTotals.diagnostics)}
              </span>
            }
          />
          <Metric
            label="Продажи"
            value={formatNumber(resolvedCrmTotals.sales)}
            sub={
              <span className="text-success">
                {formatMoney(resolvedCrmTotals.salesRevenue, currency)}
              </span>
            }
          />
        </div>

        <div className="flex items-center gap-1 self-end lg:self-center">
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            title="Получить статистику из Meta"
            className="flex h-9 items-center gap-1.5 rounded-xl border border-border/50 bg-background/40 px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-success/40 hover:bg-success/10 hover:text-success disabled:opacity-60"
          >
            {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BarChart3 className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{syncing ? "Загрузка…" : "Статистика"}</span>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label="Действия"
                className="grid h-9 w-9 place-items-center rounded-xl text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={handleSync} disabled={syncing}>
                <RefreshCw className={cn("mr-2 h-4 w-4", syncing && "animate-spin")} />
                Получить статистику
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setAutoLaunchOpen(true)} disabled={!onUpdate}>
                <CalendarClock className="mr-2 h-4 w-4" />
                Авто-запуск{cabinet.autoLaunchEnabled ? " · включён" : ""}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  navigator.clipboard.writeText(cabinet.externalId);
                  toast.success("ID скопирован");
                }}
              >
                <Copy className="mr-2 h-4 w-4" /> Скопировать ID
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onToggleOnline(cabinet.id)}>
                <Power className="mr-2 h-4 w-4" />
                {cabinet.online ? "Поставить на паузу" : "Запустить"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => {
                  if (confirm(`Удалить кабинет «${cabinet.name}»?`)) {
                    onRemove(cabinet.id);
                    toast.success("Кабинет удалён");
                  }
                }}
              >
                <Trash2 className="mr-2 h-4 w-4" /> Удалить
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            aria-label="Раскрыть"
            onClick={onToggle}
            className="grid h-9 w-9 place-items-center rounded-xl text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <ChevronDown
              className={cn(
                "h-4 w-4 transition-transform",
                expanded && "rotate-180",
              )}
            />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border/60 p-4 space-y-4 animate-fade-in-up">
          {!loading && !error && !hasDailyData && (
            <div className="flex flex-col gap-3 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-semibold">За выбранный месяц статистика не подтянута</div>
                <div className="text-xs opacity-80">Нажмите «Получить статистику», чтобы загрузить данные из Meta.</div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleSync}
                disabled={syncing}
                className="border-warning/40 bg-background/30 text-warning hover:bg-warning/10"
              >
                {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BarChart3 className="h-3.5 w-3.5" />}
                Получить статистику
              </Button>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div>
                <div className="font-semibold">Ошибка Meta API</div>
                <div className="opacity-90">{error}</div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              {
                label: "CPL CRM",
                value: cplCrm > 0 ? formatMoney(cplCrm, currency) : `— ${CURRENCY_SYMBOLS[currency] ?? currency}`,
                color: "text-amber-400",
              },
              {
                label: "CPM",
                value:
                  totals && totals.cpm > 0 ? formatMoney(totals.cpm, currency) : `— ${CURRENCY_SYMBOLS[currency] ?? currency}`,
                color: "text-blue-400",
              },
              {
                label: "CTR",
                value:
                  totals && totals.ctr > 0
                    ? `${totals.ctr.toFixed(2)}%`
                    : "—",
                color: "text-violet-400",
              },
              {
                label: "CPC",
                value:
                  totals && totals.cpc > 0 ? formatMoney(totals.cpc, currency) : `— ${CURRENCY_SYMBOLS[currency] ?? currency}`,
                color: "text-pink-400",
              },
              {
                label: "ROMI",
                value: totals && totals.spend > 0
                  ? `${totals.romi.toFixed(0)}%`
                  : "—",
                color: "text-rose-400",
              },
            ].map((m) => (
              <div
                key={m.label}
                className="rounded-xl border border-border/60 bg-background/40 p-3"
              >
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {m.label}
                </div>
                <div className={cn("mt-1 text-lg font-semibold", m.color)}>
                  {m.value}
                </div>
              </div>
            ))}
          </div>

          <div className="overflow-hidden rounded-xl border border-border/60">
            <table className="w-full text-sm">
              <thead className="bg-background/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-3 text-left font-medium">Дата</th>
                  <th className="px-3 py-3 text-right font-medium">Расход</th>
                  <th className="px-3 py-3 text-right font-medium">Лиды Meta</th>
                  <th className="px-3 py-3 text-right font-medium">Лиды CRM</th>
                  <th className="px-3 py-3 text-right font-medium">CPL CRM</th>
                  <th className="px-3 py-3 text-right font-medium">Диагностик</th>
                  <th className="px-3 py-3 text-right font-medium">Продажи</th>
                  <th className="px-3 py-3 text-right font-medium">Сумма</th>
                </tr>
              </thead>
              <tbody>
                {monthDays.map((d) => {
                  const row = dailyByDate.get(d.iso);
                  const crm = crmByDay.get(d.iso);
                  const crmLeads = crm?.crmLeads ?? 0;
                  const diagnostics = crm?.diagnostics ?? 0;
                  const dayCplCrm =
                    row && crmLeads > 0 ? row.spend / crmLeads : 0;
                  const crmSalesOnly = crm?.sales ?? 0;
                  const manualSales = row?.manualSales ?? 0;
                  const sales = resolveCdiMetric(row?.manualSalesRaw, crmSalesOnly);
                  const crmRevenueOnly = crm?.salesRevenue ?? 0;
                  const manualRev = row?.manualSalesRevenue ?? 0;
                  const crmRev = resolveCdiMetric(row?.manualSalesRevenueRaw, crmRevenueOnly);
                  return (
                    <tr
                      key={d.key}
                      className="border-t border-border/60 last:border-b-0"
                    >
                      <td className="px-3 py-3 font-medium">{d.label}</td>
                      <td
                        className={cn(
                          "px-3 py-3 text-right tabular-nums",
                          !row?.spend && "text-muted-foreground",
                        )}
                      >
                        {row?.spend ? formatMoney(row.spend, currency) : "—"}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-3 text-right tabular-nums",
                          !row?.leads && "text-muted-foreground",
                        )}
                      >
                        {row?.leads ? formatNumber(row.leads) : "—"}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-3 text-right tabular-nums",
                          !crmLeads && "text-muted-foreground",
                        )}
                      >
                        {crmLeads ? formatNumber(crmLeads) : "—"}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-3 text-right tabular-nums",
                          !dayCplCrm && "text-muted-foreground",
                        )}
                      >
                        {dayCplCrm > 0 ? formatMoney(dayCplCrm, currency) : "—"}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-3 text-right tabular-nums",
                          diagnostics ? "text-cyan-400" : "text-muted-foreground",
                        )}
                      >
                        {diagnostics ? formatNumber(diagnostics) : "—"}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <EditableNumberCell
                          value={sales}
                          manual={manualSales}
                          autoLabel="Из CRM"
                          fromAuto={crmSalesOnly}
                          render={(v) => (v ? formatNumber(v) : "—")}
                          onSave={(v) => handleManualSales(d.iso, v)}
                          title="Продажи вручную"
                        />
                      </td>
                      <td className="px-3 py-3 text-right">
                        <EditableNumberCell
                          value={crmRev}
                          manual={manualRev}
                          autoLabel="Из CRM"
                          fromAuto={crmRevenueOnly}
                          render={(v) => (v ? formatMoney(v, currency) : "—")}
                          onSave={(v) => handleManualRevenue(d.iso, v)}
                          title="Сумма вручную"
                          allowDecimal
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-muted-foreground">
            Meta — расход и лиды из Ads. Лиды CRM — заявки с атрибуцией на этот кабинет.
            CPL CRM = расход ÷ лиды CRM. Диагностика — переходы в этап диагностики, визита или консультации.
            Продажи и сумма — оплаты из CRM (можно поправить вручную).
          </p>
        </div>
      )}

      {onUpdate && (
        <AutoLaunchDialog
          open={autoLaunchOpen}
          onOpenChange={setAutoLaunchOpen}
          cabinet={cabinet}
          onSave={onUpdate}
        />
      )}
    </article>
  );
};

const EditableNumberCell = ({
  value,
  manual,
  fromAuto,
  autoLabel,
  render,
  onSave,
  title,
  allowDecimal,
}: {
  value: number;
  manual: number;
  fromAuto: number;
  autoLabel: string;
  render: (v: number) => React.ReactNode;
  onSave: (newManual: number) => Promise<void>;
  title: string;
  allowDecimal?: boolean;
}) => {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState<string>(String(manual));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const num = Number(val) || 0;
    const n = allowDecimal ? Math.max(0, num) : Math.max(0, Math.floor(num));
    setSaving(true);
    try {
      await onSave(n);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setVal(String(manual)); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-secondary",
            !value && "text-muted-foreground",
          )}
        >
          {render(value)}
          <Pencil className="h-3 w-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56" align="end">
        <div className="space-y-2">
          <div className="text-xs font-medium">{title}</div>
          <div className="text-[11px] text-muted-foreground">
            {autoLabel}: {fromAuto} · Вручную: {manual}
          </div>
          <Input
            type="number"
            min={0}
            step={allowDecimal ? "0.01" : "1"}
            value={val}
            onChange={(e) => setVal(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
              Отмена
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? "..." : "Сохранить"}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default CabinetRow;
