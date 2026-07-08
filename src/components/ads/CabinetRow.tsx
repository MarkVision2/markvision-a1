import { useMemo, useState } from "react";
import {
  AlertCircle,
  BarChart3,
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
import { supabase } from "@/integrations/supabase/client";
import { manualValueForSave } from "@/lib/cdiManualOverride";
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
}: {
  label: string;
  value: React.ReactNode;
}) => (
  <div>
    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
      {label}
    </div>
    <div className="mt-1 text-base font-semibold">{value}</div>
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
}

const CabinetRow = ({ cabinet, expanded, onToggle, monthCursor, onToggleOnline, onRemove, onSynced }: Props) => {
  const monthParam = `${monthCursor.getFullYear()}-${String(
    monthCursor.getMonth() + 1,
  ).padStart(2, "0")}`;

  const { data, loading, error, refresh } = useMetaInsights(
    cabinet.externalId,
    monthParam,
    true,
    cabinet.id,
  );

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
      const { data: resp, error: err } = await supabase.functions.invoke("meta-daily-sync", {
        body: { cabinet_id: cabinet.id, since, until },
      });
      if (err) throw err;
      const r = (resp?.results ?? [])[0];
      if (r?.ok) {
        toast.success(`Загружено: ${r.days} дн., ${r.leads} лидов, расход ${Math.round(r.spend)}`);
        refresh();
        onSynced?.();
      } else {
        toast.error("Meta: " + (r?.error || "не удалось получить данные"));
      }
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

  const cpl = totals && totals.leads > 0 ? totals.spend / totals.leads : 0;

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

  const handleManualDiagnostics = (isoDate: string, v: number) =>
    upsertManual(isoDate, { manual_diagnostics: v });
  const handleManualSales = (isoDate: string, v: number) =>
    upsertManual(isoDate, { manual_sales: v });
  const handleManualRevenue = (isoDate: string, v: number) =>
    upsertManual(isoDate, { manual_revenue: v });

  return (
    <article className="rounded-2xl border border-border/60 bg-card/60 transition-colors hover:border-border">
      <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:gap-6">
        <div className="flex items-center gap-4 lg:flex-1">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-success/15 text-success">
            <Megaphone className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-bold italic tracking-wide">{cabinet.name}</h3>
              {cabinet.online && (
                <span className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-success">
                  <span className="h-1.5 w-1.5 rounded-full bg-success" />
                  Online
                </span>
              )}
              <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] uppercase text-muted-foreground">
                {cabinet.type}
              </span>
              {cabinet.type === "Агентский" && (
                <span
                  title="Агентский кабинет: данные не попадают в Дашборд / CRM / Аналитику"
                  className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-warning"
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
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              ID: {cabinet.externalId}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:gap-6">
          <Metric
            label="Расход"
            value={formatMoney(totals?.spend ?? 0, currency)}
          />
          <Metric
            label="Лиды"
            value={
              <span>
                {formatNumber(totals?.leads ?? 0)}{" "}
                <span className="text-xs text-muted-foreground">
                  ({cpl > 0 ? formatMoney(cpl, currency) : "—"})
                </span>
              </span>
            }
          />
          <Metric
            label="Диагностики"
            value={
              <span className="text-amber-400">
                {formatNumber(totals?.diagnostics ?? 0)}
              </span>
            }
          />
          <Metric
            label="Продажи"
            value={
              <span>
                {formatNumber(totals?.sales ?? 0)}{" "}
                <span className="text-xs text-success">
                  ({formatMoney(totals?.crmRevenue ?? 0, currency)})
                </span>
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
            className="flex h-9 items-center gap-1.5 rounded-lg border border-border/60 bg-card/40 px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-60"
          >
            {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BarChart3 className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{syncing ? "Загрузка…" : "Получить статистику"}</span>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label="Действия"
                className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={handleSync} disabled={syncing}>
                <RefreshCw className={cn("mr-2 h-4 w-4", syncing && "animate-spin")} />
                Получить статистику
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
            className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
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
                label: "CPL",
                value: cpl > 0 ? formatMoney(cpl, currency) : `— ${CURRENCY_SYMBOLS[currency] ?? currency}`,
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
                  <th className="px-4 py-3 text-left font-medium">Дата</th>
                  <th className="px-4 py-3 text-right font-medium">Расход</th>
                  <th className="px-4 py-3 text-right font-medium">Лиды</th>
                  <th className="px-4 py-3 text-right font-medium">CPL</th>
                  <th className="px-4 py-3 text-right font-medium">Диагн.</th>
                  <th className="px-4 py-3 text-right font-medium">Продажи</th>
                  <th className="px-4 py-3 text-right font-medium">Сумма CRM</th>
                </tr>
              </thead>
              <tbody>
                {monthDays.map((d) => {
                  const row = dailyByDate.get(d.iso);
                  const dayCpl =
                    row && row.leads > 0 ? row.spend / row.leads : 0;
                  const diag = row?.diagnostics ?? 0;
                  const crmDiag = row?.crmDiagnostics ?? 0;
                  const manualDiag = row?.manualDiagnostics ?? 0;
                  const sales = row?.sales ?? 0;
                  const crmSalesOnly = row?.crmSales ?? 0;
                  const manualSales = row?.manualSales ?? 0;
                  const crmRev = row?.crmRevenue ?? 0;
                  const crmRevenueOnly = row?.crmRevenueOnly ?? 0;
                  const manualRev = row?.manualRevenue ?? 0;
                  return (
                    <tr
                      key={d.key}
                      className="border-t border-border/60 last:border-b-0"
                    >
                      <td className="px-4 py-3 font-medium">{d.label}</td>
                      <td
                        className={cn(
                          "px-4 py-3 text-right",
                          !row?.spend && "text-muted-foreground",
                        )}
                      >
                        {row?.spend ? formatMoney(row.spend, currency) : "—"}
                      </td>
                      <td
                        className={cn(
                          "px-4 py-3 text-right",
                          !row?.leads && "text-muted-foreground",
                        )}
                      >
                        {row?.leads ? formatNumber(row.leads) : "—"}
                      </td>
                      <td
                        className={cn(
                          "px-4 py-3 text-right",
                          !dayCpl && "text-muted-foreground",
                        )}
                      >
                        {dayCpl > 0 ? formatMoney(dayCpl, currency) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <DiagnosticsCell
                          isoDate={d.iso}
                          diagnostics={diag}
                          crm={crmDiag}
                          manual={manualDiag}
                          onSave={(v) => handleManualDiagnostics(d.iso, v)}
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
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
                      <td className="px-4 py-3 text-right">
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
            Данные Meta + CRM подгружаются в реальном времени. Диагностики и продажи считаются автоматически по лидам этого кабинета. Кликни на ячейку «Диагн.» чтобы добавить вручную.
          </p>
        </div>
      )}
    </article>
  );
};

const DiagnosticsCell = ({
  isoDate,
  diagnostics,
  crm,
  manual,
  onSave,
}: {
  isoDate: string;
  /** Итоговое значение (override-aware). */
  diagnostics: number;
  /** Чистое CRM значение, чтобы в попапе можно было увидеть авто-факт даже если поверх стоит manual. */
  crm: number;
  manual: number;
  onSave: (newManual: number) => Promise<void>;
}) => {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState<string>(String(manual));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const n = Math.max(0, Math.floor(Number(val) || 0));
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
            !diagnostics && "text-muted-foreground",
          )}
          title={`Дата ${isoDate}. CRM + ручные`}
        >
          {diagnostics ? diagnostics : "—"}
          <Pencil className="h-3 w-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56" align="end">
        <div className="space-y-2">
          <div className="text-xs font-medium">Диагностики вручную</div>
          <div className="text-[11px] text-muted-foreground">
            Из CRM: {crm} · Вручную: {manual} · Показано: {diagnostics}
          </div>
          <Input
            type="number"
            min={0}
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
