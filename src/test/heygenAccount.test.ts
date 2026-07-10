import { describe, expect, it } from "vitest";
import {
  formatHeygenBalance,
  parseHeygenAccount,
  resolveAccountSpent,
  sumEstimatedVideoSpend,
  videosInSpendPeriod,
} from "@/lib/heygenAccount";
import { monthRange } from "@/components/dashboard/PeriodPicker";

describe("heygenAccount", () => {
  it("parses usage_based billing like HeyGen dashboard", () => {
    const stats = parseHeygenAccount({
      billing_type: "usage_based",
      usage_based: {
        spending_current_usd: 3.71,
        remaining_credits: 1.37,
      },
    });
    expect(stats.remaining).toBe(1.37);
    expect(stats.remainingIsUsd).toBe(true);
    expect(stats.spentUsd).toBe(3.71);
    expect(formatHeygenBalance(stats.remaining, stats.remainingIsUsd)).toBe("$1.37");
  });

  it("sums estimated spend for completed videos in period", () => {
    const now = Math.floor(Date.now() / 1000);
    const total = sumEstimatedVideoSpend(
      [
        {
          id: "v1",
          title: "A",
          status: "completed",
          createdAt: now,
          durationSec: 60,
          costUsd: 2,
        },
        {
          id: "v2",
          title: "B",
          status: "failed",
          createdAt: now,
          durationSec: 60,
          costUsd: 2,
        },
      ],
      now - 10,
      now + 10,
    );
    expect(total).toBe(2);
  });

  it("wallet spend is a live sum of the account's own videos, not a stale snapshot", () => {
    const july = monthRange(new Date(2026, 6, 15));
    const stats = parseHeygenAccount({
      billing_type: "wallet",
      wallet: { currency: "usd", remaining_balance: 1.37 },
    });
    const ts = Math.floor(new Date("2026-07-10T12:00:00").getTime() / 1000);

    const noVideos = resolveAccountSpent(stats, [], july);
    expect(noVideos.amount).toBeNull();

    const videos = [
      { id: "a", title: "A", status: "completed", createdAt: ts, durationSec: 60, costUsd: 2 },
      { id: "b", title: "B", status: "completed", createdAt: ts, durationSec: 30, costUsd: 1 },
    ];
    const spent = resolveAccountSpent(stats, videos, july);
    expect(spent.amount).toBe(3);
    expect(spent.videoCount).toBe(2);
  });

  it("wallet ignores subscription-era videos outside API window", () => {
    const july = monthRange(new Date(2026, 7, 15)); // август 2026
    const stats = parseHeygenAccount({
      billing_type: "wallet",
      wallet: { currency: "usd", remaining_balance: 1.37 },
    });

    const oldTs = Math.floor(new Date("2026-07-01T12:00:00").getTime() / 1000);
    const apiTs = Math.floor(new Date("2026-08-02T12:00:00").getTime() / 1000);

    const periodVideos = videosInSpendPeriod(
      [
        {
          id: "sub",
          title: "sub",
          status: "completed",
          createdAt: oldTs,
          durationSec: 120,
          costUsd: 4,
        },
        {
          id: "api",
          title: "api",
          status: "completed",
          createdAt: apiTs,
          durationSec: 60,
          costUsd: 2,
        },
      ],
      july,
      "wallet",
    );

    expect(periodVideos).toHaveLength(1);
    expect(periodVideos[0]?.id).toBe("api");

    const spent = resolveAccountSpent(stats, periodVideos, july);
    expect(spent.amount).toBe(2);
  });
});
