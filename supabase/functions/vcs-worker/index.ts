// Vertical Creative System: API для Claude-воркера (репо video-creative-system +
// scripts/vcs-worker.mjs). Очередь заявок на вертикальные VoiceOver-креативы
// живёт в vcs_jobs (заявки создаёт сайт, раздел Контент-завод → Видео →
// «Вертикальные креативы»).
//
// Авторизация: verify_jwt выключен (воркер ходит не от пользователя);
// fail-closed проверка заголовка x-montage-key против montage_settings.worker_key
// (та же схема, что у montage-worker — общий ключ воркера).
//
// Действия (POST JSON { action, ... }):
//   next                          → забрать старейшую queued-заявку (status=processing)
//   update   {id, status?, progress?, error?}
//   sign_upload {path}            → signed upload URL в bucket `renders`
//   complete {id, video_url, title?, thumbnail_url?, description?, duration_sec?, review_url?}
//            → job done + heygen_usage (Готовые) + Telegram (если включён)
//   fail     {id, error}          → job failed + Telegram-уведомление
//   requeue  {id}                 → вернуть failed/processing в queued (повтор)
//   publish  {project_id, video_url, title?, ...} → регистрация без заявки
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

type Json = Record<string, unknown>;

const json = (body: Json, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function tg(token: string, method: string, body: Json): Promise<boolean> {
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

// Telegram sendVideo по URL ненадёжен против CDN — качаем сами и шлём multipart.
// Больше ~49 МБ Bot API не принимает — тогда ссылкой.
const TELEGRAM_UPLOAD_LIMIT_BYTES = 49 * 1024 * 1024;
async function sendVideo(token: string, chatId: string, url: string, caption: string): Promise<void> {
  try {
    const fileRes = await fetch(url);
    if (fileRes.ok) {
      const bytes = new Uint8Array(await fileRes.arrayBuffer());
      if (bytes.byteLength > 0 && bytes.byteLength <= TELEGRAM_UPLOAD_LIMIT_BYTES) {
        const form = new FormData();
        form.append("chat_id", chatId);
        form.append("caption", caption);
        form.append("video", new Blob([bytes], { type: "video/mp4" }), "video.mp4");
        const r = await fetch(`https://api.telegram.org/bot${token}/sendVideo`, { method: "POST", body: form });
        const j = await r.json().catch(() => ({}));
        if (r.ok && j?.ok !== false) return;
        console.error("telegram sendVideo(file) failed", r.status, JSON.stringify(j));
      }
    }
  } catch (e) {
    console.error("sendVideo threw", e instanceof Error ? e.message : String(e));
  }
  // Фолбэк: хотя бы ссылка, чтобы доставка не пропала молча.
  await tg(token, "sendMessage", { chat_id: chatId, text: `${caption}\n${url}` });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // fail-closed: без строки настроек или без совпадения ключа — отказ.
  const { data: settings } = await admin.from("montage_settings").select("worker_key").eq("id", 1).maybeSingle();
  const expected = settings?.worker_key as string | undefined;
  const provided = req.headers.get("x-montage-key");
  if (!expected || !provided || provided !== expected) return json({ error: "forbidden" }, 403);

  let body: Json;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const action = String(body.action ?? "");

  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
  async function chatIdOf(projectId: string): Promise<string | null> {
    const { data } = await admin
      .from("telegram_links").select("chat_id").eq("project_id", projectId).limit(1).maybeSingle();
    return (data?.chat_id as string | undefined) ?? null;
  }

  // Регистрация готового ролика в «AI монтаж → Готовые» + доставка в Telegram.
  async function publishResult(p: {
    projectId: string;
    refBase: string;
    videoUrl: string;
    title: string;
    thumbnailUrl?: string | null;
    description?: string | null;
    durationSec?: number | null;
    notifyTelegram: boolean;
  }): Promise<string[]> {
    const row: Json = {
      project_id: p.projectId,
      source: "video-creative-system",
      mode: "vcs",
      ref_id: p.refBase,
      title: p.title.slice(0, 80),
      video_url: p.videoUrl,
      thumbnail_url: p.thumbnailUrl ?? null,
      description: p.description ?? null,
      duration_sec: p.durationSec ?? null,
      cost_usd: null,
    };
    const { error } = await admin
      .from("heygen_usage")
      .upsert([row], { onConflict: "project_id,ref_id", ignoreDuplicates: false });
    const warnings: string[] = [];
    if (error) warnings.push(`heygen_usage: ${error.message}`);

    if (p.notifyTelegram && botToken) {
      const chatId = await chatIdOf(p.projectId);
      if (chatId) {
        await sendVideo(botToken, chatId, p.videoUrl, `🎬 Вертикальный креатив готов: ${p.title}`);
        if (p.description) await tg(botToken, "sendMessage", { chat_id: chatId, text: `Описание:\n${p.description.slice(0, 3800)}` });
      } else {
        warnings.push("telegram: чат не привязан к проекту (telegram_links)");
      }
    }
    return warnings;
  }

  try {
    switch (action) {
      case "next": {
        const { data, error } = await admin.rpc("claim_vcs_job");
        if (error) return json({ error: error.message }, 500);
        const job = Array.isArray(data) ? data[0] : data;
        return json({ job: job ?? null });
      }

      case "update": {
        const id = String(body.id ?? "");
        if (!id) return json({ error: "id required" }, 400);
        const patch: Json = { updated_at: new Date().toISOString() };
        if (typeof body.status === "string") patch.status = body.status;
        if (typeof body.progress === "string") patch.progress = body.progress;
        if (typeof body.error === "string") patch.error = body.error;
        const { error } = await admin.from("vcs_jobs").update(patch).eq("id", id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      case "sign_upload": {
        const path = String(body.path ?? "").replace(/^\/+/, "");
        if (!path) return json({ error: "path required" }, 400);
        const { data, error } = await admin.storage.from("renders").createSignedUploadUrl(path);
        if (error) return json({ error: error.message }, 500);
        const { data: pub } = admin.storage.from("renders").getPublicUrl(path);
        return json({ path, token: data.token, publicUrl: pub.publicUrl });
      }

      case "complete": {
        const id = String(body.id ?? "");
        const videoUrl = String(body.video_url ?? "");
        if (!id || !videoUrl) return json({ error: "id and video_url required" }, 400);
        const { data: job } = await admin.from("vcs_jobs").select("*").eq("id", id).maybeSingle();
        if (!job) return json({ error: "job not found" }, 404);

        const reviewUrl = (body.review_url as string | undefined) ?? null;
        const warnings = await publishResult({
          projectId: String(job.project_id),
          refBase: `vcs-${id}`,
          videoUrl,
          title: String(body.title ?? "Вертикальный креатив"),
          thumbnailUrl: (body.thumbnail_url as string | undefined) ?? null,
          description: (body.description as string | undefined) ?? null,
          durationSec: (body.duration_sec as number | undefined) ?? null,
          notifyTelegram: Boolean(job.notify_telegram),
        });

        const { error } = await admin.from("vcs_jobs").update({
          status: "done",
          progress: "готово",
          result_video_url: videoUrl,
          result: { review_url: reviewUrl, duration_sec: body.duration_sec ?? null, warnings },
          error: null,
          done_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true, warnings });
      }

      case "fail": {
        const id = String(body.id ?? "");
        if (!id) return json({ error: "id required" }, 400);
        const message = String(body.error ?? "рендер не удался");
        const notify = body.notify !== false && body.silent !== true;
        const { data: job } = await admin.from("vcs_jobs").select("project_id, notify_telegram").eq("id", id).maybeSingle();
        const { error } = await admin.from("vcs_jobs").update({
          status: "failed", error: message, updated_at: new Date().toISOString(),
        }).eq("id", id);
        if (error) return json({ error: error.message }, 500);
        if (notify && job?.notify_telegram && botToken) {
          const chatId = await chatIdOf(String(job.project_id));
          if (chatId) await tg(botToken, "sendMessage", { chat_id: chatId, text: `⚠️ Креатив не удался: ${message}` });
        }
        return json({ ok: true });
      }

      case "requeue": {
        const id = String(body.id ?? "");
        if (!id) return json({ error: "id required" }, 400);
        const { data: job } = await admin.from("vcs_jobs").select("id, status").eq("id", id).maybeSingle();
        if (!job) return json({ error: "job not found" }, 404);
        const { error } = await admin.from("vcs_jobs").update({
          status: "queued",
          progress: "повтор в очереди",
          error: null,
          result: null,
          result_video_url: null,
          done_at: null,
          claimed_at: null,
          updated_at: new Date().toISOString(),
        }).eq("id", id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true, previous_status: job.status });
      }

      case "publish": {
        const projectId = String(body.project_id ?? "");
        const videoUrl = String(body.video_url ?? "");
        if (!projectId || !videoUrl) return json({ error: "project_id and video_url required" }, 400);
        const warnings = await publishResult({
          projectId,
          refBase: String(body.ref_id ?? `vcs-manual-${Date.now()}`),
          videoUrl,
          title: String(body.title ?? "Вертикальный креатив"),
          thumbnailUrl: (body.thumbnail_url as string | undefined) ?? null,
          description: (body.description as string | undefined) ?? null,
          durationSec: (body.duration_sec as number | undefined) ?? null,
          notifyTelegram: body.notify_telegram !== false,
        });
        return json({ ok: true, warnings });
      }

      default:
        return json({ error: `unknown action: ${action}` }, 400);
    }
  } catch (e) {
    console.error("vcs-worker error", e instanceof Error ? e.message : String(e));
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
