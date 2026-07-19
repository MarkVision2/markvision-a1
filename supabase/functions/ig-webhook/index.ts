// Вебхук Instagram (мультитенантный): комментарий с код-словом →
// публичный ответ + приватный DM со ссылкой, per-project.
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
}

function asStringArray(raw: unknown, max = 10): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((v) => String(v).trim()).filter(Boolean).slice(0, max);
}

function pickRandom(items: string[]): string | null {
  if (items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)] ?? null;
}

function resolveReplyText(kw: Codeword): string | null {
  return pickRandom(asStringArray(kw.comment_replies)) ?? (kw.reply_text?.trim() || null);
}

function resolveDmText(kw: Codeword): string | null {
  return pickRandom(asStringArray(kw.dm_messages)) ?? (kw.dm_text?.trim() || null);
}

function resolveTargetUrl(kw: Codeword): string | null {
  const urls = asStringArray(kw.target_urls);
  if (urls.length > 0) return pickRandom(urls);
  return kw.target_url?.trim() || null;
}

async function matchCodeword(projectId: string, mediaId: string | null, text: string): Promise<Codeword | null> {
  const rows: Codeword[] = (await db(
    `instagram_codewords?project_id=eq.${projectId}&active=eq.true&select=id,codeword,reel_id,reel_url,target_url,short_id,reply_text,dm_text,comment_replies,dm_messages,target_urls`,
  )) ?? [];
  const low = text.toLowerCase();
  return rows.find((k) =>
    low.includes(k.codeword.toLowerCase()) && (!k.reel_id || k.reel_id === mediaId)
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

async function sendPrivateDm(
  igUserId: string,
  account: ProjectAccount,
  commentId: string,
  text: string,
) {
  const token = bearer(account, true);
  if (!token) return { ok: false, body: { error: "no token" } };
  const host = graphHost(account, true);
  const resp = await fetch(`${host}/${igUserId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recipient: { comment_id: commentId }, message: { text } }),
  });
  return { ok: resp.ok, body: await resp.json().catch(() => ({})) };
}

function ymd(d: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Almaty",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
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

        const link = `${SB_URL}/functions/v1/ig-organic-redirect?c=${encodeURIComponent(kw.short_id)}${
          username ? `&u=${encodeURIComponent(username)}` : ""
        }`;
        const dmPrefix = resolveDmText(kw);
        // target_urls used by redirect; DM still carries short tracking link
        void resolveTargetUrl(kw);
        const dmMessage = dmPrefix ? `${dmPrefix} ${link}` : link;
        const sent = await sendPrivateDm(igUserId, account, commentId, dmMessage);

        await finalizeEvent(eventId, {
          comment_id: commentId,
          media_id: mediaId,
          dm_status: sent.ok ? "sent" : "failed",
          dm_error: sent.ok ? null : sent.body,
        });
      }
    }
  } catch (_e) { /* Meta expects 200 */ }
  return new Response("EVENT_RECEIVED");
});
