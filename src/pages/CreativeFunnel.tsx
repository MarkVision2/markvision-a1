import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowDownRight, ArrowUp, ArrowUpDown, ArrowUpRight, Filter, Info, Link2, Loader2, RefreshCw, Search } from "lucide-react";
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
const fmtTenge = (n: number) => `${Math.round(n).toLocaleString("ru-RU")}\u00a0₸`;
const pct = (n: number) => `${(Math.round(n * 10) / 10).toLocaleString("ru-RU")}%`;

type SortKey = "crmRevenue" | "crmRomi" | "crmSales" | "crmLeads" | "leads" | "spend" | "ctr" | "cpl" | "name";
type SortDir = "asc" | "desc";
type StatusFilter = "all" | "active" | "paused";
type TypeFilter = "all" | "video" | "image" | "carousel";


function SortableTh({
  label, sortKey, current, dir, onSort, align = "right",
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: SortDir;
  onSort: (k: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = current === sortKey;
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className={cn("px-4 py-3 font-semibold select-none", align === "right" ? "text-right" : "text-left")}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 transition hover:text-foreground",
          align === "right" && "flex-row-reverse",
          active && "text-primary",
        )}
      >
        <span>{label}</span>
        <Icon className={cn("h-3 w-3", active ? "opacity-100" : "opacity-40")} />
      </button>
    </th>
  );
}

const CreativeFunnel = () => {
  const [range, setRange] = useState<ReportPeriodRange>(() => currentMonthRange());
  const [sortKey, setSortKey] = useState<SortKey>("leads");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [type, setType] = useState<TypeFilter>("all");
  const [hasSpend, setHasSpend] = useState(false);
  const [hasLeads, setHasLeads] = useState(false);
  const [hasSales, setHasSales] = useState(false);
  const [drawerRow, setDrawerRow] = useState<MetaCreativeRow | null>(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  const [backfilling, setBackfilling] = useState(false);
  const [orphanLeads, setOrphanLeads] = useState(0);
  const [crmTotals, setCrmTotals] = useState({ leads: 0, diagnostics: 0, sales: 0, revenue: 0 });
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

  // Сводные CRM-показатели по проекту за период (диагностики/продажи/выручка)
  useEffect(() => {
    if (!projectId) { setCrmTotals({ leads: 0, diagnostics: 0, sales: 0, revenue: 0 }); return; }
    const since = `${range.from.getFullYear()}-${String(range.from.getMonth()+1).padStart(2,"0")}-${String(range.from.getDate()).padStart(2,"0")}`;
    const until = `${range.to.getFullYear()}-${String(range.to.getMonth()+1).padStart(2,"0")}-${String(range.to.getDate()).padStart(2,"0")} 23:59:59`;
    let cancelled = false;
    void (async () => {
      const { data: stages } = await supabase
        .from("pipeline_stages")
        .select("id, is_diagnostic")
        .eq("is_diagnostic", true);
      const diagStageIds = new Set((stages ?? []).map((s) => s.id as string));
      const { data: leads } = await supabase
        .from("leads")
        .select("id, paid, amount, diagnostic_amount, stage_id, created_at")
        .eq("project_id", projectId)
        .eq("is_personal", false)
        .gte("created_at", since)
        .lte("created_at", until);
      if (cancelled) return;
      let diagnostics = 0, sales = 0, revenue = 0;
      const arr = leads ?? [];
      for (const l of arr) {
        const atDiag = diagStageIds.has(l.stage_id as string);
        const paid = !!l.paid;
        if (paid) { sales += 1; revenue += Number(l.amount) || 0; }
        if (atDiag || paid) diagnostics += 1;
        if (!paid && atDiag) revenue += Number(l.amount) || 0;
        revenue += Number(l.diagnostic_amount) || 0;
      }
      setCrmTotals({ leads: arr.length, diagnostics, sales, revenue });
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

    // Дедупликация: одинаковая медиа (видео/картинка) — это один креатив,
    // даже если откручен в нескольких кампаниях. Складываем метрики.
    const dedupKey = (x: MetaCreativeRow) =>
      x.videoId
      || x.videoUrl
      || x.imageUrl
      || x.thumbnailUrl
      || x.posterUrl
      || `name:${x.creativeType}:${x.name}`;
    const groups = new Map<string, MetaCreativeRow>();
    for (const row of r) {
      const key = dedupKey(row);
      const existing = groups.get(key);
      if (!existing) {
        groups.set(key, { ...row });
        continue;
      }
      existing.spend += row.spend;
      existing.impressions += row.impressions;
      existing.clicks += row.clicks;
      existing.leads += row.leads;
      existing.messages += row.messages;
      existing.purchases += row.purchases;
      existing.revenue += row.revenue;
      existing.crmLeads += row.crmLeads;
      existing.crmQualified += row.crmQualified;
      existing.crmSales += row.crmSales;
      existing.crmRevenue += row.crmRevenue;
      // Если ACTIVE есть хоть в одной кампании — считаем активным
      if (row.effectiveStatus === "ACTIVE") existing.effectiveStatus = "ACTIVE";
    }
    const merged = Array.from(groups.values()).map((x) => {
      const ctr = x.impressions > 0 ? (x.clicks / x.impressions) * 100 : 0;
      const cpl = x.leads > 0 ? x.spend / x.leads : 0;
      const cpc = x.clicks > 0 ? x.spend / x.clicks : 0;
      const cpm = x.impressions > 0 ? (x.spend / x.impressions) * 1000 : 0;
      const romi = x.spend > 0 ? ((x.revenue - x.spend) / x.spend) * 100 : 0;
      const crmCpl = x.crmLeads > 0 ? x.spend / x.crmLeads : 0;
      const crmCps = x.crmSales > 0 ? x.spend / x.crmSales : 0;
      const crmAvgCheck = x.crmSales > 0 ? x.crmRevenue / x.crmSales : 0;
      const crmRomi = x.spend > 0 ? ((x.crmRevenue - x.spend) / x.spend) * 100 : 0;
      const crmProfit = x.crmRevenue - x.spend;
      return { ...x, ctr, cpl, cpc, cpm, romi, crmCpl, crmCps, crmAvgCheck, crmRomi, crmProfit };
    });

    const sorted = merged;
    const dir = sortDir === "asc" ? 1 : -1;
    sorted.sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name) * dir;
      if (sortKey === "cpl") {
        const av = a.crmCpl > 0 ? a.crmCpl : a.cpl;
        const bv = b.crmCpl > 0 ? b.crmCpl : b.cpl;
        if (av === 0) return 1;
        if (bv === 0) return -1;
        return (av - bv) * dir;
      }
      const va = (a as unknown as Record<string, number>)[sortKey] ?? 0;
      const vb = (b as unknown as Record<string, number>)[sortKey] ?? 0;
      return (vb - va) * dir;
    });
    return sorted;
  }, [rows, sortKey, sortDir, search, status, type, hasSpend, hasLeads, hasSales]);


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

  // Используем фактические CRM-показатели по проекту (а не только привязанные к креативам),
  // чтобы цифры в KPI-полоске сходились с реальной CRM
  const crmRevenueTotal = crmTotals.revenue;
  const totalsRomi = totals.spend > 0 ? ((crmRevenueTotal - totals.spend) / totals.spend) * 100 : 0;

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
          { label: "Лиды CRM", value: fmtNum(crmTotals.leads) },
          { label: "Диагностики", value: fmtNum(crmTotals.diagnostics) },
          { label: "Продажи", value: fmtNum(crmTotals.sales) },
          { label: "Выручка", value: fmtTenge(crmRevenueTotal) },
          {
            label: "ROMI",
            value: totals.spend > 0 ? `${totalsRomi >= 0 ? "+" : ""}${Math.round(totalsRomi)}%` : "—",
            cls: totals.spend > 0 ? (totalsRomi >= 0 ? "text-success" : "text-destructive") : "",
          },
        ].map((k) => (
          <div key={k.label} className="rounded-2xl border border-border/60 bg-card/60 p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{k.label}</div>
            <div className={cn("mt-1 whitespace-nowrap text-lg font-bold tabular-nums", k.cls)}>{k.value}</div>
          </div>
        ))}
      </div>





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
      </div>

      <div className="mt-2 text-[11px] text-muted-foreground">
        Показано {filtered.length} из {rows.length} креативов (после объединения дублей)
      </div>


      {/* Table */}
      <div className="mt-3 overflow-hidden rounded-2xl border border-border/60 bg-card/60">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/40 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <SortableTh label="Креатив" sortKey="name" current={sortKey} dir={sortDir} onSort={(k) => {
                  if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
                  else { setSortKey(k); setSortDir("asc"); }
                }} align="left" />
                <SortableTh label="Лиды Meta" sortKey="leads" current={sortKey} dir={sortDir} onSort={(k) => {
                  if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
                  else { setSortKey(k); setSortDir("desc"); }
                }} />
                <SortableTh label="Лиды CRM" sortKey="crmLeads" current={sortKey} dir={sortDir} onSort={(k) => {
                  if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
                  else { setSortKey(k); setSortDir("desc"); }
                }} />
                <SortableTh label="Продажи" sortKey="crmSales" current={sortKey} dir={sortDir} onSort={(k) => {
                  if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
                  else { setSortKey(k); setSortDir("desc"); }
                }} />
                <SortableTh label="Расход" sortKey="spend" current={sortKey} dir={sortDir} onSort={(k) => {
                  if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
                  else { setSortKey(k); setSortDir("desc"); }
                }} />
                <SortableTh label="CPL" sortKey="cpl" current={sortKey} dir={sortDir} onSort={(k) => {
                  if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
                  else { setSortKey(k); setSortDir("asc"); }
                }} />
                <SortableTh label="Выручка" sortKey="crmRevenue" current={sortKey} dir={sortDir} onSort={(k) => {
                  if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
                  else { setSortKey(k); setSortDir("desc"); }
                }} />
                <SortableTh label="ROMI" sortKey="crmRomi" current={sortKey} dir={sortDir} onSort={(k) => {
                  if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
                  else { setSortKey(k); setSortDir("desc"); }
                }} />
              </tr>
            </thead>
            <tbody>
              {orphanLeads > 0 && (
                <tr className="border-t border-border/30 bg-warning/5">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="grid h-12 w-12 place-items-center rounded-md bg-warning/10 ring-1 ring-warning/30">
                        <Info className="h-5 w-5 text-warning" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold">Без креатива</div>
                        <div className="mt-0.5 line-clamp-1 text-[10px] text-muted-foreground">
                          Лиды без меток ad.id — нажмите «Привязать существующие лиды».
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold">{fmtNum(orphanLeads)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">—</td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">—</td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">—</td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">—</td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">—</td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">—</td>
                </tr>
              )}
              {filtered.length === 0 && orphanLeads === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    {loading ? "Загружаем креативы…" : "Под фильтр ничего не попало. Снимите фильтры или расширьте период."}
                  </td>
                </tr>
              )}
              {paged.map((row) => {
                const romiPositive = row.crmRomi >= 0;
                const RomiIcon = romiPositive ? ArrowUpRight : ArrowDownRight;
                const cplValue = row.crmCpl > 0 ? row.crmCpl : row.cpl;
                return (
                  <tr
                    key={row.id}
                    className="cursor-pointer border-t border-border/30 transition hover:bg-secondary/20"
                    onClick={() => setDrawerRow(row)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <CreativePreview row={row} compact className="h-12 w-12 ring-1 ring-border/40" />
                        <div className="min-w-0 max-w-[280px]">
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
                    <td className="px-4 py-3 text-right tabular-nums font-semibold">{fmtNum(row.leads)}</td>
                    <td className={cn("px-4 py-3 text-right tabular-nums font-semibold", row.crmLeads > 0 ? "text-primary" : "text-muted-foreground")}>
                      {fmtNum(row.crmLeads)}
                    </td>
                    <td className={cn("px-4 py-3 text-right tabular-nums", row.crmSales > 0 ? "font-semibold text-success" : "text-muted-foreground")}>
                      {fmtNum(row.crmSales)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.spend > 0 ? fmtTenge(row.spend) : <span className="text-muted-foreground">0 ₸</span>}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{cplValue > 0 ? fmtTenge(cplValue) : <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">{row.crmRevenue > 0 ? fmtTenge(row.crmRevenue) : <span className="font-normal text-muted-foreground">0 ₸</span>}</td>
                    <td className="px-4 py-3 text-right">
                      {row.spend > 0 ? (
                        <span className={cn(
                          "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-bold tabular-nums",
                          romiPositive ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive",
                        )}>
                          <RomiIcon className="h-3 w-3" />
                          {romiPositive ? "+" : ""}{Math.round(row.crmRomi)}%
                        </span>
                      ) : <span className="text-muted-foreground">—</span>}
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
