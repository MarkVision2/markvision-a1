// Вебхук Instagram v7 (мультитенантный): комментарий с код-словом →
// публичный ответ + приватный DM со ссылкой, per-project.
//
// Раньше эта функция работала на одном глобальном аккаунте из cf_settings.
// Теперь: по ig_user_id из вебхука ищем проект в instagram_accounts, берём
// его Page-токен и код-слова из instagram_codewords, событие пишем в
// instagram_organic_events — то есть данные сразу видны в CRM для нужного
// проекта, а не только в отдельной таблице cf_*.
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H: Record<string, string> = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
const GRAPH = "https://graph.facebook.com/v21.0";

async function db(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers as Record<string, string> || {}) } });
  const t = await r.text();
  try { return t ? JSON.parse(t) : null; } catch { return null; }
}

async function setting(key: string): Promise<string | undefined> {
  const rows = await db(`cf_settings?key=eq.${key}&select=value`);
  return rows?.[0]?.value;
}

interface ProjectAccount {
  project_id: string;
  ig_user_id: string;
  page_access_token: string;
}

async function resolveAccount(igUserId: string): Promise<ProjectAccount | null> {
  const rows = await db(
    `instagram_accounts?ig_user_id=eq.${encodeURIComponent(igUserId)}&active=eq.true&select=project_id,ig_user_id,page_access_token&limit=1`,
  );
  const row = rows?.[0];
  if (!row?.project_id || !row?.page_access_token) return null;
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
}

async function matchCodeword(projectId: string, mediaId: string | null, text: string): Promise<Codeword | null> {
  const rows: Codeword[] = (await db(
    `instagram_codewords?project_id=eq.${projectId}&active=eq.true&select=id,codeword,reel_id,reel_url,target_url,short_id,reply_text,dm_text`,
  )) ?? [];
  const low = text.toLowerCase();
  return rows.find((k) => low.includes(k.codeword.toLowerCase()) && (!k.reel_id || k.reel_id === mediaId)) ?? null;
}

async function alreadyProcessed(externalId: string): Promise<boolean> {
  const rows = await db(`instagram_organic_events?external_id=eq.${encodeURIComponent(externalId)}&select=id&limit=1`);
  return Array.isArray(rows) && rows.length > 0;
}

async function postPublicReply(commentId: string, token: string, text: string) {
  await fetch(`${GRAPH}/${commentId}/replies`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message: text }),
  }).catch(() => {});
}

async function sendPrivateDm(igUserId: string, token: string, commentId: string, text: string) {
  const resp = await fetch(`${GRAPH}/${igUserId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recipient: { comment_id: commentId }, message: { text } }),
  });
  return { ok: resp.ok, body: await resp.json().catch(() => ({})) };
}

function ymd(d: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const vt = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && vt === (await setting("verify_token"))) return new Response(challenge ?? "");
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
        if (await alreadyProcessed(commentId)) continue;

        const account = await resolveAccount(igUserId);
        if (!account) continue; // аккаунт не подключён ни к одному проекту CRM

        const kw = await matchCodeword(account.project_id, mediaId, text);
        if (!kw) continue;

        if (kw.reply_text) {
          await postPublicReply(commentId, account.page_access_token, kw.reply_text);
        }

        const redirectUrl = `${SB_URL}/functions/v1/ig-organic-redirect?c=${encodeURIComponent(kw.short_id)}${username ? `&u=${encodeURIComponent(username)}` : ""}`;
        const dmMessage = kw.dm_text ? `${kw.dm_text} ${redirectUrl}` : redirectUrl;
        const sent = await sendPrivateDm(igUserId, account.page_access_token, commentId, dmMessage);

        const occurredAt = new Date();
        await db("instagram_organic_events", {
          method: "POST",
          body: JSON.stringify({
            project_id: account.project_id,
            codeword_id: kw.id,
            codeword: kw.codeword,
            reel_id: kw.reel_id ?? mediaId,
            reel_url: kw.reel_url,
            event_type: "codeword_dm",
            username,
            date: ymd(occurredAt),
            occurred_at: occurredAt.toISOString(),
            external_id: commentId,
            payload: { comment_id: commentId, media_id: mediaId, dm_status: sent.ok ? "sent" : "failed", dm_error: sent.ok ? null : sent.body },
          }),
        });
      }
    }
  } catch (_e) { /* Meta ждёт 200 в любом случае */ }
  return new Response("EVENT_RECEIVED");
});
