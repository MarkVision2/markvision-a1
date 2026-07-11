// Воркер доставки: поллит задачи Video Agent и отправляет готовое видео в Telegram.
// Запускается по cron (pg_cron → net.http_post с x-automation-key).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const HEYGEN_BASE = "https://api.heygen.com";
const N8N_WEBHOOK = Deno.env.get("N8N_CONTENT_WEBHOOK_URL") ?? "https://n8n.zapoinov.com/webhook/clony-yurii";
const BATCH = 20;
const MAX_AGE_MIN = 30; // задачи старше — помечаем ошибкой, чтобы не висели вечно
const MAX_TG_RETRY_MIN = 20; // сколько повторяем именно отправку в Telegram, когда видео уже готово

const TERMINAL_OK = ["completed", "success", "done"];
const TERMINAL_FAIL = ["failed", "error"];

function nestedOf(d: Record<string, unknown>, k: string, s: string) {
  const v = d[k];
  return v && typeof v === "object" ? (v as Record<string, unknown>)[s] : undefined;
}
function pickUrl(d: Record<string, unknown>): string | undefined {
  return [
    d.video_url, d.url, d.download_url, d.mp4_url,
    nestedOf(d, "video", "url"), nestedOf(d, "video", "video_url"), nestedOf(d, "video", "download_url"),
    nestedOf(d, "output", "video_url"), nestedOf(d, "result", "video_url"), nestedOf(d, "data", "video_url"),
  ].find((x) => typeof x === "string" && (x as string).length > 0) as string | undefined;
}
function pickVideoId(d: Record<string, unknown>): string | undefined {
  return [d.video_id, nestedOf(d, "video", "video_id"), nestedOf(d, "video", "id"), nestedOf(d, "result", "video_id")]
    .find((x) => typeof x === "string" && (x as string).length > 0) as string | undefined;
}

// HeyGen отказывает в рендере с "Insufficient credit..." при пустом API-кошельке —
// это не сбой генерации, а закончившийся баланс, и пользователю нужно сообщить
// именно это, а не общее "попробуйте ещё раз" (оно вводит в заблуждение — повтор
// не поможет, пока не пополнить баланс).
function isCreditError(msg: string): boolean {
  return /insufficient|credit|balance/i.test(msg);
}

// Telegram Bot API часто отвечает HTTP 200 даже на отказ (ok:false в теле,
// например "wrong file identifier/HTTP URL specified" для sendVideo по ссылке)
// — проверка одного r.ok маскировала реальную причину недоставки. Разбираем
// тело и логируем description, если Telegram отказал.
async function tg(token: string, method: string, body: Record<string, unknown>) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j?.ok === false) {
      console.error(`telegram ${method} failed`, r.status, JSON.stringify(j));
      return false;
    }
    return true;
  } catch (e) {
    console.error(`telegram ${method} threw`, e instanceof Error ? e.message : String(e));
    return false;
  }
}

// Уведомление в чат. У веб-задач чата нет (chat_id = null) — молча пропускаем.
async function notify(token: string, chatId: string | null, text: string) {
  if (!chatId) return;
  await tg(token, "sendMessage", { chat_id: chatId, text });
}

// Telegram's sendVideo с video:<url> просит ЕГО серверá сами скачать файл —
// это ненадёжно против CDN HeyGen (иногда получаем "wrong file identifier/
// HTTP URL specified"), и тогда доставка тихо падала в plain-text ссылку.
// Качаем видео сами и грузим байты как multipart — так результат не зависит
// от того, смог ли Telegram сам достучаться до CDN.
const TELEGRAM_UPLOAD_LIMIT_BYTES = 49 * 1024 * 1024; // предел загрузки ботом файла через Bot API — 50 МБ
async function sendVideoFile(token: string, chatId: string, url: string, caption: string): Promise<boolean> {
  try {
    const fileRes = await fetch(url);
    if (!fileRes.ok) return false;
    const contentType = fileRes.headers.get("content-type") || "video/mp4";
    const bytes = new Uint8Array(await fileRes.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > TELEGRAM_UPLOAD_LIMIT_BYTES) return false;

    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("caption", caption);
    form.append("video", new Blob([bytes], { type: contentType }), "video.mp4");

    const r = await fetch(`https://api.telegram.org/bot${token}/sendVideo`, { method: "POST", body: form });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j?.ok === false) {
      console.error("telegram sendVideo(file) failed", r.status, JSON.stringify(j));
      return false;
    }
    return true;
  } catch (e) {
    console.error("telegram sendVideo(file) threw", e instanceof Error ? e.message : String(e));
    return false;
  }
}

Deno.serve(async (req) => {
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Авторизация cron-вызова (fail-closed: без валидного секрета — отказ).
  const { data: settings } = await admin.from("automation_settings").select("cron_secret").eq("id", true).maybeSingle();
  const secret = settings?.cron_secret as string | undefined;
  const provided = req.headers.get("x-automation-key");
  if (!secret || !provided || provided !== secret) {
    return new Response("forbidden", { status: 403 });
  }

  const apiKey = Deno.env.get("HEYGEN_API_KEY");
  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!apiKey || !botToken) {
    return new Response(JSON.stringify({ error: "missing HEYGEN_API_KEY or TELEGRAM_BOT_TOKEN" }), { status: 500 });
  }

  const { data: jobs } = await admin
    .from("heygen_jobs")
    .select("id, project_id, chat_id, session_id, script, source, created_at, updated_at, video_url")
    .eq("delivered", false)
    .order("created_at", { ascending: true })
    .limit(BATCH);

  // Куда доставлять готовое видео. Для Telegram-задачи — в её чат; для веб-задачи —
  // в привязанный к проекту чат (если он есть), чтобы ролик пришёл и на сайт, и в Telegram.
  async function resolveChatId(job: { chat_id: string | null; project_id: string | null }): Promise<string | null> {
    if (job.chat_id) return job.chat_id;
    if (!job.project_id) return null;
    const { data: link } = await admin
      .from("telegram_links").select("chat_id").eq("project_id", job.project_id).limit(1).maybeSingle();
    return (link?.chat_id as string | undefined) ?? null;
  }

  // Обложка + описание по сценарию через n8n Clony. В чат шлём, только если он есть —
  // но cover/desc всё равно возвращаем для записи в галерею.
  async function sendAssets(chatId: string | null, script: string | null, projectId: string | null) {
    if (!script) return { cover: null, desc: null };
    try {
      const res = await fetch(N8N_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "heygen_montage", type: "video_assets", script, project_id: projectId }),
        signal: AbortSignal.timeout(60_000),
      });
      const a = await res.json().catch(() => ({}));
      const cover = a?.cover_url ?? a?.image_url ?? a?.thumbnail_url;
      const desc = a?.description ?? a?.caption ?? a?.text;
      if (cover && chatId) await tg(botToken, "sendPhoto", { chat_id: chatId, photo: cover, caption: "Обложка" });
      if (desc && chatId) await tg(botToken, "sendMessage", { chat_id: chatId, text: `Описание:\n${desc}` });
      return { cover: cover ?? null, desc: desc ?? null };
    } catch { /* обложка/описание не критичны */ }
    return { cover: null, desc: null };
  }

  let delivered = 0, failed = 0, pending = 0;

  for (const job of jobs ?? []) {
    try {
      // Если видео уже было опознано как готовое на прошлом проходе (video_url
      // сохранён), но доставить в Telegram тогда не удалось — не спрашиваем
      // HeyGen заново, а сразу повторяем именно отправку, ничего не задваивая.
      const alreadyReady = Boolean(job.video_url);
      let vid: string | undefined;
      let url: string | undefined = (job.video_url as string | null) ?? undefined;
      let meta: Record<string, unknown> = {};
      let status = "";
      let failMsg = "";

      if (!alreadyReady) {
        const res = await fetch(`${HEYGEN_BASE}/v3/video-agents/${encodeURIComponent(job.session_id)}`, {
          headers: { "X-Api-Key": apiKey, Accept: "application/json" },
        });
        const body = await res.json().catch(() => ({}));
        const d = (body?.data ?? body ?? {}) as Record<string, unknown>;
        vid = pickVideoId(d);
        url = pickUrl(d);
        meta = d; // источник длительности/обложки
        status = String(d.status ?? ""); // статус сессии агента (пока нет video_id)

        // Как только у сессии есть video_id — авторитетен статус самого ВИДЕО
        // (GET /v3/videos/{id}), а не сессии агента: сессия бывает «failed», пока
        // видео ещё рендерится и затем успешно завершается (docs: Video Agent).
        if (vid) {
          let vd: Record<string, unknown> = {};
          try {
            const vr = await fetch(`${HEYGEN_BASE}/v3/videos/${encodeURIComponent(vid)}`, {
              headers: { "X-Api-Key": apiKey, Accept: "application/json" },
            });
            vd = ((await vr.json().catch(() => ({})))?.data ?? {}) as Record<string, unknown>;
          } catch { /* ignore */ }
          // Запасной путь — классический /v1, если v3 ничего не вернул.
          if (!pickUrl(vd) && !vd.status) {
            try {
              const vr1 = await fetch(`${HEYGEN_BASE}/v1/video_status.get?video_id=${encodeURIComponent(vid)}`, {
                headers: { "X-Api-Key": apiKey, Accept: "application/json" },
              });
              vd = ((await vr1.json().catch(() => ({})))?.data ?? vd) as Record<string, unknown>;
            } catch { /* ignore */ }
          }
          const vs = String(vd.status ?? "");
          if (vs) status = vs; // статус видео важнее статуса сессии
          const vurl = pickUrl(vd);
          if (vurl) { url = vurl; meta = vd; }
          failMsg = String(vd.failure_message ?? vd.error ?? "");
        }
      }

      const chatId = await resolveChatId(job); // Telegram-чат для доставки (у веб-задач — привязанный к проекту)
      const ageMin = (Date.now() - new Date(job.created_at).getTime()) / 60000;

      if (url) {
        // Сначала грузим файл сами (надёжнее), затем пробуем через ссылку силами
        // самого Telegram, и только если оба варианта не удались — шлём голую
        // ссылку текстом (например, если файл больше 50 МБ). tgOk=true, если чата
        // нет вовсе (веб-задача без привязанного Telegram) — слать было некуда.
        let tgOk = true;
        if (chatId) {
          const okVideo = await sendVideoFile(botToken, chatId, url, "Готово ✅")
            || await tg(botToken, "sendVideo", { chat_id: chatId, video: url, caption: "Готово ✅" });
          tgOk = okVideo || await tg(botToken, "sendMessage", { chat_id: chatId, text: `Видео готово: ${url}` });
        }

        if (!alreadyReady) {
          // Первый раз видим это видео — обложка/описание и списание расхода
          // фиксируются один раз, независимо от исхода отправки в Telegram
          // (при неудаче ниже повторяем только саму отправку, не задваивая это).
          const assets = await sendAssets(chatId, job.script, job.project_id);
          const durRaw = (meta.duration ?? meta.duration_sec) as number | undefined;
          const durationSec = typeof durRaw === "number" ? durRaw : null;
          const cost = durationSec ? Math.round((durationSec / 60) * 2 * 100) / 100 : null;
          const thumb = (meta.thumbnail_url ?? (meta.video as Record<string, unknown> | undefined)?.thumbnail_url) as string | null ?? null;
          const renderTimeSec = Math.round((Date.now() - new Date(job.created_at).getTime()) / 1000);
          // ref_id = настоящий video_id HeyGen (vid), а не session_id агента — так
          // локальная запись совпадает с id того же ролика в списке аккаунта HeyGen
          // (там же ключ для upsert-идемпотентности ниже: heygen_usage_project_ref_unique).
          await admin.from("heygen_usage").upsert({
            project_id: job.project_id, source: job.source ?? (job.chat_id ? "telegram" : "web"), mode: "agent",
            ref_id: vid ?? job.session_id, duration_sec: durationSec, cost_usd: cost, status: "completed",
            title: (job.script ?? "").slice(0, 80) || "Видео", render_time_sec: renderTimeSec,
            video_url: url, thumbnail_url: thumb, cover_url: assets.cover, description: assets.desc,
          }, { onConflict: "project_id,ref_id", ignoreDuplicates: true });
        }

        if (tgOk) {
          await admin.from("heygen_jobs").update({
            delivered: true, status: "done", video_url: url, error: null, updated_at: new Date().toISOString(),
          }).eq("id", job.id);
          delivered++;
        } else {
          // Видео готово, но ни один способ доставки в Telegram сейчас не сработал.
          // Не считаем задачу выполненной — на следующем проходе (см. alreadyReady
          // выше) повторяем именно отправку. Даём на это отдельный запас времени
          // (MAX_TG_RETRY_MIN от момента готовности), а не общий таймаут генерации.
          const readySinceMin = alreadyReady && job.updated_at
            ? (Date.now() - new Date(job.updated_at).getTime()) / 60000
            : 0;
          if (readySinceMin > MAX_TG_RETRY_MIN) {
            await admin.from("heygen_jobs").update({
              delivered: true, status: "done", video_url: url,
              error: "Видео готово, но отправить в Telegram не удалось — заберите его на сайте.",
              updated_at: new Date().toISOString(),
            }).eq("id", job.id);
            failed++;
          } else {
            await admin.from("heygen_jobs").update({
              status: "video_ready", video_url: url, error: "tg_pending", updated_at: new Date().toISOString(),
            }).eq("id", job.id);
            pending++;
          }
        }
      } else if (TERMINAL_FAIL.includes(status)) {
        // Статус видео (или сессии без video_id) — терминальный провал.
        const failText = failMsg || JSON.stringify(meta);
        const userMsg = isCreditError(failText)
          ? "Не удалось собрать видео: закончился баланс HeyGen (API-кошелёк). Пополните баланс в кабинете HeyGen и запустите генерацию заново."
          : "Не удалось собрать видео. Попробуйте ещё раз.";
        await notify(botToken, chatId, userMsg);
        await admin.from("heygen_jobs").update({
          delivered: true, status: "failed",
          error: ("fail: " + failText).slice(0, 600),
          updated_at: new Date().toISOString(),
        }).eq("id", job.id);
        failed++;
      } else if (TERMINAL_OK.includes(status)) {
        // терминальный успех без ссылки — сохраняем сырой ответ для диагностики.
        await notify(botToken, chatId, "Видео готово, но ссылка не пришла. Попробуйте ещё раз.");
        await admin.from("heygen_jobs").update({
          delivered: true, status: "failed",
          error: ("no_url: " + JSON.stringify(meta)).slice(0, 600),
          updated_at: new Date().toISOString(),
        }).eq("id", job.id);
        failed++;
      } else {
        if (ageMin > MAX_AGE_MIN) {
          await notify(botToken, chatId, "Генерация заняла слишком долго. Попробуйте ещё раз.");
          await admin.from("heygen_jobs").update({ delivered: true, status: "timeout", updated_at: new Date().toISOString() }).eq("id", job.id);
          failed++;
        } else {
          pending++;
        }
      }
    } catch {
      pending++;
    }
  }

  return new Response(JSON.stringify({ delivered, failed, pending, checked: (jobs ?? []).length }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
