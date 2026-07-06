import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown, ArrowUp, ArrowUpDown, ExternalLink, Eye, Loader2, MousePointerClick,
  MessageCircle, RefreshCw, Search, Stethoscope, TrendingUp, Trophy,
} from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PeriodPicker, currentMonthRange } from "@/components/dashboard/PeriodPicker";
import type { ReportPeriodRange } from "@/hooks/useReportData";
import { fmtKzt, fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";

// Раздел «Контент-центр» — аналитика Instagram-автоворонки (cf_*), которая живёт
// в клиентском Supabase (szfgdruhlebfvcmlvxdk). Данные считает edge-функция
// content-center одним запросом (посты + KPI + воронка за период).
const CLIENT_URL = (import.meta.env.VITE_CLIENT_SUPABASE_URL as string | undefined) || "";

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

async function fetchContentCenter(from: string, to: string): Promise<CCResp> {
  if (!CLIENT_URL) throw new Error("VITE_CLIENT_SUPABASE_URL не задан — раздел недоступен");
  const r = await fetch(`${CLIENT_URL}/functions/v1/content-center`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from, to }),
  });
  if (!r.ok) throw new Error(`content-center: HTTP ${r.status}`);
  const d = (await r.json()) as CCResp;
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

const FUNNEL_STEPS: { key: keyof CCFunnel; label: string; Icon: typeof Eye; color: string }[] = [
  { key: "reach", label: "Охват", Icon: Eye, color: "bg-sky-500" },
  { key: "clicks", label: "Клики", Icon: MousePointerClick, color: "bg-indigo-500" },
  { key: "leads", label: "Заявки", Icon: MessageCircle, color: "bg-violet-500" },
  { key: "diagnostics", label: "Диагностики", Icon: Stethoscope, color: "bg-amber-500" },
  { key: "sales", label: "Продажи", Icon: Trophy, color: "bg-emerald-500" },
];

type Top5Mode = "revenue" | "leads" | "clicks" | "crSale";
const TOP5_MODES: { key: Top5Mode; label: string }[] = [
  { key: "revenue", label: "по выручке" },
  { key: "leads", label: "по заявкам" },
  { key: "clicks", label: "по кликам" },
  { key: "crSale", label: "по конверсии в продажу" },
];

const ContentCenter = () => {
  const [range, setRange] = useState<ReportPeriodRange>(() => currentMonthRange());
  const [data, setData] = useState<CCResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [search, setSearch] = useState("");
  const [codeword, setCodeword] = useState<string>("all");
  const [top5Mode, setTop5Mode] = useState<Top5Mode>("revenue");

  const from = ymd(range.from);
  const to = ymd(range.to);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchContentCenter(from, to)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [from, to]);

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
    return [...posts]
      .filter((p) => (p[key] as number) > 0)
      .sort((a, b) => (b[key] as number) - (a[key] as number))
      .slice(0, 5);
  }, [posts, top5Mode]);

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

  const kpis = totals
    ? [
        { label: "Общий охват", value: fmtNum(totals.reach) },
        { label: "Всего кликов", value: fmtNum(totals.clicks) },
        { label: "Всего заявок", value: fmtNum(totals.leads) },
        { label: "Диагностики", value: fmtNum(totals.diagnostics), sub: fmtKzt(totals.diagnostic_sum) },
        { label: "Продажи", value: fmtNum(totals.sales), sub: fmtKzt(totals.sale_sum) },
        { label: "Общая выручка", value: fmtKzt(totals.revenue), cls: "text-success" },
        {
          label: "Средний чек",
          value: fmtKzt(totals.diagnostics + totals.sales > 0 ? totals.revenue / (totals.diagnostics + totals.sales) : 0),
        },
      ]
    : [];

  const top5Value = (p: Derived) => {
    switch (top5Mode) {
      case "revenue": return fmtKzt(p.revenue);
      case "leads": return `${fmtNum(p.leads)} заявок`;
      case "clicks": return `${fmtNum(p.clicks)} кликов`;
      case "crSale": return fmtPct(p.crSale);
    }
  };

  return (
    <PageContainer wide>
      <PageHeader
        icon={TrendingUp}
        title="Контент-центр"
        description={`Охват → код-слово → клик → заявка → диагностика → продажа по каждой публикации · ${rangeLabel}`}
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

      {error && (
        <div className="mt-6 rounded-2xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* KPI cards */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-2xl border border-border/60 bg-card/60 p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{k.label}</div>
            <div className={cn("mt-1 whitespace-nowrap text-lg font-bold tabular-nums", k.cls)}>{k.value}</div>
            {k.sub && <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">{k.sub}</div>}
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {/* Funnel */}
        <div className="rounded-2xl border border-border/60 bg-card/60 p-4 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Воронка за период</h2>
            <div className="text-[11px] text-muted-foreground">
              Сквозная конверсия охват → продажа:{" "}
              <span className="font-bold text-success tabular-nums">{fmtPct(e2e)}</span>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {FUNNEL_STEPS.map((step, i) => {
              const value = funnel?.[step.key] ?? 0;
              const prev = i === 0 ? value : (funnel?.[FUNNEL_STEPS[i - 1].key] ?? 0);
              const width = funnel && funnel.reach > 0 ? Math.max((value / funnel.reach) * 100, value > 0 ? 6 : 2) : 2;
              const cr = i === 0 ? 100 : pct(value, prev);
              const Icon = step.Icon;
              return (
                <div key={step.key} className="flex items-center gap-3">
                  <div className="flex w-28 shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <Icon className="h-3.5 w-3.5" />
                    {step.label}
                  </div>
                  <div className="relative h-8 flex-1 overflow-hidden rounded-lg bg-secondary/40">
                    <div
                      className={cn("flex h-full items-center rounded-lg px-2 text-xs font-bold text-white transition-all", step.color)}
                      style={{ width: `${width}%` }}
                    >
                      <span className="tabular-nums drop-shadow">{fmtNum(value)}</span>
                    </div>
                  </div>
                  <div className="w-16 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                    {i === 0 ? "—" : fmtPct(cr)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Top-5 */}
        <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
          <div className="flex items-center justify-between">
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
                {loading ? "Загружаем…" : "Нет данных за период"}
              </div>
            )}
            {top5.map((p, idx) => (
              <div key={p.ig_media_id} className="flex items-center gap-2">
                <div className="w-4 shrink-0 text-center text-xs font-bold text-muted-foreground">{idx + 1}</div>
                <Thumb post={p} />
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-1 text-xs font-medium">
                    {(p.codewords && p.codewords[0]) || p.caption || p.ig_media_id}
                  </div>
                  <div className="text-[10px] text-muted-foreground tabular-nums">
                    охват → продажа {fmtPct(p.e2e)}
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
        <select
          value={codeword}
          onChange={(e) => setCodeword(e.target.value)}
          className="h-10 rounded-xl border border-border/60 bg-background px-2 text-xs font-medium"
        >
          <option value="all">Все код-слова</option>
          {codewordOptions.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      <div className="mt-2 text-[11px] text-muted-foreground">
        Показано {filtered.length} публикаций
      </div>

      {/* Table */}
      <div className="mt-3 overflow-hidden rounded-2xl border border-border/60 bg-card/60">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] table-fixed text-sm">
            <colgroup>
              <col className="w-[88px]" />
              <col className="w-[300px]" />
              <col className="w-[72px]" />
              <col className="w-[100px]" />
              <col className="w-[64px]" />
              <col className="w-[56px]" />
              <col className="w-[64px]" />
              <col className="w-[56px]" />
              <col className="w-[80px]" />
              <col className="w-[64px]" />
              <col className="w-[80px]" />
              <col className="w-[96px]" />
            </colgroup>
            <thead className="bg-secondary/40 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <SortableTh label="Дата" sortKey="posted_at" current={sortKey} dir={sortDir} onSort={onSort} align="left" />
                <th className="min-w-[280px] px-3 py-3 text-left font-semibold">Публикация</th>
                <SortableTh label="Охват" sortKey="reach" current={sortKey} dir={sortDir} onSort={onSort} />
                <th className="px-3 py-3 text-left font-semibold">Код-слова</th>
                <SortableTh label="Клики" sortKey="clicks" current={sortKey} dir={sortDir} onSort={onSort} />
                <SortableTh label="CTR" sortKey="ctr" current={sortKey} dir={sortDir} onSort={onSort} />
                <SortableTh label="Заявки" sortKey="leads" current={sortKey} dir={sortDir} onSort={onSort} />
                <SortableTh label="Диагн." sortKey="diagnostics" current={sortKey} dir={sortDir} onSort={onSort} />
                <SortableTh label="Σ диагн." sortKey="diagnostic_sum" current={sortKey} dir={sortDir} onSort={onSort} />
                <SortableTh label="Продажи" sortKey="sales" current={sortKey} dir={sortDir} onSort={onSort} />
                <SortableTh label="Σ продаж" sortKey="sale_sum" current={sortKey} dir={sortDir} onSort={onSort} />
                <SortableTh label="Выручка" sortKey="revenue" current={sortKey} dir={sortDir} onSort={onSort} />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    {loading ? "Загружаем публикации…" : "Под фильтр ничего не попало. Смените период или снимите фильтры."}
                  </td>
                </tr>
              )}
              {filtered.map((p) => (
                <tr key={p.ig_media_id} className="border-t border-border/30 transition hover:bg-secondary/20">
                  <td className="whitespace-nowrap px-3 py-3 text-left tabular-nums text-muted-foreground">{fmtDate(p.posted_at)}</td>
                  <td className="px-3 py-3 align-top">
                    <div className="flex items-start gap-3">
                      <PostPreview post={p} />
                      <div className="min-w-0 flex-1">
                        <div className="line-clamp-2 text-xs font-medium leading-snug" title={p.caption ?? undefined}>
                          {p.caption || <span className="text-muted-foreground">Без подписи</span>}
                        </div>
                        {p.permalink && (
                          <a
                            href={p.permalink}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            Открыть пост <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums font-semibold">{fmtNum(p.reach)}</td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(p.codewords ?? []).length === 0
                        ? <span className="text-muted-foreground">—</span>
                        : p.codewords.map((c) => (
                            <span key={c} className="rounded bg-secondary/60 px-1.5 py-0.5 text-[10px] font-medium">{c}</span>
                          ))}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{fmtNum(p.clicks)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">{p.reach > 0 ? fmtPct(p.ctr) : "—"}</td>
                  <td className={cn("px-3 py-3 text-right tabular-nums", p.leads > 0 ? "font-semibold text-primary" : "text-muted-foreground")}>{fmtNum(p.leads)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{fmtNum(p.diagnostics)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">{p.diagnostic_sum > 0 ? fmtKzt(p.diagnostic_sum) : "—"}</td>
                  <td className={cn("px-3 py-3 text-right tabular-nums", p.sales > 0 ? "font-semibold text-success" : "text-muted-foreground")}>{fmtNum(p.sales)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">{p.sale_sum > 0 ? fmtKzt(p.sale_sum) : "—"}</td>
                  <td className="px-3 py-3 text-right tabular-nums font-semibold">{p.revenue > 0 ? fmtKzt(p.revenue) : <span className="font-normal text-muted-foreground">0 ₸</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-4 text-[11px] text-muted-foreground">
        Заявка — человек начал переписку в WhatsApp (бот сматчил номер по код-слову). Диагностика — пришёл и прошёл
        (статус «диагностика проведена» / оплата типа diagnostic). Клики очищены от ботов. Все суммы — в тенге.
      </p>
    </PageContainer>
  );
};

const POST_THUMB_PX = 56;

function PostThumb({ src, size }: { src: string | null; size: number }) {
  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden rounded-lg bg-secondary/50 ring-1 ring-border/40",
        size === POST_THUMB_PX ? "size-14" : "size-9",
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

function PostPreview({ post }: { post: CCPost }) {
  const src = post.thumbnail_url;

  return (
    <div className="shrink-0">
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

function Thumb({ post }: { post: CCPost }) {
  return <PostThumb src={post.thumbnail_url} size={36} />;
}

export default ContentCenter;
