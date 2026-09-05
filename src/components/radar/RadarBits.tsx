/**
 * Радар идей: мелкие общие элементы — чипы, бейджи оценки и X-фактора,
 * плитка метрики, подпись секции, пустое состояние, форматы дат и денег.
 */
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { PLATFORM_META, SCORE_TONE_CLS, scoreTone, type RadarPlatform } from "@/lib/radarClient";
import { formatX, xTone, type XTone } from "@/lib/radarStats";
import { cn } from "@/lib/utils";

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ru-RU", {
    timeZone: "Asia/Almaty", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export const fmtUsd = (n: number | null | undefined) => `$${(Number(n) || 0).toFixed(2)}`;

export const errMsg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export function Chip({ label, cls, title, className }: { label: ReactNode; cls?: string; title?: string; className?: string }) {
  return (
    <Badge variant="outline" className={cn("border-transparent font-medium", cls, className)} title={title}>
      {label}
    </Badge>
  );
}

export function PlatformChip({ platform, short = false, className }: { platform: RadarPlatform; short?: boolean; className?: string }) {
  const m = PLATFORM_META[platform];
  if (!m) return <Chip label={platform} cls="bg-muted text-muted-foreground" className={className} />;
  return <Chip label={short ? m.short : m.label} cls={m.cls} title={m.label} className={className} />;
}

export function ScoreBadge({ score, size = "sm" }: { score: number | null | undefined; size?: "sm" | "lg" }) {
  const tone = scoreTone(score);
  return (
    <Badge
      variant="outline"
      className={cn("border-transparent tabular-nums", SCORE_TONE_CLS[tone], size === "lg" && "px-2.5 py-1 text-sm")}
      title="Оценка потенциала для нас (0–100): реакция аудитории, скорость, X-фактор и разбор модели"
    >
      {score == null ? "—" : Math.round(Number(score))}
    </Badge>
  );
}

const X_TONE_CLS: Record<XTone, string> = {
  viral: "bg-success text-primary-foreground shadow-[0_0_0_3px_hsl(var(--success)/0.25)]",
  above: "bg-warning/20 text-warning ring-1 ring-inset ring-warning/40",
  normal: "bg-muted text-muted-foreground ring-1 ring-inset ring-border",
  none: "bg-muted/60 text-muted-foreground",
};

/** «×6 811» — во сколько раз пост обошёл обычный результат автора. */
export function XBadge({ x, size = "sm", className }: { x: number | null | undefined; size?: "sm" | "lg"; className?: string }) {
  const tone = xTone(x);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-semibold tabular-nums",
        size === "lg" ? "px-3 py-1 text-base" : "px-2 py-0.5 text-xs",
        X_TONE_CLS[tone],
        className,
      )}
      title={tone === "none" ? "X-фактор ещё не посчитан — нужны ещё посты автора" : "X-фактор: во сколько раз пост обошёл «обычно» автора"}
    >
      {formatX(x)}
    </span>
  );
}

/** Подпись секции в стиле «рентгена»: мелкая, разрядка, приглушённая. */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground", className)}>{children}</div>;
}

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border/60 px-4 py-10 text-center text-sm text-muted-foreground">
      <div className="max-w-md">{children}</div>
      {action}
    </div>
  );
}

export function MetricTile({
  label, value, hint, accent = false,
}: {
  label: string;
  value: string | number;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div className={cn("rounded-2xl border bg-card px-4 py-3", accent ? "border-success/40 bg-success/5" : "border-border/60")} title={hint}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums", accent && "text-success")}>{value}</div>
    </div>
  );
}
