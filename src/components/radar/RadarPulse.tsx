/**
 * Радар идей: «пульс» проекта вместо ряда одинаковых плиток. Слева воронка
 * собрано → разобрано → залетевших → идей → одобрено → в плане: полоска каждого
 * шага — доля от собранного, клик ведёт на вкладку с уже включённым фильтром.
 * Справа — рекорд проекта (открывает «рентген»), топ-ниша (фильтр ленты),
 * источники и расход за месяц с разбивкой. «Как считаем» раскрывает формулы.
 */
import { ArrowRight, ArrowUpRight, ChevronRight, Database, Flame, HelpCircle, Tag, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { RadarMetrics, RadarPost } from "@/lib/radarClient";
import {
  bestPost, formatAge, formatUsd, nextSteps, nicheCount, plural, radarFunnel, VIRAL_X_FACTOR, xFactorBuckets,
  type FunnelKey, type PulseTarget,
} from "@/lib/radarStats";
import { cn } from "@/lib/utils";
import { SectionLabel, XBadge } from "./RadarBits";

export type { PulseTarget };

interface RadarPulseProps {
  metrics: RadarMetrics | null;
  posts: RadarPost[];
  /** Запасное число источников, пока витрина не загрузилась. */
  sourcesFallback: number;
  crawling: boolean;
  onGo: (target: PulseTarget) => void;
  onOpenPost: (post: RadarPost) => void;
}

const num = (n: number | null | undefined) => Number(n) || 0;

/** «сентябрь» — месяц, за который считается расход. */
function currentMonth(): string {
  return new Date().toLocaleDateString("ru-RU", { month: "long", timeZone: "Asia/Almaty" });
}

const STEP_TARGET: Record<FunnelKey, PulseTarget> = {
  collected: { tab: "trends", filter: { viralOnly: false, niche: null, platform: "all", period: "all", query: "" } },
  analyzed: { tab: "trends", filter: { sort: "score", viralOnly: false } },
  viral: { tab: "trends", filter: { viralOnly: true, sort: "x" } },
  ideas: { tab: "ideas", status: "all" },
  approved: { tab: "ideas", status: "approved" },
  used: { tab: "ideas", status: "used" },
};

function HowItWorks() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-muted-foreground">
          <HelpCircle className="h-3.5 w-3.5" />
          Как считаем
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[340px] text-xs leading-relaxed">
        <SectionLabel>Откуда берутся цифры</SectionLabel>
        <dl className="mt-2 grid gap-2">
          <div>
            <dt className="font-semibold text-foreground">X-фактор поста</dt>
            <dd className="text-muted-foreground">
              Просмотры поста ÷ медиана последних 40 постов того же автора («обычно»). У фото и каруселей вместо
              просмотров берутся лайки. Если у автора собран всего один пост — делим на норму для его аудитории
              (3,75 × подписчики<sup>0,68</sup>).
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-foreground">Залетевший пост</dt>
            <dd className="text-muted-foreground">X-фактор ≥ {VIRAL_X_FACTOR}: пост обошёл обычный результат автора минимум вдвое.</dd>
          </div>
          <div>
            <dt className="font-semibold text-foreground">Оценка 0–100</dt>
            <dd className="text-muted-foreground">
              Реакция аудитории (ER), скорость набора и оценка модели после разбора, плюс бонус до 15 за X-фактор.
              Пост с оценкой ≥ 55 превращается в идею в банке.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-foreground">Воронка</dt>
            <dd className="text-muted-foreground">
              Полоска под числом — доля шага от всех собранных постов. «Одобрено» включает идеи, уже ушедшие в план.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-foreground">Расход</dt>
            <dd className="text-muted-foreground">
              Журнал трат проекта за текущий месяц: сбор постов (Apify, ≈ $0,003 за пост) и разбор
              (расшифровка речи + модель, ≈ $0,004 за пост). Списывается фактически, по каждому запуску.
            </dd>
          </div>
        </dl>
      </PopoverContent>
    </Popover>
  );
}

/** Строка правой колонки: иконка, подпись, значение, действие. Вся строка — кнопка. */
function PulseRow({
  icon: Icon, label, value, sub, action, accent = false, onClick, testId,
}: {
  icon: typeof Flame;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  action?: string;
  accent?: boolean;
  onClick?: () => void;
  testId?: string;
}) {
  const body = (
    <>
      <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", accent ? "bg-success/15 text-success" : "bg-muted text-muted-foreground")}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className={cn("mt-0.5 block truncate text-base font-semibold leading-tight", accent && "text-success")}>{value}</span>
        {sub && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{sub}</span>}
      </span>
      {onClick && (
        <span className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground transition-colors group-hover:text-foreground sm:inline-flex">
          {action}
          <ArrowUpRight className="h-3.5 w-3.5" />
        </span>
      )}
    </>
  );
  const cls = "group flex w-full items-center gap-3 px-4 py-3 text-left";
  if (!onClick) return <div className={cls} data-testid={testId}>{body}</div>;
  return (
    <button type="button" onClick={onClick} className={cn(cls, "transition-colors hover:bg-muted/40")} data-testid={testId}>
      {body}
    </button>
  );
}

export function RadarPulse({ metrics, posts, sourcesFallback, crawling, onGo, onOpenPost }: RadarPulseProps) {
  const steps = radarFunnel(metrics);
  const buckets = xFactorBuckets(posts);
  const bucketMax = Math.max(1, ...buckets.map((b) => b.count));
  const scoredPosts = buckets.reduce((acc, b) => acc + b.count, 0);
  const steps2 = nextSteps(metrics, sourcesFallback);
  const sources = metrics ? num(metrics.sources) : sourcesFallback;
  const sourcesTotal = Math.max(num(metrics?.sources_total), sources);
  const bestX = metrics?.best_x_factor == null ? null : Number(metrics.best_x_factor);
  const bestAuthor = metrics?.best_x_author ?? null;
  const best = bestPost(posts);
  const topNiche = metrics?.top_niche ?? null;
  const nichePosts = nicheCount(posts, topNiche);
  const crawlUsd = num(metrics?.spent_month_crawl_usd);
  const aiUsd = num(metrics?.spent_month_ai_usd);
  const totalUsd = num(metrics?.spent_month_usd) || crawlUsd + aiUsd;
  const crawlShare = totalUsd > 0 ? Math.round((crawlUsd / totalUsd) * 100) : 0;
  const last = metrics?.last_run_at ?? null;

  return (
    <section className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]" data-testid="radar-pulse">
      {/* Воронка + распределение + что дальше */}
      <div className="flex min-w-0 flex-col rounded-2xl border border-border/60 bg-card p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2">
          <SectionLabel>Воронка радара</SectionLabel>
          <HowItWorks />
        </div>
        <ol className="mt-3 grid grid-cols-3 gap-x-2 gap-y-4 sm:grid-cols-6 sm:gap-x-3">
          {steps.map((s, i) => {
            const isViral = s.key === "viral";
            const isEnd = s.key === "used";
            const zero = s.value === 0;
            return (
              <li key={s.key} className="relative min-w-0">
                {i > 0 && (
                  <ChevronRight className="pointer-events-none absolute -left-2.5 top-2 hidden h-3.5 w-3.5 text-muted-foreground/50 sm:block" aria-hidden />
                )}
                <button
                  type="button"
                  onClick={() => onGo(STEP_TARGET[s.key])}
                  title={s.hint}
                  className="group block w-full rounded-xl px-1 py-1 text-left transition-colors hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  data-testid={`funnel-${s.key}`}
                >
                  <div className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">{s.label}</div>
                  <div
                    className={cn(
                      "mt-1 text-2xl font-semibold leading-none tabular-nums sm:text-[28px]",
                      isViral && !zero && "text-success",
                      isEnd && !zero && "text-primary",
                      zero && "text-muted-foreground/70",
                    )}
                  >
                    {s.value.toLocaleString("ru-RU")}
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn("h-full rounded-full transition-[width]", isViral ? "bg-success" : isEnd ? "bg-primary" : "bg-foreground/45")}
                      style={{ width: `${Math.max(zero ? 0 : 6, Math.round(s.share * 100))}%` }}
                    />
                  </div>
                  <div className="mt-1.5 truncate text-[11px] leading-tight text-muted-foreground" title={s.sub}>{s.sub}</div>
                </button>
              </li>
            );
          })}
        </ol>

        <div className="mt-auto grid grid-cols-1 gap-4 border-t border-border/60 pt-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] sm:gap-6">
          {/* Распределение X-фактора */}
          <div className="min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <SectionLabel>X-фактор постов</SectionLabel>
              <span className="text-[11px] text-muted-foreground">{scoredPosts ? `${scoredPosts} ${plural(scoredPosts, "пост", "поста", "постов")}` : "нет данных"}</span>
            </div>
            <ul className="mt-2 grid grid-cols-1 gap-1.5" data-testid="x-buckets">
              {buckets.map((b) => (
                <li key={b.key} className="grid grid-cols-[76px_1fr_28px] items-center gap-2 text-xs">
                  <span className="truncate text-muted-foreground">{b.label}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-muted">
                    <span
                      className={cn("block h-full rounded-full", b.tone === "viral" ? "bg-success" : b.tone === "above" ? "bg-warning/80" : "bg-foreground/35")}
                      style={{ width: `${b.count ? Math.max(4, Math.round((b.count / bucketMax) * 100)) : 0}%` }}
                    />
                  </span>
                  <span className="text-right tabular-nums">{b.count}</span>
                </li>
              ))}
            </ul>
          </div>
          {/* Что дальше */}
          <div className="min-w-0">
            <SectionLabel>Что дальше</SectionLabel>
            <ul className="mt-2 grid grid-cols-1 gap-1.5" data-testid="next-steps">
              {steps2.map((st) => (
                <li key={st.key} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => onGo(st.target)}
                    className="group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted/40"
                  >
                    <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", st.urgent ? "bg-warning" : "bg-muted-foreground/50")} aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-foreground/90" title={st.text}>{st.text}</span>
                    <span className="inline-flex shrink-0 items-center gap-1 font-medium text-primary">
                      {st.action}
                      <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Правая колонка: рекорд, ниша, источники + расход */}
      <div className="grid min-w-0 grid-cols-1 divide-y divide-border/60 rounded-2xl border border-border/60 bg-card">
        <PulseRow
          icon={Flame}
          label="Рекорд проекта"
          accent={bestX != null && bestX >= VIRAL_X_FACTOR}
          value={
            bestX ? (
              <span className="inline-flex items-center gap-2">
                <XBadge x={bestX} />
                {bestAuthor && <span className="truncate">@{bestAuthor}</span>}
              </span>
            ) : "—"
          }
          sub={bestX ? "во сколько раз лучший пост обошёл «обычно» своего автора" : "появится после первого сбора с X-фактором"}
          action={best ? "рентген" : "в ленту"}
          onClick={bestX ? () => (best ? onOpenPost(best) : onGo({ tab: "trends", filter: { sort: "x", viralOnly: false } })) : undefined}
          testId="pulse-best"
        />
        <PulseRow
          icon={Tag}
          label="Чаще всего заходит"
          value={topNiche ?? "—"}
          sub={topNiche ? (nichePosts ? `${nichePosts} ${plural(nichePosts, "пост", "поста", "постов")} в ленте` : "ниша из разборов") : "появится после разборов"}
          action="показать"
          onClick={topNiche ? () => onGo({ tab: "trends", filter: { niche: topNiche, viralOnly: false } }) : undefined}
          testId="pulse-niche"
        />
        <PulseRow
          icon={Database}
          label="Источников"
          value={
            <span className="inline-flex items-center gap-2">
              <span className="tabular-nums">{sources}</span>
              <span className="text-xs font-normal text-muted-foreground">{sourcesTotal > sources ? `включено из ${sourcesTotal}` : sources ? "все включены" : "добавьте первый"}</span>
            </span>
          }
          sub={
            <span className="inline-flex items-center gap-1.5">
              <span className={cn("h-1.5 w-1.5 rounded-full", crawling ? "animate-pulse bg-success" : last ? "bg-success/70" : "bg-muted-foreground/40")} aria-hidden />
              {crawling ? "идёт сбор…" : last ? `последний сбор ${formatAge(last)}` : "сборов ещё не было"}
            </span>
          }
          action="источники"
          onClick={() => onGo({ tab: "sources" })}
          testId="pulse-sources"
        />
        <PulseRow
          icon={Wallet}
          label={`Расход за ${currentMonth()}`}
          value={<span className="tabular-nums">{formatUsd(totalUsd)}</span>}
          sub={
            <span className="flex min-w-0 items-center gap-2">
              <span className="flex h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-muted" aria-hidden>
                <span className="h-full bg-sky-400/80" style={{ width: `${crawlShare}%` }} />
                <span className="h-full bg-violet-400/80" style={{ width: `${totalUsd > 0 ? 100 - crawlShare : 0}%` }} />
              </span>
              <span className="min-w-0 truncate">сбор {formatUsd(crawlUsd)} · разбор {formatUsd(aiUsd)}</span>
            </span>
          }
          action="журнал"
          onClick={() => onGo({ tab: "runs" })}
          testId="pulse-spend"
        />
      </div>
    </section>
  );
}
