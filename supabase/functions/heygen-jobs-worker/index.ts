// Воркер доставки: поллит задачи Video Agent и отправляет готовое видео в Telegram.
// Запускается по cron (pg_cron → net.http_post с x-automation-key).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const HEYGEN_BASE = "https://api.heygen.com";
const N8N_WEBHOOK = Deno.env.get("N8N_CONTENT_WEBHOOK_URL") ?? "https://n8n.zapoinov.com/webhook/clony-yurii";
const BATCH = 20;
const MAX_AGE_MIN = 30; // задачи старше — помечаем ошибкой, чтобы не висели вечно

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

async function tg(token: string, method: string, body: Record<string, unknown>) {
  return fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.ok).catch(() => false);
}

// Уведомление в чат. У веб-задач чата нет (chat_id = null) — молча пропускаем.
async function notify(token: string, chatId: string | null, text: string) {
  if (!chatId) return;
  await tg(token, "sendMessage", { chat_id: chatId, text });
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
    .select("id, project_id, chat_id, session_id, script, source, created_at")
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
      const res = await fetch(`${HEYGEN_BASE}/v3/video-agents/${encodeURIComponent(job.session_id)}`, {
        headers: { "X-Api-Key": apiKey, Accept: "application/json" },
      });
      const body = await res.json().catch(() => ({}));
      const d = (body?.data ?? body ?? {}) as Record<string, unknown>;
      const status = String(d.status ?? "");
      let url = pickUrl(d);
      let meta: Record<string, unknown> = d; // источник длительности/обложки (v3 или v1)

      // Video Agent часто отдаёт video_id, а MP4 (и длительность) забираются вторым запросом (/v1).
      if (!url) {
        const vid = pickVideoId(d);
        if (vid) {
          try {
            const vres = await fetch(`${HEYGEN_BASE}/v1/video_status.get?video_id=${encodeURIComponent(vid)}`, {
              headers: { "X-Api-Key": apiKey, Accept: "application/json" },
            });
            const vbody = await vres.json().catch(() => ({}));
            const vd = (vbody?.data ?? {}) as Record<string, unknown>;
            url = pickUrl(vd);
            if (url) meta = vd; // длительность/обложка тоже приходят из /v1
          } catch { /* ignore */ }
        }
      }

      const chatId = await resolveChatId(job); // Telegram-чат для доставки (у веб-задач — привязанный к проекту)

      if (url) {
        if (chatId) {
          const okVideo = await tg(botToken, "sendVideo", { chat_id: chatId, video: url, caption: "Готово ✅" });
          if (!okVideo) await tg(botToken, "sendMessage", { chat_id: chatId, text: `Видео готово: ${url}` });
        }
        await admin.from("heygen_jobs").update({ delivered: true, status: "done", video_url: url, updated_at: new Date().toISOString() }).eq("id", job.id);
        const assets = await sendAssets(chatId, job.script, job.project_id); // обложка + описание (в чат, если он есть)
        // Учёт расхода + запись в галерею «Готовый контент».
        const durRaw = (meta.duration ?? meta.duration_sec) as number | undefined;
        const durationSec = typeof durRaw === "number" ? durRaw : null;
        const cost = durationSec ? Math.round((durationSec / 60) * 2 * 100) / 100 : null;
        const thumb = (meta.thumbnail_url ?? (meta.video as Record<string, unknown> | undefined)?.thumbnail_url) as string | null ?? null;
        await admin.from("heygen_usage").insert({
          project_id: job.project_id, source: job.source ?? (job.chat_id ? "telegram" : "web"), mode: "agent",
          ref_id: job.session_id, duration_sec: durationSec, cost_usd: cost, status: "completed",
          title: (job.script ?? "").slice(0, 80) || "Видео",
          video_url: url, thumbnail_url: thumb, cover_url: assets.cover, description: assets.desc,
        });
        delivered++;
      } else if (TERMINAL_FAIL.includes(status)) {
        await notify(botToken, chatId, "Не удалось собрать видео. Попробуйте ещё раз.");
        await admin.from("heygen_jobs").update({ delivered: true, status: "failed", error: status, updated_at: new Date().toISOString() }).eq("id", job.id);
        failed++;
      } else if (TERMINAL_OK.includes(status)) {
        // терминальный успех без ссылки — сохраняем сырой ответ для диагностики.
        await notify(botToken, chatId, "Видео готово, но ссылка не пришла. Попробуйте ещё раз.");
        await admin.from("heygen_jobs").update({
          delivered: true, status: "failed",
          error: ("no_url: " + JSON.stringify(d)).slice(0, 600),
          updated_at: new Date().toISOString(),
        }).eq("id", job.id);
        failed++;
      } else {
        const ageMin = (Date.now() - new Date(job.created_at).getTime()) / 60000;
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
