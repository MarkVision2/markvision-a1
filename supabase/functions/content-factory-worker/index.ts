// content-factory-worker — генерация статичного контента вместо n8n.
//
// Разбирает очередь content_factory_jobs и повторяет путь воркфлоу «Clony AI»:
//   1. анализ входа  — референсное фото через Gemini Vision, сайт по ссылке;
//   2. стратегия     — промпт ветки по content_type → список слайдов;
//   3. кадры         — по слайду: Gemini image → Storage → content_factory_results
//                      (фронт видит их сразу через realtime) → галерея → Telegram.
//
// Долгая работа нарезана: за один вызов делаем столько кадров, сколько
// успеваем до мягкого дедлайна, и возвращаем задание в очередь. Крон раз
// в минуту продолжает с того слайда, на котором остановились — поэтому
// карусель из десяти кадров не упирается в лимит времени функции.
//
// Auth: x-automation-key == automation_settings.cron_secret либо service-role.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import {
  base64ToBytes,
  geminiImage,
  geminiText,
  geminiVision,
  hasGeminiKey,
} from "../_lib/gemini.ts";
import {
  buildBranchPrompt,
  buildSlidePrompt,
  type GenerationSlide,
  parseStrategy,
} from "../_lib/contentFactoryGen.ts";
import { VISION_ANALYSIS_PROMPT } from "../_lib/contentFactoryPrompts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-automation-key, x-cron-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_ATTEMPTS = 4;
const DEFAULT_BATCH = 2;
const STUCK_MINUTES = 15;
/** Мягкий дедлайн вызова: успеть завершить кадр и аккуратно вернуть задание. */
const SOFT_DEADLINE_MS = 200_000;
/** Сколько референсных фото отдаём модели (в n8n было до 14). */
const MAX_REFERENCES = 8;
/** Крупные референсы режем — иначе тело запроса к Gemini раздувается. */
const MAX_REFERENCE_BYTES = 4_000_000;
const BUCKET = "content-factory";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface JobRow {
  id: string;
  request_id: string;
  session_id: string | null;
  project_id: string | null;
  created_by: string | null;
  body: Record<string, unknown>;
  status: string;
  analysis: Record<string, string>;
  strategy: GenerationSlide[] | null;
  slides_done: number;
  slides_total: number;
  attempts: number;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Скачивание референса в base64 для inline_data. */
async function fetchAsBase64(
  url: string,
): Promise<{ data: string; mime: string } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(45_000) });
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (!buf.byteLength || buf.byteLength > MAX_REFERENCE_BYTES) return null;
    let binary = "";
    for (let i = 0; i < buf.length; i += 8192) {
      binary += String.fromCharCode(...buf.subarray(i, i + 8192));
    }
    return {
      data: btoa(binary),
      mime: res.headers.get("content-type")?.split(";")[0] || "image/jpeg",
    };
  } catch {
    return null;
  }
}

function referenceUrls(body: Record<string, unknown>): string[] {
  const raw = body.image_urls;
  const list = Array.isArray(raw) ? raw : [];
  return list
    .filter((u): u is string => typeof u === "string" && /^https:\/\//i.test(u.trim()))
    .map((u) => u.trim())
    .slice(0, MAX_REFERENCES);
}

/** Текст страницы по ссылке — замена ноды ScrapingBee в n8n. */
async function fetchSiteText(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
      headers: { "User-Agent": "MarkVisionBot/1.0" },
    });
    if (!res.ok) return "";
    const html = await res.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 6000);
  } catch {
    return "";
  }
}

async function setStep(admin: SupabaseClient, job: JobRow, step: string) {
  await admin.from("content_factory_jobs").update({ step }).eq("id", job.id);
}

/** Ошибка слайда видна пользователю прямо в карточке «в работе». */
async function markResultError(
  admin: SupabaseClient,
  requestId: string,
  slideIndex: number,
  message: string,
) {
  await admin.from("content_factory_results").upsert({
    request_id: requestId,
    slide_index: slideIndex,
    status: "error",
    error_message: message.slice(0, 500),
  }, { onConflict: "request_id,slide_index" });
}

async function failJob(
  admin: SupabaseClient,
  job: JobRow,
  reason: string,
  retryable: boolean,
) {
  const canRetry = retryable && job.attempts < MAX_ATTEMPTS;
  const delayMin = Math.min(Math.pow(2, job.attempts), 30);
  await admin.from("content_factory_jobs").update({
    status: canRetry ? "queued" : "error",
    last_error: reason,
    locked_at: null,
    next_attempt_at: new Date(Date.now() + (canRetry ? delayMin * 60_000 : 0)).toISOString(),
    ...(canRetry ? {} : { completed_at: new Date().toISOString() }),
  }).eq("id", job.id);

  if (!canRetry) {
    // Оставшиеся кадры помечаем ошибкой — иначе карточки висят «в работе» вечно.
    for (let i = job.slides_done; i < Math.max(job.slides_total, 1); i++) {
      await markResultError(admin, job.request_id, i, reason);
    }
  }
  return { id: job.id, status: canRetry ? "retry" : "error", reason };
}

/** Telegram-чат проекта: как у монтажа — через telegram_links. */
async function resolveTelegramChat(
  admin: SupabaseClient,
  projectId: string | null,
): Promise<string | null> {
  if (projectId) {
    const { data } = await admin
      .from("telegram_links")
      .select("chat_id")
      .eq("project_id", projectId)
      .limit(1)
      .maybeSingle();
    const chat = (data as { chat_id?: string } | null)?.chat_id;
    if (chat) return String(chat);
  }
  return Deno.env.get("CONTENT_FACTORY_TELEGRAM_CHAT_ID") ?? null;
}

async function sendTelegramPhoto(chatId: string, imageUrl: string, caption: string) {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token || !chatId) return;
  try {
    // Отдаём Telegram ссылку: bucket публичный, и так не нужно гонять
    // мегабайты через память функции.
    await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        photo: imageUrl,
        caption: caption.slice(0, 1000),
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    console.error("[content-factory-worker] telegram:", (e as Error).message);
  }
}

async function processJob(
  admin: SupabaseClient,
  job: JobRow,
  deadline: number,
): Promise<Record<string, unknown>> {
  const body = job.body ?? {};
  const analysis: Record<string, string> = { ...(job.analysis ?? {}) };
  const refs = referenceUrls(body);

  // ===== 1. Анализ входа =====
  if (analysis.done !== "1") {
    await setStep(admin, job, "analyzing");

    if (refs.length) {
      const first = await fetchAsBase64(refs[0]);
      if (first) {
        const vision = await geminiVision(VISION_ANALYSIS_PROMPT, [first]);
        if (vision.ok) analysis.image_analysis = vision.data ?? "";
        else if (vision.retryable) return await failJob(admin, job, vision.error ?? "", true);
      }
    }

    const link = str(body.link);
    if (link && /^https?:\/\//i.test(link)) {
      analysis.site_data = await fetchSiteText(link);
    }

    // В n8n text-ветка складывала расшифровку аудио и текст брифа.
    // Аудио в Контент-заводе нет, остаётся текст задания.
    analysis.text_analysis = [str(body.prompt), str(body.description)]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 6000);

    analysis.done = "1";
    await admin.from("content_factory_jobs").update({ analysis }).eq("id", job.id);
  }

  // ===== 2. Стратегия слайдов =====
  let strategy = job.strategy;
  if (!strategy || !strategy.length) {
    await setStep(admin, job, "strategy");
    const prompt = buildBranchPrompt(body, analysis);
    const res = await geminiText(prompt);
    if (!res.ok) return await failJob(admin, job, res.error ?? "Модель не ответила", res.retryable);

    const aspect = str(body.aspect) || "4:5";
    strategy = parseStrategy(res.data ?? "", aspect, Math.max(job.slides_total, 1));
    if (!strategy.length) {
      return await failJob(admin, job, "Модель не вернула ни одного слайда", true);
    }
    await admin.from("content_factory_jobs")
      .update({ strategy, slides_total: strategy.length })
      .eq("id", job.id);
  }

  // ===== 3. Кадры =====
  const references: Array<{ data: string; mime: string }> = [];
  for (const url of refs) {
    const ref = await fetchAsBase64(url);
    if (ref) references.push(ref);
  }

  const chatId = await resolveTelegramChat(admin, job.project_id);
  const styleLabel = str(body.style_label) || str(body.style);
  let done = job.slides_done;

  for (let index = done; index < strategy.length; index++) {
    if (Date.now() > deadline) {
      // Время вышло — задание вернётся в очередь и продолжится со следующего
      // кадра. Попытку не тратим: прогресс есть, это не сбой.
      await admin.from("content_factory_jobs").update({
        status: "queued",
        step: "generating",
        slides_done: done,
        locked_at: null,
        attempts: 0,
        next_attempt_at: new Date().toISOString(),
      }).eq("id", job.id);
      return { id: job.id, status: "partial", slides_done: done, of: strategy.length };
    }

    await setStep(admin, job, `generating:${index + 1}/${strategy.length}`);
    const slide = strategy[index];
    const image = await geminiImage(buildSlidePrompt(slide, references.length), references);

    if (!image.ok || !image.data) {
      const reason = image.error ?? "Модель не вернула изображение";
      if (image.retryable) return await failJob(admin, job, reason, true);
      // Фильтр отказал именно на этом кадре — остальные ещё могут получиться.
      await markResultError(admin, job.request_id, index, reason);
      done = index + 1;
      await admin.from("content_factory_jobs")
        .update({ slides_done: done, last_error: reason })
        .eq("id", job.id);
      continue;
    }

    const ext = image.data.mime.includes("jpeg") ? "jpg" : "png";
    const path = `generated/${job.request_id}/${index}.${ext}`;
    const { error: upErr } = await admin.storage
      .from(BUCKET)
      .upload(path, base64ToBytes(image.data.data), {
        contentType: image.data.mime,
        upsert: true,
      });
    if (upErr) return await failJob(admin, job, `Storage: ${upErr.message}`, true);

    const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
    const imageUrl = pub.publicUrl;

    // Фронт слушает именно эту таблицу — подменяет «в работе» на картинку.
    await admin.from("content_factory_results").upsert({
      request_id: job.request_id,
      slide_index: index,
      style_id: str(body.style_id) || null,
      style_label: styleLabel || null,
      status: "ready",
      image_url: imageUrl,
      raw: { slide, source: "direct" },
      error_message: null,
    }, { onConflict: "request_id,slide_index" });

    if (job.project_id) {
      await admin.from("content_factory_gallery").insert({
        project_id: job.project_id,
        created_by: job.created_by,
        // request_id уникален на проект — для карусели добавляем индекс кадра.
        request_id: strategy.length > 1 ? `${job.request_id}#${index}` : job.request_id,
        session_id: job.session_id,
        type_id: str(body.type_id) || str(body.content_type),
        type_title: str(body.type_title) || null,
        style_id: str(body.style_id) || null,
        style_label: styleLabel || null,
        image_url: imageUrl,
        prompt_snapshot: str(body.prompt).slice(0, 4000),
        metadata: { source: "direct", slide_index: index, slide_type: slide.slide_type },
      });
    }

    if (chatId) {
      await sendTelegramPhoto(
        chatId,
        imageUrl,
        [styleLabel, str(body.name), `кадр ${index + 1}/${strategy.length}`]
          .filter(Boolean)
          .join(" · "),
      );
    }

    done = index + 1;
    // Прогресс сбрасывает счётчик попыток: сбои считаем подряд идущими,
    // иначе длинная карусель исчерпала бы лимит на ровном месте.
    await admin.from("content_factory_jobs")
      .update({ slides_done: done, attempts: 0 })
      .eq("id", job.id);
  }

  await admin.from("content_factory_jobs").update({
    status: "done",
    step: "done",
    slides_done: done,
    locked_at: null,
    completed_at: new Date().toISOString(),
  }).eq("id", job.id);

  return { id: job.id, status: "done", slides: done };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: settings } = await admin
    .from("automation_settings")
    .select("cron_secret")
    .eq("id", true)
    .maybeSingle();
  const expected = (settings as { cron_secret?: string } | null)?.cron_secret
    ?? Deno.env.get("AUTOMATION_CRON_KEY");
  const provided = req.headers.get("x-automation-key") ?? req.headers.get("x-cron-key");
  const isServiceRole = req.headers.get("Authorization")?.includes(
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "___",
  );
  if (!isServiceRole && (!expected || provided !== expected)) {
    return json({ error: "Unauthorized" }, 401);
  }

  if (!hasGeminiKey()) return json({ error: "GEMINI_API_KEY не задан" }, 503);

  let payload: { batch_size?: number; job_id?: string } = {};
  try { payload = await req.json(); } catch { /* пустое тело допустимо */ }
  const batchSize = Math.min(Math.max(Number(payload.batch_size) || DEFAULT_BATCH, 1), 5);

  // Реанимация зависших: функция могла быть прервана посреди кадра.
  await admin.from("content_factory_jobs")
    .update({ status: "queued", locked_at: null })
    .eq("status", "processing")
    .lt("locked_at", new Date(Date.now() - STUCK_MINUTES * 60_000).toISOString());

  const { data: rows, error } = payload.job_id
    ? await admin.from("content_factory_jobs").select("*").eq("id", payload.job_id).limit(1)
    : await admin
      .from("content_factory_jobs")
      .select("*")
      .eq("status", "queued")
      .lt("attempts", MAX_ATTEMPTS)
      .lte("next_attempt_at", new Date().toISOString())
      .order("created_at", { ascending: true })
      .limit(batchSize);

  if (error) return json({ error: error.message }, 500);

  const jobs = (rows ?? []) as JobRow[];
  const results: unknown[] = [];
  const deadline = Date.now() + SOFT_DEADLINE_MS;

  for (const job of jobs) {
    if (["done", "error", "cancelled"].includes(job.status)) continue;
    if (Date.now() > deadline) break;

    const { data: claimed } = await admin
      .from("content_factory_jobs")
      .update({
        status: "processing",
        locked_at: new Date().toISOString(),
        attempts: job.attempts + 1,
      })
      .eq("id", job.id)
      .is("locked_at", null)
      .select()
      .maybeSingle();
    if (!claimed) {
      results.push({ id: job.id, status: "skipped", reason: "locked" });
      continue;
    }

    try {
      results.push(await processJob(admin, claimed as JobRow, deadline));
    } catch (e) {
      results.push(await failJob(
        admin,
        claimed as JobRow,
        `Внутренняя ошибка воркера: ${(e as Error).message}`,
        true,
      ));
    }
  }

  return json({ ok: true, processed: jobs.length, results });
});
