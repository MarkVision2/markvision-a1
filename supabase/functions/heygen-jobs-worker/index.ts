// Воркер доставки: поллит задачи Video Agent и отправляет готовое видео в Telegram.
// Запускается по cron (pg_cron → net.http_post с x-automation-key).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const HEYGEN_BASE = "https://api.heygen.com";
const BATCH = 20;
const MAX_AGE_MIN = 30; // задачи старше — помечаем ошибкой, чтобы не висели вечно

const TERMINAL_OK = ["completed", "success", "done"];
const TERMINAL_FAIL = ["failed", "error"];

function pickUrl(d: Record<string, unknown>): string | undefined {
  const nested = (k: string, s: string) => {
    const v = d[k];
    return v && typeof v === "object" ? (v as Record<string, unknown>)[s] : undefined;
  };
  return [d.video_url, nested("video", "url"), nested("output", "video_url"), nested("result", "video_url")]
    .find((x) => typeof x === "string" && (x as string).length > 0) as string | undefined;
}

async function tg(token: string, method: string, body: Record<string, unknown>) {
  return fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.ok).catch(() => false);
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
    .select("id, project_id, chat_id, session_id, created_at")
    .eq("delivered", false)
    .order("created_at", { ascending: true })
    .limit(BATCH);

  let delivered = 0, failed = 0, pending = 0;

  for (const job of jobs ?? []) {
    try {
      const res = await fetch(`${HEYGEN_BASE}/v3/video-agents/${encodeURIComponent(job.session_id)}`, {
        headers: { "X-Api-Key": apiKey, Accept: "application/json" },
      });
      const body = await res.json().catch(() => ({}));
      const d = (body?.data ?? {}) as Record<string, unknown>;
      const status = String(d.status ?? "");
      const url = pickUrl(d);

      if (url) {
        const okVideo = await tg(botToken, "sendVideo", { chat_id: job.chat_id, video: url, caption: "Готово ✅" });
        if (!okVideo) await tg(botToken, "sendMessage", { chat_id: job.chat_id, text: `Видео готово: ${url}` });
        await admin.from("heygen_jobs").update({ delivered: true, status: "done", video_url: url, updated_at: new Date().toISOString() }).eq("id", job.id);
        // Учёт расхода (Video Agent, $2/мин).
        const durRaw = (d.duration ?? d.duration_sec) as number | undefined;
        const durationSec = typeof durRaw === "number" ? durRaw : null;
        const cost = durationSec ? Math.round((durationSec / 60) * 2 * 100) / 100 : null;
        await admin.from("heygen_usage").insert({
          project_id: job.project_id, source: "telegram", mode: "agent",
          ref_id: job.session_id, duration_sec: durationSec, cost_usd: cost, status: "completed",
        });
        delivered++;
      } else if (TERMINAL_FAIL.includes(status)) {
        await tg(botToken, "sendMessage", { chat_id: job.chat_id, text: "Не удалось собрать видео. Попробуйте ещё раз." });
        await admin.from("heygen_jobs").update({ delivered: true, status: "failed", error: status, updated_at: new Date().toISOString() }).eq("id", job.id);
        failed++;
      } else if (TERMINAL_OK.includes(status)) {
        // терминальный успех без ссылки — считаем неуспехом, но не виснем
        await tg(botToken, "sendMessage", { chat_id: job.chat_id, text: "Видео готово, но ссылка не пришла. Попробуйте ещё раз." });
        await admin.from("heygen_jobs").update({ delivered: true, status: "failed", error: "no_url", updated_at: new Date().toISOString() }).eq("id", job.id);
        failed++;
      } else {
        const ageMin = (Date.now() - new Date(job.created_at).getTime()) / 60000;
        if (ageMin > MAX_AGE_MIN) {
          await tg(botToken, "sendMessage", { chat_id: job.chat_id, text: "Генерация заняла слишком долго. Попробуйте ещё раз." });
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
