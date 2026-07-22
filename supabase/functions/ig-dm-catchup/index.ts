// Catch-up for Instagram Direct codewords when Meta webhooks are dropped.
//
// Problem: inbound DM webhooks sometimes never reach ig-webhook (seen with
// @urvn.tt writing «хаб» — conversation had the text, no codeword_dm event).
// Outbound Graph send still works. This worker polls recent conversations and
// replies to unmatched codeword messages.
//
// Cron: every minute via pg_cron → x-automation-key = automation_settings.cron_secret.
import { IG_WEBHOOK_SUBSCRIBED_FIELDS, matchLongestCodeword } from "../_lib/igCodewordMessaging.ts";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H: Record<string, string> = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
};
const GRAPH_FB = "https://graph.facebook.com/v21.0";
const GRAPH_IG = "https://graph.instagram.com/v21.0";
const PUBLIC_LINK_ORIGIN = Deno.env.get("IG_PUBLIC_LINK_ORIGIN") ?? "https://www.markvision.kz";
const DEFAULT_DM_TEXT = "Готово! Жми кнопку ниже и забирай доступ 👇";
const DEFAULT_BUTTON_TITLE = "получить доступ";

/** How far back to scan conversation updates / messages. */
const LOOKBACK_MS = 45 * 60 * 1000;
/** Soft anti-spam: one successful auto-DM per sender+codeword in this window. */
const DEDUPE_MS = 2 * 60 * 60 * 1000;
const CONV_LIMIT = 30;
const MSG_LIMIT = 15;

type Account = {
  project_id: string;
  ig_user_id: string;
  username: string | null;
  page_access_token: string | null;
  ig_login_access_token: string | null;
};

type Codeword = {
  id: string;
  codeword: string;
  reel_id: string | null;
  reel_url: string | null;
  target_url: string | null;
  short_id: string;
  dm_text: string | null;
  dm_messages: unknown;
  target_urls: unknown;
};

async function db(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...H, ...(init.headers as Record<string, string> || {}) },
  });
  const t = await r.text();
  try {
    return t ? JSON.parse(t) : null;
  } catch {
    return null;
  }
}

async function dbRaw(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...H, ...(init.headers as Record<string, string> || {}) },
  });
  const t = await r.text();
  let json: unknown = null;
  try {
    json = t ? JSON.parse(t) : null;
  } catch { /* noop */ }
  return { status: r.status, json };
}

async function cronSecret(): Promise<string | null> {
  const rows = await db("automation_settings?id=eq.true&select=cron_secret&limit=1");
  const v = rows?.[0]?.cron_secret;
  return typeof v === "string" && v.length > 0 ? v : null;
}

function asStringArray(raw: unknown, max = 10): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((v) => String(v).trim()).filter(Boolean).slice(0, max);
}

function pickRandom(items: string[]): string | null {
  if (items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)] ?? null;
}

function resolveDmText(kw: Codeword): string {
  return pickRandom(asStringArray(kw.dm_messages)) ??
    (kw.dm_text?.trim() || DEFAULT_DM_TEXT);
}

function resolveTargetUrlIndexed(kw: Codeword): { value: string; index: number } | null {
  const urls = asStringArray(kw.target_urls);
  if (urls.length > 0) {
    const index = Math.floor(Math.random() * urls.length);
    return { value: urls[index]!, index };
  }
  const legacy = kw.target_url?.trim();
  return legacy ? { value: legacy, index: 0 } : null;
}

function buildTrackingLink(
  shortId: string,
  username: string | null,
  linkIndex: number | null,
): string {
  const params = new URLSearchParams();
  if (username) params.set("u", username);
  if (linkIndex != null && linkIndex >= 0) params.set("v", String(linkIndex));
  const q = params.toString();
  return `${PUBLIC_LINK_ORIGIN}/r/${encodeURIComponent(shortId)}${q ? `?${q}` : ""}`;
}

function ymd(d: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Almaty",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function graphHost(account: Account) {
  if (account.ig_login_access_token) return GRAPH_IG;
  return GRAPH_FB;
}

function bearer(account: Account): string | null {
  return account.ig_login_access_token || account.page_access_token;
}

async function sendDmToUser(
  account: Account,
  recipientId: string,
  opts: { text: string; buttonUrl: string },
) {
  const token = bearer(account);
  if (!token) return { ok: false, body: { error: "no token" }, mode: "none" as const };
  const host = graphHost(account);
  const igUserId = account.ig_user_id;

  const buttonBody = {
    recipient: { id: recipientId },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: opts.text.slice(0, 640),
          buttons: [{ type: "web_url", url: opts.buttonUrl, title: DEFAULT_BUTTON_TITLE }],
        },
      },
    },
  };
  const r1 = await fetch(`${host}/${igUserId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(buttonBody),
  });
  const j1 = await r1.json().catch(() => ({}));
  if (r1.ok) return { ok: true, body: j1, mode: "button" as const };

  const textBody = {
    recipient: { id: recipientId },
    message: { text: `${opts.text}\n${opts.buttonUrl}`.slice(0, 1000) },
  };
  const r2 = await fetch(`${host}/${igUserId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(textBody),
  });
  const j2 = await r2.json().catch(() => ({}));
  return {
    ok: r2.ok,
    body: r2.ok ? j2 : { button_error: j1, text_error: j2 },
    mode: r2.ok ? ("text_fallback" as const) : ("failed" as const),
  };
}

async function claimEvent(
  projectId: string,
  kw: Codeword,
  mid: string,
  username: string | null,
): Promise<string | null> {
  const { status, json } = await dbRaw("instagram_organic_events", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      project_id: projectId,
      codeword_id: kw.id,
      codeword: kw.codeword,
      reel_id: kw.reel_id,
      reel_url: kw.reel_url,
      event_type: "codeword_dm",
      username,
      external_id: mid,
      date: ymd(new Date()),
      occurred_at: new Date().toISOString(),
      payload: { stage: "claimed", source: "catchup" },
    }),
  });
  if (status === 409) return null;
  if (status >= 400) {
    console.error("[ig-dm-catchup] claim failed", status, json);
    return null;
  }
  const row = Array.isArray(json) ? (json[0] as { id?: string } | undefined) : undefined;
  return row?.id ?? null;
}

async function finalizeEvent(eventId: string, payload: Record<string, unknown>) {
  await db(`instagram_organic_events?id=eq.${eventId}`, {
    method: "PATCH",
    body: JSON.stringify({ payload }),
  });
}

async function alreadyRepliedRecently(
  projectId: string,
  codewordId: string,
  senderId: string,
  username: string | null,
): Promise<boolean> {
  const since = new Date(Date.now() - DEDUPE_MS).toISOString();
  // Prefer username match; also scan recent rows and check payload.recipient_id.
  const rows = await db(
    `instagram_organic_events?project_id=eq.${projectId}&codeword_id=eq.${codewordId}&event_type=eq.codeword_dm&occurred_at=gte.${encodeURIComponent(since)}&select=id,username,payload&order=occurred_at.desc&limit=40`,
  );
  if (!Array.isArray(rows)) return false;
  for (const row of rows) {
    if (username && row.username === username) return true;
    const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
    if (payload.recipient_id === senderId && payload.dm_status === "sent") return true;
    if (payload.recipient_id === senderId && payload.source === "catchup") return true;
    if (payload.recipient_id === senderId && payload.source === "dm") return true;
  }
  return false;
}

async function ensureSubscribed(account: Account) {
  const token = bearer(account);
  if (!token) return;
  const host = graphHost(account);
  try {
    await fetch(
      `${host}/${encodeURIComponent(account.ig_user_id)}/subscribed_apps?subscribed_fields=${encodeURIComponent(IG_WEBHOOK_SUBSCRIBED_FIELDS)}&access_token=${encodeURIComponent(token)}`,
      { method: "POST" },
    );
  } catch {
    /* best-effort */
  }
}

type GraphMsg = {
  id?: string;
  created_time?: string;
  message?: string;
  from?: { id?: string; username?: string };
};

async function processAccount(account: Account, codewords: Codeword[]) {
  const token = bearer(account);
  if (!token || codewords.length === 0) {
    return { scanned: 0, matched: 0, sent: 0, skipped: 0 };
  }
  await ensureSubscribed(account);
  const host = graphHost(account);
  const sinceMs = Date.now() - LOOKBACK_MS;
  let scanned = 0;
  let matched = 0;
  let sent = 0;
  let skipped = 0;

  const convUrl =
    `${host}/${encodeURIComponent(account.ig_user_id)}/conversations` +
    `?platform=instagram&limit=${CONV_LIMIT}` +
    `&fields=${encodeURIComponent(
      `id,updated_time,participants{id,username},messages.limit(${MSG_LIMIT}){id,created_time,from,message}`,
    )}` +
    `&access_token=${encodeURIComponent(token)}`;

  const convRes = await fetch(convUrl);
  const convJson = await convRes.json().catch(() => ({}));
  if (!convRes.ok) {
    console.error("[ig-dm-catchup] conversations failed", account.ig_user_id, convJson);
    return { scanned: 0, matched: 0, sent: 0, skipped: 0, error: convJson };
  }

  for (const conv of convJson?.data ?? []) {
    const updated = conv.updated_time ? Date.parse(String(conv.updated_time)) : 0;
    if (updated && updated < sinceMs) continue;

    const messages: GraphMsg[] = conv.messages?.data ?? [];
    // Oldest → newest so first codeword gets the reply; later ones soft-dedupe.
    const ordered = [...messages].reverse();
    for (const msg of ordered) {
      scanned += 1;
      const fromId = msg.from?.id != null ? String(msg.from.id) : null;
      if (!fromId || fromId === account.ig_user_id) continue;
      const created = msg.created_time ? Date.parse(String(msg.created_time)) : 0;
      if (created && created < sinceMs) continue;
      const text = String(msg.message ?? "").trim();
      if (!text) continue;
      const mid = msg.id ? String(msg.id) : null;
      if (!mid) continue;

      const kw = matchLongestCodeword(codewords, null, text);
      if (!kw) continue;
      matched += 1;

      const username = msg.from?.username ? String(msg.from.username) : null;
      if (await alreadyRepliedRecently(account.project_id, kw.id, fromId, username)) {
        skipped += 1;
        continue;
      }

      const eventId = await claimEvent(account.project_id, kw, mid, username);
      if (!eventId) {
        skipped += 1;
        continue;
      }

      const pickedLink = resolveTargetUrlIndexed(kw);
      const link = buildTrackingLink(kw.short_id, username, pickedLink?.index ?? null);
      const result = await sendDmToUser(account, fromId, {
        text: resolveDmText(kw),
        buttonUrl: link,
      });

      await finalizeEvent(eventId, {
        source: "catchup",
        mid,
        recipient_id: fromId,
        username,
        dm_status: result.ok ? "sent" : "failed",
        dm_mode: result.mode,
        dm_button_url: link,
        target_url: pickedLink?.value ?? null,
        target_url_index: pickedLink?.index ?? null,
        dm_error: result.ok ? null : result.body,
        inbound_text: text.slice(0, 120),
      });

      if (result.ok) sent += 1;
      else {
        console.error("[ig-dm-catchup] send failed", { mid, fromId, body: result.body });
      }
    }
  }

  return { scanned, matched, sent, skipped };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "authorization, x-client-info, apikey, content-type, x-automation-key",
      },
    });
  }
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response("method not allowed", { status: 405 });
  }

  const provided = req.headers.get("x-automation-key") ?? "";
  const expected = await cronSecret();
  if (!expected || provided !== expected) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const accounts = (await db(
    "instagram_accounts?active=eq.true&select=project_id,ig_user_id,username,page_access_token,ig_login_access_token",
  )) as Account[] | null;
  if (!Array.isArray(accounts) || accounts.length === 0) {
    return new Response(JSON.stringify({ ok: true, accounts: 0 }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const summary: Array<Record<string, unknown>> = [];
  for (const account of accounts) {
    if (!bearer(account)) continue;
    const codewords = (await db(
      `instagram_codewords?project_id=eq.${account.project_id}&active=eq.true&select=id,codeword,reel_id,reel_url,target_url,short_id,dm_text,dm_messages,target_urls`,
    )) as Codeword[] | null;
    if (!Array.isArray(codewords) || codewords.length === 0) continue;
    try {
      const result = await processAccount(account, codewords);
      summary.push({
        ig_user_id: account.ig_user_id,
        username: account.username,
        ...result,
      });
    } catch (e) {
      console.error("[ig-dm-catchup] account failed", account.ig_user_id, e);
      summary.push({
        ig_user_id: account.ig_user_id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return new Response(JSON.stringify({ ok: true, accounts: summary.length, summary }), {
    headers: { "Content-Type": "application/json" },
  });
});
