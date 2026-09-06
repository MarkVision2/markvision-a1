/**
 * AI Content Analyst — детерминированные инсайты по публикациям, чистый модуль
 * (без Deno и Supabase), покрыт vitest (src/test/publishInsights.test.ts).
 *
 * Вход — строки витрины publish_publications за период, пояса аккаунтов и
 * упавшие задания; выход — что работает: площадки, часы и дни недели в поясе
 * аккаунта, лучшие и худшие аккаунты, классы ошибок и рекомендации словами.
 * Никакого LLM: те же числа, что видит человек, только сложенные.
 */

export interface InsightPublication {
  publication_id: string;
  content_id: string;
  content_title: string | null;
  account_id: string;
  account_name: string;
  platform: string;
  status: string;
  verification_status: string | null;
  published_at: string | null;
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  score: number | null;
  metrics_checkpoint: string | null;
  /** Метаданные ролика (Phase 5): тема, хук, призыв — могут отсутствовать. */
  topic_key?: string | null;
  hook_type?: string | null;
  cta_type?: string | null;
}

export interface InsightFailure {
  error_class: string | null;
  platform: string;
}

export interface InsightBucket {
  key: string;
  publications: number;
  measured: number;
  views_avg: number | null;
  score_avg: number | null;
}

export interface AccountInsight extends InsightBucket {
  account_id: string;
  account_name: string;
  platform: string;
}

export interface ContentInsights {
  period_days: number;
  publications: number;
  measured: number;
  verified_rate: number | null;
  views_total: number;
  by_platform: (InsightBucket & { verified_rate: number | null })[];
  by_hour: InsightBucket[];
  by_weekday: InsightBucket[];
  best_hours: number[];
  best_weekdays: number[];
  accounts_top: AccountInsight[];
  accounts_bottom: AccountInsight[];
  errors: { error_class: string; count: number; platforms: string[] }[];
  top_content: { content_id: string; title: string | null; publications: number; views_avg: number | null; score_avg: number | null }[];
  /** По типу хука / призыва / теме — только для роликов с заполненными метаданными. */
  by_hook: InsightBucket[];
  by_cta: InsightBucket[];
  by_topic: InsightBucket[];
  recommendations: string[];
}

const WEEKDAY_LABELS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
/** Минимум измеренных публикаций, чтобы час/день считался показательным. */
export const MIN_SAMPLE = 3;

function avg(values: number[]): number | null {
  if (!values.length) return null;
  return Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10;
}

function localParts(iso: string, timezone: string): { hour: number; weekday: number } | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const tryTz = (tz: string) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false, weekday: "short" }).formatToParts(d);
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? NaN) % 24;
    const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
    return Number.isFinite(hour) && weekday >= 0 ? { hour, weekday } : null;
  };
  try {
    return tryTz(timezone);
  } catch {
    return tryTz("UTC");
  }
}

function bucketize<K extends string>(rows: InsightPublication[], keyOf: (p: InsightPublication) => K | null): Map<K, InsightPublication[]> {
  const m = new Map<K, InsightPublication[]>();
  for (const p of rows) {
    const k = keyOf(p);
    if (k == null) continue;
    const arr = m.get(k) ?? [];
    arr.push(p);
    m.set(k, arr);
  }
  return m;
}

function summarize(key: string, rows: InsightPublication[]): InsightBucket {
  const measured = rows.filter((r) => r.metrics_checkpoint != null);
  return {
    key,
    publications: rows.length,
    measured: measured.length,
    views_avg: avg(measured.map((r) => r.views ?? 0)),
    score_avg: avg(measured.map((r) => r.score ?? 0)),
  };
}

/** Лучшие ключи по среднему score (при равенстве — по просмотрам) среди показательных корзин. */
function bestKeys(buckets: InsightBucket[], n: number): string[] {
  return buckets
    .filter((b) => b.measured >= MIN_SAMPLE && b.score_avg != null)
    .sort((a, b) => (b.score_avg ?? 0) - (a.score_avg ?? 0) || (b.views_avg ?? 0) - (a.views_avg ?? 0))
    .slice(0, n)
    .map((b) => b.key);
}

export function buildContentInsights(
  input: {
    publications: InsightPublication[];
    failures: InsightFailure[];
    timezones: Record<string, string | null | undefined>;
    periodDays: number;
    defaultTimezone?: string;
  },
): ContentInsights {
  const tzDefault = input.defaultTimezone ?? "UTC";
  const pubs = input.publications.filter((p) => p.published_at);
  const measured = pubs.filter((p) => p.metrics_checkpoint != null);
  const verified = pubs.filter((p) => p.verification_status === "verified").length;
  const verifiable = pubs.filter((p) => p.verification_status && p.verification_status !== "skipped").length;

  const byPlatform = [...bucketize(pubs, (p) => p.platform).entries()]
    .map(([k, rows]) => {
      const v = rows.filter((r) => r.verification_status && r.verification_status !== "skipped");
      const ok = v.filter((r) => r.verification_status === "verified").length;
      return { ...summarize(k, rows), verified_rate: v.length ? Math.round((ok / v.length) * 100) : null };
    })
    .sort((a, b) => b.publications - a.publications);

  const local = new Map<string, { hour: number; weekday: number }>();
  for (const p of pubs) {
    const lp = localParts(p.published_at as string, input.timezones[p.account_id] || tzDefault);
    if (lp) local.set(p.publication_id, lp);
  }
  const byHour = [...bucketize(pubs, (p) => { const l = local.get(p.publication_id); return l ? String(l.hour).padStart(2, "0") : null; }).entries()]
    .map(([k, rows]) => summarize(k, rows))
    .sort((a, b) => a.key.localeCompare(b.key));
  const byWeekday = [...bucketize(pubs, (p) => { const l = local.get(p.publication_id); return l ? String(l.weekday) : null; }).entries()]
    .map(([k, rows]) => summarize(k, rows))
    .sort((a, b) => Number(a.key) - Number(b.key));

  const accounts = [...bucketize(pubs, (p) => p.account_id).entries()]
    .map(([id, rows]) => ({ ...summarize(id, rows), account_id: id, account_name: rows[0].account_name, platform: rows[0].platform }))
    .filter((a) => a.measured >= 1);
  const byScore = [...accounts].sort((a, b) => (b.score_avg ?? 0) - (a.score_avg ?? 0) || (b.views_avg ?? 0) - (a.views_avg ?? 0));
  const accountsTop = byScore.slice(0, 5);
  const accountsBottom = byScore.length > 5 ? byScore.slice(-3).reverse() : [];

  const errorMap = new Map<string, { count: number; platforms: Set<string> }>();
  for (const f of input.failures) {
    const k = f.error_class ?? "UNKNOWN_ERROR";
    const e = errorMap.get(k) ?? { count: 0, platforms: new Set<string>() };
    e.count += 1;
    e.platforms.add(f.platform);
    errorMap.set(k, e);
  }
  const errors = [...errorMap.entries()].map(([error_class, e]) => ({ error_class, count: e.count, platforms: [...e.platforms].sort() }))
    .sort((a, b) => b.count - a.count);

  const topContent = [...bucketize(pubs, (p) => p.content_id).entries()]
    .map(([id, rows]) => { const s = summarize(id, rows); return { content_id: id, title: rows[0].content_title, publications: s.publications, views_avg: s.views_avg, score_avg: s.score_avg }; })
    .filter((c) => c.score_avg != null)
    .sort((a, b) => (b.score_avg ?? 0) - (a.score_avg ?? 0))
    .slice(0, 5);

  const metaBuckets = (field: "hook_type" | "cta_type" | "topic_key") =>
    [...bucketize(pubs, (p) => p[field] || null).entries()]
      .map(([k, rows]) => summarize(k, rows))
      .sort((a, b) => (b.score_avg ?? -1) - (a.score_avg ?? -1) || b.publications - a.publications);
  const byHook = metaBuckets("hook_type");
  const byCta = metaBuckets("cta_type");
  const byTopic = metaBuckets("topic_key");

  const bestHours = bestKeys(byHour, 3).map(Number);
  const bestWeekdays = bestKeys(byWeekday, 2).map(Number);

  const recommendations: string[] = [];
  if (pubs.length === 0) recommendations.push(`За ${input.periodDays} дн. публикаций нет — инсайтов пока не из чего собрать.`);
  else if (measured.length < MIN_SAMPLE) recommendations.push(`Метрики сняты только у ${measured.length} публикаций — выводы появятся после точек d1/d3 (нужно хотя бы ${MIN_SAMPLE}).`);
  if (bestHours.length) {
    const rest = byHour.filter((b) => !bestHours.includes(Number(b.key)) && b.measured >= 1);
    const restAvg = avg(rest.map((b) => b.score_avg ?? 0));
    const bestAvg = avg(byHour.filter((b) => bestHours.includes(Number(b.key))).map((b) => b.score_avg ?? 0));
    recommendations.push(
      `Лучшие часы публикации (по поясу аккаунта): ${bestHours.map((h) => `${String(h).padStart(2, "0")}:00`).join(", ")}` +
      (bestAvg != null && restAvg != null ? ` — средний score ${bestAvg} против ${restAvg} в остальные часы.` : "."),
    );
  }
  if (bestWeekdays.length) recommendations.push(`Сильные дни недели: ${bestWeekdays.map((d) => WEEKDAY_LABELS[d]).join(", ")}.`);
  if (byPlatform.length > 1) {
    const ranked = byPlatform.filter((b) => b.measured >= MIN_SAMPLE).sort((a, b) => (b.score_avg ?? 0) - (a.score_avg ?? 0));
    if (ranked.length > 1) {
      recommendations.push(`Площадка с лучшим откликом: ${ranked[0].key} (score ${ranked[0].score_avg}); слабее всего — ${ranked[ranked.length - 1].key} (score ${ranked[ranked.length - 1].score_avg}).`);
    }
  }
  for (const b of byPlatform) {
    if (b.verified_rate != null && b.verified_rate < 80 && b.publications >= MIN_SAMPLE) {
      recommendations.push(`${b.key}: подтверждено только ${b.verified_rate}% публикаций — проверьте права токенов, часть постов могла не выйти.`);
    }
  }
  if (accountsBottom.length && accountsTop.length && (accountsTop[0].score_avg ?? 0) > 0) {
    const weak = accountsBottom[0];
    recommendations.push(`Слабее всех ${weak.account_name} (score ${weak.score_avg ?? 0}) — сравните с лидером ${accountsTop[0].account_name} (${accountsTop[0].score_avg}): подписи, время, разгон.`);
  }
  if (errors.length) {
    const top = errors[0];
    const share = input.failures.length ? Math.round((top.count / input.failures.length) * 100) : 0;
    const hint: Record<string, string> = {
      AUTH_EXPIRED: "переподключите аккаунты — токены протухли",
      AUTH_REVOKED: "площадка отозвала доступ — нужен reconnect",
      RECONNECT_REQUIRED: "аккаунты ждут переподключения",
      RATE_LIMIT: "снизьте дневной лимит или разнесите слоты",
      MEDIA_INVALID: "проверьте формат и длительность роликов",
      MEDIA_TOO_LARGE: "уменьшите вес файлов",
      ACCOUNT_RESTRICTED: "аккаунты под ограничением площадки — пауза и разгон заново",
      PLATFORM_TEMPORARY_ERROR: "сбои площадки — повтор по политике уже идёт",
    };
    recommendations.push(`Главная причина отказов за период — ${top.error_class} (${top.count}, ${share}% отказов${top.platforms.length ? `, ${top.platforms.join("/")}` : ""})${hint[top.error_class] ? `: ${hint[top.error_class]}` : "."}`);
  }
  if (topContent.length && (topContent[0].score_avg ?? 0) > 0) {
    recommendations.push(`Лучший ролик периода — «${topContent[0].title ?? topContent[0].content_id.slice(0, 8)}» (score ${topContent[0].score_avg}): кандидат на варианты по группам.`);
  }
  for (const [label, buckets] of [["хук", byHook], ["призыв", byCta], ["тема", byTopic]] as const) {
    const shown = buckets.filter((b) => b.measured >= MIN_SAMPLE);
    if (shown.length >= 2) {
      recommendations.push(`Лучший ${label} — «${shown[0].key}» (score ${shown[0].score_avg}), слабейший — «${shown[shown.length - 1].key}» (score ${shown[shown.length - 1].score_avg}).`);
    }
  }

  return {
    period_days: input.periodDays,
    publications: pubs.length,
    measured: measured.length,
    verified_rate: verifiable ? Math.round((verified / verifiable) * 100) : null,
    views_total: measured.reduce((s, p) => s + (p.views ?? 0), 0),
    by_platform: byPlatform,
    by_hour: byHour,
    by_weekday: byWeekday,
    best_hours: bestHours,
    best_weekdays: bestWeekdays,
    accounts_top: accountsTop,
    accounts_bottom: accountsBottom,
    errors,
    top_content: topContent,
    by_hook: byHook,
    by_cta: byCta,
    by_topic: byTopic,
    recommendations,
  };
}
