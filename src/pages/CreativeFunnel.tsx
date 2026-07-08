import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowDownRight, ArrowUp, ArrowUpDown, ArrowUpRight, Filter, ImageDown, Info, Loader2, RefreshCw, Search, Zap } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PeriodPicker, currentMonthRange } from "@/components/dashboard/PeriodPicker";
import { CreativePreview } from "@/components/creatives/CreativePreview";
import { CreativeDetailDrawer } from "@/components/creatives/CreativeDetailDrawer";
import { useMetaCreatives, type MetaCreativeRow } from "@/hooks/useMetaStructure";
import { META_STRUCTURE_QUERY_KEY } from "@/hooks/useMetaDashboard";
import { refreshMetaCreative } from "@/lib/metaCreativeRefresh";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { usePersonalCabinets } from "@/hooks/useCabinetsStore";
import { LEADS_LITE_QUERY_KEY, useLeadsLite } from "@/hooks/useLeadsLite";
import { supabase } from "@/integrations/supabase/client";
import { formatMetaSyncMessages, syncMetaFull } from "@/lib/metaSync";
import { supabaseProjectId } from "@/lib/supabaseConfig";
import type { ReportPeriodRange } from "@/hooks/useReportData";
import {
  buildAdToCabinetMap,
  computeProjectCrmTotals,
  dedupMetaCreatives,
  filterRowsByCabinet,
  metaLeadCount,
  sumCreativeTableTotals,
  type CreativeTableTotals,
} from "@/lib/creativeFunnelUtils";
import { fetchCdiRows } from "@/lib/cdiFetch";
import { cn } from "@/lib/utils";

const fmtNum = (n: number) => Math.round(n).toLocaleString("ru-RU");
const fmtTenge = (n: number) => `${Math.round(n).toLocaleString("ru-RU")}\u00a0₸`;

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
  const [cabinetId, setCabinetId] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("crmRevenue");
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
  const [refreshingPosters, setRefreshingPosters] = useState(false);
  const [posterProgress, setPosterProgress] = useState({ done: 0, total: 0 });
  const [syncingMeta, setSyncingMeta] = useState(false);
  const [cdiTotals, setCdiTotals] = useState<Pick<CreativeTableTotals, "spend" | "metaLeads">>({
    spend: 0,
    metaLeads: 0,
  });
  const [cdiTick, setCdiTick] = useState(0);
  const { activeId: projectId } = useProjectsStore();
  const { cabinets } = usePersonalCabinets();
  const queryClient = useQueryClient();

  const { rows: rawRows, loading } = useMetaCreatives(range);
  const { leads: allLeads } = useLeadsLite();

  const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const sinceYmd = ymd(range.from);
  const untilExclusive = ymd(new Date(range.to.getFullYear(), range.to.getMonth(), range.to.getDate() + 1));

  const adToCabinet = useMemo(() => buildAdToCabinetMap(rawRows), [rawRows]);
  const scopedRows = useMemo(
    () => dedupMetaCreatives(filterRowsByCabinet(rawRows, cabinetId)),
    [rawRows, cabinetId],
  );

  const crmTotals = useMemo(
    () => computeProjectCrmTotals(allLeads, range, projectId, cabinetId, adToCabinet),
    [allLeads, range, projectId, cabinetId, adToCabinet],
  );

  useEffect(() => {
    if (!projectId) { setOrphanLeads(0); return; }
    let cancelled = false;
    void (async () => {
      let q = supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId)
        .eq("is_personal", false)
        .is("meta_ad_id", null)
        .gte("created_at", sinceYmd)
        .lt("created_at", untilExclusive);
      if (cabinetId !== "all") q = q.eq("cabinet_id", cabinetId);
      const { count } = await q;
      if (!cancelled) setOrphanLeads(count ?? 0);
    })();
    return () => { cancelled = true; };
  }, [projectId, sinceYmd, untilExclusive, backfilling, cabinetId]);

  useEffect(() => {
    if (!projectId) {
      setCdiTotals({ spend: 0, metaLeads: 0 });
      return;
    }
    let cancelled = false;
    const cabinetIds =
      cabinetId !== "all" ? [cabinetId] : cabinets.map((c) => c.id).filter(Boolean);
    if (cabinetIds.length === 0) {
      setCdiTotals({ spend: 0, metaLeads: 0 });
      return;
    }
    void (async () => {
      const rows = await fetchCdiRows<{ spend: number | string; leads: number | string }>(
        "spend, leads",
        {
          cabinetIds,
          since: sinceYmd,
          until: ymd(range.to),
          projectId,
        },
      );
      if (cancelled) return;
      setCdiTotals({
        spend: rows.reduce((s, r) => s + (Number(r.spend) || 0), 0),
        metaLeads: rows.reduce((s, r) => s + (Number(r.leads) || 0), 0),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, sinceYmd, range.to, cabinetId, cabinets, cdiTick]);

  const refreshData = () => {
    void queryClient.invalidateQueries({ queryKey: [META_STRUCTURE_QUERY_KEY] });
    void queryClient.invalidateQueries({ queryKey: [LEADS_LITE_QUERY_KEY, projectId] });
  };

  const runMetaSync = async () => {
    setSyncingMeta(true);
    try {
      const result = await syncMetaFull({
        since: sinceYmd,
        until: ymd(range.to),
        insights_only: true,
        ...(cabinetId !== "all" ? { cabinet_id: cabinetId } : {}),
      });
      const messages = formatMetaSyncMessages(result);
      if (messages.success) toast.success(messages.success);
      if (messages.error) toast.error(messages.error);
      for (const w of messages.warnings) toast.warning(w);
      refreshData();
      setCdiTick((t) => t + 1);
    } finally {
      setSyncingMeta(false);
    }
  };

  const runBackfill = async () => {
    if (!projectId) return;
    setBackfilling(true);
    const since = `${range.from.getFullYear()}-${String(range.from.getMonth() + 1).padStart(2, "0")}-${String(range.from.getDate()).padStart(2, "0")}`;
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
      refreshData();
    } else {
      toast.message("Новых привязок не найдено", { description: "Лиды без меток нельзя привязать к креативу" });
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let r = scopedRows;
    if (status === "active") r = r.filter((x) => x.effectiveStatus === "ACTIVE");
    if (status === "paused") r = r.filter((x) => x.effectiveStatus && x.effectiveStatus !== "ACTIVE");
    if (type !== "all") r = r.filter((x) => x.creativeType === type);
    if (hasSpend) r = r.filter((x) => x.spend > 0);
    if (hasLeads) r = r.filter((x) => x.crmLeads > 0 || metaLeadCount(x) > 0);
    if (hasSales) r = r.filter((x) => x.crmSales > 0);
    if (q) r = r.filter((x) => x.name.toLowerCase().includes(q) || x.adId.includes(q));

    const sorted = [...r];
    const dir = sortDir === "asc" ? 1 : -1;
    sorted.sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name) * dir;
      if (sortKey === "leads") {
        return (metaLeadCount(b) - metaLeadCount(a)) * dir;
      }
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
  }, [scopedRows, sortKey, sortDir, search, status, type, hasSpend, hasLeads, hasSales]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage],
  );
  useEffect(() => { setPage(1); }, [search, status, type, hasSpend, hasLeads, hasSales, range.from, range.to, cabinetId]);

  const tableTotals = useMemo(() => sumCreativeTableTotals(filtered), [filtered]);
  const kpiTotals = useMemo(() => sumCreativeTableTotals(scopedRows), [scopedRows]);
  const displaySpend = kpiTotals.spend > 0 ? kpiTotals.spend : cdiTotals.spend;
  const displayMetaLeads = kpiTotals.metaLeads > 0 ? kpiTotals.metaLeads : cdiTotals.metaLeads;
  const spendFromCdi = kpiTotals.spend === 0 && cdiTotals.spend > 0;
  const totalsRomi = displaySpend > 0
    ? ((crmTotals.revenue - displaySpend) / displaySpend) * 100
    : 0;

  const refreshAllPosters = async () => {
    const adIds = Array.from(new Set(filtered.flatMap((r) => r.mergedAdIds ?? [r.adId]).filter(Boolean)));
    if (adIds.length === 0 || refreshingPosters) return;
    setRefreshingPosters(true);
    setPosterProgress({ done: 0, total: adIds.length });
    let ok = 0;
    await Promise.all(
      adIds.map(async (adId) => {
        const res = await refreshMetaCreative(adId, { force: true, refreshVideo: true }).catch(() => null);
        if (res?.ok) ok += 1;
        setPosterProgress((p) => ({ ...p, done: p.done + 1 }));
      }),
    );
    refreshData();
    setRefreshingPosters(false);
    if (ok > 0) {
      toast.success(`Обновлено превью: ${ok} из ${adIds.length}`);
    } else {
      toast.error("Свежих превью не получено", {
        description: "Проверьте META_ACCESS_TOKEN и логи функции meta-creative-refresh.",
      });
    }
  };

  const rangeLabel = useMemo(() => {
    const f = range.from.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
    const t = range.to.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
    return `${f} — ${t}`;
  }, [range]);

  const attributedCrmLeads = tableTotals.crmLeads;

  return (
    <PageContainer>
      <PageHeader
        icon={Filter}
        title="Воронка по креативам"
        description={`Лид Meta → Лид CRM → Квалификация → Продажа → Выручка по каждому креативу · ${rangeLabel}`}
        actions={
          <>
            <PeriodPicker range={range} onChange={setRange} />
            {cabinets.length > 1 && (
              <Select value={cabinetId} onValueChange={setCabinetId}>
                <SelectTrigger className="h-10 w-[180px] rounded-xl border-border/60">
                  <SelectValue placeholder="Кабинет" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все кабинеты</SelectItem>
                  {cabinets.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              variant="outline"
              className="h-10 rounded-xl border-border/60"
              onClick={() => void runMetaSync()}
              disabled={syncingMeta || loading}
              title="Подтянуть расходы и креативы из Meta за выбранный период"
            >
              {syncingMeta ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Meta…
                </>
              ) : (
                <>
                  <Zap className="mr-2 h-4 w-4" />
                  Синхронизация Meta
                </>
              )}
            </Button>
            <Button
              variant="outline"
              className="h-10 rounded-xl border-border/60"
              onClick={() => void refreshAllPosters()}
              disabled={refreshingPosters || loading || scopedRows.length === 0}
              title="Перетянуть свежие превью из Meta для всех креативов"
            >
              {refreshingPosters ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {posterProgress.done}/{posterProgress.total}
                </>
              ) : (
                <>
                  <ImageDown className="mr-2 h-4 w-4" />
                  Обновить превью
                </>
              )}
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-10 w-10 rounded-xl border-border/60"
              aria-label="Обновить"
              onClick={refreshData}
              disabled={loading}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </>
        }
      />

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {[
          {
            label: spendFromCdi ? "Расход (CDI)" : "Расход",
            value: fmtTenge(displaySpend),
          },
          { label: "Лиды Meta", value: fmtNum(displayMetaLeads) },
          { label: "Лиды CRM", value: fmtNum(crmTotals.leads) },
          { label: "Диагностики", value: fmtNum(crmTotals.diagnostics) },
          { label: "Продажи", value: fmtNum(crmTotals.sales) },
          { label: "Выручка", value: fmtTenge(crmTotals.revenue) },
          {
            label: "ROMI",
            value: displaySpend > 0 ? `${totalsRomi >= 0 ? "+" : ""}${Math.round(totalsRomi)}%` : "—",
            cls: displaySpend > 0 ? (totalsRomi >= 0 ? "text-success" : "text-destructive") : "",
          },
        ].map((k) => (
          <div key={k.label} className="rounded-2xl border border-border/60 bg-card/60 p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{k.label}</div>
            <div className={cn("mt-1 whitespace-nowrap text-lg font-bold tabular-nums", k.cls)}>{k.value}</div>
          </div>
        ))}
      </div>

      <div className="mt-2 text-[11px] text-muted-foreground">
        По креативам в таблице: CRM-лиды {fmtNum(attributedCrmLeads)}
        {orphanLeads > 0 ? ` · без креатива ${fmtNum(orphanLeads)}` : ""}
        {cabinetId !== "all" ? " · выбран один кабинет" : ""}
        {" · "}
        БД <code className="text-[10px]">{supabaseProjectId}</code>
      </div>

      {!loading && scopedRows.length > 0 && kpiTotals.spend === 0 && spendFromCdi && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          <p>
            <span className="font-medium">Расход по креативам в таблице — 0 ₸</span>
            <span className="text-muted-foreground">
              {" "}
              — нет строк в <code className="text-xs">meta_creative_daily</code> за период.
              В шапке показан суммарный расход из таблицы показателей (CDI): {fmtTenge(cdiTotals.spend)}.
              Нажмите «Синхронизация Meta», чтобы разнести по креативам.
            </span>
          </p>
          <Button size="sm" className="rounded-xl" onClick={() => void runMetaSync()} disabled={syncingMeta}>
            {syncingMeta ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}
            Синхронизация Meta
          </Button>
        </div>
      )}

      {!loading && scopedRows.length > 0 && kpiTotals.spend === 0 && !spendFromCdi && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
          <p>
            <span className="font-medium">Расход 0 ₸</span>
            <span className="text-muted-foreground">
              {" "}
              — в таблице <code className="text-xs">meta_creative_daily</code> нет данных за период.
              Превью Lovable может показывать другую базу, пока не завершена миграция на szfg.
            </span>
          </p>
          <Button size="sm" className="rounded-xl" onClick={() => void runMetaSync()} disabled={syncingMeta}>
            {syncingMeta ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}
            Синхронизация Meta
          </Button>
        </div>
      )}

      {orphanLeads > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warning/40 bg-warning/5 px-4 py-3">
          <div className="text-sm">
            <span className="font-semibold">{orphanLeads} лидов</span>
            <span className="text-muted-foreground"> без привязки к креативу за период</span>
          </div>
          <Button
            size="sm"
            className="rounded-xl"
            disabled={backfilling}
            onClick={() => void runBackfill()}
          >
            {backfilling ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Привязать существующие лиды
          </Button>
        </div>
      )}

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
        Показано {filtered.length} из {scopedRows.length} креативов (после объединения дублей)
      </div>

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
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">—</td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold">{fmtNum(orphanLeads)}</td>
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
                const metaLeads = metaLeadCount(row);
                const mergedCount = row.mergedAdIds?.length ?? 1;
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
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                            <code className="rounded bg-secondary/60 px-1 tabular-nums">{row.adId}</code>
                            {mergedCount > 1 && (
                              <span className="rounded bg-primary/10 px-1 font-semibold text-primary">
                                +{mergedCount - 1} объявл.
                              </span>
                            )}
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
                    <td className="px-4 py-3 text-right tabular-nums font-semibold">{fmtNum(metaLeads)}</td>
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

      {totalPages > 1 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-[11px] text-muted-foreground">
            Стр. {safePage} из {totalPages} · показано {paged.length} из {filtered.length}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-8 rounded-lg"
              onClick={() => setPage(Math.max(1, safePage - 1))}
              disabled={safePage <= 1}
            >
              ←
            </Button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === totalPages || Math.abs(p - safePage) <= 2)
              .reduce<(number | "...")[]>((acc, p) => {
                const last = acc[acc.length - 1];
                if (last !== "..." && typeof last === "number" && p - last > 1) acc.push("...");
                acc.push(p);
                return acc;
              }, [])
              .map((p, i) =>
                p === "..." ? (
                  <span key={`gap-${i}`} className="px-1 text-xs text-muted-foreground">…</span>
                ) : (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPage(p)}
                    className={cn(
                      "h-8 min-w-[32px] rounded-lg border px-2 text-xs font-medium tabular-nums transition",
                      p === safePage
                        ? "border-primary/60 bg-primary/10 text-primary"
                        : "border-border/60 bg-background hover:bg-secondary/40",
                    )}
                  >
                    {p}
                  </button>
                ),
              )}
            <Button
              variant="outline"
              size="sm"
              className="h-8 rounded-lg"
              onClick={() => setPage(Math.min(totalPages, safePage + 1))}
              disabled={safePage >= totalPages}
            >
              →
            </Button>
          </div>
        </div>
      )}

      <p className="mt-4 text-[11px] text-muted-foreground">
        Атрибуция: WhatsApp — через Meta CTWA (в «Лиды Meta» показываем messages, если они больше leads);
        сайт — через UTM с <code className="rounded bg-secondary/60 px-1">utm_content=&#123;&#123;ad.id&#125;&#125;</code>.
        Клик по строке откроет воронку по всем объявлениям этого креатива.
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
