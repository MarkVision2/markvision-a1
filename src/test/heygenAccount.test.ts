import { describe, expect, it } from "vitest";
import {
  formatHeygenBalance,
  parseHeygenAccount,
  sumEstimatedVideoSpend,
} from "@/lib/heygenAccount";

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
    );
    expect(total).toBe(2);
  });
});
