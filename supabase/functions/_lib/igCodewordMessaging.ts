/**
 * Shared helpers for Instagram codeword DM handling (ig-webhook + ig-dm-catchup).
 * Keep vitest mirrors in src/test/igWebhookCommentPayload.test.ts in sync for payload shapes.
 */

export type MessagingEvent = {
  senderId: string;
  mid: string;
  text: string;
  isEcho: boolean;
  username: string | null;
};

type LooseEntry = {
  id?: unknown;
  messaging?: unknown;
  standby?: unknown;
  field?: unknown;
  value?: unknown;
  changes?: unknown;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function parseMessagingItem(raw: unknown, igUserId: string): MessagingEvent | null {
  const ev = asRecord(raw);
  if (!ev) return null;
  const sender = asRecord(ev.sender);
  const msg = asRecord(ev.message);
  const senderId = sender?.id != null ? String(sender.id) : null;
  if (!senderId || senderId === igUserId) return null;
  if (!msg) return null;
  if (msg.is_echo === true || msg.is_deleted === true) return null;
  const text = String(msg.text ?? "").trim();
  if (!text) return null;
  const mid = msg.mid != null ? String(msg.mid) : `${senderId}:${ev.timestamp ?? Date.now()}`;
  const username = sender?.username != null ? String(sender.username) : null;
  return { senderId, mid, text, isEcho: false, username };
}

/**
 * Collect inbound text DMs from Meta webhook entry.
 * Supports:
 *  - Classic Messenger shape: entry.messaging[] / entry.standby[]
 *  - Instagram Login flat field: entry.field === "messages" + entry.value
 *  - changes[] with field "messages"
 */
export function collectMessagingEvents(entry: LooseEntry, igUserId: string): MessagingEvent[] {
  const out: MessagingEvent[] = [];
  const pushList = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      const parsed = parseMessagingItem(item, igUserId);
      if (parsed) out.push(parsed);
    }
  };

  pushList(entry.messaging);
  pushList(entry.standby);

  const pushValue = (field: unknown, value: unknown) => {
    if (field !== "messages" && field !== "message_echoes") return;
    // value may be a single messaging-like object or { messaging: [...] }
    const rec = asRecord(value);
    if (!rec) return;
    if (Array.isArray(rec.messaging)) {
      pushList(rec.messaging);
      return;
    }
    // Flat: value itself looks like one messaging event
    if (rec.sender || rec.message) {
      const parsed = parseMessagingItem(rec, igUserId);
      if (parsed) out.push(parsed);
    }
  };

  if (Array.isArray(entry.changes)) {
    for (const change of entry.changes) {
      const c = asRecord(change);
      if (!c) continue;
      pushValue(c.field, c.value);
    }
  }
  pushValue(entry.field, entry.value);

  // Deduplicate by mid within one entry
  const seen = new Set<string>();
  return out.filter((e) => {
    if (seen.has(e.mid)) return false;
    seen.add(e.mid);
    return true;
  });
}

export function matchLongestCodeword<T extends { codeword: string; reel_id?: string | null }>(
  rows: T[],
  mediaId: string | null,
  text: string,
): T | null {
  const low = text.toLowerCase();
  const matches = rows.filter((k) => {
    const cw = String(k.codeword ?? "").toLowerCase();
    return cw.length > 0 && low.includes(cw) && (!k.reel_id || k.reel_id === mediaId);
  });
  if (matches.length === 0) return null;
  matches.sort((a, b) => String(b.codeword).length - String(a.codeword).length);
  return matches[0] ?? null;
}

/** Instagram Login webhook fields we subscribe on the IG professional account. */
export const IG_WEBHOOK_SUBSCRIBED_FIELDS =
  "comments,live_comments,messages,messaging_postbacks,messaging_referral,messaging_seen,standby";
