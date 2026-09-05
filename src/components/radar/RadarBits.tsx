/**
 * Радар идей: мелкие общие элементы — чипы, бейджи оценки и X-фактора,
 * превью поста с заглушкой, плитка метрики, подпись секции, пустое состояние,
 * форматы дат и денег.
 */
import { useEffect, useState, type ReactNode } from "react";
import { ScanSearch } from "lucide-react";
import { looksLikeVideoUrl } from "@/components/autopost/MediaThumb";
import { Badge } from "@/components/ui/badge";
import { PLATFORM_META, SCORE_TONE_CLS, scoreTone, type RadarPlatform, type RadarPost } from "@/lib/radarClient";
import { formatUsd, formatX, xTone, type XTone } from "@/lib/radarStats";
import { cn } from "@/lib/utils";

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ru-RU", {
    timeZone: "Asia/Almaty", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/** Деньги радара (реэкспорт чистой функции — формат общий с тестами). */
export const fmtUsd = formatUsd;

export const errMsg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export function Chip({ label, cls, title, className }: { label: ReactNode; cls?: string; title?: string; className?: string }) {
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap border-transparent font-medium", cls, className)} title={title}>
      {label}
    </Badge>
  );
}

export function PlatformChip({ platform, short = false, className }: { platform: RadarPlatform; short?: boolean; className?: string }) {
  const m = PLATFORM_META[platform];
  if (!m) return <Chip label={platform} cls="bg-muted text-muted-foreground" className={className} />;
  return <Chip label={short ? m.short : m.label} cls={m.cls} title={m.label} className={className} />;
}

/** Фон заглушки превью — оттенок площадки, чтобы карточка без картинки не была «дыркой». */
const PLATFORM_GRADIENT: Record<RadarPlatform, string> = {
  instagram: "from-pink-500/25 via-fuchsia-500/10 to-amber-400/15",
  tiktok: "from-slate-400/25 via-cyan-400/10 to-rose-400/15",
  youtube: "from-red-500/25 via-red-500/10 to-zinc-500/10",
  threads: "from-zinc-400/25 via-zinc-500/10 to-zinc-800/20",
  facebook: "from-blue-500/25 via-blue-500/10 to-sky-400/15",
};

/**
 * Превью поста. Ссылки CDN площадок подписаны и протухают, а с чужим referrer
 * отдают 403 — поэтому грузим без referrer и при ошибке рисуем заглушку с
 * началом подписи, а не битую картинку. Сервер параллельно кладёт копию в Storage.
 */
export function PostThumb({
  post, className, imgClassName, compact = false,
}: {
  post: Pick<RadarPost, "thumbnail_url" | "platform" | "caption" | "author_handle">;
  className?: string;
  imgClassName?: string;
  /** Маленькое превью (≈ 72 px): в заглушке только иконка, без подписи и водяного знака. */
  compact?: boolean;
}) {
  const src = post.thumbnail_url && !looksLikeVideoUrl(post.thumbnail_url) ? post.thumbnail_url : null;
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const meta = PLATFORM_META[post.platform];
  const snippet = (post.caption ?? "").replace(/\s+/g, " ").trim().slice(0, 90);

  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        className={cn("h-full w-full object-cover", imgClassName, className)}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    );
  }
  const gradient = PLATFORM_GRADIENT[post.platform] ?? "from-muted to-background";
  if (compact) {
    return (
      <div className={cn("grid h-full w-full place-items-center bg-gradient-to-br", gradient, className)} data-testid="post-thumb-fallback" aria-hidden>
        <ScanSearch className="h-5 w-5 text-foreground/40" />
      </div>
    );
  }
  return (
    <div
      className={cn("relative flex h-full w-full flex-col items-center justify-center overflow-hidden bg-gradient-to-br p-4 text-center", gradient, className)}
      data-testid="post-thumb-fallback"
      aria-hidden
    >
      <span className="pointer-events-none absolute -right-2 -top-3 select-none text-[88px] font-black leading-none tracking-tighter text-foreground/[0.06]">
        {meta?.short ?? "•"}
      </span>
      <ScanSearch className="h-7 w-7 text-foreground/35" />
      {snippet ? (
        <p className="mt-3 line-clamp-4 text-xs italic leading-snug text-foreground/60">«{snippet}{(post.caption ?? "").length > 90 ? "…" : ""}»</p>
      ) : (
        <p className="mt-3 text-xs text-foreground/50">{post.author_handle ? `@${post.author_handle}` : meta?.label ?? "Пост"}</p>
      )}
    </div>
  );
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

/**
 * Плитка метрики: название, число и обязательная расшифровка под ним — из
 * чего это число собрано (период, знаменатель, разбивка). Без расшифровки
 * цифра на странице выглядит взятой с потолка.
 */
export function MetricTile({
  label, value, sub, hint, accent = false,
}: {
  label: string;
  value: string | number;
  /** Короткая расшифровка: «из 28 с X-фактором», «сбор $0.021 · разбор $0.045». */
  sub?: ReactNode;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col rounded-2xl border bg-card px-4 py-3",
        accent ? "border-success/40 bg-success/5" : "border-border/60",
      )}
      title={hint}
    >
      <div className="truncate text-xs text-muted-foreground" title={label}>{label}</div>
      <div className={cn("mt-1 text-2xl font-semibold leading-none tabular-nums", accent && "text-success")}>{value}</div>
      <div className="mt-1.5 min-h-[1rem] truncate text-[11px] leading-4 text-muted-foreground" title={typeof sub === "string" ? sub : undefined}>
        {sub}
      </div>
    </div>
  );
}
