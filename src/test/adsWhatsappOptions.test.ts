import { describe, expect, it } from "vitest";

/** Mirrors GoalAssetsPicker phone helpers — keep in sync. */
function normalizeWa(raw: string | null | undefined) {
  return String(raw ?? "").replace(/\D+/g, "");
}

function mergeWaOptions(
  meta: Array<{ id: string; display_phone_number: string }>,
  cabinetNumber: string | null | undefined,
) {
  type WaOpt = { id: string; display: string; source: "meta" | "cabinet" };
  const fromMeta: WaOpt[] = meta.map((p) => ({
    id: normalizeWa(p.id) || normalizeWa(p.display_phone_number) || p.id,
    display: p.display_phone_number || p.id,
    source: "meta",
  }));
  const seen = new Set(fromMeta.map((p) => normalizeWa(p.id)).filter(Boolean));
  const cabinetDigits = normalizeWa(cabinetNumber);
  if (cabinetDigits && !seen.has(cabinetDigits)) {
    fromMeta.push({
      id: cabinetDigits,
      display: `+${cabinetDigits} · из настроек`,
      source: "cabinet",
    });
  }
  return fromMeta;
}

describe("ads WhatsApp number options", () => {
  it("falls back to cabinet number when Meta list is empty", () => {
    const opts = mergeWaOptions([], "77472842595");
    expect(opts).toHaveLength(1);
    expect(opts[0]!.id).toBe("77472842595");
    expect(opts[0]!.source).toBe("cabinet");
  });

  it("does not duplicate cabinet number already returned by Meta", () => {
    const opts = mergeWaOptions(
      [{ id: "77472842595", display_phone_number: "+7 747 284 25 95" }],
      "+7 (747) 284-25-95",
    );
    expect(opts).toHaveLength(1);
    expect(opts[0]!.source).toBe("meta");
  });

  it("normalizes non-digit cabinet input", () => {
    expect(normalizeWa("+7 747 284-25-95")).toBe("77472842595");
  });
});
