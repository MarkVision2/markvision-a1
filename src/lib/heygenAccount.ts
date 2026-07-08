import { estimateCost } from "@/lib/heygenUsage";

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
      // В кабинете HeyGen pay-as-you-go остаток/расход показываются в $.
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

export function monthStartTs(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000;
}

export function sumEstimatedVideoSpend(
  videos: HeygenVideoRow[],
  sinceTs = monthStartTs(),
): number {
  return videos
    .filter((v) => v.status === "completed" && (v.createdAt ?? 0) >= sinceTs)
    .reduce((sum, v) => sum + (v.costUsd ?? 0), 0);
}
