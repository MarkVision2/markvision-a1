import { estimateCost } from "@/lib/heygenUsage";
import type { ReportPeriodRange } from "@/hooks/useReportData";

type RawPool = { remaining?: number | null };

export type RawUserProfile = {
  billing_type?: string | null;
  wallet?: { currency?: string; remaining_balance?: number | null } | null;
  subscription?: {
    credits?: { premium_credits?: RawPool; add_on_credits?: RawPool };
  } | null;
  usage_based?: {
    spending_current_usd?: number | null;
    spending_cap_usd?: number | null;
    remaining_credits?: number | null;
    included_credits?: number | null;
  } | null;
};

export interface HeygenAccountStats {
  billingType: string | null;
  remaining: number | null;
  remainingIsUsd: boolean;
  spentUsd: number | null;
  spendingCapUsd: number | null;
}

export interface HeygenVideoRow {
  id: string;
  title: string | null;
  status: string;
  createdAt: number | null;
  durationSec: number | null;
  costUsd: number | null;
}

/** С какой даты аккаунт на API-кошельке (ролики по подписке раньше — не в расход кошелька). */
export const HEYGEN_WALLET_API_SINCE = "2026-07-07";

/** Зафиксированный расход API-кошелька до точного учёта по роликам (YYYY-MM). */
export const WALLET_SPENT_BASELINES: Record<string, number> = {
  "2026-07": 5.28,
};

export function parseHeygenAccount(raw: RawUserProfile): HeygenAccountStats {
  const bt = raw.billing_type ?? null;

  if (bt === "wallet" && raw.wallet) {
    return {
      billingType: bt,
      remaining: raw.wallet.remaining_balance ?? null,
      remainingIsUsd: raw.wallet.currency === "usd",
      spentUsd: null,
      spendingCapUsd: null,
    };
  }

  if (bt === "usage_based" && raw.usage_based) {
    const ub = raw.usage_based;
    return {
      billingType: bt,
      remaining: ub.remaining_credits ?? null,
      remainingIsUsd: true,
      spentUsd: ub.spending_current_usd ?? null,
      spendingCapUsd: ub.spending_cap_usd ?? null,
    };
  }

  if (bt === "subscription" && raw.subscription) {
    const prem = raw.subscription.credits?.premium_credits?.remaining ?? 0;
    const addon = raw.subscription.credits?.add_on_credits?.remaining ?? 0;
    return {
      billingType: bt,
      remaining: prem + addon,
      remainingIsUsd: false,
      spentUsd: null,
      spendingCapUsd: null,
    };
  }

  return {
    billingType: bt,
    remaining: null,
    remainingIsUsd: false,
    spentUsd: null,
    spendingCapUsd: null,
  };
}

export function formatHeygenBalance(remaining: number | null, asUsd: boolean): string {
  if (remaining == null) return "—";
  if (asUsd) return `$${remaining.toFixed(2)}`;
  return `${Math.round(remaining)} кредитов`;
}

export function formatHeygenUsd(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `$${n.toFixed(2)}`;
}

/** Оценка расхода по длительности (Video Agent по умолчанию). */
export function estimateHeygenVideoCost(durationSec?: number | null, mode = "agent"): number | null {
  return estimateCost(mode, durationSec ?? null);
}

export function isCurrentMonth(range: ReportPeriodRange): boolean {
  const now = new Date();
  return range.from.getFullYear() === now.getFullYear() && range.from.getMonth() === now.getMonth();
}

export function periodKey(range: ReportPeriodRange): string {
  const y = range.from.getFullYear();
  const m = range.from.getMonth() + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

export function formatPeriodMonth(range: ReportPeriodRange): string {
  const months = [
    "январь", "февраль", "март", "апрель", "май", "июнь",
    "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
  ];
  return `${months[range.from.getMonth()]} ${range.from.getFullYear()}`;
}

export function rangeBoundsSec(range: ReportPeriodRange): { fromTs: number; toTs: number } {
  const fromTs = Math.floor(
    new Date(range.from.getFullYear(), range.from.getMonth(), range.from.getDate()).getTime() / 1000,
  );
  const toTs = Math.floor(
    new Date(range.to.getFullYear(), range.to.getMonth(), range.to.getDate(), 23, 59, 59).getTime() / 1000,
  );
  return { fromTs, toTs };
}

export function walletApiSinceTs(): number {
  return Math.floor(new Date(`${HEYGEN_WALLET_API_SINCE}T00:00:00`).getTime() / 1000);
}

export function isInRangeSec(ts: number | null | undefined, fromTs: number, toTs: number): boolean {
  if (ts == null || ts <= 0) return false;
  return ts >= fromTs && ts <= toTs;
}

export function isInReportPeriod(iso: string, range: ReportPeriodRange): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const start = new Date(range.from.getFullYear(), range.from.getMonth(), range.from.getDate());
  const end = new Date(range.to.getFullYear(), range.to.getMonth(), range.to.getDate(), 23, 59, 59);
  return d >= start && d <= end;
}

export function sumEstimatedVideoSpend(
  videos: HeygenVideoRow[],
  fromTs: number,
  toTs: number,
): number {
  return videos
    .filter((v) => v.status === "completed" && isInRangeSec(v.createdAt, fromTs, toTs))
    .reduce((sum, v) => sum + (v.costUsd ?? 0), 0);
}

export function videosInSpendPeriod(
  videos: HeygenVideoRow[],
  range: ReportPeriodRange,
  billingType: string | null | undefined,
): HeygenVideoRow[] {
  const { fromTs, toTs } = rangeBoundsSec(range);
  const walletSince = walletApiSinceTs();
  const effectiveFrom = billingType === "wallet" ? Math.max(fromTs, walletSince) : fromTs;

  return videos.filter(
    (v) => v.status === "completed" && isInRangeSec(v.createdAt, effectiveFrom, toTs),
  );
}

export interface AccountSpentEstimate {
  amount: number | null;
  label: string;
  videoCount: number;
}

/** Расход аккаунта за выбранный период. */
export function resolveAccountSpent(
  account: HeygenAccountStats | undefined,
  videos: HeygenVideoRow[],
  range: ReportPeriodRange,
): AccountSpentEstimate {
  const periodLabel = formatPeriodMonth(range);

  if (!account) {
    return { amount: null, label: "", videoCount: 0 };
  }

  const periodVideos = videosInSpendPeriod(videos, range, account.billingType);
  const { fromTs, toTs } = rangeBoundsSec(range);
  const walletSince = walletApiSinceTs();
  const effectiveFrom =
    account.billingType === "wallet" ? Math.max(fromTs, walletSince) : fromTs;

  if (account.billingType === "wallet") {
    const baseline = WALLET_SPENT_BASELINES[periodKey(range)];
    if (baseline != null) {
      return {
        amount: baseline,
        label: `API-кошелёк · ${periodLabel}`,
        videoCount: periodVideos.length,
      };
    }

    const amount =
      periodVideos.length > 0 ? sumEstimatedVideoSpend(periodVideos, effectiveFrom, toTs) : null;
    return {
      amount,
      label:
        periodVideos.length > 0
          ? `оценка по ${periodVideos.length} роликам · ${periodLabel}`
          : `нет API-роликов · ${periodLabel}`,
      videoCount: periodVideos.length,
    };
  }

  if (account.spentUsd != null && isCurrentMonth(range)) {
    return {
      amount: account.spentUsd,
      label: `текущий период в HeyGen · ${periodLabel}`,
      videoCount: periodVideos.length,
    };
  }

  const amount =
    periodVideos.length > 0 ? sumEstimatedVideoSpend(periodVideos, effectiveFrom, toTs) : null;
  return {
    amount,
    label:
      periodVideos.length > 0
        ? `оценка по ${periodVideos.length} роликам · ${periodLabel}`
        : `нет роликов · ${periodLabel}`,
    videoCount: periodVideos.length,
  };
}

/** Remote-ролики HeyGen за выбранный период (с учётом биллинга). */
export function remoteVideosForPeriod(
  account: HeygenAccountStats | undefined,
  videos: HeygenVideoRow[],
  range: ReportPeriodRange,
): HeygenVideoRow[] {
  return videosInSpendPeriod(videos, range, account?.billingType);
}
