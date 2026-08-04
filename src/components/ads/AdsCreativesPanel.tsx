import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle, CheckCircle2, Coins, Crown, Film, Filter, Info,
  LayoutGrid, List, Loader2, RefreshCw, Search, Sparkles, Target, Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { CreativeCard } from "./CreativeCard";
import { CreativeDetailDrawer } from "@/components/creatives/CreativeDetailDrawer";
import {
  classifyGoal,
  useMetaCampaigns,
  useMetaCreatives,
  type MetaCampaignRow,
} from "@/hooks/useMetaStructure";
import { META_STRUCTURE_QUERY_KEY } from "@/hooks/useMetaDashboard";
import { buildCreativesSummary } from "@/lib/creativesOverview";
import { pickCreativeTitle } from "@/lib/creativeDisplay";
import { formatMetaSyncMessages, syncMetaFull } from "@/lib/metaSync";
import { fetchCdiRows } from "@/lib/cdiFetch";
import { useCabinetsStore } from "@/hooks/useCabinetsStore";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import type { ReportPeriodRange } from "@/hooks/useReportData";
import { useIsMobile } from "@/hooks/use-mobile";

type StatusFilter = "active" | "active_or_spent" | "all";
type TypeFilter = "all" | "video" | "image" | "carousel";
type SortKey = "spend" | "ctr" | "cpl" | "leads" | "messages" | "romi" | "crmLeads" | "crmSales" | "crmRevenue" | "crmRomi" | "crmCpl";

const SORT_LABELS: Record<SortKey, string> = {
  spend: "Расход",
  cpl: "CPL Meta",
  ctr: "CTR",
  leads: "Заявки Meta",
  messages: "Сообщения",
  crmLeads: "Лиды CRM",
  crmCpl: "CPL CRM",
  crmRevenue: "Выручка CRM",
  crmSales: "Продажи CRM",
  crmRomi: "ROMI (CRM)",
  romi: "ROMI Meta",
};

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "active_or_spent", label: "Рабочие" },
  { id: "active", label: "Активные" },
  { id: "all", label: "Все" },
];

const fmtTenge = (n: number) =>
  `${Math.round(n).toLocaleString("ru-RU").replace(/\s/g, "\u00A0")}\u00A0₸`;

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function classifyCampaignWa(camp: MetaCampaignRow | undefined): { isWhatsApp: boolean; goalLabel: string | null } {
  if (!camp) return { isWhatsApp: false, goalLabel: null };
  const goal = classifyGoal(camp.objective, camp.destinationType);
  return { isWhatsApp: goal.key === "whatsapp", goalLabel: goal.label };
}

export function AdsCreativesPanel({ range }: { range: ReportPeriodRange }) {
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const { activeId: projectId } = useProjectsStore();
  const [status, setStatus] = useState<StatusFilter>("active_or_spent");
  const [typeF, setTypeF] = useState<TypeFilter>("all");
  const [goalF, setGoalF] = useState<"all" | "whatsapp" | "site">("all");
  const [sort, setSort] = useState<SortKey>("spend");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [cabinetFilter, setCabinetFilter] = useState<string>("all");
  const [visibleCount, setVisibleCount] = useState(48);
  const [cdiSpend, setCdiSpend] = useState(0);
  const [cdiTick, setCdiTick] = useState(0);
  const [viewMode, setViewMode] = useState<"grid" | "list">(() =>
    typeof window !== "undefined" && window.innerWidth < 768 ? "list" : "grid",
  );
  const PAGE_SIZE = 48;
  const [searchParams, setSearchParams] = useSearchParams();
  const focusAdId = searchParams.get("ad");
  const focusQuery = searchParams.get("q");

  const { rows: creatives, loading } = useMetaCreatives(range);
  const { rows: campaigns } = useMetaCampaigns(range);
  const { cabinets } = useCabinetsStore();

  // Deep-link from campaigns tab: ?q=<campaign name> pre-fills search.
  useEffect(() => {
    if (!focusQuery) return;
    setQuery(focusQuery);
    setSearchParams((sp) => {
      sp.delete("q");
      return sp;
    }, { replace: true });
  }, [focusQuery, setSearchParams]);

  // Deep-link: ?ad=<meta ad_id> opens the matching creative drawer once loaded.
  useEffect(() => {
    if (!focusAdId || creatives.length === 0) return;
    const match = creatives.find((c) => c.adId === focusAdId);
    if (match && openId !== match.id) {
      setOpenId(match.id);
      // Clear the param so re-opening the page doesn't trap user in the drawer.
      setSearchParams((sp) => { sp.delete("ad"); return sp; }, { replace: true });
    }
  }, [focusAdId, creatives, openId, setSearchParams]);

  useEffect(() => {
    if (!projectId) {
      setCdiSpend(0);
      return;
    }
    const cabinetIds =
      cabinetFilter !== "all"
        ? [cabinetFilter]
        : cabinets.map((c) => c.id).filter(Boolean);
    if (cabinetIds.length === 0) {
      setCdiSpend(0);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const rows = await fetchCdiRows<{ spend: number | string }>("spend", {
          cabinetIds,
          since: ymd(range.from),
          until: ymd(range.to),
          projectId,
        });
        if (!cancelled) {
          setCdiSpend(rows.reduce((s, r) => s + (Number(r.spend) || 0), 0));
        }
      } catch {
        if (!cancelled) setCdiSpend(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, cabinets, cabinetFilter, range.from, range.to, cdiTick]);

  const campaignById = useMemo(() => {
    const m = new Map<string, MetaCampaignRow>();
    for (const c of campaigns) m.set(c.campaignId, c);
    return m;
  }, [campaigns]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return creatives
      .map((row) => {
        const camp = row.campaignId ? campaignById.get(row.campaignId) : undefined;
        const meta = classifyCampaignWa(camp);
        return { row, campaign: camp, ...meta };
      })
      .filter(({ row, campaign, isWhatsApp }) => {
        if (typeF !== "all" && row.creativeType !== typeF) return false;
        const eff = (row.effectiveStatus ?? "").toUpperCase();
        if (status === "active" && eff !== "ACTIVE") return false;
        if (status === "active_or_spent" && eff !== "ACTIVE" && row.spend <= 0) return false;
        if (cabinetFilter !== "all" && row.cabinetId !== cabinetFilter) return false;
        if (goalF === "whatsapp" && !isWhatsApp) return false;
        if (goalF === "site" && isWhatsApp) return false;
        if (q) {
          const hay = `${row.name} ${row.headline ?? ""} ${row.primaryText ?? ""} ${row.adId} ${campaign?.name ?? ""} ${campaign?.campaignId ?? ""}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sort === "cpl" || sort === "crmCpl") {
          const av = (a.row[sort] as number) > 0 ? (a.row[sort] as number) : Number.POSITIVE_INFINITY;
          const bv = (b.row[sort] as number) > 0 ? (b.row[sort] as number) : Number.POSITIVE_INFINITY;
          return av - bv;
        }
        return ((b.row[sort] as number) ?? 0) - ((a.row[sort] as number) ?? 0);
      });
  }, [creatives, campaignById, typeF, status, goalF, query, sort, cabinetFilter]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [query, typeF, status, goalF, sort, cabinetFilter, range.from, range.to]);

  const visible = useMemo(
    () => filtered.slice(0, visibleCount),
    [filtered, visibleCount],
  );

  const summary = useMemo(
    () => buildCreativesSummary(filtered.map((f) => f.row)),
    [filtered],
  );
  const bestTitle = summary.best
    ? pickCreativeTitle({ name: summary.best.name, headline: summary.best.headline }).title
    : null;
  const spendMissing = !loading && creatives.length > 0 && summary.spend === 0;
  const spendFromCdi = spendMissing && cdiSpend > 0;

  const openCreative = useMemo(
    () => (openId ? filtered.find((f) => f.row.id === openId) ?? null : null),
    [filtered, openId],
  );

  // Close opened card if it's no longer in the filtered list
  useEffect(() => {
    if (openId && !filtered.some((f) => f.row.id === openId)) setOpenId(null);
  }, [filtered, openId]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await syncMetaFull({
        since: ymd(range.from),
        until: ymd(range.to),
        insights_only: true,
        ...(cabinetFilter !== "all" ? { cabinet_id: cabinetFilter } : {}),
      });
      const messages = formatMetaSyncMessages(result);
      if (messages.success) toast.success(messages.success);
      if (messages.error) toast.error(messages.error);
      for (const w of messages.warnings) toast.warning(w);
      await queryClient.invalidateQueries({ queryKey: [META_STRUCTURE_QUERY_KEY, projectId] });
      setCdiTick((t) => t + 1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось синхронизировать");
    } finally {
      setSyncing(false);
    }
  };

  const filterSelectClass =
    "h-11 shrink-0 rounded-xl border border-border/60 bg-background px-3 text-sm font-medium sm:h-9 sm:rounded-lg sm:px-2 sm:text-xs";

  return (
    <div className="space-y-4">
      {/* Overview */}
      <section className="rounded-2xl border border-border/60 bg-card/50 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <Film className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold">Креативы за период</h2>
              <p className="text-xs text-muted-foreground">
                На каждой карточке — расход, заявки, CPL и CTR из Meta за выбранный период. Нажмите карточку, чтобы открыть воронку.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 rounded-xl"
            disabled={syncing}
            onClick={() => void handleSync()}
          >
            {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Обновить из Meta
          </Button>
        </div>

        {spendMissing && (
          <div
            className={cn(
              "mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-xs",
              spendFromCdi
                ? "border-amber-500/40 bg-amber-500/10 text-foreground"
                : "border-primary/30 bg-primary/5 text-muted-foreground",
            )}
          >
            <p>
              <span className="font-semibold text-foreground">
                {spendFromCdi
                  ? `В кабинете есть расход (${fmtTenge(cdiSpend)}), а по креативам — 0 ₸.`
                  : "По креативам нет расхода за период."}
              </span>{" "}
              Подтяните дневную статистику объявлений из Meta — после синхронизации на карточках появятся расход, лиды, CPL и CTR.
            </p>
            <Button
              type="button"
              size="sm"
              className="h-8 shrink-0 rounded-lg"
              disabled={syncing}
              onClick={() => void handleSync()}
            >
              {syncing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
              Синхронизировать
            </Button>
          </div>
        )}

        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard
            icon={Wallet}
            label="Расход за период"
            value={summary.spend > 0 ? fmtTenge(summary.spend) : spendFromCdi ? fmtTenge(cdiSpend) : "—"}
            hint={
              summary.spend > 0
                ? `${summary.active} активных из ${summary.total}`
                : spendFromCdi
                  ? "Сумма из таблицы кабинетов — синхронизируйте креативы"
                  : `${summary.active} активных из ${summary.total}`
            }
          />
          <SummaryCard
            icon={Target}
            label="Заявки и сообщения"
            value={summary.results > 0 ? summary.results.toLocaleString("ru-RU") : "—"}
            hint="По данным Meta за период"
          />
          <SummaryCard
            icon={Coins}
            label="Выручка CRM"
            value={summary.hasCrm ? fmtTenge(summary.crmRevenue) : "—"}
            hint={summary.hasCrm ? `${summary.crmSales} продаж` : "Нужны оплаты в CRM"}
          />
          <SummaryCard
            icon={summary.hasCrm && summary.crmProfit >= 0 ? CheckCircle2 : AlertCircle}
            label="Прибыль · ROMI CRM"
            value={summary.hasCrm ? fmtTenge(summary.crmProfit) : "—"}
            hint={summary.hasCrm && summary.spend > 0
              ? `ROMI ${Math.round(((summary.crmRevenue - summary.spend) / summary.spend) * 100)}%`
              : "Появится после продаж"}
            tone={summary.hasCrm ? (summary.crmProfit >= 0 ? "success" : "danger") : undefined}
          />
        </div>

        {summary.best && (
          <button
            type="button"
            onClick={() => setOpenId(summary.best!.id)}
            className="mt-3 flex w-full items-center gap-3 rounded-xl border border-success/30 bg-success/5 px-3 py-2.5 text-left transition hover:bg-success/10"
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-success/15 text-success">
              <Crown className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-success">
                Лучший креатив по ROMI CRM
              </span>
              <span className="block truncate text-sm font-semibold">{bestTitle}</span>
            </span>
            <span className="shrink-0 text-sm font-bold tabular-nums text-success">
              +{Math.round(summary.best.crmRomi)}%
            </span>
          </button>
        )}

        {!summary.hasCrm && summary.spend > 0 && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <p>
              Расход за период есть, а выручки из CRM пока нет: либо оплаты по этим креативам ещё не прошли,
              либо лиды не привязаны к объявлениям. Как только в CRM появятся продажи, здесь появится ROMI по каждому креативу.
            </p>
          </div>
        )}
      </section>

      {/* Toolbar */}
      <section className="space-y-3 rounded-2xl border border-border/60 bg-card/40 p-3">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск: название, текст, кампания, ID"
              className="h-11 rounded-xl border-border/60 bg-background pl-10 text-sm sm:h-10"
            />
          </div>
          <div className="flex shrink-0 rounded-xl border border-border/60 bg-background p-0.5">
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              className={cn(
                "grid h-10 w-10 place-items-center rounded-lg transition sm:h-9 sm:w-9",
                viewMode === "grid" ? "bg-secondary text-foreground" : "text-muted-foreground",
              )}
              aria-label="Сетка"
              aria-pressed={viewMode === "grid"}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={cn(
                "grid h-10 w-10 place-items-center rounded-lg transition sm:h-9 sm:w-9",
                viewMode === "list" ? "bg-secondary text-foreground" : "text-muted-foreground",
              )}
              aria-label="Список"
              aria-pressed={viewMode === "list"}
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1 scrollbar-none touch-pan-x">
          <div className="flex shrink-0 gap-1.5">
            {STATUS_FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setStatus(item.id)}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition",
                  status === item.id
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border/60 text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
          <select value={typeF} onChange={(e) => setTypeF(e.target.value as TypeFilter)} className={filterSelectClass}>
            <option value="all">Все типы</option>
            <option value="video">Видео</option>
            <option value="image">Фото</option>
            <option value="carousel">Карусель</option>
          </select>
          <select value={goalF} onChange={(e) => setGoalF(e.target.value as typeof goalF)} className={filterSelectClass}>
            <option value="all">Все цели</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="site">Сайт</option>
          </select>
          {cabinets.length > 1 && (
            <select
              value={cabinetFilter}
              onChange={(e) => setCabinetFilter(e.target.value)}
              className={cn(filterSelectClass, "max-w-[200px]")}
            >
              <option value="all">Все кабинеты</option>
              {cabinets.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className={filterSelectClass}>
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <option key={k} value={k}>Сортировка: {SORT_LABELS[k]}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Filter className="h-3.5 w-3.5" />
            Показано: <span className="font-bold text-foreground">{filtered.length}</span> из {creatives.length}
          </span>
          {loading && (
            <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> загрузка</span>
          )}
          {isMobile && <span>На телефоне удобнее режим «Список».</span>}
        </div>
      </section>

      {/* Empty state */}
      {filtered.length === 0 && !loading && (
        <div className="rounded-2xl border border-dashed border-border/60 bg-card/30 p-12 text-center">
          <Sparkles className="mx-auto h-7 w-7 text-muted-foreground/60" />
          <h3 className="mt-3 text-base font-semibold">Креативов не найдено</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {creatives.length === 0
              ? "Нажмите «Обновить из Meta», чтобы подтянуть объявления из подключённых кабинетов."
              : "Измените фильтры, поисковый запрос или период."}
          </p>
          {creatives.length === 0 && (
            <Button
              type="button"
              variant="outline"
              className="mt-4 gap-1.5"
              disabled={syncing}
              onClick={() => void handleSync()}
            >
              {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Обновить из Meta
            </Button>
          )}
        </div>
      )}

      {/* Grid */}
      {filtered.length > 0 && viewMode === "grid" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map(({ row, isWhatsApp }) => (
            <CreativeCard
              key={row.id}
              row={row}
              isWhatsApp={isWhatsApp}
              active={openId === row.id}
              layout="grid"
              onOpen={() => setOpenId(row.id)}
            />
          ))}
        </div>
      )}

      {filtered.length > 0 && viewMode === "list" && (
        <div className="flex flex-col gap-3">
          {visible.map(({ row, isWhatsApp }) => (
            <CreativeCard
              key={row.id}
              row={row}
              isWhatsApp={isWhatsApp}
              active={openId === row.id}
              layout="list"
              onOpen={() => setOpenId(row.id)}
            />
          ))}
        </div>
      )}

      {filtered.length > visible.length && (
        <div className="flex justify-center pt-2">
          <Button
            variant="outline"
            size="sm"
            className="h-11 w-full rounded-xl sm:h-9 sm:w-auto"
            onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
          >
            Показать ещё ({filtered.length - visible.length})
          </Button>
        </div>
      )}

      {/* Drawer for selected creative */}
      <CreativeDetailDrawer
        row={openCreative?.row ?? null}
        range={range}
        open={!!openId}
        onOpenChange={(v) => { if (!v) setOpenId(null); }}
        campaignName={openCreative?.campaign?.name ?? null}
        isWhatsApp={openCreative?.isWhatsApp ?? false}
      />
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  hint: string;
  tone?: "success" | "danger";
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border/50 bg-background/50 px-3 py-3",
        tone === "success" && "border-success/30 bg-success/5",
        tone === "danger" && "border-destructive/30 bg-destructive/5",
      )}
    >
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div
        className={cn(
          "mt-1 text-lg font-bold tabular-nums",
          tone === "success" && "text-success",
          tone === "danger" && "text-destructive",
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>
    </div>
  );
}
