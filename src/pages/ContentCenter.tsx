import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, Banknote, ExternalLink, Eye,
  Instagram, LayoutGrid, Lightbulb, List, Loader2, MousePointerClick, MessageCircle, RefreshCw, Search,
  ShoppingCart, Stethoscope, Target, Trophy,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ContentPeriodPicker, type ContentPeriodPreset } from "@/components/content/ContentPeriodPicker";
import type { ReportPeriodRange } from "@/hooks/useReportData";
import { thisMonthRange } from "@/lib/metricsPeriod";
import { fmtKzt, fmtNum } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { useInstagramAccount } from "@/hooks/useInstagramAccount";
import { cn } from "@/lib/utils";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { SiteAnalyticsCard } from "@/components/content-center/SiteAnalyticsCard";

// Раздел «Контент-центр» — аналитика Instagram-автоворонки (cf_*), которая живёт
// в клиентском Supabase (szfgdruhlebfvcmlvxdk). Данные считает edge-функция
// content-center одним запросом (посты + KPI + воронка за период) СТРОГО по
// активному проекту: project_id передаётся вместе с JWT, а функция проверяет
// доступ пользователя к проекту. Без project_id раздел показывал бы контент
// чужих Instagram-аккаунтов (других проектов).

interface CCPost {
  ig_media_id: string;
  caption: string | null;
  permalink: string | null;
  media_type: string | null;
  thumbnail_url: string | null;
  posted_at: string | null;
  reach: number;
  views: number;
  codewords: string[];
  clicks: number;
  leads: number;
  diagnostics: number;
  sales: number;
  diagnostic_sum: number;
  sale_sum: number;
}
interface CCTotals {
  reach: number; views: number; clicks: number; leads: number;
  diagnostics: number; diagnostic_sum: number; sales: number; sale_sum: number; revenue: number;
}
interface CCFunnel { reach: number; clicks: number; leads: number; diagnostics: number; sales: number; }
interface CCResp { from: string; to: string; posts: CCPost[]; totals: CCTotals; funnel: CCFunnel; }

const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);
const fmtPct = (v: number) => `${v.toFixed(1)}%`;
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—";

async function fetchContentCenter(projectId: string, from: string, to: string): Promise<CCResp> {
  // supabase.functions.invoke сам подставляет Authorization (JWT пользователя)
  // и apikey — edge-функция по ним проверяет доступ к project_id.
  const { data: d, error } = await supabase.functions.invoke<CCResp>("content-center", {
    body: { project_id: projectId, from, to },
  });
  if (error) {
    let message = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") {
        const body = await ctx.json();
        if (body?.error) message = String(body.error);
      }
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  if (!d) throw new Error("content-center: пустой ответ");
  return {
    from: d.from, to: d.to,
    posts: Array.isArray(d.posts) ? d.posts : [],
    totals: d.totals ?? ({} as CCTotals),
    funnel: d.funnel ?? ({} as CCFunnel),
  };
}

type Derived = CCPost & {
  revenue: number; ctr: number; crLead: number; crDiag: number; crSale: number;
  avgCheck: number; e2e: number;
};
function enrich(p: CCPost): Derived {
  const revenue = (p.diagnostic_sum || 0) + (p.sale_sum || 0);
  const deals = (p.diagnostics || 0) + (p.sales || 0);
  return {
    ...p,
    revenue,
    ctr: pct(p.clicks, p.reach),
    crLead: pct(p.leads, p.clicks),
    crDiag: pct(p.diagnostics, p.leads),
    crSale: pct(p.sales, p.diagnostics),
    avgCheck: deals > 0 ? revenue / deals : 0,
    e2e: pct(p.sales, p.reach),
  };
}

type SortKey =
  | "posted_at" | "reach" | "clicks" | "leads" | "diagnostics"
  | "diagnostic_sum" | "sales" | "sale_sum" | "revenue" | "ctr";
type SortDir = "asc" | "desc";

function SortableTh({
  label, sortKey, current, dir, onSort, align = "right",
}: {
  label: string; sortKey: SortKey; current: SortKey; dir: SortDir;
  onSort: (k: SortKey) => void; align?: "left" | "right";
}) {
  const active = current === sortKey;
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className={cn("px-3 py-3 font-semibold select-none", align === "right" ? "text-right" : "text-left")}>
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

const FUNNEL_STEPS: {
  key: keyof CCFunnel;
  label: string;
  transition?: string;
  moneyKey?: keyof CCTotals;
}[] = [
  { key: "reach", label: "Охват" },
  { key: "clicks", label: "Клики", transition: "CTR" },
  { key: "leads", label: "Заявки", transition: "Из кликов" },
  { key: "diagnostics", label: "Диагностики", transition: "Из заявок", moneyKey: "diagnostic_sum" },
  { key: "sales", label: "Продажи", transition: "Из диагн.", moneyKey: "sale_sum" },
];

const FUNNEL_GRADIENTS = [
  "from-pink-500/50 to-pink-500/20",
  "from-indigo-500/45 to-indigo-500/15",
  "from-violet-500/45 to-violet-500/15",
  "from-amber-500/45 to-amber-500/15",
  "from-emerald-500/55 to-emerald-500/25",
];

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  emphasized,
  accent = "muted",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
  emphasized?: boolean;
  accent?: "pink" | "success" | "primary" | "muted";
}) {
  const iconCls =
    accent === "pink"
      ? "bg-pink-500/10 text-pink-500"
      : accent === "success"
        ? "bg-success/10 text-success"
        : accent === "primary"
          ? "bg-primary/10 text-primary"
          : "bg-secondary text-muted-foreground";

  return (
    <div
      className={cn(
        "rounded-2xl border border-border/60 bg-card/60 p-3.5 transition-colors",
        emphasized && accent === "success" && "border-success/40 bg-success/5",
        emphasized && accent === "pink" && "border-pink-500/30 bg-pink-500/5",
        emphasized && accent === "primary" && "border-primary/30 bg-primary/5",
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-lg", iconCls)}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      </div>
      <div className={cn("mt-2.5 text-xl font-bold tabular-nums leading-tight", emphasized && accent === "success" && "text-success")}>
        {value}
      </div>
      {sub && <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function KpiSkeleton() {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 p-3.5 animate-pulse">
      <div className="flex items-center gap-2">
        <div className="h-7 w-7 rounded-lg bg-secondary" />
        <div className="h-3 w-20 rounded bg-secondary" />
      </div>
      <div className="mt-3 h-7 w-24 rounded bg-secondary" />
    </div>
  );
}

function ContentFunnel({
  funnel,
  totals,
  rangeLabel,
  e2e,
}: {
  funnel: CCFunnel | undefined;
  totals: CCTotals | undefined;
  rangeLabel: string;
  e2e: number;
}) {
  const steps = FUNNEL_STEPS.map((s) => ({
    ...s,
    value: funnel?.[s.key] ?? 0,
    money: s.moneyKey && totals ? totals[s.moneyKey] : null,
  }));

  const max = Math.max(...steps.map((s) => s.value), 1);
  const convs = steps.map((s, i) =>
    i === 0 || steps[i - 1].value === 0 ? null : (s.value / steps[i - 1].value) * 100,
  );

  let worstIdx = -1;
  let worstVal = Infinity;
  convs.forEach((c, i) => {
    if (c !== null && c < worstVal && steps[i - 1].value > 5) {
      worstVal = c;
      worstIdx = i;
    }
  });

  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Instagram className="h-3.5 w-3.5 text-pink-500" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Воронка контента
          </span>
          <span className="rounded-full border border-border/60 bg-secondary/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {rangeLabel}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-[10px] font-bold text-success">
            <Target className="h-3 w-3" />
            Охват → продажа: {fmtPct(e2e)}
          </span>
          {worstIdx > 0 && (
            <span className="flex items-center gap-1.5 rounded-full border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-[10px] font-bold text-destructive">
              <AlertTriangle className="h-3 w-3" />
              Узкое место: {steps[worstIdx - 1].label} → {steps[worstIdx].label}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-2.5">
        {steps.map((s, i) => {
          const conv = convs[i];
          const isWorst = i === worstIdx;
          const widthPct = (s.value / max) * 100;
          return (
            <div
              key={s.key}
              className={cn(
                "group relative grid grid-cols-[100px_1fr_100px] items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors sm:grid-cols-[110px_1fr_120px]",
                isWorst
                  ? "border-destructive/50 bg-destructive/5"
                  : "border-border/50 bg-secondary/20 hover:border-border/80",
              )}
            >
              <div className="flex flex-col">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {s.label}
                </span>
                {conv !== null && (
                  <span
                    className={cn(
                      "mt-0.5 text-[11px] font-bold tabular-nums",
                      isWorst ? "text-destructive" : "text-success",
                    )}
                  >
                    {conv.toFixed(1)}%
                  </span>
                )}
                {s.transition && (
                  <span className="mt-0.5 text-[9px] uppercase tracking-wider text-muted-foreground/70">
                    {s.transition}
                  </span>
                )}
              </div>

              <div className="relative h-9 overflow-hidden rounded-lg border border-border/40 bg-background/40">
                <div
                  className={cn("h-full bg-gradient-to-r transition-all duration-500", FUNNEL_GRADIENTS[i])}
                  style={{ width: `${Math.max(widthPct, s.value > 0 ? 2 : 0)}%` }}
                />
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-base font-bold tabular-nums">
                  {fmtNum(s.value)}
                </span>
              </div>

              <div className="text-right">
                {s.money != null && s.money > 0 ? (
                  <span className="text-sm font-bold tabular-nums">{fmtKzt(s.money)}</span>
                ) : (
                  <span className="text-xs text-muted-foreground/60">—</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type Top5Mode = "reach" | "revenue" | "leads" | "clicks" | "crSale";
type ViewMode = "table" | "cards";
const TOP5_MODES: { key: Top5Mode; label: string }[] = [
  { key: "reach", label: "по охвату" },
  { key: "clicks", label: "по кликам" },
  { key: "leads", label: "по заявкам" },
  { key: "revenue", label: "по выручке" },
  { key: "crSale", label: "по конверсии в продажу" },
];

const ContentCenter = () => {
  const isMobile = useIsMobile();
  const { activeId: projectId, active } = useProjectsStore();
  const { sync } = useInstagramAccount();
  const [preset, setPreset] = useState<ContentPeriodPreset>("this_month");
  const [range, setRange] = useState<ReportPeriodRange>(() => thisMonthRange());
  const [data, setData] = useState<CCResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("posted_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [search, setSearch] = useState("");
  const [codeword, setCodeword] = useState<string>("all");
  const [top5Mode, setTop5Mode] = useState<Top5Mode>("reach");
  const [selectedPost, setSelectedPost] = useState<Derived | null>(null);
  const [viewModeOverride, setViewModeOverride] = useState<ViewMode | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const viewMode = viewModeOverride ?? (isMobile ? "cards" : "table");
  const openPost = (p: Derived) => setSelectedPost(p);

  const from = useMemo(() => ymd(range.from), [range.from]);
  const to = ymd(range.to);

  useEffect(() => {
    if (!projectId) {
      setData(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchContentCenter(projectId, from, to)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, from, to, refreshTick]);

  const onPresetChange = (next: ContentPeriodPreset, nextRange: ReportPeriodRange) => {
    setPreset(next);
    setRange(nextRange);
  };

  const refresh = async () => {
    setSyncing(true);
    try {
      await sync();
      setRefreshTick((t) => t + 1);
    } finally {
      setSyncing(false);
    }
  };

  const posts = useMemo(() => (data?.posts ?? []).map(enrich), [data]);
  const totals = data?.totals;
  const funnel = data?.funnel;

  const codewordOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of posts) for (const c of p.codewords ?? []) set.add(c);
    return Array.from(set).sort();
  }, [posts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let r = posts;
    if (codeword !== "all") r = r.filter((p) => (p.codewords ?? []).includes(codeword));
    if (q) r = r.filter((p) =>
      (p.caption ?? "").toLowerCase().includes(q) ||
      (p.codewords ?? []).some((c) => c.toLowerCase().includes(q)) ||
      p.ig_media_id.includes(q));
    const dir = sortDir === "asc" ? 1 : -1;
    const sorted = [...r].sort((a, b) => {
      if (sortKey === "posted_at") {
        const av = a.posted_at ? new Date(a.posted_at).getTime() : 0;
        const bv = b.posted_at ? new Date(b.posted_at).getTime() : 0;
        return (av - bv) * dir;
      }
      const av = (a as unknown as Record<string, number>)[sortKey] ?? 0;
      const bv = (b as unknown as Record<string, number>)[sortKey] ?? 0;
      return (av - bv) * dir;
    });
    return sorted;
  }, [posts, search, codeword, sortKey, sortDir]);

  const top5 = useMemo(() => {
    const key = top5Mode;
    const scored = [...posts]
      .filter((p) => (p[key] as number) > 0)
      .sort((a, b) => (b[key] as number) - (a[key] as number));
    if (scored.length > 0) return scored.slice(0, 5);
    // Fallback: show top reach when chosen metric has no conversions yet.
    return [...posts]
      .filter((p) => p.reach > 0)
      .sort((a, b) => b.reach - a.reach)
      .slice(0, 5);
  }, [posts, top5Mode]);

  const insights = useMemo(() => {
    if (!posts.length) return [];
    const items: { tone: "success" | "warning" | "default"; text: string }[] = [];

    const withReach = posts.filter((p) => p.reach > 0);
    if (withReach.length) {
      const bestCtr = [...withReach].sort((a, b) => b.ctr - a.ctr)[0];
      if (bestCtr.ctr > 0) {
        const snippet = (bestCtr.caption || bestCtr.codewords?.[0] || "пост").slice(0, 42);
        items.push({
          tone: "success",
          text: `Лучший CTR ${fmtPct(bestCtr.ctr)} — «${snippet}${snippet.length >= 42 ? "…" : ""}»`,
        });
      }
    }

    const deadPosts = posts.filter((p) => p.reach >= 5000 && p.leads === 0);
    if (deadPosts.length > 0) {
      items.push({
        tone: "warning",
        text: `${deadPosts.length} пост(ов) с охватом ≥5k без заявок — проверьте код-слово в подписи`,
      });
    }

    const bestRev = [...posts].filter((p) => p.revenue > 0).sort((a, b) => b.revenue - a.revenue)[0];
    if (bestRev) {
      items.push({
        tone: "default",
        text: `Лидер по выручке: ${fmtKzt(bestRev.revenue)} (${fmtDate(bestRev.posted_at)})`,
      });
    }

    return items.slice(0, 3);
  }, [posts]);

  const onSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir(k === "posted_at" ? "desc" : "desc"); }
  };

  const rangeLabel = useMemo(() => {
    const f = range.from.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
    const t = range.to.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
    return `${f} — ${t}`;
  }, [range]);

  const e2e = pct(funnel?.sales ?? 0, funnel?.reach ?? 0);

  const avgCheck =
    totals && totals.diagnostics + totals.sales > 0
      ? totals.revenue / (totals.diagnostics + totals.sales)
      : 0;

  const top5Value = (p: Derived) => {
    switch (top5Mode) {
      case "revenue": return fmtKzt(p.revenue);
      case "leads": return `${fmtNum(p.leads)} заявок`;
      case "clicks": return `${fmtNum(p.clicks)} кликов`;
      case "crSale": return fmtPct(p.crSale);
    }
  };

  const isEmptyPeriod = !loading && !error && posts.length === 0;

  return (
    <PageContainer wide>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link
          to="/analytics/content"
          className="rounded-xl border border-border/60 bg-card/50 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Контент-аналитика (охват и ER)
        </Link>
        <Link
          to="/marketing/content-center"
          className="rounded-xl border border-pink-500/40 bg-pink-500/10 px-3 py-1.5 text-xs font-semibold text-pink-500"
        >
          Контент-центр (заявки и выручка)
        </Link>
      </div>

      <PageHeader
        icon={Instagram}
        iconAccent="pink"
        title="Контент-центр"
        description={
          <span>
            Контент-центр отвечает за коммерцию контента: путь от охвата до продажи в деньгах (₸).
            {" "}
            Для анализа форматов, ER и охватов используйте{" "}
            <Link to="/analytics/content" className="text-primary hover:underline">
              Контент-аналитику
            </Link>
            .{" "}
            <span className="text-pink-500 font-medium">Instagram</span>
            {active?.name ? <> проекта «{active.name}»</> : null}
            {" · "}охват → код-слово → заявка → диагностика → продажа · {rangeLabel}
          </span>
        }
        actions={
          <>
            <ContentPeriodPicker
              preset={preset}
              range={range}
              showCompare={false}
              onPresetChange={onPresetChange}
            />
            <Button
              variant="outline"
              size="icon"
              className="h-10 w-10 rounded-xl border-border/60"
              aria-label="Синхронизировать Instagram и обновить"
              title="Синхронизировать Instagram и обновить"
              onClick={() => void refresh()}
              disabled={loading || syncing}
            >
              {loading || syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </>
        }
      />

      {error && (
        <div className="mt-6 rounded-2xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <>
      {isEmptyPeriod && (
        <div className="mt-6 rounded-2xl border border-pink-500/30 bg-pink-500/5 px-6 py-8 text-center">
          <Instagram className="mx-auto h-8 w-8 text-pink-500" />
          <h2 className="mt-3 text-lg font-semibold">Нет публикаций за период</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Подключите Instagram Business, синхронизируйте контент или расширьте диапазон дат.
          </p>
          <Button asChild variant="outline" className="mt-4 rounded-xl">
            <Link to="/analytics/content">Перейти в Контент-аналитику</Link>
          </Button>
        </div>
      )}

      {/* KPI — главные + детали */}
      {loading && !totals ? (
        <>
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => <KpiSkeleton key={`h-${i}`} />)}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <KpiSkeleton key={`s-${i}`} />)}
          </div>
        </>
      ) : totals ? (
        <>
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <KpiCard
              icon={Banknote}
              label="Выручка с контента"
              value={fmtKzt(totals.revenue)}
              sub={`${fmtNum(totals.sales)} продаж · ${fmtNum(totals.diagnostics)} диагн.`}
              emphasized
              accent="success"
            />
            <KpiCard
              icon={MessageCircle}
              label="Заявки"
              value={fmtNum(totals.leads)}
              sub={`из ${fmtNum(totals.clicks)} кликов`}
              emphasized
              accent="primary"
            />
            <KpiCard
              icon={Target}
              label="Конверсия в продажу"
              value={fmtPct(e2e)}
              sub="охват → продажа за период"
              emphasized
              accent="pink"
            />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiCard icon={Eye} label="Охват" value={fmtNum(totals.reach)} sub="уникальный reach" />
            <KpiCard icon={MousePointerClick} label="Клики" value={fmtNum(totals.clicks)} sub="без ботов" />
            <KpiCard
              icon={Stethoscope}
              label="Диагностики"
              value={fmtNum(totals.diagnostics)}
              sub={totals.diagnostic_sum > 0 ? fmtKzt(totals.diagnostic_sum) : "нет оплат"}
            />
            <KpiCard
              icon={ShoppingCart}
              label="Средний чек"
              value={avgCheck > 0 ? fmtKzt(avgCheck) : "—"}
              sub={totals.sales + totals.diagnostics > 0 ? "на сделку" : "нет сделок"}
            />
          </div>
        </>
      ) : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ContentFunnel funnel={funnel} totals={totals} rangeLabel={rangeLabel} e2e={e2e} />
        </div>
        {/* Top-5 */}
        <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-amber-500" />
            <h2 className="text-sm font-semibold">Топ-5 публикаций</h2>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {TOP5_MODES.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setTop5Mode(m.key)}
                className={cn(
                  "rounded-lg border px-2 py-1 text-[10px] font-medium transition",
                  top5Mode === m.key
                    ? "border-primary/60 bg-primary/10 text-primary"
                    : "border-border/60 bg-background hover:bg-secondary/40",
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="mt-3 space-y-2">
            {top5.length === 0 && (
              <div className="py-6 text-center text-xs text-muted-foreground">
                {loading ? "Загружаем…" : posts.length === 0 ? "Нет публикаций за период" : "Нет конверсий — покажите посты по охвату через период шире"}
              </div>
            )}
            {top5.map((p, idx) => (
              <div
                key={p.ig_media_id}
                role="button"
                tabIndex={0}
                onClick={() => openPost(p)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") openPost(p); }}
                className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-transparent px-2 py-1.5 transition hover:border-border/50 hover:bg-secondary/30"
              >
                <div
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                    idx === 0 && "bg-amber-500/15 text-amber-600 dark:text-amber-400",
                    idx === 1 && "bg-secondary text-muted-foreground",
                    idx === 2 && "bg-amber-700/10 text-amber-700/80 dark:text-amber-600/80",
                    idx > 2 && "text-muted-foreground",
                  )}
                >
                  {idx + 1}
                </div>
                <PostThumb src={p.thumbnail_url} size={44} />
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-1 text-xs font-medium">
                    {(p.codewords && p.codewords[0]) || p.caption || p.ig_media_id}
                  </div>
                  <div className="text-[10px] text-muted-foreground tabular-nums">
                    охват {fmtNum(p.reach)} · e2e {fmtPct(p.e2e)}
                  </div>
                </div>
                <div className="shrink-0 text-right text-xs font-bold tabular-nums">{top5Value(p)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по подписи или код-слову"
            className="h-10 rounded-xl border-border/60 pl-9"
          />
        </div>
        <Select value={codeword} onValueChange={setCodeword}>
          <SelectTrigger className="h-10 w-[180px] rounded-xl border-border/60 text-xs font-medium">
            <SelectValue placeholder="Код-слово" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все код-слова</SelectItem>
            {codewordOptions.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ViewModeToggle mode={viewMode} onChange={setViewModeOverride} />
      </div>

      <div className="mt-2 text-[11px] text-muted-foreground">
        Показано {filtered.length} публикаций
        <span className="mx-2 text-border">·</span>
        <Link to="/analytics/content" className="text-primary hover:underline">
          Настроить код-слова →
        </Link>
      </div>

      {insights.length > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {insights.map((ins) => (
            <div
              key={ins.text}
              className={cn(
                "flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs",
                ins.tone === "success" && "border-success/30 bg-success/5",
                ins.tone === "warning" && "border-warning/40 bg-warning/5",
                ins.tone === "default" && "border-border/60 bg-card/40",
              )}
            >
              <Lightbulb
                className={cn(
                  "mt-0.5 h-3.5 w-3.5 shrink-0",
                  ins.tone === "success" && "text-success",
                  ins.tone === "warning" && "text-warning",
                  ins.tone === "default" && "text-muted-foreground",
                )}
              />
              <span>{ins.text}</span>
            </div>
          ))}
        </div>
      )}

      {viewMode === "cards" ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.length === 0 && (
            <div className="col-span-full rounded-2xl border border-border/60 bg-card/60 px-4 py-12 text-center text-sm text-muted-foreground">
              {loading ? "Загружаем публикации…" : "Под фильтр ничего не попало. Смените период или снимите фильтры."}
            </div>
          )}
          {filtered.map((p) => (
            <PostCard key={p.ig_media_id} post={p} onOpen={() => openPost(p)} />
          ))}
        </div>
      ) : (
        <div className="mt-3 overflow-hidden rounded-2xl border border-border/60 bg-card/60">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] table-fixed text-sm">
            <colgroup>
              <col className="w-[42%]" />
              <col className="w-[12%]" />
              <col className="w-[26%]" />
              <col className="w-[10%]" />
              <col className="w-[10%]" />
            </colgroup>
            <thead className="bg-secondary/40 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-3 text-left font-semibold">Публикация</th>
                <SortableTh label="Охват" sortKey="reach" current={sortKey} dir={sortDir} onSort={onSort} />
                <SortableTh label="Воронка" sortKey="leads" current={sortKey} dir={sortDir} onSort={onSort} align="left" />
                <SortableTh label="CTR" sortKey="ctr" current={sortKey} dir={sortDir} onSort={onSort} />
                <SortableTh label="Выручка" sortKey="revenue" current={sortKey} dir={sortDir} onSort={onSort} />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    {loading ? "Загружаем публикации…" : "Под фильтр ничего не попало. Смените период или снимите фильтры."}
                  </td>
                </tr>
              )}
              {filtered.map((p) => (
                <tr
                  key={p.ig_media_id}
                  onClick={() => openPost(p)}
                  className="cursor-pointer border-t border-border/30 transition hover:bg-secondary/20"
                >
                  <td className="px-3 py-3 align-top">
                    <div className="mb-1 text-[10px] tabular-nums text-muted-foreground">{fmtDate(p.posted_at)}</div>
                    <div className="flex items-start gap-3">
                      <PostPreview post={p} stopClickPropagation />
                      <div className="min-w-0 flex-1">
                        <div className="line-clamp-2 text-xs font-medium leading-snug" title={p.caption ?? undefined}>
                          {p.caption || <span className="text-muted-foreground">Без подписи</span>}
                        </div>
                        {(p.codewords ?? []).length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {p.codewords.map((c) => (
                              <span
                                key={c}
                                className="rounded-full bg-pink-500/10 px-1.5 py-0.5 text-[10px] font-medium text-pink-600 dark:text-pink-400"
                              >
                                {c}
                              </span>
                            ))}
                          </div>
                        )}
                        {p.permalink && (
                          <a
                            href={p.permalink}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            Открыть пост <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums font-semibold align-top">{fmtNum(p.reach)}</td>
                  <td className="px-3 py-3 align-top">
                    <MiniFunnel post={p} />
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-muted-foreground align-top">
                    {p.reach > 0 ? fmtPct(p.ctr) : "—"}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums font-semibold align-top">
                    {p.revenue > 0 ? fmtKzt(p.revenue) : <span className="font-normal text-muted-foreground">0 ₸</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </div>
      )}

      <PostDetailSheet
        post={selectedPost}
        open={selectedPost !== null}
        onOpenChange={(open) => { if (!open) setSelectedPost(null); }}
      />

      <p className="mt-4 text-[11px] text-muted-foreground">
        Воронка в строке: клики → заявки → диагностики → продажи. Сортировка «Воронка» — по заявкам.
        {" "}Заявка — переписка в WhatsApp по код-слову. Суммы — в тенге.
      </p>
      </>
    </PageContainer>
  );
};

const POST_THUMB_PX = 56;

function MiniFunnel({ post }: { post: Derived }) {
  const steps: { v: number; label: string; tone?: "primary" | "success" }[] = [
    { v: post.clicks, label: "клики" },
    { v: post.leads, label: "заявки", tone: post.leads > 0 ? "primary" : undefined },
    { v: post.diagnostics, label: "диагн." },
    { v: post.sales, label: "продажи", tone: post.sales > 0 ? "success" : undefined },
  ];

  const allZero = steps.every((s) => s.v === 0);

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-x-1 text-xs tabular-nums">
        {allZero ? (
          <span className="text-muted-foreground">нет конверсий</span>
        ) : (
          steps.map((s, i) => (
            <span key={s.label} className="inline-flex items-center gap-1">
              {i > 0 && <span className="text-muted-foreground/35">→</span>}
              <span
                className={cn(
                  s.tone === "primary" && "font-semibold text-primary",
                  s.tone === "success" && "font-semibold text-success",
                  !s.tone && s.v > 0 && "font-medium text-foreground",
                  s.v === 0 && "text-muted-foreground",
                )}
              >
                {fmtNum(s.v)}
              </span>
            </span>
          ))
        )}
      </div>
      {(post.diagnostic_sum > 0 || post.sale_sum > 0) && (
        <div className="text-[10px] tabular-nums text-muted-foreground">
          {post.diagnostic_sum > 0 && <span>{fmtKzt(post.diagnostic_sum)}</span>}
          {post.diagnostic_sum > 0 && post.sale_sum > 0 && <span className="mx-1">·</span>}
          {post.sale_sum > 0 && <span className="text-success">{fmtKzt(post.sale_sum)}</span>}
        </div>
      )}
    </div>
  );
}

function PostThumb({ src, size }: { src: string | null; size: number }) {
  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden rounded-lg bg-secondary/50 ring-1 ring-border/40",
        size === POST_THUMB_PX ? "size-14" : size >= 44 ? "size-11" : "size-9",
      )}
      style={{ width: size, height: size, minWidth: size, minHeight: size }}
    >
      {src ? (
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          referrerPolicy="no-referrer"
          className="block h-full w-full object-cover"
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-muted-foreground">
          <Eye className={size >= POST_THUMB_PX ? "h-4 w-4" : "h-3.5 w-3.5"} />
        </span>
      )}
    </div>
  );
}

function PostPreview({ post, stopClickPropagation }: { post: CCPost; stopClickPropagation?: boolean }) {
  const src = post.thumbnail_url;

  return (
    <div className="shrink-0" onClick={stopClickPropagation ? (e) => e.stopPropagation() : undefined}>
      <HoverCard openDelay={120} closeDelay={80}>
        <HoverCardTrigger asChild>
          <button
            type="button"
            aria-label="Предпросмотр публикации"
            className="m-0 block cursor-zoom-in appearance-none border-0 bg-transparent p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
          >
            <PostThumb src={src} size={POST_THUMB_PX} />
          </button>
        </HoverCardTrigger>
      <HoverCardContent align="start" className="w-72 p-3">
        {src && (
          <img
            src={src}
            alt=""
            referrerPolicy="no-referrer"
            className="mb-2 max-h-64 w-full rounded-lg object-cover"
          />
        )}
        <div className="max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-foreground/90">
          {post.caption || "Без подписи"}
        </div>
        {post.permalink && (
          <a href={post.permalink} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
            Открыть в Instagram <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </HoverCardContent>
      </HoverCard>
    </div>
  );
}

function ViewModeToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  return (
    <div className="flex h-10 shrink-0 items-center rounded-xl border border-border/60 bg-background p-0.5">
      <button
        type="button"
        aria-label="Карточки"
        onClick={() => onChange("cards")}
        className={cn(
          "flex h-full items-center justify-center rounded-lg px-2.5 transition",
          mode === "cards" ? "bg-secondary text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
        )}
      >
        <LayoutGrid className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label="Таблица"
        onClick={() => onChange("table")}
        className={cn(
          "flex h-full items-center justify-center rounded-lg px-2.5 transition",
          mode === "table" ? "bg-secondary text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
        )}
      >
        <List className="h-4 w-4" />
      </button>
    </div>
  );
}

function PostCard({ post, onOpen }: { post: Derived; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="rounded-2xl border border-border/60 bg-card/60 text-left transition hover:border-border hover:bg-secondary/20"
    >
      <div className="flex gap-3 p-3">
        <PostThumb src={post.thumbnail_url} size={72} />
        <div className="min-w-0 flex-1">
          <div className="text-[10px] tabular-nums text-muted-foreground">{fmtDate(post.posted_at)}</div>
          <div className="mt-0.5 line-clamp-2 text-sm font-medium leading-snug">
            {post.caption || <span className="text-muted-foreground">Без подписи</span>}
          </div>
          {(post.codewords ?? []).length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {post.codewords.map((c) => (
                <span
                  key={c}
                  className="rounded-full bg-pink-500/10 px-1.5 py-0.5 text-[10px] font-medium text-pink-600 dark:text-pink-400"
                >
                  {c}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 border-t border-border/40 px-3 py-2.5 text-center text-[10px] uppercase tracking-wider text-muted-foreground">
        <div>
          <div className="text-[9px]">Охват</div>
          <div className="text-sm font-bold tabular-nums text-foreground">{fmtNum(post.reach)}</div>
        </div>
        <div>
          <div className="text-[9px]">Заявки</div>
          <div className={cn("text-sm font-bold tabular-nums", post.leads > 0 ? "text-primary" : "text-foreground")}>
            {fmtNum(post.leads)}
          </div>
        </div>
        <div>
          <div className="text-[9px]">Выручка</div>
          <div className={cn("text-sm font-bold tabular-nums", post.revenue > 0 ? "text-success" : "text-foreground")}>
            {post.revenue > 0 ? fmtKzt(post.revenue) : "0 ₸"}
          </div>
        </div>
      </div>
      <div className="border-t border-border/40 px-3 py-2">
        <MiniFunnel post={post} />
      </div>
    </button>
  );
}

const MEDIA_LABEL: Record<string, string> = {
  IMAGE: "Фото",
  VIDEO: "Видео",
  CAROUSEL_ALBUM: "Карусель",
  REELS: "Reels",
};

function PostDetailSheet({
  post,
  open,
  onOpenChange,
}: {
  post: Derived | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!post) return null;

  const funnelRows: {
    label: string;
    value: number;
    pct: number | null;
    pctLabel: string;
    money?: number;
  }[] = [
    { label: "Охват", value: post.reach, pct: null, pctLabel: "" },
    { label: "Клики", value: post.clicks, pct: post.ctr, pctLabel: "CTR" },
    { label: "Заявки", value: post.leads, pct: post.crLead, pctLabel: "из кликов" },
    { label: "Диагностики", value: post.diagnostics, pct: post.crDiag, pctLabel: "из заявок", money: post.diagnostic_sum },
    { label: "Продажи", value: post.sales, pct: post.crSale, pctLabel: "из диагн.", money: post.sale_sum },
  ];

  const max = Math.max(...funnelRows.map((r) => r.value), 1);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
        <SheetHeader className="sr-only">
          <SheetTitle>Публикация {fmtDate(post.posted_at)}</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {post.thumbnail_url && (
            <img
              src={post.thumbnail_url}
              alt=""
              referrerPolicy="no-referrer"
              className="aspect-square w-full object-cover"
            />
          )}

          <div className="space-y-4 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs tabular-nums text-muted-foreground">{fmtDate(post.posted_at)}</span>
              {post.media_type && (
                <span className="rounded-full bg-pink-500/10 px-2 py-0.5 text-[10px] font-semibold text-pink-600 dark:text-pink-400">
                  {MEDIA_LABEL[post.media_type] ?? post.media_type}
                </span>
              )}
              {post.reach > 0 && (
                <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium tabular-nums">
                  e2e {fmtPct(post.e2e)}
                </span>
              )}
            </div>

            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {post.caption || <span className="text-muted-foreground">Без подписи</span>}
            </p>

            {(post.codewords ?? []).length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {post.codewords.map((c) => (
                  <span
                    key={c}
                    className="rounded-full bg-pink-500/10 px-2 py-0.5 text-xs font-medium text-pink-600 dark:text-pink-400"
                  >
                    {c}
                  </span>
                ))}
              </div>
            )}

            {post.permalink && (
              <a
                href={post.permalink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                Открыть в Instagram <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}

            <div className="grid grid-cols-2 gap-2">
              <MetricCell label="Выручка" value={fmtKzt(post.revenue)} highlight={post.revenue > 0 ? "success" : undefined} />
              <MetricCell label="Средний чек" value={post.avgCheck > 0 ? fmtKzt(post.avgCheck) : "—"} />
              <MetricCell label="Охват" value={fmtNum(post.reach)} />
              <MetricCell label="Просмотры" value={fmtNum(post.views)} />
              <MetricCell label="CTR" value={post.reach > 0 ? fmtPct(post.ctr) : "—"} />
              <MetricCell label="Клики" value={fmtNum(post.clicks)} />
            </div>

            <div>
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Воронка публикации</h3>
              <div className="mt-2 space-y-2">
                {funnelRows.map((row, i) => (
                  <div key={row.label} className="rounded-xl border border-border/50 bg-secondary/20 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-muted-foreground">{row.label}</span>
                      <div className="flex items-center gap-2">
                        {row.pct != null && row.value > 0 && (
                          <span className="text-[10px] font-bold text-success tabular-nums">
                            {fmtPct(row.pct)} <span className="font-normal text-muted-foreground">{row.pctLabel}</span>
                          </span>
                        )}
                        <span className="text-sm font-bold tabular-nums">{fmtNum(row.value)}</span>
                      </div>
                    </div>
                    <div className="relative mt-1.5 h-2 overflow-hidden rounded-full bg-background/50">
                      <div
                        className={cn("h-full rounded-full bg-gradient-to-r", FUNNEL_GRADIENTS[i])}
                        style={{ width: `${Math.max((row.value / max) * 100, row.value > 0 ? 4 : 0)}%` }}
                      />
                    </div>
                    {row.money != null && row.money > 0 && (
                      <div className="mt-1 text-right text-xs font-semibold tabular-nums text-success">
                        {fmtKzt(row.money)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function MetricCell({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: "success" | "primary";
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-secondary/20 px-3 py-2">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-0.5 text-sm font-bold tabular-nums",
          highlight === "success" && "text-success",
          highlight === "primary" && "text-primary",
        )}
      >
        {value}
      </div>
    </div>
  );
}

export default ContentCenter;
