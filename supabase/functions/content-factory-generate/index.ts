// content-factory-generate — приём заявки Контент-завода вместо вебхука в n8n.
//
// Мастер (CreateStep3) шлёт сюда тот же JSON, что раньше уходил в n8n:
// плоские поля на корне плюс полный дубль в body. Функция не генерирует
// ничего сама — она ставит задание в очередь content_factory_jobs, создаёт
// строку-заглушку в content_factory_results (её фронт уже слушает по
// request_id через realtime) и сразу дёргает воркер.
//
// Так ответ приходит мгновенно, а долгая генерация идёт в фоне с ретраями —
// раньше фронт ждал n8n до 120 секунд и часто получал таймаут.
//
// Детали — docs/CONTENT-FACTORY-DIRECT.md.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { AUTH_CORS_HEADERS, requireUser } from "../_lib/auth.ts";
import { hasGeminiKey } from "../_lib/gemini.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...AUTH_CORS_HEADERS, "Content-Type": "application/json" },
  });
}

/** Тело заявки: мастер дублирует всё в body, но подстрахуемся корнем. */
function readBody(payload: Record<string, unknown>): Record<string, unknown> {
  const nested = payload.body;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return payload;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: AUTH_CORS_HEADERS });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  if (!hasGeminiKey()) {
    return json({
      error: "Не настроен GEMINI_API_KEY — генерация изображений недоступна",
    }, 503);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json() as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const body = readBody(payload);
  const requestId = str(body.request_id) || str(payload.request_id);
  if (!requestId) {
    return json({ error: "Не передан request_id — фронт не сможет поймать результат" }, 400);
  }

  const contentType = str(body.content_type) || "fb-target";
  const prompt = str(body.prompt);
  if (!prompt) {
    return json({ error: "Пустое ТЗ: в body.prompt должно быть техзадание" }, 400);
  }

  const projectId = str(body.project_id) || str(payload.project_id) || null;
  const sessionId = str(body.session_id) || str(payload.session_id) || null;
  const styleId = str(body.style_id) || str(body.style);
  const styleLabel = str(body.style_label) || styleId;

  // Сколько кадров ждёт фронт: slides для карусели, иначе один.
  const slidesRaw = Number(body.slides ?? body.image_count ?? 1);
  const slidesTotal = Number.isFinite(slidesRaw) && slidesRaw > 0
    ? Math.min(Math.round(slidesRaw), 10)
    : 1;

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Заглушки результата — фронт подписан по request_id и сразу покажет
  // «в работе», а воркер заменит строки готовыми картинками.
  const placeholders = Array.from({ length: slidesTotal }, (_, index) => ({
    request_id: requestId,
    slide_index: index,
    style_id: styleId || null,
    style_label: styleLabel || null,
    status: "queued",
  }));
  const { error: resultsErr } = await admin
    .from("content_factory_results")
    .upsert(placeholders, { onConflict: "request_id,slide_index" });
  if (resultsErr) {
    // Не фатально: воркер вставит строки сам, когда картинка будет готова.
    console.error("[content-factory-generate] results placeholder:", resultsErr.message);
  }

  const { data: job, error: jobErr } = await admin
    .from("content_factory_jobs")
    .upsert({
      request_id: requestId,
      session_id: sessionId,
      project_id: projectId,
      created_by: auth.userId,
      body,
      status: "queued",
      step: "queued",
      slides_total: slidesTotal,
      slides_done: 0,
      attempts: 0,
      next_attempt_at: new Date().toISOString(),
      locked_at: null,
      last_error: null,
    }, { onConflict: "request_id" })
    .select("id")
    .single();

  if (jobErr || !job) {
    return json({ error: `Не удалось поставить задание: ${jobErr?.message}` }, 500);
  }

  // Fire-and-forget: ждать воркер незачем, результат придёт через realtime.
  // Если вызов не дойдёт, задание подберёт крон в течение минуты.
  const kick = fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/content-factory-worker`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify({ job_id: (job as { id: string }).id, source: "enqueue" }),
    signal: AbortSignal.timeout(300_000),
  }).catch((e) => console.error("[content-factory-generate] kick:", (e as Error).message));

  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
    .EdgeRuntime;
  if (typeof rt?.waitUntil === "function") rt.waitUntil(kick);

  return json({
    ok: true,
    accepted: true,
    mode: "direct",
    jobId: (job as { id: string }).id,
    request_id: requestId,
    content_type: contentType,
    slides: slidesTotal,
    // Картинки приходят через realtime content_factory_results — синхронного
    // image_url здесь принципиально нет.
    status: "queued",
  });
});
