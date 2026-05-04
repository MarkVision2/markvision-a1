import { useMemo, useState } from "react";
import {
  AlertCircle,
  ChevronDown,
  Copy,
  Download,
  Loader2,
  Megaphone,
  MoreHorizontal,
  Power,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { AdCabinet } from "@/types/ads";
import { useMetaInsights } from "@/hooks/useMetaInsights";
import { supabase } from "@/integrations/supabase/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  KZT: "$",
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
}

const CabinetRow = ({ cabinet, expanded, onToggle, monthCursor, onToggleOnline, onRemove }: Props) => {
  const monthParam = `${monthCursor.getFullYear()}-${String(
    monthCursor.getMonth() + 1,
  ).padStart(2, "0")}`;

  const { data, loading, error, refresh } = useMetaInsights(
    cabinet.externalId,
    monthParam,
    true,
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
      const lastDay = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 0).getDate();
      const until = `${monthCursor.getFullYear()}-${String(monthCursor.getMonth() + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      const { data: resp, error: err } = await supabase.functions.invoke("meta-daily-sync", {
        body: { cabinet_id: cabinet.id, since, until },
      });
      if (err) throw err;
      const r = (resp?.results ?? [])[0];
      if (r?.ok) {
        toast.success(`Загружено: ${r.days} дн., ${r.leads} лидов, расход ${Math.round(r.spend)}`);
        refresh();
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

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:gap-8">
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
            label="CPL"
            value={cpl > 0 ? formatMoney(cpl, currency) : "—"}
          />
          <Metric
            label="Выручка"
            value={
              <span className="text-success">
                {formatMoney(totals?.revenue ?? 0, currency)}
              </span>
            }
          />
        </div>

        <div className="flex items-center gap-1 self-end lg:self-center">
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            title="Подтянуть статистику из Meta"
            className="flex h-9 items-center gap-1.5 rounded-lg border border-border/60 bg-card/40 px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-60"
          >
            {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{syncing ? "Загрузка…" : "Подтянуть"}</span>
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
                Подтянуть статистику
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
                value:
                  totals && totals.romi !== 0
                    ? `${totals.romi.toFixed(0)}%`
                    : "—",
                color: "text-rose-400",
              },
              {
                label: "Показы",
                value: formatNumber(totals?.impressions ?? 0),
                color: "text-foreground",
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
                  <th className="px-4 py-3 text-right font-medium">Показы</th>
                  <th className="px-4 py-3 text-right font-medium">Клики</th>
                  <th className="px-4 py-3 text-right font-medium">Лиды</th>
                  <th className="px-4 py-3 text-right font-medium">CPL</th>
                </tr>
              </thead>
              <tbody>
                {monthDays.map((d) => {
                  const row = dailyByDate.get(d.iso);
                  const dayCpl =
                    row && row.leads > 0 ? row.spend / row.leads : 0;
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
                          !row?.impressions && "text-muted-foreground",
                        )}
                      >
                        {row?.impressions
                          ? formatNumber(row.impressions)
                          : "—"}
                      </td>
                      <td
                        className={cn(
                          "px-4 py-3 text-right",
                          !row?.clicks && "text-muted-foreground",
                        )}
                      >
                        {row?.clicks ? formatNumber(row.clicks) : "—"}
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
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-muted-foreground">
            Данные подгружаются из Meta Marketing API в реальном времени.
          </p>
        </div>
      )}
    </article>
  );
};

export default CabinetRow;