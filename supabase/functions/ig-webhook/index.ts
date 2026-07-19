// Вебхук Instagram (мультитенантный):
// 1) комментарий с код-словом → публичный ответ + Private Reply с кнопкой
// 2) входящий DM с код-словом (в т.ч. с рекламы) → автоответ со ссылкой
//
// Атрибуция поста/рекламы: в короткую ссылку пишем m=<media_id>&ad=<ad_id>,
// чтобы link_click и lead в CRM сохранили источник (пост + объявление).
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

interface AdReferral {
  adId: string | null;
  mediaId: string | null;
  source: string | null;
  raw: Record<string, unknown> | null;
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

/** Достаём ad_id / post_id из Instagram messaging.referral (CTA с рекламы). */
function parseAdReferral(raw: unknown): AdReferral {
  const empty: AdReferral = { adId: null, mediaId: null, source: null, raw: null };
  if (!raw || typeof raw !== "object") return empty;
  const ref = raw as Record<string, unknown>;
  const adsCtx = (ref.ads_context_data ?? ref.adsContextData) as Record<string, unknown> | undefined;
  const adIdRaw = ref.ad_id ?? ref.adId ?? adsCtx?.ad_id ?? adsCtx?.adId;
  const mediaIdRaw =
    adsCtx?.post_id ??
    adsCtx?.postId ??
    adsCtx?.media_id ??
    adsCtx?.mediaId ??
    ref.post_id ??
    ref.postId ??
    null;
  const adId = adIdRaw != null && String(adIdRaw).trim() ? String(adIdRaw).trim() : null;
  const mediaId = mediaIdRaw != null && String(mediaIdRaw).trim() ? String(mediaIdRaw).trim() : null;
  const source = ref.source != null ? String(ref.source) : null;
  return { adId, mediaId, source, raw: ref };
}

async function upsertSenderAttribution(
  projectId: string,
  senderId: string,
  referral: AdReferral,
) {
  if (!referral.adId && !referral.mediaId) return;
  await dbRaw("instagram_sender_attribution?on_conflict=project_id,sender_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      project_id: projectId,
      sender_id: senderId,
      meta_ad_id: referral.adId,
      media_id: referral.mediaId,
      referral: referral.raw,
      updated_at: new Date().toISOString(),
      captured_at: new Date().toISOString(),
    }),
  });
}

async function loadSenderAttribution(
  projectId: string,
  senderId: string,
): Promise<{ adId: string | null; mediaId: string | null }> {
  const rows = await db(
    `instagram_sender_attribution?project_id=eq.${encodeURIComponent(projectId)}&sender_id=eq.${encodeURIComponent(senderId)}&select=meta_ad_id,media_id,updated_at&limit=1`,
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return { adId: null, mediaId: null };
  const updated = row.updated_at ? new Date(String(row.updated_at)).getTime() : 0;
  // Окно 7 дней — как типичный цикл буста/ретаргета.
  if (updated && Date.now() - updated > 7 * 24 * 3600 * 1000) {
    return { adId: null, mediaId: null };
  }
  return {
    adId: row.meta_ad_id ? String(row.meta_ad_id) : null,
    mediaId: row.media_id ? String(row.media_id) : null,
  };
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
  opts: {
    eventType: "codeword_comment" | "codeword_dm";
    mediaId: string | null;
    externalId: string;
    username: string | null;
    payload?: Record<string, unknown>;
  },
): Promise<string | null> {
  const { status, json } = await dbRaw("instagram_organic_events", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      project_id: projectId,
      codeword_id: kw.id,
      codeword: kw.codeword,
      reel_id: opts.mediaId ?? kw.reel_id,
      reel_url: kw.reel_url,
      event_type: opts.eventType,
      username: opts.username,
      external_id: opts.externalId,
      date: ymd(new Date()),
      occurred_at: new Date().toISOString(),
      payload: { stage: "claimed", ...(opts.payload ?? {}) },
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
          reel_id: opts.mediaId ?? kw.reel_id,
          reel_url: kw.reel_url,
          event_type: opts.eventType,
          username: opts.username,
          date: ymd(new Date()),
          occurred_at: new Date().toISOString(),
          payload: {
            stage: "claimed",
            missing_external_id: true,
            fallback_external_id: opts.externalId,
            ...(opts.payload ?? {}),
          },
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
  mediaId: string | null = null,
  adId: string | null = null,
): string {
  const params = new URLSearchParams();
  if (username) params.set("u", username);
  if (linkIndex != null && linkIndex >= 0) params.set("v", String(linkIndex));
  if (mediaId) params.set("m", mediaId);
  if (adId) params.set("ad", adId);
  const q = params.toString();
  return `${PUBLIC_LINK_ORIGIN}/r/${encodeURIComponent(shortId)}${q ? `?${q}` : ""}`;
}

function clampButtonTitle(_raw?: string | null): string {
  // Текст кнопки фиксирован продуктом — всегда «получить доступ».
  return DEFAULT_BUTTON_TITLE;
}

type DmRecipient =
  | { comment_id: string }
  | { id: string };

async function sendPrivateDm(
  igUserId: string,
  account: ProjectAccount,
  recipient: DmRecipient,
  opts: { text: string; buttonTitle: string; buttonUrl: string },
) {
  const token = bearer(account, true);
  if (!token) return { ok: false, body: { error: "no token" }, mode: "none" as const };
  const host = graphHost(account, true);

  const buttonBody = {
    recipient,
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
    recipient,
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

async function handleCodewordHit(opts: {
  account: ProjectAccount;
  igUserId: string;
  kw: Codeword;
  eventType: "codeword_comment" | "codeword_dm";
  externalId: string;
  username: string | null;
  mediaId: string | null;
  adId: string | null;
  recipient: DmRecipient;
  publicReply?: boolean;
  claimPayload?: Record<string, unknown>;
}) {
  const eventId = await claimEvent(opts.account.project_id, opts.kw, {
    eventType: opts.eventType,
    mediaId: opts.mediaId,
    externalId: opts.externalId,
    username: opts.username,
    payload: {
      ...(opts.claimPayload ?? {}),
      ...(opts.adId ? { meta_ad_id: opts.adId } : {}),
      ...(opts.mediaId ? { media_id: opts.mediaId } : {}),
    },
  });
  if (!eventId) return;

  if (opts.publicReply && "comment_id" in opts.recipient) {
    const replyText = resolveReplyText(opts.kw);
    if (replyText) {
      await postPublicReply(opts.recipient.comment_id, opts.account, replyText);
    }
  }

  const pickedLink = resolveTargetUrlIndexed(opts.kw);
  const link = buildTrackingLink(
    opts.kw.short_id,
    opts.username,
    pickedLink?.index ?? null,
    opts.mediaId,
    opts.adId,
  );
  const dmPrefix = resolveDmText(opts.kw) || DEFAULT_DM_TEXT;
  const sent = await sendPrivateDm(opts.igUserId, opts.account, opts.recipient, {
    text: dmPrefix,
    buttonTitle: clampButtonTitle(),
    buttonUrl: link,
  });

  await finalizeEvent(eventId, {
    media_id: opts.mediaId,
    meta_ad_id: opts.adId,
    dm_status: sent.ok ? "sent" : "failed",
    dm_mode: sent.mode,
    dm_button_url: link,
    target_url: pickedLink?.value ?? null,
    target_url_index: pickedLink?.index ?? null,
    dm_error: sent.ok ? null : sent.body,
    ...(opts.claimPayload ?? {}),
  });
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

      // ── Комментарии под постом / рилсом (в т.ч. буст) ──────────────────
      for (const change of entry.changes ?? []) {
        if (change.field !== "comments") continue;
        const v = change.value ?? {};
        const commentId = v.id;
        const mediaId = v.media?.id ? String(v.media.id) : null;
        const text = String(v.text ?? "");
        const fromId = v.from?.id ?? null;
        const username = v.from?.username ?? null;
        if (!commentId || !fromId || fromId === igUserId) continue;

        const account = await resolveAccount(igUserId);
        if (!account) continue;

        const kw = await matchCodeword(account.project_id, mediaId, text);
        if (!kw) continue;

        await handleCodewordHit({
          account,
          igUserId,
          kw,
          eventType: "codeword_comment",
          externalId: String(commentId),
          username,
          mediaId,
          adId: null,
          recipient: { comment_id: String(commentId) },
          publicReply: true,
          claimPayload: { comment_id: String(commentId) },
        });
      }

      // ── Входящие Direct (код-слово с рекламы / органики) ───────────────
      for (const msgEvent of entry.messaging ?? []) {
        const senderId = msgEvent?.sender?.id ? String(msgEvent.sender.id) : null;
        if (!senderId || senderId === igUserId) continue;

        const message = msgEvent?.message ?? null;
        if (message?.is_echo || message?.is_deleted) continue;

        const text = String(message?.text ?? "");
        // referral может быть на message или на самом messaging-событии (OPEN_THREAD).
        const referral = parseAdReferral(message?.referral ?? msgEvent.referral ?? null);
        const mid = message?.mid ? String(message.mid) : null;

        const account = await resolveAccount(igUserId);
        if (!account) continue;

        // OPEN_THREAD / referral без текста — запоминаем ad/post для следующего DM.
        if (referral.adId || referral.mediaId) {
          await upsertSenderAttribution(account.project_id, senderId, referral);
        }

        // Без текста не матчим код-слово.
        if (!text.trim()) continue;

        const sticky = (!referral.adId && !referral.mediaId)
          ? await loadSenderAttribution(account.project_id, senderId)
          : { adId: null, mediaId: null };
        const adId = referral.adId ?? sticky.adId;
        const mediaId = referral.mediaId ?? sticky.mediaId;

        // Тот же код-слово, что и в комментариях («хаб» и т.п.).
        // Сначала пробуем с media из рекламы; если кодворд глобальный / другой пост —
        // матчим без привязки к reel_id (как человек просто написал в Direct).
        const kw =
          (await matchCodeword(account.project_id, mediaId, text)) ??
          (mediaId ? await matchCodeword(account.project_id, null, text) : null);
        if (!kw) continue;

        const externalId = mid ?? `dm:${senderId}:${message?.timestamp ?? Date.now()}`;
        await handleCodewordHit({
          account,
          igUserId,
          kw,
          eventType: "codeword_dm",
          externalId,
          username: null,
          mediaId: mediaId ?? kw.reel_id,
          adId,
          // Тот же button-template, что после комментария — только recipient = IGSID.
          recipient: { id: senderId },
          publicReply: false,
          claimPayload: {
            sender_id: senderId,
            referral_source: referral.source,
            referral: referral.raw,
            sticky_ad_id: sticky.adId,
            sticky_media_id: sticky.mediaId,
            channel: "direct",
          },
        });
      }
    }
  } catch (_e) { /* Meta expects 200 */ }
  return new Response("EVENT_RECEIVED");
});
