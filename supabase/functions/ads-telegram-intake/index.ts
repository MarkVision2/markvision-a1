/**
 * Приём запусков рекламы из Telegram: таргетолог кидает боту фото, альбом или
 * видео с подписью «на сайт, бюджет 30» — задание уходит в ту же очередь
 * `ad_launch_jobs`, что и запуск с сайта.
 *
 * Последний кусок, ради которого держали воркфлоу n8n. Разбор подписи —
 * чистый модуль _lib/telegramLaunch.ts, сборка тел Meta — _lib/metaAds.ts.
 *
 * Подключение (выполняется вручную, когда решено переключаться):
 *   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
 *     -d "url=<SUPABASE_URL>/functions/v1/ads-telegram-intake" \
 *     -d "secret_token=<TELEGRAM_ADS_WEBHOOK_SECRET>"
 * До этого момента бот продолжает обслуживать n8n, а функция просто не
 * получает апдейтов.
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { resolveMetaAccessToken } from "../_lib/metaToken.ts";
import { normalizeActId } from "../_lib/metaAds.ts";
import { MetaApiError, uploadImage, uploadVideoFile } from "../_lib/metaGraph.ts";
import {
  needsDirectionPrompt,
  parseLaunchCommand,
  resolveWebsite,
} from "../_lib/telegramLaunch.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "content-type, x-telegram-bot-api-secret-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Бот-API не отдаёт файлы больше 20 МБ. */
const TELEGRAM_FILE_LIMIT = 20 * 1024 * 1024;
/** Сколько ждём остальные кадры альбома, прежде чем собирать карусель. */
const ALBUM_SETTLE_MS = 12_000;

function ok(body: unknown = { ok: true }) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function admin(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

function botToken(): string {
  return Deno.env.get("TELEGRAM_ADS_BOT_TOKEN") ??
    Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
}

/* ────────────────────────────── Telegram API ─────────────────────────── */

interface TgPhotoSize {
  file_id: string;
  file_size?: number;
  width?: number;
  height?: number;
}

interface TgMessage {
  message_id: number;
  chat?: { id?: number | string; title?: string };
  caption?: string;
  text?: string;
  media_group_id?: string;
  photo?: TgPhotoSize[];
  video?: { file_id: string; file_size?: number; file_name?: string };
  document?: { file_id: string; file_size?: number; file_name?: string; mime_type?: string };
}

async function tg<T>(method: string, body: Record<string, unknown>): Promise<T | null> {
  const token = botToken();
  if (!token) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const data = await res.json().catch(() => null) as { ok?: boolean; result?: T } | null;
    return data?.ok ? (data.result ?? null) : null;
  } catch (e) {
    console.warn(`[ads-telegram-intake] ${method}:`, (e as Error).message);
    return null;
  }
}

async function reply(chatId: string | number, text: string): Promise<void> {
  await tg("sendMessage", { chat_id: chatId, text });
}

/** Скачивает файл бота. Возвращает null, если файл недоступен или слишком велик. */
async function downloadFile(fileId: string, fallbackName: string): Promise<File | null> {
  const token = botToken();
  if (!token) return null;

  const info = await tg<{ file_path?: string; file_size?: number }>("getFile", {
    file_id: fileId,
  });
  if (!info?.file_path) return null;
  if ((info.file_size ?? 0) > TELEGRAM_FILE_LIMIT) return null;

  const res = await fetch(
    `https://api.telegram.org/file/bot${token}/${info.file_path}`,
    { signal: AbortSignal.timeout(120_000) },
  );
  if (!res.ok) return null;

  const blob = await res.blob();
  const name = info.file_path.split("/").pop() || fallbackName;
  return new File([blob], name, { type: blob.type || "application/octet-stream" });
}

/* ────────────────────────────── разбор медиа ─────────────────────────── */

type MediaKind = "photo" | "video" | "none";

interface Media {
  kind: MediaKind;
  fileId: string;
  fileName: string;
  tooLarge: boolean;
}

function pickMedia(msg: TgMessage): Media {
  if (Array.isArray(msg.photo) && msg.photo.length > 0) {
    // Telegram присылает несколько размеров — берём самый крупный.
    const best = msg.photo.reduce((a, b) =>
      (b.file_size ?? 0) > (a.file_size ?? 0) ? b : a
    );
    return {
      kind: "photo",
      fileId: best.file_id,
      fileName: "photo.jpg",
      tooLarge: (best.file_size ?? 0) > TELEGRAM_FILE_LIMIT,
    };
  }
  if (msg.video) {
    return {
      kind: "video",
      fileId: msg.video.file_id,
      fileName: msg.video.file_name || "video.mp4",
      tooLarge: (msg.video.file_size ?? 0) > TELEGRAM_FILE_LIMIT,
    };
  }
  const doc = msg.document;
  if (doc?.mime_type?.startsWith("image/")) {
    return {
      kind: "photo",
      fileId: doc.file_id,
      fileName: doc.file_name || "photo.jpg",
      tooLarge: (doc.file_size ?? 0) > TELEGRAM_FILE_LIMIT,
    };
  }
  if (doc?.mime_type?.startsWith("video/")) {
    return {
      kind: "video",
      fileId: doc.file_id,
      fileName: doc.file_name || "video.mp4",
      tooLarge: (doc.file_size ?? 0) > TELEGRAM_FILE_LIMIT,
    };
  }
  return { kind: "none", fileId: "", fileName: "", tooLarge: false };
}

/* ────────────────────────────── обработка ────────────────────────────── */

async function handleMessage(db: SupabaseClient, msg: TgMessage): Promise<void> {
  const chatId = String(msg.chat?.id ?? "");
  if (!chatId) return;

  const caption = msg.caption ?? msg.text ?? "";
  const media = pickMedia(msg);
  const mediaGroupId = msg.media_group_id ?? null;

  // Текст без медиа — это разговор, а не запуск.
  if (media.kind === "none") return;

  if (media.tooLarge) {
    await reply(
      chatId,
      "Файл больше 20 МБ — Telegram не отдаёт такие ботам. " +
        "Сожмите видео или загрузите его через сайт, раздел «Управление рекламой».",
    );
    return;
  }

  const { data: cabinetRow } = await db
    .from("ad_cabinets")
    .select("*")
    .eq("telegram_group_id", chatId)
    .maybeSingle();

  if (!cabinetRow) {
    await reply(
      chatId,
      "Этот чат не привязан к рекламному кабинету. " +
        "Укажите его ID в настройках кабинета на сайте, и запуск заработает.",
    );
    return;
  }
  const cabinet = cabinetRow as Record<string, unknown>;

  if (needsDirectionPrompt({ caption, hasMedia: true, mediaGroupId })) {
    await reply(
      chatId,
      "Куда запускаем? Добавьте к файлу подпись: «на сайт», «на форму», " +
        "«в директ» или «в whatsapp», и там же текст объявления и бюджет.",
    );
    return;
  }

  const adAccount = normalizeActId(
    String(cabinet.ad_account_id ?? cabinet.external_id ?? ""),
  );
  if (!adAccount) {
    await reply(chatId, "У кабинета не заполнен рекламный аккаунт — запускать некуда.");
    return;
  }

  const projectId = cabinet.project_id ? String(cabinet.project_id) : null;
  const token = await resolveMetaAccessToken({
    cabinetId: String(cabinet.id),
    projectId,
    admin: db,
  });
  if (!token) {
    await reply(chatId, "Нет токена Meta: подключите Facebook в настройках кабинета.");
    return;
  }

  // ── Медиа сразу в Meta: дальше очереди нужен только hash или id ──
  const file = await downloadFile(media.fileId, media.fileName);
  if (!file) {
    await reply(chatId, "Не получилось скачать файл из Telegram. Пришлите его ещё раз.");
    return;
  }

  let imageHash: string | null = null;
  let videoId: string | null = null;
  try {
    if (media.kind === "photo") {
      const uploaded = await uploadImage(adAccount, token, file);
      imageHash = uploaded?.hash ?? null;
      if (!imageHash) throw new Error("Meta не вернула image_hash");
    } else {
      videoId = await uploadVideoFile(adAccount, token, file);
    }
  } catch (e) {
    const message = e instanceof MetaApiError ? e.message : (e as Error).message;
    await reply(chatId, `Meta не приняла файл: ${message}`);
    return;
  }

  // ── Кадр альбома: складываем и, если это первый, заводим задание ──
  if (mediaGroupId && imageHash) {
    await db.from("ad_telegram_media").upsert({
      media_group_id: mediaGroupId,
      chat_id: chatId,
      message_id: msg.message_id,
      cabinet_id: String(cabinet.id),
      meta_image_hash: imageHash,
    }, { onConflict: "media_group_id,message_id" });
  }

  // Подпись висит на одном кадре альбома; остальные приходят пустыми —
  // для них задание не создаём, они просто пополняют карусель.
  if (mediaGroupId && caption.trim() === "") return;

  const parsed = parseLaunchCommand(caption);

  // Текст объявления не выдумываем: в n8n его писал AI, но без анализа
  // креатива он сочинял бы цены и обещания. Просим текст у человека.
  if (!parsed.adText) {
    await reply(
      chatId,
      "Добавьте в подпись текст объявления — он уходит в рекламу как есть. " +
        "Пример: «на сайт, бюджет 30. Импланты под ключ за 3 дня, гарантия 5 лет».",
    );
    return;
  }

  const { data: allowedRows } = await db
    .from("ad_cabinet_websites")
    .select("url, label, is_default")
    .eq("cabinet_id", String(cabinet.id));

  const website = resolveWebsite({
    fromCaption: parsed.websiteFromCaption,
    cabinetDefault: String(cabinet.website_url ?? "") || null,
    allowed: (allowedRows ?? []).map((w) => ({
      url: String((w as Record<string, unknown>).url ?? ""),
      label: (w as Record<string, unknown>).label as string | null,
      isDefault: (w as Record<string, unknown>).is_default as boolean | null,
    })),
  });

  const budgetUsd = parsed.budgetUsd ??
    (Number(cabinet.daily_budget) > 0 ? Number(cabinet.daily_budget) : 5);

  const format = mediaGroupId ? "carousel" : videoId ? "video" : "single";
  const launchId = crypto.randomUUID();

  // Строка запуска — чтобы прогресс был виден и на сайте, а не только в чате.
  const { error: campaignErr } = await db.from("ad_campaigns").insert({
    launch_id: launchId,
    cabinet_id: String(cabinet.id),
    project_id: projectId,
    goal: parsed.goal,
    budget: String(budgetUsd),
    text: parsed.adText,
    status: "queued",
    status_step: "accepted",
    status_message: "Запуск принят из Telegram",
    status_updated_at: new Date().toISOString(),
  });
  if (campaignErr) {
    await reply(chatId, `Не удалось зарегистрировать запуск: ${campaignErr.message}`);
    return;
  }

  const { error: jobErr } = await db.from("ad_launch_jobs").insert({
    launch_id: launchId,
    project_id: projectId,
    cabinet_id: String(cabinet.id),
    status: "queued",
    step: "resolve",
    // Альбому даём время долететь целиком, остальному — сразу.
    next_attempt_at: new Date(Date.now() + (mediaGroupId ? ALBUM_SETTLE_MS : 0))
      .toISOString(),
    telegram_media_group_id: mediaGroupId,
    request: {
      source: "telegram",
      chatId,
      goal: parsed.goal,
      budgetUsd,
      text: parsed.adText,
      codeWord: parsed.codeWord,
      format,
      imageHash,
      videoId,
      websiteUrl: website.url,
      adAccountId: adAccount,
      telegramMediaGroupId: mediaGroupId,
    },
  });

  if (jobErr) {
    // Уникальный ключ по media_group_id: задание на этот альбом уже создано
    // соседним кадром — это не ошибка, просто второй раз запускать не нужно.
    if (/duplicate key|unique constraint/i.test(jobErr.message)) return;
    await db.from("ad_campaigns")
      .update({
        status: "error",
        status_message: `Очередь недоступна: ${jobErr.message}`,
        last_error: jobErr.message,
      })
      .eq("launch_id", launchId);
    await reply(chatId, `Не удалось поставить запуск в очередь: ${jobErr.message}`);
    return;
  }

  const goalLabel = parsed.destination === "website"
    ? `сайт ${website.url ?? ""}`.trim()
    : parsed.destination === "leadform"
    ? "лид-форма"
    : parsed.destination === "instagram"
    ? "директ Instagram"
    : "WhatsApp";

  const lines = [
    "Принял, запускаю.",
    `Направление: ${goalLabel}`,
    `Бюджет: $${budgetUsd} в сутки`,
    format === "carousel" ? "Формат: карусель" : format === "video" ? "Формат: видео" : "Формат: фото",
  ];
  if (parsed.codeWord) lines.push(`Кодовое слово: ${parsed.codeWord}`);
  if (website.message) lines.push(website.message);
  await reply(chatId, lines.join("\n"));

  // Пинок воркера, чтобы не ждать тик крона. Альбом трогать рано — ему нужно
  // время долететь, его подберёт крон по next_attempt_at.
  if (!mediaGroupId) {
    const { data: settings } = await db
      .from("automation_settings")
      .select("cron_secret")
      .eq("id", true)
      .maybeSingle();
    const secret = (settings as { cron_secret?: string | null } | null)?.cron_secret ?? "";
    fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/ads-launch-worker`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-automation-key": secret },
      body: JSON.stringify({ batch_size: 3 }),
      signal: AbortSignal.timeout(3_000),
    }).catch(() => {});
  }
}

/* ────────────────────────────── точка входа ──────────────────────────── */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Telegram подписывает вызовы секретом из setWebhook — без него апдейты
  // мог бы слать кто угодно.
  const expected = Deno.env.get("TELEGRAM_ADS_WEBHOOK_SECRET");
  if (!expected) {
    return new Response(
      JSON.stringify({ error: "TELEGRAM_ADS_WEBHOOK_SECRET не задан" }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  if (req.headers.get("x-telegram-bot-api-secret-token") !== expected) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const update = await req.json().catch(() => null) as
    | { message?: TgMessage; channel_post?: TgMessage }
    | null;
  const message = update?.message ?? update?.channel_post ?? null;
  if (!message) return ok();

  try {
    await handleMessage(admin(), message);
  } catch (e) {
    // Telegram повторяет апдейт при ошибке — отвечаем 200 и разбираемся по логам.
    console.error("[ads-telegram-intake]", (e as Error).message);
    const chatId = message.chat?.id;
    if (chatId) {
      await reply(chatId, "Внутренняя ошибка при запуске. Мы уже знаем, попробуйте ещё раз.");
    }
  }
  return ok();
});
