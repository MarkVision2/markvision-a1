import { describe, expect, it } from "vitest";

/** Pure helpers mirroring ig-webhook match rules (keep in sync with edge fn). */
function matchCodeword(
  rows: Array<{ codeword: string; reel_id: string | null }>,
  mediaId: string | null,
  text: string,
) {
  const low = text.toLowerCase();
  const matches = rows.filter((k) => {
    const cw = String(k.codeword ?? "").toLowerCase();
    return cw.length > 0 && low.includes(cw) && (!k.reel_id || k.reel_id === mediaId);
  });
  matches.sort((a, b) => String(b.codeword).length - String(a.codeword).length);
  return matches[0] ?? null;
}

describe("ig codeword match", () => {
  const rows = [
    { codeword: "+", reel_id: null as string | null },
    { codeword: "хаб", reel_id: null as string | null },
    { codeword: "кейс", reel_id: "media-1" },
  ];

  it("matches хаб case-insensitively as substring", () => {
    expect(matchCodeword(rows, null, "Хаб")?.codeword).toBe("хаб");
    expect(matchCodeword(rows, "any", "дайте хаб плиз")?.codeword).toBe("хаб");
  });

  it("prefers longer codeword over +", () => {
    expect(matchCodeword(rows, null, "хаб +")?.codeword).toBe("хаб");
  });

  it("respects reel_id binding when set", () => {
    expect(matchCodeword(rows, "media-2", "кейс")).toBeNull();
    expect(matchCodeword(rows, "media-1", "кейс")?.codeword).toBe("кейс");
  });
});
