import { useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Filter, Info, Link2, Loader2, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PeriodPicker, currentMonthRange } from "@/components/dashboard/PeriodPicker";
import { CreativePreview } from "@/components/creatives/CreativePreview";
import { CreativeDetailDrawer } from "@/components/creatives/CreativeDetailDrawer";
import { useMetaCreatives, type MetaCreativeRow } from "@/hooks/useMetaStructure";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { supabase } from "@/integrations/supabase/client";
import type { ReportPeriodRange } from "@/hooks/useReportData";
import { cn } from "@/lib/utils";

const fmtNum = (n: number) => Math.round(n).toLocaleString("ru-RU");
const fmtTenge = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;
const pct = (n: number) => `${(Math.round(n * 10) / 10).toLocaleString("ru-RU")}%`;

type SortKey = "crmRevenue" | "crmRomi" | "crmSales" | "crmLeads" | "leads" | "spend" | "ctr" | "cpl" | "name";
type StatusFilter = "all" | "active" | "paused";
type TypeFilter = "all" | "video" | "image" | "carousel";

const SORT_LABELS: Record<SortKey, string> = {
  crmRevenue: "Выручка CRM",
  crmRomi: "ROMI CRM",
  crmSales: "Продажи",
  crmLeads: "Лиды CRM",
  leads: "Лиды Meta",
  spend: "Расход",
  ctr: "CTR",
  cpl: "CPL",
  name: "Имя",
};

const STAGE_COLORS = ["bg-primary", "bg-accent", "bg-warning", "bg-success"] as const;

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
  const [status, setStatus] = useState<StatusFilter>("all");
  const [type, setType] = useState<TypeFilter>("all");
  const [hasSpend, setHasSpend] = useState(false);
  const [hasLeads, setHasLeads] = useState(false);
  const [hasSales, setHasSales] = useState(false);
  const [drawerRow, setDrawerRow] = useState<MetaCreativeRow | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  const [orphanLeads, setOrphanLeads] = useState(0);
  const { activeId: projectId } = useProjectsStore();

  const { rows, loading } = useMetaCreatives(range);

  // Лиды без привязки к креативу — для строки "Без креатива" и баннера
  useEffect(() => {
    if (!projectId) { setOrphanLeads(0); return; }
    const since = `${range.from.getFullYear()}-${String(range.from.getMonth()+1).padStart(2,"0")}-${String(range.from.getDate()).padStart(2,"0")}`;
    const until = `${range.to.getFullYear()}-${String(range.to.getMonth()+1).padStart(2,"0")}-${String(range.to.getDate()).padStart(2,"0")} 23:59:59`;
    let cancelled = false;
    void (async () => {
      const { count } = await supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId)
        .eq("is_personal", false)
        .is("meta_ad_id", null)
        .gte("created_at", since)
        .lte("created_at", until);
      if (!cancelled) setOrphanLeads(count ?? 0);
    })();
    return () => { cancelled = true; };
  }, [projectId, range.from, range.to, backfilling]);

  const runBackfill = async () => {
    if (!projectId) return;
    setBackfilling(true);
    const since = `${range.from.getFullYear()}-${String(range.from.getMonth()+1).padStart(2,"0")}-${String(range.from.getDate()).padStart(2,"0")}`;
    const { data, error } = await (supabase as unknown as { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: { attributed?: number } | null; error: unknown }> })
      .rpc("backfill_lead_attribution", { p_project_id: projectId, p_since: since });
    setBackfilling(false);
    if (error) {
      console.error(error);
      toast.error("Не удалось привязать лиды");
      return;
    }
    const n = data?.attributed ?? 0;
    if (n > 0) {
      toast.success(`Привязано лидов: ${n}`);
      setRange({ ...range });
    } else {
      toast.message("Новых привязок не найдено", { description: "Лиды без меток нельзя привязать к креативу" });
    }
  };


  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let r = rows;
    if (status === "active") r = r.filter((x) => x.effectiveStatus === "ACTIVE");
    if (status === "paused") r = r.filter((x) => x.effectiveStatus && x.effectiveStatus !== "ACTIVE");
    if (type !== "all") r = r.filter((x) => x.creativeType === type);
    if (hasSpend) r = r.filter((x) => x.spend > 0);
    if (hasLeads) r = r.filter((x) => x.crmLeads > 0 || x.leads > 0);
    if (hasSales) r = r.filter((x) => x.crmSales > 0);
    if (q) r = r.filter((x) => x.name.toLowerCase().includes(q) || x.adId.includes(q));
    const sorted = [...r];
    sorted.sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name);
      if (sortKey === "cpl") {
        const av = a.crmCpl > 0 ? a.crmCpl : a.cpl;
        const bv = b.crmCpl > 0 ? b.crmCpl : b.cpl;
        if (av === 0) return 1;
        if (bv === 0) return -1;
        return av - bv;
      }
      return ((b as unknown as Record<string, number>)[sortKey] ?? 0) - ((a as unknown as Record<string, number>)[sortKey] ?? 0);
    });
    return sorted;
  }, [rows, sortKey, search, status, type, hasSpend, hasLeads, hasSales]);

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, r) => ({
        spend: acc.spend + r.spend,
        metaLeads: acc.metaLeads + r.leads,
        crmLeads: acc.crmLeads + r.crmLeads,
        crmQualified: acc.crmQualified + r.crmQualified,
        crmSales: acc.crmSales + r.crmSales,
        crmRevenue: acc.crmRevenue + r.crmRevenue,
      }),
      { spend: 0, metaLeads: 0, crmLeads: 0, crmQualified: 0, crmSales: 0, crmRevenue: 0 },
    );
  }, [filtered]);

  const totalsRomi = totals.spend > 0 ? ((totals.crmRevenue - totals.spend) / totals.spend) * 100 : 0;

  const rangeLabel = useMemo(() => {
    const f = range.from.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
    const t = range.to.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
    return `${f} — ${t}`;
  }, [range]);

  const attributionRate = totals.metaLeads > 0 ? (totals.crmLeads / totals.metaLeads) * 100 : 0;

  return (
    <PageContainer>
      <PageHeader
        icon={Filter}
        title="Воронка по креативам"
        description={`Лид Meta → Лид CRM → Квалификация → Продажа → Выручка по каждому креативу · ${rangeLabel}`}
        actions={
          <>
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
          </>
        }
      />

      {/* KPI strip */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {[
          { label: "Расход", value: fmtTenge(totals.spend) },
          { label: "Лиды Meta", value: fmtNum(totals.metaLeads) },
          { label: "Лиды CRM", value: fmtNum(totals.crmLeads) },
          { label: "Квалиф.", value: fmtNum(totals.crmQualified) },
          { label: "Продажи", value: fmtNum(totals.crmSales) },
          { label: "Выручка", value: fmtTenge(totals.crmRevenue) },
          {
            label: "ROMI",
            value: totals.spend > 0 ? `${totalsRomi >= 0 ? "+" : ""}${Math.round(totalsRomi)}%` : "—",
            cls: totals.spend > 0 ? (totalsRomi >= 0 ? "text-success" : "text-destructive") : "",
          },
        ].map((k) => (
          <div key={k.label} className="rounded-2xl border border-border/60 bg-card/60 p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{k.label}</div>
            <div className={cn("mt-1 text-lg font-bold tabular-nums", k.cls)}>{k.value}</div>
          </div>
        ))}
      </div>

      {totals.metaLeads > 0 && attributionRate < 100 && (
        <div className="mt-3 flex flex-wrap items-start gap-3 rounded-xl border border-warning/40 bg-warning/5 p-3 text-xs">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div className="flex-1 min-w-[280px]">
            <span className="font-semibold">Привязка лидов: {pct(attributionRate)}.</span>
            {" "}Meta видит {fmtNum(totals.metaLeads)} лидов, в CRM привязано к креативам {fmtNum(totals.crmLeads)}.
            Чтобы поднять до 100%, в Meta-шаблоне URL добавьте
            {" "}<code className="rounded bg-secondary/60 px-1">utm_content=&#123;&#123;ad.id&#125;&#125;</code>.
            WhatsApp-лиды привязываются автоматически через CTWA referral.
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 border-warning/40"
            onClick={runBackfill}
            disabled={backfilling || !projectId}
          >
            {backfilling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
            Привязать существующие лиды
          </Button>
        </div>
      )}


      {/* Toolbar */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по названию или ad.id"
            className="h-10 rounded-xl border-border/60 pl-9"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          className="h-10 rounded-xl border border-border/60 bg-background px-2 text-xs font-medium"
        >
          <option value="all">Все статусы</option>
          <option value="active">Только активные</option>
          <option value="paused">На паузе / архив</option>
        </select>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as TypeFilter)}
          className="h-10 rounded-xl border border-border/60 bg-background px-2 text-xs font-medium"
        >
          <option value="all">Все типы</option>
          <option value="video">Видео</option>
          <option value="image">Картинка</option>
          <option value="carousel">Карусель</option>
        </select>
        {[
          { label: "Есть расход", v: hasSpend, set: setHasSpend },
          { label: "Есть лиды", v: hasLeads, set: setHasLeads },
          { label: "Есть продажи", v: hasSales, set: setHasSales },
        ].map((f) => (
          <button
            key={f.label}
            type="button"
            onClick={() => f.set(!f.v)}
            className={cn(
              "h-10 rounded-xl border px-3 text-xs font-medium transition",
              f.v ? "border-primary/60 bg-primary/10 text-primary" : "border-border/60 bg-background hover:bg-secondary/40",
            )}
          >
            {f.label}
          </button>
        ))}
        <div className="flex items-center gap-1 text-xs">
          <span className="text-muted-foreground">Сорт.:</span>
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

      <div className="mt-2 text-[11px] text-muted-foreground">
        Показано {filtered.length} из {rows.length} креативов
      </div>

      {/* Table */}
      <div className="mt-3 overflow-hidden rounded-2xl border border-border/60 bg-card/60">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/30 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Креатив</th>
                <th className="px-4 py-3 text-left font-semibold">Воронка</th>
                <th className="px-4 py-3 text-right font-semibold">Лиды Meta</th>
                <th className="px-4 py-3 text-right font-semibold">CR лид→прод.</th>
                <th className="px-4 py-3 text-right font-semibold">Сред. чек</th>
                <th className="px-4 py-3 text-right font-semibold">Расход</th>
                <th className="px-4 py-3 text-right font-semibold">Выручка</th>
                <th className="px-4 py-3 text-right font-semibold">ROMI</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    {loading ? "Загружаем креативы…" : "Под фильтр ничего не попало. Снимите фильтры или расширьте период."}
                  </td>
                </tr>
              )}
              {filtered.map((row) => {
                const cr = row.crmLeads > 0 ? (row.crmSales / row.crmLeads) * 100 : 0;
                const romiPositive = row.crmRomi >= 0;
                const RomiIcon = romiPositive ? ArrowUpRight : ArrowDownRight;
                return (
                  <tr
                    key={row.id}
                    className="cursor-pointer border-t border-border/30 transition hover:bg-secondary/20"
                    onClick={() => setDrawerRow(row)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <CreativePreview row={row} compact className="h-14 w-14 ring-1 ring-border/40" />
                        <div className="min-w-0">
                          <div className="line-clamp-1 text-sm font-semibold" title={row.name}>
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
                      </div>
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
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{fmtNum(row.leads)}</td>
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
        Атрибуция: WhatsApp — через Meta CTWA referral; сайт — через UTM-шаблон с
        {" "}<code className="rounded bg-secondary/60 px-1">utm_content=&#123;&#123;ad.id&#125;&#125;</code>.
        Клик по строке откроет полную карточку креатива с воронкой и списком лидов.
      </p>

      <CreativeDetailDrawer
        row={drawerRow}
        range={range}
        open={!!drawerRow}
        onOpenChange={(o) => !o && setDrawerRow(null)}
      />
    </PageContainer>
  );
};

export default CreativeFunnel;
