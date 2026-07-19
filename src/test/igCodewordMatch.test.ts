import { describe, expect, it } from "vitest";

/** Pure helpers mirroring ig-webhook match rules (keep in sync with edge fn). */
function matchCodeword(
  rows: Array<{ codeword: string; reel_id: string | null }>,
  mediaId: string | null,
  text: string,
) {
  const low = text.toLowerCase();
  return (
    rows.find(
      (k) =>
        low.includes(String(k.codeword ?? "").toLowerCase()) &&
        (!k.reel_id || k.reel_id === mediaId),
    ) ?? null
  );
}

describe("ig codeword match", () => {
  const rows = [
    { codeword: "хаб", reel_id: null as string | null },
    { codeword: "кейс", reel_id: "media-1" },
  ];

  it("matches хаб case-insensitively as substring", () => {
    expect(matchCodeword(rows, null, "Хаб")?.codeword).toBe("хаб");
    expect(matchCodeword(rows, "any", "дайте хаб плиз")?.codeword).toBe("хаб");
  });

  it("respects reel_id binding when set", () => {
    expect(matchCodeword(rows, "media-2", "кейс")).toBeNull();
    expect(matchCodeword(rows, "media-1", "кейс")?.codeword).toBe("кейс");
  });
});
