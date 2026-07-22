// Вебхук Instagram (мультитенантный): комментарий с код-словом →
// публичный ответ + приватный DM с кнопкой «получить доступ», per-project.
//
// Аккаунт ищется в instagram_accounts по ig_user_id. DM предпочтительно
// через Instagram Login токен (graph.instagram.com) — Page-токен на этом
// Meta-приложении для messages падает с (#3). Варианты ответов берутся из
// comment_replies / dm_messages (с фолбэком на legacy reply_text / dm_text).
import { collectMessagingEvents } from "../_lib/igCodewordMessaging.ts";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H: Record<string, string> = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
};
const GRAPH_FB = "https://graph.facebook.com/v21.0";
const GRAPH_IG = "https://graph.instagram.com/v21.0";

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

async function setting(key: string): Promise<string | undefined> {
  const rows = await db(`cf_settings?key=eq.${key}&select=value`);
  return rows?.[0]?.value;
}

interface ProjectAccount {
  project_id: string;
  ig_user_id: string;
  page_access_token: string | null;
  ig_login_access_token: string | null;
}

async function resolveAccount(igUserId: string): Promise<ProjectAccount | null> {
  const rows = await db(
    `instagram_accounts?ig_user_id=eq.${encodeURIComponent(igUserId)}&active=eq.true&select=project_id,ig_user_id,page_access_token,ig_login_access_token&limit=1`,
  );
  const row = rows?.[0];
  if (!row?.project_id) return null;
  if (!row.page_access_token && !row.ig_login_access_token) return null;
  return row as ProjectAccount;
}

interface Codeword {
  id: string;
  codeword: string;
  reel_id: string | null;
  reel_url: string | null;
  target_url: string | null;
  short_id: string;
  reply_text: string | null;
  dm_text: string | null;
  comment_replies: unknown;
  dm_messages: unknown;
  target_urls: unknown;
  dm_button_title: string | null;
}

function asStringArray(raw: unknown, max = 10): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((v) => String(v).trim()).filter(Boolean).slice(0, max);
}

/** Legacy reply_text/dm_text sometimes stored all variants joined by newlines. */
function legacyVariants(raw: string | null | undefined, max = 10): string[] {
  const text = raw?.trim();
  if (!text) return [];
  const parts = text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  return (parts.length > 1 ? parts : [text]).slice(0, max);
}

function pickRandom(items: string[]): string | null {
  if (items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)] ?? null;
}

function pickRandomIndexed(items: string[]): { value: string; index: number } | null {
  if (items.length === 0) return null;
  const index = Math.floor(Math.random() * items.length);
  return { value: items[index]!, index };
}

function resolveReplyText(kw: Codeword): string | null {
  return pickRandom(asStringArray(kw.comment_replies)) ?? pickRandom(legacyVariants(kw.reply_text));
}

function resolveDmText(kw: Codeword): string | null {
  return pickRandom(asStringArray(kw.dm_messages)) ?? pickRandom(legacyVariants(kw.dm_text));
}

function resolveTargetUrlIndexed(kw: Codeword): { value: string; index: number } | null {
  const urls = asStringArray(kw.target_urls);
  if (urls.length > 0) return pickRandomIndexed(urls);
  const legacy = kw.target_url?.trim();
  return legacy ? { value: legacy, index: 0 } : null;
}

async function matchCodeword(projectId: string, mediaId: string | null, text: string): Promise<Codeword | null> {
  // Сначала полный select (legacy reply_text/dm_text + button). Если колонок нет — без них.
  let rows: Codeword[] = (await db(
    `instagram_codewords?project_id=eq.${projectId}&active=eq.true&select=id,codeword,reel_id,reel_url,target_url,short_id,reply_text,dm_text,comment_replies,dm_messages,target_urls,dm_button_title`,
  )) ?? [];
  if (!Array.isArray(rows)) {
    rows = (await db(
      `instagram_codewords?project_id=eq.${projectId}&active=eq.true&select=id,codeword,reel_id,reel_url,target_url,short_id,comment_replies,dm_messages,target_urls`,
    )) ?? [];
  }
  if (!Array.isArray(rows)) return null;
  const low = text.toLowerCase();
  // Prefer the longest matching codeword so "+" does not steal "хаб" / "разбор+".
  const matches = rows.filter((k) => {
    const cw = String(k.codeword ?? "").toLowerCase();
    return cw.length > 0 && low.includes(cw) && (!k.reel_id || k.reel_id === mediaId);
  });
  if (matches.length === 0) return null;
  matches.sort((a, b) => String(b.codeword).length - String(a.codeword).length);
  return matches[0] ?? null;
}

async function claimEvent(
  projectId: string,
  kw: Codeword,
  mediaId: string | null,
  commentId: string,
  username: string | null,
  eventType = "codeword_comment",
): Promise<string | null> {
  const { status, json } = await dbRaw("instagram_organic_events", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      project_id: projectId,
      codeword_id: kw.id,
      codeword: kw.codeword,
      reel_id: mediaId,
      reel_url: kw.reel_url,
      event_type: eventType,
      username,
      external_id: commentId,
      date: ymd(new Date()),
      occurred_at: new Date().toISOString(),
      payload: { stage: "claimed" },
    }),
  });
  if (status === 409) return null;
  if (status >= 400) {
    // Фоллбек: колонка external_id ещё не применена на проде — всё равно отвечаем.
    const msg = JSON.stringify(json ?? {});
    if (/external_id|schema cache|PGRST204/i.test(msg)) {
      const retry = await dbRaw("instagram_organic_events", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          project_id: projectId,
          codeword_id: kw.id,
          codeword: kw.codeword,
          reel_id: mediaId,
          reel_url: kw.reel_url,
          event_type: eventType,
          username,
          date: ymd(new Date()),
          occurred_at: new Date().toISOString(),
          payload: { stage: "claimed", comment_id: commentId, missing_external_id: true },
        }),
      });
      if (retry.status === 409) return null;
      const row = Array.isArray(retry.json) ? (retry.json[0] as { id?: string } | undefined) : undefined;
      if (row?.id) return row.id;
      console.error("[ig-webhook] claim fallback failed", retry.status, retry.json);
      return null;
    }
    console.error("[ig-webhook] claim failed", status, json);
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

function graphHost(account: ProjectAccount, preferLogin: boolean) {
  if (preferLogin && account.ig_login_access_token) return GRAPH_IG;
  if (account.page_access_token && !/^IG/i.test(account.page_access_token)) return GRAPH_FB;
  if (account.ig_login_access_token) return GRAPH_IG;
  return GRAPH_FB;
}

function bearer(account: ProjectAccount, preferLogin: boolean): string | null {
  if (preferLogin && account.ig_login_access_token) return account.ig_login_access_token;
  if (account.page_access_token) return account.page_access_token;
  return account.ig_login_access_token;
}

/** Resolve @username for tracking links when webhook payload omits it. */
async function resolveIgUsername(
  account: ProjectAccount,
  igsid: string,
): Promise<string | null> {
  const token = bearer(account, true);
  if (!token) return null;
  const host = graphHost(account, true);
  try {
    const r = await fetch(
      `${host}/${encodeURIComponent(igsid)}?fields=username&access_token=${encodeURIComponent(token)}`,
    );
    const j = await r.json().catch(() => ({}));
    return j?.username ? String(j.username) : null;
  } catch {
    return null;
  }
}

async function postPublicReply(
  commentId: string,
  account: ProjectAccount,
  text: string,
): Promise<{ ok: boolean; body: unknown }> {
  // Prefer Instagram Login token (same path as DM) — Page token on this app
  // often lacks comment reply rights for page-less IG Login accounts.
  const token = bearer(account, true) ?? bearer(account, false);
  if (!token) return { ok: false, body: { error: "no token" } };
  const host = graphHost(account, /^IG/i.test(token) || Boolean(account.ig_login_access_token));
  try {
    const resp = await fetch(`${host}/${commentId}/replies`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message: text }),
    });
    const body = await resp.json().catch(() => ({}));
    return { ok: resp.ok, body };
  } catch (e) {
    return { ok: false, body: { error: String(e) } };
  }
}

const PUBLIC_LINK_ORIGIN = Deno.env.get("IG_PUBLIC_LINK_ORIGIN") ?? "https://www.markvision.kz";
/** Keep in sync with InstagramOrganicSettings DEFAULT_COMMENT / DEFAULT_DM */
const DEFAULT_COMMENT_REPLY = "Спасибо! Проверь Direct — отправили доступ 👇";
const DEFAULT_DM_TEXT = "Готово! Жми кнопку ниже и забирай доступ 👇";
const DEFAULT_BUTTON_TITLE = "получить доступ";

function buildTrackingLink(
  shortId: string,
  username: string | null,
  linkIndex: number | null = null,
): string {
  const params = new URLSearchParams();
  if (username) params.set("u", username);
  if (linkIndex != null && linkIndex >= 0) params.set("v", String(linkIndex));
  const q = params.toString();
  return `${PUBLIC_LINK_ORIGIN}/r/${encodeURIComponent(shortId)}${q ? `?${q}` : ""}`;
}

function clampButtonTitle(_raw?: string | null): string {
  // Текст кнопки фиксирован продуктом — всегда «получить доступ».
  return DEFAULT_BUTTON_TITLE;
}

async function sendPrivateDm(
  igUserId: string,
  account: ProjectAccount,
  commentId: string,
  opts: { text: string; buttonTitle: string; buttonUrl: string },
) {
  const token = bearer(account, true);
  if (!token) return { ok: false, body: { error: "no token" }, mode: "none" as const };
  const host = graphHost(account, true);

  const buttonBody = {
    recipient: { comment_id: commentId },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: opts.text.slice(0, 640),
          buttons: [
            {
              type: "web_url",
              url: opts.buttonUrl,
              title: opts.buttonTitle,
            },
          ],
        },
      },
    },
  };

  const buttonResp = await fetch(`${host}/${igUserId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(buttonBody),
  });
  const buttonJson = await buttonResp.json().catch(() => ({}));
  if (buttonResp.ok) return { ok: true, body: buttonJson, mode: "button" as const };

  // Фоллбек: короткий markvision-линк в тексте (без supabase URL).
  const textBody = {
    recipient: { comment_id: commentId },
    message: { text: `${opts.text}\n${opts.buttonUrl}`.slice(0, 1000) },
  };
  const textResp = await fetch(`${host}/${igUserId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(textBody),
  });
  const textJson = await textResp.json().catch(() => ({}));
  return {
    ok: textResp.ok,
    body: textResp.ok ? textJson : { button_error: buttonJson, text_error: textJson },
    mode: textResp.ok ? ("text_fallback" as const) : ("failed" as const),
  };
}

function ymd(d: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Almaty",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

// Ответ в личные сообщения (DM): та же кнопка «получить доступ», что и на комментарий,
// но recipient — по IGSID отправителя (а не comment_id).
async function sendDmToUser(
  igUserId: string,
  account: ProjectAccount,
  recipientId: string,
  opts: { text: string; buttonTitle: string; buttonUrl: string },
) {
  const token = bearer(account, true);
  if (!token) return { ok: false, body: { error: "no token" }, mode: "none" as const };
  const host = graphHost(account, true);

  const buttonBody = {
    recipient: { id: recipientId },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: opts.text.slice(0, 640),
          buttons: [{ type: "web_url", url: opts.buttonUrl, title: opts.buttonTitle }],
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
  return { ok: r2.ok, body: r2.ok ? j2 : { button_error: j1, text_error: j2 }, mode: r2.ok ? ("text_fallback" as const) : ("failed" as const) };
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const vt = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && vt === (await setting("verify_token"))) {
      return new Response(challenge ?? "");
    }
    return new Response("forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("ok");

  const rawBody = await req.text();
  const appSecret = Deno.env.get("META_APP_SECRET") ?? (await setting("app_secret"));
  if (!appSecret) {
    console.error("[ig-webhook] META_APP_SECRET not configured; rejecting POST");
    return new Response("forbidden", { status: 403 });
  }
  const sigHeader =
    req.headers.get("x-hub-signature-256") ||
    req.headers.get("X-Hub-Signature-256") ||
    "";
  const provided = sigHeader.startsWith("sha256=") ? sigHeader.slice(7) : "";
  if (!provided) return new Response("forbidden", { status: 403 });
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(appSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const macBuf = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(rawBody),
    );
    const expected = Array.from(new Uint8Array(macBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    // constant-time compare
    if (expected.length !== provided.length) {
      return new Response("forbidden", { status: 403 });
    }
    let diff = 0;
    for (let i = 0; i < expected.length; i++) {
      diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
    }
    if (diff !== 0) return new Response("forbidden", { status: 403 });
  } catch (e) {
    console.error("[ig-webhook] signature verification failed", e);
    return new Response("forbidden", { status: 403 });
  }

  let body: { entry?: unknown[] } | null = null;
  try {
    body = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    body = null;
  }

  try {
    for (const entry of body?.entry ?? []) {
      const igUserId = String(entry.id ?? "");
      if (!igUserId) continue;

      // Личные сообщения (DM): код-слово в директе → тот же ответ, что и на комментарий.
      // Meta шлёт messaging[] / standby[]; Instagram Login иногда — field/value или changes[].
      const dmEvents = collectMessagingEvents(entry as Record<string, unknown>, igUserId);
      for (const dm of dmEvents) {
        const account = await resolveAccount(igUserId);
        if (!account) {
          console.log("ig-webhook: dm no account", { igUserId, mid: dm.mid });
          continue;
        }

        const kw = await matchCodeword(account.project_id, null, dm.text);
        if (!kw) {
          console.log("ig-webhook: dm no codeword", {
            project: account.project_id,
            text: dm.text.slice(0, 80),
            mid: dm.mid,
          });
          continue;
        }

        const username =
          dm.username ?? (await resolveIgUsername(account, dm.senderId));
        const eventId = await claimEvent(
          account.project_id,
          kw,
          null,
          dm.mid,
          username,
          "codeword_dm",
        );
        if (!eventId) continue;

        const pickedLink = resolveTargetUrlIndexed(kw);
        const link = buildTrackingLink(kw.short_id, username, pickedLink?.index ?? null);
        const dmPrefix = resolveDmText(kw) || DEFAULT_DM_TEXT;
        const sent = await sendDmToUser(igUserId, account, dm.senderId, {
          text: dmPrefix,
          buttonTitle: clampButtonTitle(),
          buttonUrl: link,
        });
        if (!sent.ok) {
          console.log("ig-webhook: dm send failed", {
            mid: dm.mid,
            senderId: dm.senderId,
            body: sent.body,
            mode: sent.mode,
          });
        }

        await finalizeEvent(eventId, {
          source: "dm",
          mid: dm.mid,
          recipient_id: dm.senderId,
          username,
          dm_status: sent.ok ? "sent" : "failed",
          dm_mode: sent.mode,
          dm_button_url: link,
          target_url: pickedLink?.value ?? null,
          target_url_index: pickedLink?.index ?? null,
          dm_error: sent.ok ? null : sent.body,
        });
      }

      // Comments: two Meta shapes
      // 1) Facebook Login for Business → entry.changes[{ field, value }]
      // 2) Business Login for Instagram → field/value directly on entry (no changes[])
      const commentEvents: Array<{ field: string; value: Record<string, unknown> }> = [];
      for (const change of entry.changes ?? []) {
        if (change?.field === "comments" || change?.field === "live_comments") {
          commentEvents.push({ field: String(change.field), value: (change.value ?? {}) as Record<string, unknown> });
        }
      }
      if (entry.field === "comments" || entry.field === "live_comments") {
        commentEvents.push({
          field: String(entry.field),
          value: (entry.value ?? {}) as Record<string, unknown>,
        });
      }

      for (const change of commentEvents) {
        const raw = change.value;
        // value can be a single object or (rarely) an array of objects
        const values = Array.isArray(raw) ? raw : [raw];
        for (const v0 of values) {
          const v = (v0 ?? {}) as Record<string, unknown>;
          const from = (v.from ?? {}) as { id?: string; username?: string };
          const media = (v.media ?? {}) as { id?: string };
          // FB Login uses comment_id; Instagram Login uses id
          const commentId = (v.comment_id ?? v.id) != null ? String(v.comment_id ?? v.id) : null;
          const mediaId = media.id != null ? String(media.id) : (v.media_id != null ? String(v.media_id) : null);
          const text = String(v.text ?? "");
          const fromId = from.id != null ? String(from.id) : null;
          const username = from.username != null ? String(from.username) : null;
          if (!commentId || !fromId || fromId === igUserId) {
            console.log("ig-webhook: skip comment payload", {
              igUserId,
              field: change.field,
              hasCommentId: Boolean(commentId),
              hasFromId: Boolean(fromId),
              self: fromId === igUserId,
              keys: Object.keys(v),
            });
            continue;
          }

          const account = await resolveAccount(igUserId);
          if (!account) {
            console.log("ig-webhook: no account for", igUserId);
            continue;
          }

          const kw = await matchCodeword(account.project_id, mediaId, text);
          if (!kw) {
            console.log("ig-webhook: no codeword match", {
              project: account.project_id,
              text: text.slice(0, 80),
            });
            continue;
          }

          const eventId = await claimEvent(account.project_id, kw, mediaId, commentId, username);
          if (!eventId) continue;

          // Always attempt public reply + DM (same fields as Settings → код-слова).
          const replyText = resolveReplyText(kw) || DEFAULT_COMMENT_REPLY;
          const replied = await postPublicReply(commentId, account, replyText);
          const replyStatus: "sent" | "failed" = replied.ok ? "sent" : "failed";
          const replyError: unknown = replied.ok ? null : replied.body;
          if (!replied.ok) {
            console.log("ig-webhook: public reply failed", { commentId, body: replied.body });
          }

          const pickedLink = resolveTargetUrlIndexed(kw);
          const link = buildTrackingLink(kw.short_id, username, pickedLink?.index ?? null);
          const dmPrefix = resolveDmText(kw) || DEFAULT_DM_TEXT;
          const sent = await sendPrivateDm(igUserId, account, commentId, {
            text: dmPrefix,
            buttonTitle: clampButtonTitle(),
            buttonUrl: link,
          });
          if (!sent.ok) {
            console.log("ig-webhook: private DM failed", {
              commentId,
              body: sent.body,
              mode: sent.mode,
            });
          }

          await finalizeEvent(eventId, {
            comment_id: commentId,
            media_id: mediaId,
            reply_status: replyStatus,
            reply_error: replyError,
            dm_status: sent.ok ? "sent" : "failed",
            dm_mode: sent.mode,
            dm_button_url: link,
            target_url: pickedLink?.value ?? null,
            target_url_index: pickedLink?.index ?? null,
            dm_error: sent.ok ? null : sent.body,
          });
        }
      }
    }
  } catch (e) {
    // Meta retries on non-2xx; always 200, but log so DM misses are visible.
    console.error("[ig-webhook] handler error", e instanceof Error ? e.message : String(e));
  }
  return new Response("EVENT_RECEIVED");
});
