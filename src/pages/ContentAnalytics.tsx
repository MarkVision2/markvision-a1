import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
} from "recharts";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BarChart3,
  Eye,
  ExternalLink,
  Factory,
  Film,
  Heart,
  Images,
  ImageIcon,
  Loader2,
  MoveRight,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Trophy,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ContentPeriodPicker, type ContentPeriodPreset } from "@/components/content/ContentPeriodPicker";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { InstagramAccountConnect } from "@/components/settings/InstagramAccountConnect";
import { useInstagramAccount } from "@/hooks/useInstagramAccount";
import { useInstagramAnalytics } from "@/hooks/useInstagramAnalytics";
import { useProjectsStore } from "@/hooks/useProjectsStore";
import { buildContentAnalyticsFromIg, type ContentAnalyticsPost } from "@/lib/contentAnalyticsFromIg";
import { fmtNum } from "@/lib/format";
import {
  formatPeriodLabel,
  previousEqualRange,
  thisMonthRange,
  ymdLocal,
} from "@/lib/metricsPeriod";
import { cn } from "@/lib/utils";
import { ContentPerformanceChart } from "@/pages/content-analytics/ContentPerformanceChart";
import type { ReportPeriodRange } from "@/hooks/useReportData";

const FORMAT: Record<string, { label: string; color: string; icon: LucideIcon }> = {
  CAROUSEL_ALBUM: { label: "Карусель", color: "#6366f1", icon: Images },
  IMAGE: { label: "Фото", color: "#f59e0b", icon: ImageIcon },
  VIDEO: { label: "Reels", color: "#ec4899", icon: Film },
};
const fmtOf = (t: string) => FORMAT[t] ?? { label: t, color: "hsl(var(--muted-foreground))", icon: ImageIcon };
const CONTENT_CUTOFF = "2026-07-20";

const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString("ru-RU", { day: "2-digit", month: "short" }) : "—";

function Delta({ cur, prev, suffix }: { cur: number; prev: number; suffix?: string }) {
  if (!prev) return null;
  const diff = ((cur - prev) / prev) * 100;
  if (!isFinite(diff) || Math.abs(diff) < 0.5) return <span className="text-[11px] text-muted-foreground">≈ прошл. период</span>;
  const up = diff > 0;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[11px] font-medium", up ? "text-success" : "text-destructive")}>
      {up ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      {Math.abs(diff).toFixed(0)}%{suffix}
    </span>
  );
}

function KpiCard({ icon: Icon, label, value, sub, delta }: {
  icon: LucideIcon; label: string; value: string; sub?: string; delta?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-xs font-medium">{label}</span>
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums">{value}</div>
      <div className="mt-0.5 flex items-center gap-2">
        {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
        {delta}
      </div>
    </div>
  );
}

function PostRow({ p, rank }: { p: ContentAnalyticsPost; rank: number }) {
  const f = fmtOf(p.media_type);
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-secondary/20">
      <span className="w-4 shrink-0 text-center text-xs font-bold text-muted-foreground">{rank}</span>
      <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-secondary/50">
        {p.thumbnail_url ? (
          <img src={p.thumbnail_url} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="grid h-full w-full place-items-center text-muted-foreground"><ImageIcon className="h-4 w-4" /></div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide" style={{ background: `${f.color}22`, color: f.color }}>
            {f.label}
          </span>
          <span className="text-[11px] text-muted-foreground">{fmtDate(p.posted_at)}</span>
        </div>
        <p className="mt-0.5 truncate text-sm">{p.caption || "—"}</p>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-sm font-semibold tabular-nums">ER {p.er}%</div>
        <div className="text-[11px] text-muted-foreground tabular-nums">{fmtNum(p.reach)} охват</div>
      </div>
      {p.permalink && (
        <a href={p.permalink} target="_blank" rel="noopener noreferrer" className="shrink-0 text-muted-foreground hover:text-foreground">
          <ExternalLink className="h-4 w-4" />
        </a>
      )}
    </div>
  );
}

export default function ContentAnalytics() {
  const [preset, setPreset] = useState<ContentPeriodPreset>("this_month");
  const [range, setRange] = useState<ReportPeriodRange>(() => thisMonthRange());
  const [compare, setCompare] = useState(true);
  const { active } = useProjectsStore();
  const { account, loading: accountLoading, sync } = useInstagramAccount();
  const [syncing, setSyncing] = useState(false);

  const compareRange = useMemo(() => previousEqualRange(range), [range]);
  const compareLabel = useMemo(() => formatPeriodLabel(compareRange), [compareRange]);

  // Wider fetch window so prev-period deltas work inside buildContentAnalyticsFromIg.
  const fetchRange = useMemo(() => {
    if (!compare) return range;
    return { from: compareRange.from, to: range.to };
  }, [compare, compareRange.from, range]);
  const { media, daily, loading, refetch } = useInstagramAnalytics(fetchRange);

  const data = useMemo(() => {
    if (!account) return null;
    const from = ymdLocal(range.from);
    return buildContentAnalyticsFromIg({
      from: from < CONTENT_CUTOFF ? CONTENT_CUTOFF : from,
      to: ymdLocal(range.to),
      media,
      daily,
      followersNow: account.followersCount,
    });
  }, [account, range.from, range.to, media, daily]);

  const onPresetChange = (next: ContentPeriodPreset, nextRange: ReportPeriodRange) => {
    setPreset(next);
    setRange(nextRange);
  };

  const k = data?.kpis;
  const bestFormat = useMemo(() => {
    if (!data?.by_format?.length) return null;
    return [...data.by_format].sort((a, b) => b.er - a.er)[0];
  }, [data]);

  const refresh = async () => {
    setSyncing(true);
    try {
      await sync();
      await refetch();
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    void refetch();
  }, [account?.igUserId, refetch]);

  const expandToYear = () => {
    const to = new Date();
    to.setHours(0, 0, 0, 0);
    const from = new Date(to);
    from.setDate(from.getDate() - 364);
    setPreset("custom");
    setRange({ from, to });
  };

  return (
    <PageContainer>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link
          to="/analytics/content"
          className="rounded-xl border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary"
        >
          Контент-аналитика (охват и ER)
        </Link>
        <Link
          to="/marketing/content-center"
          className="rounded-xl border border-border/60 bg-card/50 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Контент-центр (заявки и выручка)
        </Link>
      </div>

      <PageHeader
        icon={BarChart3}
        title="Контент-аналитика"
        description={
          <span>
            Контент-аналитика отвечает за эффективность контента: охват, просмотры, ER и лучшие форматы.
            {" "}
            Для бизнес-результата (клики, заявки, продажи, выручка) используйте{" "}
            <Link to="/marketing/content-center" className="text-primary hover:underline">
              Контент-центр
            </Link>
            .{" "}
            Данные по Instagram, подключённому к проекту
            {active?.name ? <> «{active.name}»</> : null}
            {account?.username ? <> · @{account.username}</> : null}
            .
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ContentPeriodPicker
              preset={preset}
              range={range}
              compare={compare}
              compareLabel={compare ? compareLabel : null}
              onPresetChange={onPresetChange}
              onCompareChange={setCompare}
            />
            <Button
              variant="outline"
              size="icon"
              className="h-10 w-10 rounded-2xl"
              onClick={() => void refresh()}
              disabled={syncing || loading || !account}
              title="Синхронизировать Instagram и обновить"
            >
              <RefreshCw className={cn("h-4 w-4", (syncing || loading) && "animate-spin")} />
            </Button>
          </div>
        }
      />

      {(accountLoading && !account) ? (
        <div className="flex justify-center py-24 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : !account ? (
        <div className="mx-auto max-w-xl space-y-4 py-8">
          <div className="rounded-2xl border border-pink-500/30 bg-pink-500/5 px-4 py-3 text-sm text-muted-foreground">
            Подключите Instagram Business к этому проекту — после синхронизации охват, ER и посты появятся здесь.
            Один проект = один Instagram аккаунт.
          </div>
          <InstagramAccountConnect />
        </div>
      ) : loading && !data ? (
        <div className="flex justify-center py-24 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : !data ? null : (
        <div className={cn("space-y-6", (loading || syncing) && "opacity-60")}>
          <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
            <InstagramAccountConnect />
          </div>

          {k && k.posts === 0 && (account?.mediaCount ?? 0) > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">
              <span className="text-muted-foreground">
                В выбранном периоде нет публикаций. В аккаунте всего {fmtNum(account?.mediaCount ?? 0)} постов.
                Выберите более широкий период.
              </span>
              <Button variant="outline" size="sm" className="h-7 rounded-lg" onClick={expandToYear}>
                Показать последние 12 месяцев
              </Button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <KpiCard icon={BarChart3} label="Постов" value={fmtNum(k!.posts)}
              delta={compare ? <Delta cur={k!.posts} prev={k!.posts_prev} /> : undefined} />
            <KpiCard icon={Eye} label="Охват" value={fmtNum(k!.reach)}
              delta={compare ? <Delta cur={k!.reach} prev={k!.reach_prev} /> : undefined} />
            <KpiCard icon={Film} label="Просмотры" value={fmtNum(k!.views)} />
            <KpiCard icon={Heart} label="Вовлечённость" value={`${k!.er}%`} sub={`${fmtNum(k!.engagement)} реакций`}
              delta={compare ? <Delta cur={k!.er} prev={k!.er_prev} suffix=" п.п." /> : undefined} />
            <KpiCard icon={Users} label="Подписчики" value={data.followers.now != null ? fmtNum(data.followers.now) : "—"}
              delta={data.followers.growth ? (
                <span className={cn("inline-flex items-center gap-0.5 text-[11px] font-medium", data.followers.growth >= 0 ? "text-success" : "text-destructive")}>
                  {data.followers.growth >= 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                  {Math.abs(data.followers.growth)} за период
                </span>
              ) : undefined} />
          </div>

          {compare && (
            <div className="rounded-xl border border-border/60 bg-card/40 px-3 py-2 text-xs text-muted-foreground">
              Сравнение включено: текущий период vs {compareLabel}
            </div>
          )}

          <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Динамика контента</h2>
              <span className="text-xs text-muted-foreground">охват · просмотры · ER по неделям</span>
            </div>
            <ContentPerformanceChart data={data.trend} />
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Что заходит лучше — по форматам</h2>
                {bestFormat && (
                  <span className="text-xs text-muted-foreground">
                    лидер: <span className="font-semibold text-foreground">{fmtOf(bestFormat.media_type).label}</span>
                  </span>
                )}
              </div>
              <div className="space-y-2">
                {data.by_format.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">Нет данных — нажмите обновить для синхронизации</p>
                ) : (
                  data.by_format.map((f) => {
                    const meta = fmtOf(f.media_type);
                    const maxEr = Math.max(...data.by_format.map((x) => x.er), 1);
                    return (
                      <div key={f.media_type} className="rounded-xl border border-border/50 p-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: `${meta.color}22`, color: meta.color }}>
                              <meta.icon className="h-4 w-4" />
                            </span>
                            <span className="text-sm font-medium">{meta.label}</span>
                            <span className="text-xs text-muted-foreground">· {f.posts} шт.</span>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-semibold tabular-nums">ER {f.er}%</div>
                            <div className="text-[11px] text-muted-foreground tabular-nums">ср. охват {fmtNum(f.avg_reach)}</div>
                          </div>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
                          <div className="h-full rounded-full" style={{ width: `${(f.er / maxEr) * 100}%`, background: meta.color }} />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="space-y-6">
              <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Users className="h-4 w-4 text-primary" /> Аудитория @{account.username}
                </div>
                <div className="mt-3 flex items-end justify-between">
                  <div>
                    <div className="text-2xl font-bold tabular-nums">{data.followers.now != null ? fmtNum(data.followers.now) : "—"}</div>
                    <div className="text-xs text-muted-foreground">подписчиков сейчас</div>
                  </div>
                  <div className={cn("flex items-center gap-1 text-sm font-semibold", data.followers.growth >= 0 ? "text-success" : "text-destructive")}>
                    {data.followers.growth >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                    {data.followers.growth >= 0 ? "+" : ""}{data.followers.growth}
                  </div>
                </div>
                {data.followers.series.length > 1 && (
                  <div className="mt-3 h-12 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={data.followers.series} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                        <Area type="monotone" dataKey="followers" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.15)" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Factory className="h-4 w-4 text-primary" /> Производство → публикация
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <div className="flex-1 rounded-xl bg-secondary/40 p-3 text-center">
                    <div className="text-xl font-bold tabular-nums">{fmtNum(data.production.generated)}</div>
                    <div className="text-[11px] text-muted-foreground">креативов на Заводе</div>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="flex-1 rounded-xl bg-primary/10 p-3 text-center">
                    <div className="text-xl font-bold tabular-nums text-primary">{fmtNum(data.production.published)}</div>
                    <div className="text-[11px] text-muted-foreground">постов вышло</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/60">
              <div className="flex items-center gap-2 border-b border-border/40 px-4 py-3">
                <Trophy className="h-4 w-4 text-amber-500" />
                <h2 className="text-sm font-semibold">Лучшие посты</h2>
                <Link
                  to="/marketing/content-center"
                  className="ml-auto inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                >
                  Проверить деньги <MoveRight className="h-3 w-3" />
                </Link>
              </div>
              <div className="divide-y divide-border/20">
                {data.top_posts.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">Нет данных</p>
                ) : data.top_posts.map((p, i) => <PostRow key={p.ig_media_id} p={p} rank={i + 1} />)}
              </div>
            </div>
            <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/60">
              <div className="flex items-center gap-2 border-b border-border/40 px-4 py-3">
                <TrendingDown className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold">Слабые посты</h2>
                <Link
                  to="/marketing/content-center"
                  className="ml-auto inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                >
                  Где теряем лиды <MoveRight className="h-3 w-3" />
                </Link>
              </div>
              <div className="divide-y divide-border/20">
                {data.bottom_posts.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">Нет данных</p>
                ) : data.bottom_posts.map((p, i) => <PostRow key={p.ig_media_id} p={p} rank={i + 1} />)}
              </div>
            </div>
          </div>
        </div>
      )}
    </PageContainer>
  );
}
