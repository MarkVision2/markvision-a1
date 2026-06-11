import { describe, it, expect } from "vitest";
import {
  capMetaSyncUntil,
  formatMetaSyncMessages,
  type MetaFullSyncResult,
} from "@/lib/metaSync";

describe("capMetaSyncUntil", () => {
  it("не запрашивает сегодняшний день", () => {
    const today = new Date();
    const todayYmd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const capped = capMetaSyncUntil(todayYmd);
    expect(capped < todayYmd).toBe(true);
  });

  it("оставляет прошлые даты без изменений", () => {
    expect(capMetaSyncUntil("2024-01-15")).toBe("2024-01-15");
  });
});

describe("formatMetaSyncMessages", () => {
  const base: MetaFullSyncResult = {
    daily: { kind: "daily", ok: true, results: [] },
    structure: { kind: "structure", ok: true, results: [] },
  };

  it("показывает успех по расходам и структуре", () => {
    const msg = formatMetaSyncMessages({
      daily: {
        ...base.daily,
        results: [{ ok: true, cabinet: "act_1", days: 5, leads: 10, spend: 12000 }],
      },
      structure: {
        ...base.structure,
        results: [{ ok: true, cabinet: "act_1", campaigns: 3, creatives: 7 }],
      },
    });
    expect(msg.success).toContain("расходы/лиды");
    expect(msg.success).toContain("кампании/креативы");
    expect(msg.error).toBeUndefined();
  });

  it("сообщает если нет кабинетов с external_id", () => {
    const msg = formatMetaSyncMessages(base);
    expect(msg.error).toContain("Ad Account ID");
  });

  it("предупреждает при 403 на daily", () => {
    const msg = formatMetaSyncMessages({
      daily: { kind: "daily", ok: false, error: "Forbidden", results: [] },
      structure: {
        kind: "structure",
        ok: true,
        results: [{ ok: true, cabinet: "act_1", campaigns: 1, creatives: 2 }],
      },
    });
    expect(msg.success).toContain("кампании/креативы");
    expect(msg.warnings.some((w) => w.includes("Forbidden"))).toBe(true);
  });
});
