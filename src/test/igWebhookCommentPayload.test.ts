import { describe, expect, it } from "vitest";

/**
 * Mirrors ig-webhook comment event collection + id extraction.
 * Keep in sync with supabase/functions/ig-webhook/index.ts
 * and supabase/functions/_lib/igCodewordMessaging.ts
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

/** Mirrors supabase/functions/_lib/igCodewordMessaging.ts collectMessagingEvents */
function collectMessagingEvents(entry: Record<string, unknown>, igUserId: string) {
  type Ev = { senderId: string; mid: string; text: string; username: string | null };
  const out: Ev[] = [];
  const asRecord = (v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  const parse = (raw: unknown): Ev | null => {
    const ev = asRecord(raw);
    if (!ev) return null;
    const sender = asRecord(ev.sender);
    const msg = asRecord(ev.message);
    const senderId = sender?.id != null ? String(sender.id) : null;
    if (!senderId || senderId === igUserId) return null;
    if (!msg || msg.is_echo === true || msg.is_deleted === true) return null;
    const text = String(msg.text ?? "").trim();
    if (!text) return null;
    const mid = msg.mid != null ? String(msg.mid) : `${senderId}:${ev.timestamp ?? 0}`;
    const username = sender?.username != null ? String(sender.username) : null;
    return { senderId, mid, text, username };
  };
  const pushList = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      const p = parse(item);
      if (p) out.push(p);
    }
  };
  pushList(entry.messaging);
  pushList(entry.standby);
  const pushValue = (field: unknown, value: unknown) => {
    if (field !== "messages" && field !== "message_echoes") return;
    const rec = asRecord(value);
    if (!rec) return;
    if (Array.isArray(rec.messaging)) {
      pushList(rec.messaging);
      return;
    }
    if (rec.sender || rec.message) {
      const p = parse(rec);
      if (p) out.push(p);
    }
  };
  for (const change of (entry.changes as Array<Record<string, unknown>> | undefined) ?? []) {
    pushValue(change?.field, change?.value);
  }
  pushValue(entry.field, entry.value);
  const seen = new Set<string>();
  return out.filter((e) => {
    if (seen.has(e.mid)) return false;
    seen.add(e.mid);
    return true;
  });
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

describe("ig-webhook messaging payload shapes", () => {
  const ig = "17841439242678602";

  it("reads classic entry.messaging[]", () => {
    const entry = {
      id: ig,
      messaging: [
        {
          sender: { id: "2542785836227958", username: "urvn.tt" },
          recipient: { id: ig },
          timestamp: 1,
          message: { mid: "m1", text: "Хаб" },
        },
      ],
    };
    const evs = collectMessagingEvents(entry, ig);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({
      senderId: "2542785836227958",
      mid: "m1",
      text: "Хаб",
      username: "urvn.tt",
    });
  });

  it("reads standby[] (handover) the same way", () => {
    const entry = {
      id: ig,
      standby: [
        {
          sender: { id: "u2" },
          message: { mid: "m2", text: "хаб" },
        },
      ],
    };
    expect(collectMessagingEvents(entry, ig)[0]?.mid).toBe("m2");
  });

  it("reads Instagram Login field/value messages", () => {
    const entry = {
      id: ig,
      field: "messages",
      value: {
        sender: { id: "u3" },
        message: { mid: "m3", text: "хаб" },
      },
    };
    expect(collectMessagingEvents(entry, ig)[0]?.mid).toBe("m3");
  });

  it("skips echoes and empty text", () => {
    const entry = {
      id: ig,
      messaging: [
        { sender: { id: "u4" }, message: { mid: "e1", text: "хаб", is_echo: true } },
        { sender: { id: ig }, message: { mid: "e2", text: "хаб" } },
        { sender: { id: "u4" }, message: { mid: "e3", text: "  " } },
      ],
    };
    expect(collectMessagingEvents(entry, ig)).toHaveLength(0);
  });
});
