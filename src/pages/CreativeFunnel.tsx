import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDownRight, ArrowUpRight, Image as ImageIcon, Layers, Loader2, RefreshCw, Search, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PeriodPicker, currentMonthRange } from "@/components/dashboard/PeriodPicker";
import { useMetaCreatives, type MetaCreativeRow } from "@/hooks/useMetaStructure";
import type { ReportPeriodRange } from "@/hooks/useReportData";
import { cn } from "@/lib/utils";

const fmtNum = (n: number) => Math.round(n).toLocaleString("ru-RU");
const fmtTenge = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;
const pct = (n: number) => `${(Math.round(n * 10) / 10).toLocaleString("ru-RU")}%`;

type SortKey = "crmRevenue" | "crmRomi" | "crmSales" | "crmLeads" | "spend" | "name";

const SORT_LABELS: Record<SortKey, string> = {
  crmRevenue: "Выручка",
  crmRomi: "ROMI",
  crmSales: "Продажи",
  crmLeads: "Лиды",
  spend: "Расход",
  name: "Имя",
};

const STAGE_COLORS = ["bg-primary", "bg-accent", "bg-warning", "bg-success"] as const;

function CreativeThumb({ row }: { row: MetaCreativeRow }) {
  const src = (() => {
    if (row.imageUrl) return row.imageUrl;
    return row.thumbnailUrl?.replace(/p\d{2,4}x\d{2,4}/g, "p240x240") ?? null;
  })();
  const Icon = row.creativeType === "video" ? Video : row.creativeType === "carousel" ? Layers : ImageIcon;
  return (
    <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-secondary/40 ring-1 ring-border/40">
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <Icon className="h-5 w-5 text-muted-foreground/50" />
        </div>
      )}
      <span className="absolute right-0.5 top-0.5 grid h-4 w-4 place-items-center rounded bg-background/80 backdrop-blur">
        <Icon className="h-2.5 w-2.5" />
      </span>
    </div>
  );
}

/** Мини-воронка: 4 столбца с относительной высотой и подписью значения. */
function MiniFunnel({ stages }: { stages: { label: string; value: number; display: string }[] }) {
  const max = Math.max(1, ...stages.map((s) => s.value));
  return (
    <div className="flex items-end gap-1.5">
      {stages.map((s, i) => {
        const h = Math.max(8, Math.round((s.value / max) * 40));
        return (
          <div key={s.label} className="flex w-12 flex-col items-center gap-1">
            <div className="text-[10px] font-bold tabular-nums leading-none">{s.display}</div>
            <div className="flex h-10 w-full items-end">
              <div
                className={cn("w-full rounded-sm transition-all", STAGE_COLORS[i] ?? "bg-primary", s.value === 0 && "opacity-30")}
                style={{ height: `${h}px` }}
                title={`${s.label}: ${s.display}`}
              />
            </div>
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{s.label}</div>
          </div>
        );
      })}
    </div>
  );
}

const CreativeFunnel = () => {
  const [range, setRange] = useState<ReportPeriodRange>(() => currentMonthRange());
  const [sortKey, setSortKey] = useState<SortKey>("crmRevenue");
  const [search, setSearch] = useState("");
  const [onlyWithLeads, setOnlyWithLeads] = useState(true);

  const { rows, loading } = useMetaCreatives(range);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let r = rows;
    if (onlyWithLeads) r = r.filter((x) => x.crmLeads > 0 || x.leads > 0);
    if (q) r = r.filter((x) => x.name.toLowerCase().includes(q) || x.adId.includes(q));
    const sorted = [...r];
    sorted.sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name);
      return ((b as any)[sortKey] ?? 0) - ((a as any)[sortKey] ?? 0);
    });
    return sorted;
  }, [rows, sortKey, search, onlyWithLeads]);

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, r) => ({
        spend: acc.spend + r.spend,
        crmLeads: acc.crmLeads + r.crmLeads,
        crmQualified: acc.crmQualified + r.crmQualified,
        crmSales: acc.crmSales + r.crmSales,
        crmRevenue: acc.crmRevenue + r.crmRevenue,
      }),
      { spend: 0, crmLeads: 0, crmQualified: 0, crmSales: 0, crmRevenue: 0 },
    );
  }, [filtered]);

  const totalsRomi = totals.spend > 0 ? ((totals.crmRevenue - totals.spend) / totals.spend) * 100 : 0;

  const rangeLabel = useMemo(() => {
    const f = range.from.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
    const t = range.to.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
    return `${f} — ${t}`;
  }, [range]);

  return (
    <main className="container max-w-7xl py-8 animate-fade-in-up">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Воронка по креативам</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Лид → Квалификация → Продажа → Выручка по каждому креативу за период · {rangeLabel}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PeriodPicker range={range} onChange={setRange} />
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-10 rounded-xl border-border/60"
            aria-label="Обновить"
            onClick={() => setRange({ ...range })}
            disabled={loading}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Aggregate KPI strip */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: "Расход", value: fmtTenge(totals.spend) },
          { label: "Лиды CRM", value: fmtNum(totals.crmLeads) },
          { label: "Квалиф.", value: fmtNum(totals.crmQualified) },
          { label: "Продажи", value: fmtNum(totals.crmSales) },
          { label: "Выручка", value: fmtTenge(totals.crmRevenue) },
          {
            label: "ROMI",
            value: `${totalsRomi >= 0 ? "+" : ""}${Math.round(totalsRomi)}%`,
            cls: totalsRomi >= 0 ? "text-success" : "text-destructive",
          },
        ].map((k) => (
          <div key={k.label} className="rounded-2xl border border-border/60 bg-card/60 p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{k.label}</div>
            <div className={cn("mt-1 text-lg font-bold tabular-nums", k.cls)}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по названию или ad.id"
            className="h-10 rounded-xl border-border/60 pl-9"
          />
        </div>
        <label className="flex items-center gap-2 rounded-xl border border-border/60 bg-card/60 px-3 h-10 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={onlyWithLeads}
            onChange={(e) => setOnlyWithLeads(e.target.checked)}
            className="accent-primary"
          />
          Только с лидами
        </label>
        <div className="flex items-center gap-1 text-xs">
          <span className="text-muted-foreground">Сортировка:</span>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="h-10 rounded-xl border border-border/60 bg-background px-2 text-xs font-medium"
          >
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <option key={k} value={k}>{SORT_LABELS[k]}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-border/60 bg-card/60">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/30 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Креатив</th>
                <th className="px-4 py-3 text-left font-semibold">Воронка</th>
                <th className="px-4 py-3 text-right font-semibold">CR лид→продажа</th>
                <th className="px-4 py-3 text-right font-semibold">Сред. чек</th>
                <th className="px-4 py-3 text-right font-semibold">Расход</th>
                <th className="px-4 py-3 text-right font-semibold">Выручка</th>
                <th className="px-4 py-3 text-right font-semibold">ROMI</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    {loading ? "Загружаем креативы…" : "Нет креативов с лидами за выбранный период."}
                  </td>
                </tr>
              )}
              {filtered.map((row) => {
                const cr = row.crmLeads > 0 ? (row.crmSales / row.crmLeads) * 100 : 0;
                const romiPositive = row.crmRomi >= 0;
                const RomiIcon = romiPositive ? ArrowUpRight : ArrowDownRight;
                return (
                  <tr key={row.id} className="border-t border-border/30 hover:bg-secondary/20">
                    <td className="px-4 py-3">
                      <Link to={`/ads?tab=creatives&ad=${row.adId}`} className="flex items-center gap-3 group">
                        <CreativeThumb row={row} />
                        <div className="min-w-0">
                          <div className="line-clamp-1 text-sm font-semibold group-hover:text-primary" title={row.name}>
                            {row.name || "Без названия"}
                          </div>
                          <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                            <code className="rounded bg-secondary/60 px-1 tabular-nums">{row.adId}</code>
                            {row.effectiveStatus && (
                              <span className={cn(
                                "rounded px-1 font-bold uppercase",
                                row.effectiveStatus === "ACTIVE" ? "bg-success/15 text-success" : "bg-warning/15 text-warning",
                              )}>
                                {row.effectiveStatus}
                              </span>
                            )}
                          </div>
                        </div>
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <MiniFunnel
                        stages={[
                          { label: "Лид", value: row.crmLeads, display: fmtNum(row.crmLeads) },
                          { label: "Квал.", value: row.crmQualified, display: fmtNum(row.crmQualified) },
                          { label: "Прод.", value: row.crmSales, display: fmtNum(row.crmSales) },
                          { label: "₸", value: row.crmRevenue, display: row.crmRevenue > 0 ? `${Math.round(row.crmRevenue / 1000)}k` : "0" },
                        ]}
                      />
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{cr > 0 ? pct(cr) : "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.crmAvgCheck > 0 ? fmtTenge(row.crmAvgCheck) : "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.spend > 0 ? fmtTenge(row.spend) : "—"}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">{row.crmRevenue > 0 ? fmtTenge(row.crmRevenue) : "—"}</td>
                    <td className="px-4 py-3 text-right">
                      {row.spend > 0 ? (
                        <span className={cn(
                          "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-bold tabular-nums",
                          romiPositive ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive",
                        )}>
                          <RomiIcon className="h-3 w-3" />
                          {romiPositive ? "+" : ""}{Math.round(row.crmRomi)}%
                        </span>
                      ) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-4 text-[11px] text-muted-foreground">
        Атрибуция: WhatsApp — через Meta CTWA referral; сайт — через UTM-шаблон с <code className="rounded bg-secondary/60 px-1">utm_content=&#123;&#123;ad.id&#125;&#125;</code>.
        Клик по креативу открывает его карточку в разделе «Управление рекламой».
      </p>
    </main>
  );
};

export default CreativeFunnel;
