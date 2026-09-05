/**
 * Радар идей: ряд плиток с метриками. Каждое число подписано — из чего оно
 * собрано (период, знаменатель, разбивка расхода), а кнопка «Как считаем»
 * раскрывает формулы: X-фактор, оценка, порог идеи, откуда берутся деньги.
 */
import { HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { RadarMetrics } from "@/lib/radarClient";
import { formatUsd, formatX, VIRAL_X_FACTOR } from "@/lib/radarStats";
import { MetricTile, SectionLabel } from "./RadarBits";

interface MetricsRowProps {
  metrics: RadarMetrics | null;
  /** Запасное значение, пока витрина не загрузилась. */
  sourcesFallback: number;
}

const num = (n: number | null | undefined) => Number(n) || 0;

/** «сентябрь» — месяц, за который считается расход. */
function currentMonth(): string {
  return new Date().toLocaleDateString("ru-RU", { month: "long", timeZone: "Asia/Almaty" });
}

/** Склонение по числу: 1 тема, 2 темы, 5 тем. */
function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

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

export function MetricsRow({ metrics, sourcesFallback }: MetricsRowProps) {
  const sources = metrics ? num(metrics.sources) : sourcesFallback;
  const sourcesTotal = num(metrics?.sources_total) || sources;
  const posts7d = num(metrics?.posts_7d);
  const postsTotal = num(metrics?.posts_total);
  const viral = num(metrics?.posts_viral);
  const scored = num(metrics?.posts_scored);
  const unanalyzed = num(metrics?.posts_unanalyzed);
  const analyzed = num(metrics?.posts_analyzed);
  const ideasNew = num(metrics?.ideas_new);
  const ideasTotal = num(metrics?.ideas_total);
  const ideasApproved = num(metrics?.ideas_approved);
  const ideasUsed = num(metrics?.ideas_used);
  const postsToday = num(metrics?.posts_today);
  const bestX = metrics?.best_x_factor == null ? null : Number(metrics.best_x_factor);
  const bestAuthor = metrics?.best_x_author ?? null;
  const topNiche = metrics?.top_niche ?? null;
  const crawlUsd = num(metrics?.spent_month_crawl_usd);
  const aiUsd = num(metrics?.spent_month_ai_usd);
  const totalUsd = num(metrics?.spent_month_usd);

  return (
    <section className="mt-4">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <SectionLabel>Сводка</SectionLabel>
        <HowItWorks />
      </div>
      {/* Четыре колонки: в семь узких не влезала расшифровка расхода. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        <MetricTile
          label="Источников"
          value={sources}
          sub={sourcesTotal > sources ? `включено из ${sourcesTotal}` : "все включены"}
          hint="Аккаунты, хештеги и запросы, которые радар собирает по расписанию"
        />
        <MetricTile
          label="Постов за 7 дней"
          value={posts7d}
          sub={postsToday ? `сегодня +${postsToday} · всего ${postsTotal}` : `всего собрано ${postsTotal}`}
          hint="Публикации, попавшие в базу радара за последние 7 дней"
        />
        <MetricTile
          label="Залетевших"
          value={viral}
          sub={scored ? `из ${scored} с X-фактором` : "X-фактор ещё не посчитан"}
          hint={`Постов с X-фактором ≥ ${VIRAL_X_FACTOR} — обошли обычный результат автора минимум вдвое`}
          accent={viral > 0}
        />
        <MetricTile
          label="Лучший X-фактор"
          value={bestX ? formatX(bestX) : "—"}
          sub={bestAuthor ? `@${bestAuthor}` : "нужен хотя бы один разбор"}
          hint="Рекорд проекта: во сколько раз лучший пост обошёл обычный результат своего автора"
        />
        <MetricTile
          label="Ждут разбора"
          value={unanalyzed}
          sub={`разобрано ${analyzed}`}
          hint="Посты ждут расшифровки и разбора моделью — очередь идёт каждые 15 минут"
        />
        <MetricTile
          label="Новых идей"
          value={ideasNew}
          sub={ideasTotal ? `всего ${ideasTotal} · одобрено ${ideasApproved}` : "идей пока нет"}
          hint="Идеи из разбора со статусом «Новая» — ждут вашего решения"
        />
        <MetricTile
          label="Идей в плане"
          value={ideasUsed}
          sub={ideasUsed ? `${plural(ideasUsed, "тема", "темы", "тем")} в контент-плане` : "ещё ни одной"}
          hint="Идеи, которые вы отправили в контент-план кнопкой «В контент-план»"
        />
        <MetricTile
          label="Чаще всего заходит"
          value={topNiche ?? "—"}
          valueSize="sm"
          sub={topNiche ? "ниша из разборов" : "появится после разборов"}
          hint="Ниша, которая чаще других встречается в разборах собранных постов"
        />
        <MetricTile
          label={`Расход за ${currentMonth()}`}
          value={formatUsd(totalUsd)}
          sub={`сбор ${formatUsd(crawlUsd)} · разбор ${formatUsd(aiUsd)}`}
          hint="Фактические траты радара за текущий месяц: сбор постов и их разбор моделью"
        />
      </div>
    </section>
  );
}
