/**
 * Радар идей: строка статуса («● РАДАР · N постов под наблюдением …») и поле
 * «вставьте ссылку на видео → разбор» — как первый экран viralex.
 */
import { useState } from "react";
import { Link2, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RadarMetrics } from "@/lib/radarClient";
import { formatAge } from "@/lib/radarStats";
import { cn } from "@/lib/utils";

interface RadarHeroProps {
  metrics: RadarMetrics | null;
  sourcesCount: number;
  crawling: boolean;
  busy: boolean;
  onAnalyzeUrl: (url: string) => Promise<void>;
}

const num = (n: number | null | undefined) => (Number(n) || 0).toLocaleString("ru-RU");

export function RadarHero({ metrics, sourcesCount, crawling, busy, onAnalyzeUrl }: RadarHeroProps) {
  const [url, setUrl] = useState("");
  const submit = async () => {
    const u = url.trim();
    if (!u) return;
    await onAnalyzeUrl(u);
    setUrl("");
  };
  const watching = metrics?.posts_total ?? 0;
  const viral = metrics?.posts_viral ?? 0;
  const last = metrics?.last_run_at ?? null;

  return (
    <section className="rounded-3xl border border-border/60 bg-gradient-to-br from-card via-card to-success/5 p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-2 font-semibold uppercase tracking-[0.18em] text-foreground">
          <span className={cn("h-2 w-2 rounded-full bg-success", crawling && "animate-pulse")} aria-hidden />
          Радар
        </span>
        <span><b className="tabular-nums text-foreground">{num(watching)}</b> постов под наблюдением</span>
        <span>·</span>
        <span><b className="tabular-nums text-foreground">{num(sourcesCount)}</b> {sourcesCount === 1 ? "источник" : sourcesCount >= 2 && sourcesCount <= 4 ? "источника" : "источников"}</span>
        <span>·</span>
        <span><b className="tabular-nums text-foreground">{num(viral)}</b> залетевших</span>
        <span>·</span>
        <span>{crawling ? "идёт сбор…" : last ? `последний сбор ${formatAge(last)}` : "сборов ещё не было"}</span>
      </div>

      <h2 className="mt-4 text-balance text-xl font-semibold leading-tight sm:text-2xl">
        Вставьте ссылку на ролик — через минуту получите разбор: хук, структура, почему залетел и сценарий для вас.
      </h2>

      <form
        className="mt-4 flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="relative flex-1">
          <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Ссылка на публикацию"
            placeholder="https://www.instagram.com/reel/… · TikTok · YouTube Shorts · Threads · Facebook"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="h-11 pl-9"
            disabled={busy}
          />
        </div>
        <Button type="submit" size="lg" className="h-11 gap-2" disabled={busy || !url.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Разобрать
        </Button>
      </form>
      <p className="mt-2 text-xs text-muted-foreground">
        Разбор ≈ 1–2 минуты. Пост попадёт в «Тренды», разбор — в «рентген» поста, идея с оценкой ≥ 55 — в банк идей.
      </p>
    </section>
  );
}
