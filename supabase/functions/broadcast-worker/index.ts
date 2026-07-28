// Broadcast worker — серверный движок WhatsApp-рассылок.
//
// Запускается pg_cron раз в минуту (см. миграцию 20260722120000_broadcast_engine).
// Забирает готовые к отправке строки broadcast_recipients, шлёт их через Green
// API инстанс проекта (whatsapp_config) и продвигает статусы кампаний.
//
// Антибан («максимально осторожно» — дефолты в схеме):
//   - жёсткий дневной потолок на номер (broadcast_sender_daily + daily_limit);
//   - плавный прогрев нового номера (день 1 — 20, дальше +30%/день);
//   - окно отправки в таймзоне кампании (вне окна очередь стоит);
//   - маленький пакет за тик + рандомная пауза между сообщениями (джиттер);
//   - opt-out: телефоны из broadcast_opt_outs пропускаются навсегда;
//   - kill-switch: всплеск ошибок → кампания и номер уходят на паузу.
//
// Auth: заголовок x-automation-key == automation_settings.cron_secret (cron)
// ИЛИ авторизованный админ (ручной прогон из UI).
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import {
  DEFAULT_GREEN_API_BASE_URL,
  validateGreenApiBaseUrl,
} from "../_lib/green_api_url.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-automation-key",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Абсолютный потолок сообщений за один тик воркера, даже если лимиты позволяют
// больше — чтобы функция не висела и отправка оставалась «капельной».
const HARD_TICK_CAP = 5;
// Максимальная пауза внутри тика (сек) — чтобы edge-функция не жила слишком долго.
const MAX_INTICK_SLEEP_S = 8;
const WARMUP_DAY1 = 20;
const WARMUP_GROWTH = 1.3;
// Ретраи транзиентных сбоев (сеть/5xx/429). Постоянные ошибки (нет WhatsApp,
// инстанс просрочен, битый номер) не ретраятся.
const MAX_ATTEMPTS = 3;
// Строки, застрявшие в 'sending' дольше этого (воркер упал в полёте), возвращаем
// в очередь в начале тика.
const STALE_SENDING_MIN = 5;

/** Транзиентная ли ошибка Green API (стоит ретраить). */
function isTransient(msg: string): boolean {
  return /(\s5\d\d:)|(\b429\b)|network|timeout|timed out|fetch failed|ECONN|socket|temporarily/i.test(msg);
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const rnd = (min: number, max: number) => Math.floor(min + Math.random() * (max - min + 1));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function digits(s: string | null | undefined): string {
  return String(s ?? "").replace(/\D/g, "");
}

/** Локальный час (0–23) в таймзоне кампании. */
function localHour(tz: string): number {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hour12: false,
    });
    return Number(fmt.format(new Date()));
  } catch {
    return new Date().getUTCHours();
  }
}

function inWindow(hour: number, start: number, end: number): boolean {
  if (start === end) return true; // круглосуточно
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end; // окно через полночь
}

/** Подстановка имени, ссылки перехода и заголовка.
 *  linkAsButton — убрать плейсхолдер (URL уйдёт в кнопку WhatsApp). */
function renderMessage(
  title: string,
  message: string,
  name: string,
  link: string,
  linkAsButton = false,
): string {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  let body = (message ?? "").replace(/\{имя\}/gi, first).replace(/\{name\}/gi, first);
  if (linkAsButton) {
    body = body
      .replace(/\{ссылка\}/gi, "")
      .replace(/\{link\}/gi, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } else if (link) {
    body = body.replace(/\{ссылка\}/gi, link).replace(/\{link\}/gi, link);
  }
  const head = (title ?? "").trim();
  return head ? `*${head}*\n\n${body}` : body;
}

/** Трекинг-ссылка перехода для получателя (или пусто, если нет токена). */
function clickLink(clickToken: string | null | undefined): string {
  return clickToken ? `${SUPABASE_URL}/functions/v1/broadcast-click?t=${clickToken}` : "";
}

function defaultCtaLabel(targetUrl: string | null | undefined): string {
  const u = (targetUrl ?? "").toLowerCase();
  if (u.includes("chat.whatsapp.com") || u.includes("whatsapp.com/channel")) {
    return "Вступить в группу";
  }
  return "Перейти";
}

function isHttpUrl(u: string | null | undefined): u is string {
  if (!u) return false;
  try {
    const url = new URL(u);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Нормализация `{https://…}` / голого URL → `{ссылка}` + targetUrl (как на клиенте). */
function normalizeOutgoingLink(message: string, targetUrl: string | null | undefined): {
  message: string;
  targetUrl: string;
} {
  let extracted = (targetUrl ?? "").trim();
  let body = message ?? "";
  body = body.replace(/\{((?:https?:\/\/)[^}]+)\}/gi, (_m, url: string) => {
    const u = String(url).trim();
    if (!extracted && /^https?:\/\//i.test(u)) extracted = u;
    return "{ссылка}";
  });
  if (!extracted) {
    const bare = body.match(/(https?:\/\/[^\s<>"']+)/i);
    if (bare?.[0]) {
      extracted = bare[0].replace(/[),.;]+$/, "");
      body = body.replace(bare[0], "{ссылка}");
    }
  }
  let seen = false;
  body = body.replace(/\{ссылка\}|\{link\}/gi, () => {
    if (seen) return "";
    seen = true;
    return "{ссылка}";
  });
  return { message: body.replace(/\n{3,}/g, "\n\n").trim(), targetUrl: extracted };
}

type Creds = { idInstance: string; apiToken: string; baseUrl: string };

/** Резолв chatId: WhatsApp всё чаще отдаёт @lid; @c.us часто зависает в status=sent. */
async function resolveChatId(creds: Creds, phone: string): Promise<string> {
  const fallback = `${digits(phone)}@c.us`;
  try {
    const url = `${creds.baseUrl}/waInstance${creds.idInstance}/checkWhatsapp/${creds.apiToken}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber: Number(digits(phone)) }),
    });
    if (!res.ok) return fallback;
    const data = await res.json().catch(() => null) as {
      existsWhatsapp?: boolean;
      chatId?: string;
    } | null;
    if (data?.existsWhatsapp === false) {
      throw new Error("Нет WhatsApp на этом номере");
    }
    const chatId = (data?.chatId ?? "").trim();
    if (chatId.includes("@")) return chatId;
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Нет WhatsApp")) throw e;
  }
  return fallback;
}

async function resolveCreds(projectId: string): Promise<Creds | null> {
  const { data } = await admin
    .from("whatsapp_config")
    .select("id_instance, api_token, api_url, connected")
    .eq("project_id", projectId)
    .maybeSingle();
  const row = data as
    | { id_instance?: string; api_token?: string; api_url?: string; connected?: boolean }
    | null;
  if (!row?.id_instance || !row.api_token) return null;
  let baseUrl = DEFAULT_GREEN_API_BASE_URL;
  try {
    baseUrl = validateGreenApiBaseUrl(row.api_url ?? "");
  } catch {
    return null;
  }
  return { idInstance: row.id_instance, apiToken: (row.api_token ?? "").trim(), baseUrl };
}

/** Состояние аккаунта у Green API: authorized / yellowCard / blocked / … */
async function accountState(creds: Creds): Promise<{ state: string; httpStatus: number | null }> {
  const url = `${creds.baseUrl}/waInstance${creds.idInstance}/getStateInstance/${creds.apiToken}`;
  // На минутном кроне рядом бьют другие воркеры → Green часто отвечает 429.
  // Один ретрай с паузой; 429 не считаем «не в сети».
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 429) {
        if (attempt === 0) {
          await delay(800 + rnd(0, 400));
          continue;
        }
        return { state: "rate_limited", httpStatus: 429 };
      }
      const data = await res.json().catch(() => null);
      const state = (data as { stateInstance?: string } | null)?.stateInstance ?? "unknown";
      return { state, httpStatus: res.status };
    } catch {
      if (attempt === 0) {
        await delay(500);
        continue;
      }
      return { state: "unknown", httpStatus: null };
    }
  }
  return { state: "unknown", httpStatus: null };
}

/** Одна отправка текстом. Возвращает idMessage при успехе. */
async function sendGreen(creds: Creds, phone: string, message: string): Promise<string> {
  const chatId = await resolveChatId(creds, phone);
  const url = `${creds.baseUrl}/waInstance${creds.idInstance}/sendMessage/${creds.apiToken}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatId, message }),
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch { /* keep raw */ }
  if (!res.ok) {
    throw new Error(`Green API ${res.status}: ${String(text).slice(0, 160)}`);
  }
  const idMessage = (data as { idMessage?: string } | null)?.idMessage;
  if (!idMessage) throw new Error("Green API: пустой idMessage");
  return idMessage;
}

/** Сообщение + URL-кнопка (трекинг-ссылка вшита в кнопку). Fallback → sendMessage. */
async function sendGreenWithButton(
  creds: Creds,
  phone: string,
  body: string,
  buttonUrl: string,
  buttonText: string,
  header?: string,
): Promise<string> {
  const chatId = await resolveChatId(creds, phone);
  const url = `${creds.baseUrl}/waInstance${creds.idInstance}/sendInteractiveButtons/${creds.apiToken}`;
  const payload: Record<string, unknown> = {
    chatId,
    body: body || " ",
    buttons: [
      {
        type: "url",
        buttonId: "cta",
        buttonText: (buttonText || "Перейти").slice(0, 25),
        url: buttonUrl,
      },
    ],
  };
  const head = (header ?? "").trim();
  if (head) payload.header = head.slice(0, 60);

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch { /* keep raw */ }
  if (!res.ok) {
    // Не все инстансы/тарифы тянут interactive buttons — откат на текст со ссылкой.
    const fallback = head ? `*${head}*\n\n${body}\n\n${buttonUrl}` : `${body}\n\n${buttonUrl}`;
    console.warn("sendInteractiveButtons failed, fallback sendMessage:", String(text).slice(0, 120));
    return await sendGreen(creds, phone, fallback.trim());
  }
  const idMessage = (data as { idMessage?: string } | null)?.idMessage;
  if (!idMessage) throw new Error("Green API: пустой idMessage (buttons)");
  return idMessage;
}

// ─── Auth ────────────────────────────────────────────────────────────────────
async function authorize(req: Request): Promise<boolean> {
  const { data: settings } = await admin
    .from("automation_settings")
    .select("cron_secret")
    .eq("id", true)
    .maybeSingle();
  const secret = (settings as { cron_secret?: string } | null)?.cron_secret ?? null;
  const provided = req.headers.get("x-automation-key");
  if (secret && provided && provided === secret) return true;

  // Ручной прогон / kick после «Отправить»: любой авторизованный пользователь.
  // Запуск кампании уже защищён RLS на broadcast_campaigns.
  const auth = req.headers.get("Authorization") ?? "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (jwt && ANON_KEY) {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (user?.id) return true;
  }
  return false;
}

// ─── Типы строк ──────────────────────────────────────────────────────────────
type Campaign = {
  id: string;
  project_id: string;
  status: string;
  title: string;
  message: string;
  message_variants: string[];
  target_url: string | null;
  cta_label: string | null;
  daily_limit: number;
  window_start_hour: number;
  window_end_hour: number;
  timezone: string;
  min_gap_seconds: number;
  max_gap_seconds: number;
  warmup_enabled: boolean;
  scheduled_at: string | null;
  started_at: string | null;
  schedule_mode: string;
};

// Окно отправки не должно блокировать кампанию, которую пользователь ТОЛЬКО что
// запустил вручную (он осознанно жмёт «отправить сейчас») — даём грейс-период
// после старта. Плановая рассылка на следующий день окна уже уважает.
const LAUNCH_GRACE_MS = 15 * 60 * 1000;
function windowOk(c: Campaign): boolean {
  if (c.started_at && Date.now() - new Date(c.started_at).getTime() < LAUNCH_GRACE_MS) {
    return true;
  }
  return inWindow(localHour(c.timezone), c.window_start_hour, c.window_end_hour);
}

async function activeCampaigns(): Promise<Campaign[]> {
  const nowIso = new Date().toISOString();
  const { data } = await admin
    .from("broadcast_campaigns")
    .select("*")
    .in("status", ["scheduled", "sending"])
    .or(`scheduled_at.is.null,scheduled_at.lte.${nowIso}`)
    .order("created_at", { ascending: true });
  return ((data ?? []) as Campaign[]).map((c) => ({
    ...c,
    message_variants: Array.isArray(c.message_variants) ? c.message_variants : [],
  }));
}

async function sentToday(projectId: string): Promise<number> {
  const day = new Date().toISOString().slice(0, 10);
  const { data } = await admin
    .from("broadcast_sender_daily")
    .select("sent")
    .eq("project_id", projectId)
    .eq("day", day)
    .maybeSingle();
  return (data as { sent?: number } | null)?.sent ?? 0;
}

/** Эффективный дневной потолок с учётом прогрева номера. */
async function effectiveDailyCap(c: Campaign): Promise<number> {
  if (!c.warmup_enabled) return c.daily_limit;
  const { data } = await admin
    .from("broadcast_sender_state")
    .select("warmup_started_on, paused")
    .eq("project_id", c.project_id)
    .maybeSingle();
  const state = data as { warmup_started_on?: string | null } | null;
  let startedOn = state?.warmup_started_on ?? null;
  if (!startedOn) {
    startedOn = new Date().toISOString().slice(0, 10);
    await admin.from("broadcast_sender_state").upsert({
      project_id: c.project_id,
      warmup_started_on: startedOn,
      updated_at: new Date().toISOString(),
    });
  }
  const days = Math.max(
    0,
    Math.floor((Date.now() - new Date(startedOn + "T00:00:00Z").getTime()) / 86400000),
  );
  const warmCap = Math.round(WARMUP_DAY1 * Math.pow(WARMUP_GROWTH, days));
  return Math.min(c.daily_limit, Math.max(WARMUP_DAY1, warmCap));
}

async function isPaused(projectId: string): Promise<boolean> {
  const { data } = await admin
    .from("broadcast_sender_state")
    .select("paused")
    .eq("project_id", projectId)
    .maybeSingle();
  return !!(data as { paused?: boolean } | null)?.paused;
}

async function pauseSender(projectId: string, reason: string) {
  await admin.from("broadcast_sender_state").upsert({
    project_id: projectId,
    paused: true,
    pause_reason: reason,
    updated_at: new Date().toISOString(),
  });
}

async function isOptedOut(projectId: string, phone: string): Promise<boolean> {
  const { data } = await admin
    .from("broadcast_opt_outs")
    .select("phone")
    .eq("project_id", projectId)
    .eq("phone", phone)
    .maybeSingle();
  return !!data;
}

/** Возврат в очередь строк, застрявших в 'sending' (воркер упал в полёте). */
async function reapStaleSending() {
  const cutoff = new Date(Date.now() - STALE_SENDING_MIN * 60_000).toISOString();
  await admin
    .from("broadcast_recipients")
    .update({ status: "queued" })
    .eq("status", "sending")
    .lt("updated_at", cutoff);
}

/** Пересчёт stats кампании и финализация, когда в работе никого не осталось. */
async function refreshCampaign(campaignId: string) {
  const { data } = await admin
    .from("broadcast_recipients")
    .select("status, clicked_at, joined_at")
    .eq("campaign_id", campaignId);
  const rows = (data ?? []) as { status: string; clicked_at: string | null; joined_at: string | null }[];
  const count = (s: string) => rows.filter((r) => r.status === s).length;
  const stats = {
    total: rows.length,
    queued: count("queued"),
    sending: count("sending"),
    sent: count("sent"),
    delivered: count("delivered"),
    read: count("read"),
    replied: count("replied"),
    converted: count("converted"),
    failed: count("failed"),
    optout: count("skipped_optout"),
    clicked: rows.filter((r) => !!r.clicked_at).length,
    joined: rows.filter((r) => !!r.joined_at).length,
  };
  const patch: Record<string, unknown> = { stats };
  // Финализируем только когда никого не осталось ни в очереди, ни в полёте.
  if (stats.queued === 0 && stats.sending === 0) {
    const anySent =
      stats.sent + stats.delivered + stats.read + stats.replied + stats.converted + count("clicked");
    patch.status = anySent === 0 ? "failed" : stats.failed > 0 ? "partial" : "sent";
    patch.finished_at = new Date().toISOString();
  }
  await admin.from("broadcast_campaigns").update(patch).eq("id", campaignId);
}

/**
 * Бэкап к webhook outgoingMessageStatus: если статусы не долетели (n8n украл
 * webhook), догоняем delivered/read из журнала Green API.
 */
async function syncDeliveryStatuses(): Promise<number> {
  const since = new Date(Date.now() - 48 * 3600_000).toISOString();
  const { data } = await admin
    .from("broadcast_recipients")
    .select("id, project_id, campaign_id, message_id, status, phone")
    .eq("status", "sent")
    .not("message_id", "is", null)
    .gte("sent_at", since)
    .limit(200);
  const rows = (data ?? []) as {
    id: string;
    project_id: string;
    campaign_id: string;
    message_id: string;
    status: string;
    phone: string;
  }[];
  if (!rows.length) return 0;

  const byProject = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!byProject.has(r.project_id)) byProject.set(r.project_id, []);
    byProject.get(r.project_id)!.push(r);
  }

  let updated = 0;
  const touched = new Set<string>();

  for (const [projectId, list] of byProject) {
    const creds = await resolveCreds(projectId);
    if (!creds) continue;
    let journal: { idMessage?: string; statusMessage?: string; chatId?: string }[] = [];
    try {
      const url =
        `${creds.baseUrl}/waInstance${creds.idInstance}/lastOutgoingMessages/${creds.apiToken}?minutes=2880`;
      const res = await fetch(url);
      const data = await res.json().catch(() => []);
      journal = Array.isArray(data) ? data : [];
    } catch {
      continue;
    }
    const byId = new Map<string, string>();
    for (const m of journal) {
      if (m.idMessage && m.statusMessage) byId.set(m.idMessage, m.statusMessage);
    }

    for (const r of list) {
      let st = byId.get(r.message_id) ?? null;
      if (!st) {
        try {
          const url = `${creds.baseUrl}/waInstance${creds.idInstance}/getMessage/${creds.apiToken}`;
          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chatId: `${digits(r.phone)}@c.us`,
              idMessage: r.message_id,
            }),
          });
          const data = await res.json().catch(() => null) as { statusMessage?: string } | null;
          st = data?.statusMessage ?? null;
        } catch {
          st = null;
        }
      }
      if (!st || st === "sent" || st === "pending") continue;
      const now = new Date().toISOString();
      const patch: Record<string, unknown> = {};
      if (st === "delivered") {
        patch.status = "delivered";
        patch.delivered_at = now;
      } else if (st === "read") {
        patch.status = "read";
        patch.delivered_at = now;
        patch.read_at = now;
      } else if (st === "failed" || st === "noAccount" || st === "notDelivered") {
        patch.status = "failed";
        patch.error = `Green API: ${st}`;
      } else {
        continue;
      }
      await admin.from("broadcast_recipients").update(patch).eq("id", r.id);
      updated += 1;
      touched.add(r.campaign_id);
    }
  }

  for (const id of touched) await refreshCampaign(id);
  return updated;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!(await authorize(req))) return json({ error: "unauthorized" }, 401);

  // Возвращаем в очередь «зависшие» в отправке строки от упавших воркеров.
  await reapStaleSending();
  const statusSynced = await syncDeliveryStatuses();

  const campaigns = await activeCampaigns();
  if (campaigns.length === 0) {
    return json({
      ok: true,
      processed: 0,
      status_synced: statusSynced,
      note: "no active campaigns",
    });
  }
  // scheduled → sending (проставляем started_at при первом заходе).
  for (const c of campaigns) {
    if (c.status === "scheduled") {
      await admin
        .from("broadcast_campaigns")
        .update({ status: "sending", started_at: new Date().toISOString() })
        .eq("id", c.id);
      c.status = "sending";
    }
  }

  const stats = {
    sent: 0,
    failed: 0,
    skipped: 0,
    touchedCampaigns: new Set<string>(),
    skips: [] as { campaign_id: string; reason: string }[],
  };
  const skip = (campaignId: string, reason: string) => {
    stats.skips.push({ campaign_id: campaignId, reason });
  };
  // Кэш creds/бюджета по проекту в пределах тика.
  const credsCache = new Map<string, Creds | null>();
  const budgetCache = new Map<string, number>(); // сколько ещё можно отправить сегодня
  const stateCache = new Map<string, string>(); // состояние аккаунта Green по проекту

  for (const c of campaigns) {
    stats.touchedCampaigns.add(c.id);

    // Пауза номера (kill-switch) — стоп по всему проекту.
    if (await isPaused(c.project_id)) {
      skip(c.id, "sender_paused");
      continue;
    }

    // Окно отправки (с грейс-периодом для только что запущенной вручную).
    if (!windowOk(c)) {
      skip(c.id, "outside_send_window");
      continue;
    }

    // Бюджет на сегодня (кэшируем на проект).
    if (!budgetCache.has(c.project_id)) {
      const cap = await effectiveDailyCap(c);
      const used = await sentToday(c.project_id);
      budgetCache.set(c.project_id, Math.max(0, cap - used));
    }
    let budget = budgetCache.get(c.project_id) ?? 0;
    if (budget <= 0) {
      skip(c.id, "daily_budget_exhausted");
      continue;
    }

    // Размер пакета за тик: капельно, из среднего джиттера.
    const avgGap = Math.max(1, (c.min_gap_seconds + c.max_gap_seconds) / 2);
    const perTickByGap = Math.max(1, Math.round(60 / avgGap));
    const perTick = Math.min(HARD_TICK_CAP, perTickByGap, budget);

    // Creds проекта.
    if (!credsCache.has(c.project_id)) {
      credsCache.set(c.project_id, await resolveCreds(c.project_id));
    }
    const creds = credsCache.get(c.project_id) ?? null;
    if (!creds) {
      skip(c.id, "whatsapp_not_connected");
      continue; // WhatsApp не подключён — оставляем очередь как есть
    }

    // Ban-aware: реальное состояние аккаунта у Green (раз на проект за тик).
    // yellowCard = предупреждение WhatsApp перед баном → немедленно на паузу.
    // 429 / краткий unknown — не блокируем тик: иначе рассылка «висит» часами
    // при минутном кроне рядом с другими Green-вызовами.
    if (!stateCache.has(c.project_id)) {
      const st = await accountState(creds);
      stateCache.set(c.project_id, st.state);
    }
    const state = stateCache.get(c.project_id) ?? "unknown";
    if (state === "blocked" || state === "yellowCard") {
      await pauseSender(
        c.project_id,
        state === "blocked"
          ? "Аккаунт заблокирован WhatsApp"
          : "WhatsApp выдал предупреждение (жёлтая карточка) — отправка остановлена",
      );
      skip(c.id, state);
      continue;
    }
    if (state === "notAuthorized" || state === "sleepMode") {
      skip(c.id, `green_state:${state}`);
      continue;
    }
    if (state !== "authorized" && state !== "rate_limited" && state !== "unknown") {
      skip(c.id, `green_state:${state}`);
      continue;
    }

    // Атомарный захват: помечает строки 'sending' и возвращает их. Два
    // параллельных воркера получат разные строки (SKIP LOCKED) → без дублей.
    const { data: batch, error: claimErr } = await admin.rpc("broadcast_claim_recipients", {
      _campaign_id: c.id,
      _limit: perTick,
    });
    if (claimErr) {
      skip(c.id, `claim_error:${claimErr.message}`.slice(0, 160));
      continue;
    }
    const rows = (batch ?? []) as { id: string; phone: string; name: string; attempt: number; click_token: string | null }[];
    if (rows.length === 0) {
      skip(c.id, "no_claimable_recipients");
    }
    let campaignFailures = 0;
    let campaignSends = 0;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];

      if (await isOptedOut(c.project_id, r.phone)) {
        await admin
          .from("broadcast_recipients")
          .update({ status: "skipped_optout" })
          .eq("id", r.id);
        stats.skipped++;
        continue;
      }

      const variantRaw = c.message_variants.length
        ? c.message_variants[rnd(0, c.message_variants.length - 1)]
        : c.message;
      const norm = normalizeOutgoingLink(variantRaw, c.target_url);
      const effectiveTarget = norm.targetUrl || c.target_url;
      const track = clickLink(r.click_token);
      const useButton = isHttpUrl(effectiveTarget) && !!track;
      const text = renderMessage(c.title, norm.message, r.name, track, useButton);
      const attempt = (r.attempt ?? 0) + 1;

      try {
        const idMessage = useButton
          ? await sendGreenWithButton(
            creds,
            r.phone,
            // title уже может быть в header кнопки — в body без markdown-заголовка
            renderMessage("", norm.message, r.name, track, true),
            track,
            (c.cta_label || "").trim() || defaultCtaLabel(effectiveTarget),
            c.title,
          )
          : await sendGreen(creds, r.phone, text);
        await admin
          .from("broadcast_recipients")
          .update({
            status: "sent",
            message_id: idMessage,
            sent_at: new Date().toISOString(),
            attempt,
          })
          .eq("id", r.id);
        await admin.rpc("broadcast_bump_daily", { _project_id: c.project_id, _n: 1 });
        budget -= 1;
        stats.sent++;
        campaignSends++;
      } catch (e) {
        const msg = (e as Error).message.slice(0, 300);
        // Транзиентная ошибка и попытки не исчерпаны → назад в очередь с backoff.
        const retry = attempt < MAX_ATTEMPTS && isTransient(msg);
        await admin
          .from("broadcast_recipients")
          .update(
            retry
              ? {
                  status: "queued",
                  error: msg,
                  attempt,
                  scheduled_at: new Date(Date.now() + attempt * 60_000).toISOString(),
                }
              : { status: "failed", error: msg, attempt },
          )
          .eq("id", r.id);
        stats.failed++;
        campaignFailures++;
      }

      // Джиттер между сообщениями (капаем длительность на тик).
      if (i < rows.length - 1) {
        const gap = Math.min(MAX_INTICK_SLEEP_S, rnd(c.min_gap_seconds, c.max_gap_seconds));
        await delay(gap * 1000);
      }
    }

    budgetCache.set(c.project_id, budget);

    // Kill-switch: явный перекос в ошибки за тик → пауза номера и кампании.
    if (campaignFailures >= 3 && campaignFailures > campaignSends) {
      await pauseSender(
        c.project_id,
        `Авто-пауза: ${campaignFailures} ошибок подряд в кампании ${c.id}`,
      );
      await admin.from("broadcast_campaigns").update({ status: "paused" }).eq("id", c.id);
    }
  }

  // Пересчёт stats и финализация каждой затронутой кампании.
  for (const id of stats.touchedCampaigns) {
    await refreshCampaign(id);
  }

  return json({
    ok: true,
    sent: stats.sent,
    failed: stats.failed,
    skipped: stats.skipped,
    campaigns: stats.touchedCampaigns.size,
    status_synced: statusSynced,
    skips: stats.skips.slice(0, 20),
    ran_at: new Date().toISOString(),
  });
});
