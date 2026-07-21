// Вебхук Instagram (мультитенантный): комментарий с код-словом →
// публичный ответ + приватный DM с кнопкой «получить доступ», per-project.
//
// Аккаунт ищется в instagram_accounts по ig_user_id. DM предпочтительно
// через Instagram Login токен (graph.instagram.com) — Page-токен на этом
// Meta-приложении для messages падает с (#3). Варианты ответов берутся из
// comment_replies / dm_messages (с фолбэком на legacy reply_text / dm_text).
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
  return pickRandom(asStringArray(kw.comment_replies)) ?? (kw.reply_text?.trim() || null);
}

function resolveDmText(kw: Codeword): string | null {
  return pickRandom(asStringArray(kw.dm_messages)) ?? (kw.dm_text?.trim() || null);
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
  return rows.find((k) =>
    low.includes(String(k.codeword ?? "").toLowerCase()) && (!k.reel_id || k.reel_id === mediaId)
  ) ?? null;
}

async function claimEvent(
  projectId: string,
  kw: Codeword,
  mediaId: string | null,
  commentId: string,
  username: string | null,
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
      event_type: "codeword_comment",
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
          event_type: "codeword_comment",
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

async function postPublicReply(commentId: string, account: ProjectAccount, text: string) {
  const token = bearer(account, false) ?? bearer(account, true);
  if (!token) return;
  const host = graphHost(account, /^IG/i.test(token));
  await fetch(`${host}/${commentId}/replies`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message: text }),
  }).catch(() => {});
}

const PUBLIC_LINK_ORIGIN = Deno.env.get("IG_PUBLIC_LINK_ORIGIN") ?? "https://www.markvision.kz";
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

// --- Легаси DM-бот (Clony): личные сообщения + cf_keywords + cf_settings ---
async function logCfMessage(igUserId: string, direction: "in" | "out", text: string) {
  await db("cf_messages", { method: "POST", body: JSON.stringify({ ig_user_id: igUserId, direction, text }) }).catch(() => {});
}
interface CfKeyword { id: string; keyword: string; dm_text: string | null; link_url: string | null; }
async function matchCfKeyword(text: string): Promise<CfKeyword | null> {
  const rows: CfKeyword[] = (await db(`cf_keywords?active=eq.true&select=id,keyword,dm_text,link_url`)) ?? [];
  if (!Array.isArray(rows)) return null;
  const low = text.toLowerCase();
  return rows.find((k) => k.keyword && low.includes(String(k.keyword).toLowerCase())) ?? null;
}
async function sendLegacyDm(ourIgId: string, recipientId: string, text: string): Promise<boolean> {
  const token = await setting("ig_access_token");
  if (!token) return false;
  const host = /^IG/i.test(token) ? GRAPH_IG : GRAPH_FB;
  const resp = await fetch(`${host}/${ourIgId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recipient: { id: recipientId }, message: { text: text.slice(0, 900) } }),
  }).catch(() => null);
  if (!resp) return false;
  if (!resp.ok) { const b = await resp.text().catch(() => ""); console.error("[ig-webhook] DM send failed", resp.status, b.slice(0, 300)); return false; }
  return true;
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

  const body = await req.json().catch(() => null);

  try {
    for (const entry of body?.entry ?? []) {
      const igUserId = String(entry.id ?? "");
      if (!igUserId) continue;

      // Личные сообщения (DM): код-слово в директе -> ответ со ссылкой (легаси Clony)
      for (const ev of entry.messaging ?? []) {
        const senderId = ev.sender?.id ? String(ev.sender.id) : null;
        const msg = ev.message;
        if (!senderId || senderId === igUserId) continue;   // не мы
        if (!msg || msg.is_echo) continue;                  // не эхо собственных сообщений
        const dmText = String(msg.text ?? "").trim();
        if (!dmText) continue;
        await logCfMessage(senderId, "in", dmText);
        const kw = await matchCfKeyword(dmText);
        if (!kw) continue;
        const reply = [kw.dm_text?.trim(), kw.link_url?.trim()].filter(Boolean).join("\n") || "Лови ссылку 👇";
        const ok = await sendLegacyDm(igUserId, senderId, reply);
        if (ok) await logCfMessage(senderId, "out", reply);
      }

      for (const change of entry.changes ?? []) {
        if (change.field !== "comments") continue;
        const v = change.value ?? {};
        const commentId = v.id;
        const mediaId = v.media?.id ?? null;
        const text = String(v.text ?? "");
        const fromId = v.from?.id ?? null;
        const username = v.from?.username ?? null;
        if (!commentId || !fromId || fromId === igUserId) continue;

        const account = await resolveAccount(igUserId);
        if (!account) continue;

        const kw = await matchCodeword(account.project_id, mediaId, text);
        if (!kw) continue;

        const eventId = await claimEvent(account.project_id, kw, mediaId, commentId, username);
        if (!eventId) continue;

        const replyText = resolveReplyText(kw);
        if (replyText) {
          await postPublicReply(commentId, account, replyText);
        }

        const pickedLink = resolveTargetUrlIndexed(kw);
        const link = buildTrackingLink(kw.short_id, username, pickedLink?.index ?? null);
        const dmPrefix = resolveDmText(kw) || DEFAULT_DM_TEXT;
        const sent = await sendPrivateDm(igUserId, account, commentId, {
          text: dmPrefix,
          buttonTitle: clampButtonTitle(),
          buttonUrl: link,
        });

        await finalizeEvent(eventId, {
          comment_id: commentId,
          media_id: mediaId,
          dm_status: sent.ok ? "sent" : "failed",
          dm_mode: sent.mode,
          dm_button_url: link,
          target_url: pickedLink?.value ?? null,
          target_url_index: pickedLink?.index ?? null,
          dm_error: sent.ok ? null : sent.body,
        });
      }
    }
  } catch (_e) { /* Meta expects 200 */ }
  return new Response("EVENT_RECEIVED");
});
