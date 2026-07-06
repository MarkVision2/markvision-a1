import { describe, it, expect } from "vitest";
import {
  formatMetaSyncMessages,
  metaSyncUntilForRange,
  ymdAlmaty,
  ymdAlmatyFromIso,
  type MetaFullSyncResult,
} from "@/lib/metaSync";

describe("ymdAlmaty / metaSyncUntilForRange", () => {
  it("включает сегодняшний день в ручную синхронизацию", () => {
    const today = ymdAlmaty();
    expect(metaSyncUntilForRange(today)).toBe(today);
    expect(metaSyncUntilForRange("2099-12-31")).toBe(today);
  });

  it("оставляет прошлые даты без изменений", () => {
    expect(metaSyncUntilForRange("2024-01-15")).toBe("2024-01-15");
  });

  it("ymdAlmatyFromIso совпадает с днём Meta date_start", () => {
    expect(ymdAlmatyFromIso("2026-06-01T20:00:00Z")).toBe("2026-06-02");
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

  it("показывает ошибку отсутствия токена", () => {
    const msg = formatMetaSyncMessages({
      daily: {
        kind: "daily",
        ok: false,
        error: "Meta access token не настроен. Укажите токен в Настройках → Автоматизация.",
        results: [],
      },
      structure: { kind: "structure", ok: false, error: "Meta access token не настроен.", results: [] },
    });
    expect(msg.error).toContain("токен");
  });
});
