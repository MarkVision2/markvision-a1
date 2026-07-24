import { describe, expect, it } from "vitest";

/**
 * Mirrors ig-webhook comment event collection + id extraction.
 * Keep in sync with supabase/functions/ig-webhook/index.ts
 */
function collectCommentEvents(entry: Record<string, unknown>) {
  const commentEvents: Array<{ field: string; value: Record<string, unknown> }> = [];
  for (const change of (entry.changes as Array<{ field?: string; value?: unknown }> | undefined) ?? []) {
    if (change?.field === "comments" || change?.field === "live_comments") {
      commentEvents.push({
        field: String(change.field),
        value: (change.value ?? {}) as Record<string, unknown>,
      });
    }
  }
  if (entry.field === "comments" || entry.field === "live_comments") {
    commentEvents.push({
      field: String(entry.field),
      value: (entry.value ?? {}) as Record<string, unknown>,
    });
  }
  return commentEvents;
}

function extractComment(v: Record<string, unknown>) {
  const from = (v.from ?? {}) as { id?: string; username?: string };
  const media = (v.media ?? {}) as { id?: string };
  const commentId = (v.comment_id ?? v.id) != null ? String(v.comment_id ?? v.id) : null;
  const mediaId =
    media.id != null ? String(media.id) : v.media_id != null ? String(v.media_id) : null;
  return {
    commentId,
    mediaId,
    text: String(v.text ?? ""),
    fromId: from.id != null ? String(from.id) : null,
    username: from.username != null ? String(from.username) : null,
  };
}

function matchLongest(
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

function legacyVariants(raw: string | null | undefined) {
  const text = raw?.trim();
  if (!text) return [];
  const parts = text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  return parts.length > 1 ? parts : [text];
}

describe("ig-webhook Instagram Login comment payload", () => {
  it("reads field/value on entry (no changes[])", () => {
    const entry = {
      id: "17841439242678602",
      time: 1,
      field: "comments",
      value: {
        id: "18185551606400466",
        text: "Хаб",
        from: { id: "27271353945897631", username: "chalykh_aa" },
        media: { id: "17959585533175214", media_product_type: "REELS" },
      },
    };
    const events = collectCommentEvents(entry);
    expect(events).toHaveLength(1);
    const c = extractComment(events[0]!.value);
    expect(c.commentId).toBe("18185551606400466");
    expect(c.text).toBe("Хаб");
    expect(c.fromId).toBe("27271353945897631");
    expect(c.mediaId).toBe("17959585533175214");
  });

  it("reads Facebook Login changes[] with comment_id", () => {
    const entry = {
      id: "17841439242678602",
      changes: [
        {
          field: "comments",
          value: {
            comment_id: "cid-1",
            text: "хаб",
            from: { id: "u1", username: "u" },
            media: { id: "m1" },
          },
        },
      ],
    };
    const events = collectCommentEvents(entry);
    expect(events).toHaveLength(1);
    expect(extractComment(events[0]!.value).commentId).toBe("cid-1");
  });

  it("prefers longest codeword over +", () => {
    const rows = [
      { codeword: "+", reel_id: null as string | null },
      { codeword: "хаб", reel_id: null },
    ];
    expect(matchLongest(rows, null, "хаб +")?.codeword).toBe("хаб");
    expect(matchLongest(rows, null, "+")?.codeword).toBe("+");
  });

  it("splits legacy newline-joined reply_text into variants", () => {
    expect(legacyVariants("one\ntwo\nthree")).toEqual(["one", "two", "three"]);
    expect(legacyVariants("single")).toEqual(["single"]);
  });
});
