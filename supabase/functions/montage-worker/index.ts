// Монтаж-конвейер: API для Claude-воркера (скилл montage-pipeline +
// scripts/montage-worker.mjs). Очередь заявок на автомонтаж живёт в
// montage_jobs (заявки создаёт сайт, раздел Контент-завод → «Монтаж съёмки»).
//
// Авторизация: verify_jwt выключен (воркер ходит не от пользователя);
// fail-closed проверка заголовка x-montage-key против montage_settings.worker_key
// (та же схема, что x-automation-key у capi-outbox-worker).
//
// Действия (POST JSON { action, ... }):
//   next                          → забрать старейшую queued-заявку (status=processing)
//   update   {id, status?, progress?, error?}
//   sign_upload {path}            → signed upload URL в bucket `renders`
//   complete {id, video_url, title?, thumbnail_url?, description?, duration_sec?, shorts?}
//            → job done + heygen_usage (Готовые) + Telegram (если включён)
//   fail     {id, error}          → job failed + Telegram-уведомление
//   requeue  {id}                 → вернуть failed/processing в queued (повтор)
//   publish  {project_id, video_url, title?, ...} → регистрация без заявки
//   kie_create {project_id, prompt} → taskId (Kling via Kie.ai)
//   kie_status {project_id, task_id}
//   pexels_search {project_id, query, per_page?}
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { addToPublishLibrary } from "../_lib/publishLibrary.ts";
import { decryptProviderKey } from "../_lib/reelsCredentials.ts";
import { seedEricDemo } from "../_lib/ericDemoSeed.ts";

type Json = Record<string, unknown>;

const json = (body: Json, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function projectProviderKey(
  admin: ReturnType<typeof createClient>,
  projectId: string,
  provider: "pexels" | "kie",
): Promise<string> {
  const { data: credential } = await admin
    .from("reels_provider_credentials")
    .select("encrypted_key")
    .eq("project_id", projectId)
    .eq("provider", provider)
    .eq("enabled", true)
    .maybeSingle();
  if (!credential?.encrypted_key) {
    throw new Error(`${provider === "pexels" ? "Pexels" : "Kie.ai"} key not configured for project`);
  }
  return decryptProviderKey(String(credential.encrypted_key));
}

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

// Telegram sendVideo по URL ненадёжен против CDN — качаем сами и шлём multipart
// (как heygen-jobs-worker). Больше 50 МБ Bot API не принимает — тогда ссылкой.
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

  // Регистрация готовых роликов в «AI монтаж → Готовые» + доставка в Telegram.
  async function publishResult(p: {
    projectId: string;
    refBase: string;
    videoUrl: string;
    title: string;
    thumbnailUrl?: string | null;
    description?: string | null;
    durationSec?: number | null;
    shorts?: { url: string; title?: string }[];
    notifyTelegram: boolean;
  }): Promise<string[]> {
    const rows: Json[] = [
      {
        project_id: p.projectId,
        source: "montage-pipeline",
        mode: "montage",
        ref_id: p.refBase,
        title: p.title.slice(0, 80),
        video_url: p.videoUrl,
        thumbnail_url: p.thumbnailUrl ?? null,
        description: p.description ?? null,
        duration_sec: p.durationSec ?? null,
        cost_usd: null,
      },
      ...(p.shorts ?? []).map((s, i) => ({
        project_id: p.projectId,
        source: "montage-pipeline",
        mode: "montage-short",
        ref_id: `${p.refBase}-short-${i + 1}`,
        title: (s.title ?? `${p.title} — шортс ${i + 1}`).slice(0, 80),
        video_url: s.url,
        cost_usd: null,
      })),
    ];
    const { error } = await admin
      .from("heygen_usage")
      .upsert(rows, { onConflict: "project_id,ref_id", ignoreDuplicates: false });
    const warnings: string[] = [];
    if (error) warnings.push(`heygen_usage: ${error.message}`);

    // Готовый рендер — сразу в библиотеку публикации, иначе он оставался только в витрине
    // «Готовые», и опубликовать его можно было лишь перезалив руками (docs/JOBS.md).
    // Статус ready: раскладку по аккаунтам человек запускает сам.
    for (const v of [
      { url: p.videoUrl, title: p.title, ref: p.refBase, source: "montage", caption: p.description ?? null, thumb: p.thumbnailUrl ?? null, dur: p.durationSec ?? null },
      ...(p.shorts ?? []).map((s, i) => ({
        url: s.url,
        title: s.title ?? `${p.title} — шортс ${i + 1}`,
        ref: `${p.refBase}-short-${i + 1}`,
        source: "montage-short",
        caption: null as string | null,
        thumb: null as string | null,
        dur: null as number | null,
      })),
    ]) {
      const { warning } = await addToPublishLibrary(admin, {
        projectId: p.projectId,
        fileUrl: v.url,
        title: v.title,
        caption: v.caption,
        thumbnailUrl: v.thumb,
        durationSec: v.dur,
        source: v.source,
        sourceRef: v.ref,
      });
      if (warning) warnings.push(warning);
    }

    if (p.notifyTelegram && botToken) {
      const chatId = await chatIdOf(p.projectId);
      if (chatId) {
        await sendVideo(botToken, chatId, p.videoUrl, `🎬 Монтаж готов: ${p.title}`);
        for (const [i, s] of (p.shorts ?? []).entries()) {
          await sendVideo(botToken, chatId, s.url, s.title ?? `Шортс ${i + 1}`);
        }
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
        // Атомарный забор (FOR UPDATE SKIP LOCKED) — безопасно при нескольких
        // параллельных воркерах; заодно RPC возвращает в очередь зависшие заявки.
        const { data, error } = await admin.rpc("claim_montage_job");
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
        const { error } = await admin.from("montage_jobs").update(patch).eq("id", id);
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
        const { data: job } = await admin.from("montage_jobs").select("*").eq("id", id).maybeSingle();
        if (!job) return json({ error: "job not found" }, 404);

        const shorts = Array.isArray(body.shorts) ? (body.shorts as { url: string; title?: string }[]) : [];
        const warnings = await publishResult({
          projectId: String(job.project_id),
          refBase: `montage-${id}`,
          videoUrl,
          title: String(body.title ?? job.source_name ?? "Монтаж"),
          thumbnailUrl: (body.thumbnail_url as string | undefined) ?? null,
          description: (body.description as string | undefined) ?? null,
          durationSec: (body.duration_sec as number | undefined) ?? null,
          shorts,
          notifyTelegram: Boolean(job.notify_telegram),
        });

        const { error } = await admin.from("montage_jobs").update({
          status: "done",
          progress: "готово",
          result_video_url: videoUrl,
          result: { shorts, warnings },
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
        const message = String(body.error ?? "монтаж не удался");
        // silent:true — служебный fail перед requeue, без Telegram-спама
        const notify = body.notify !== false && body.silent !== true;
        const { data: job } = await admin.from("montage_jobs").select("project_id, notify_telegram").eq("id", id).maybeSingle();
        const { error } = await admin.from("montage_jobs").update({
          status: "failed", error: message, updated_at: new Date().toISOString(),
        }).eq("id", id);
        if (error) return json({ error: error.message }, 500);
        if (notify && job?.notify_telegram && botToken) {
          const chatId = await chatIdOf(String(job.project_id));
          if (chatId) await tg(botToken, "sendMessage", { chat_id: chatId, text: `⚠️ Монтаж не удался: ${message}` });
        }
        return json({ ok: true });
      }

      case "requeue": {
        const id = String(body.id ?? "");
        if (!id) return json({ error: "id required" }, 400);
        const { data: job } = await admin.from("montage_jobs").select("id, status").eq("id", id).maybeSingle();
        if (!job) return json({ error: "job not found" }, 404);
        // Работает из любого статуса (processing/rendering/failed) — без предварительного fail/Telegram.
        const { error } = await admin.from("montage_jobs").update({
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
          refBase: String(body.ref_id ?? `montage-manual-${Date.now()}`),
          videoUrl,
          title: String(body.title ?? "Монтаж"),
          thumbnailUrl: (body.thumbnail_url as string | undefined) ?? null,
          description: (body.description as string | undefined) ?? null,
          durationSec: (body.duration_sec as number | undefined) ?? null,
          shorts: Array.isArray(body.shorts) ? (body.shorts as { url: string; title?: string }[]) : [],
          notifyTelegram: body.notify_telegram !== false,
        });
        return json({ ok: true, warnings });
      }

      case "kie_create": {
        const projectId = String(body.project_id ?? "");
        // Kling 2.6: prompt max 1000; v2-1-master снят с маркета («Operation not found»).
        const prompt = String(body.prompt ?? "").trim().slice(0, 1000);
        if (!projectId || !prompt) return json({ error: "project_id and prompt required" }, 400);
        const apiKey = await projectProviderKey(admin, projectId, "kie");
        const response = await fetch("https://api.kie.ai/api/v1/jobs/createTask", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "kling-2.6/text-to-video",
            input: {
              prompt,
              sound: false,
              aspect_ratio: "9:16",
              duration: "5",
            },
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.code !== 200) {
          const detail = String(payload.msg ?? JSON.stringify(payload).slice(0, 300));
          return json({
            error: `Kie.ai ${payload.code ?? response.status}${detail ? `: ${detail}` : ""}`,
            detail,
          }, 502);
        }
        return json({ taskId: payload.data?.taskId });
      }

      case "kie_status": {
        const projectId = String(body.project_id ?? "");
        const taskId = String(body.task_id ?? body.taskId ?? "").trim();
        if (!projectId || !taskId) return json({ error: "project_id and task_id required" }, 400);
        const apiKey = await projectProviderKey(admin, projectId, "kie");
        const url = new URL("https://api.kie.ai/api/v1/jobs/recordInfo");
        url.searchParams.set("taskId", taskId);
        const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) return json({ error: `Kie.ai ${response.status}`, detail: payload }, 502);
        return json({ task: payload.data ?? payload });
      }

      case "pexels_search": {
        const projectId = String(body.project_id ?? "");
        const query = String(body.query ?? "").trim().slice(0, 120);
        const perPage = Math.min(12, Math.max(1, Number(body.per_page ?? body.perPage ?? 6)));
        if (!projectId || !query) return json({ error: "project_id and query required" }, 400);
        const apiKey = await projectProviderKey(admin, projectId, "pexels");
        const url = new URL("https://api.pexels.com/v1/videos/search");
        url.searchParams.set("query", query);
        url.searchParams.set("orientation", "portrait");
        url.searchParams.set("per_page", String(perPage));
        const response = await fetch(url, { headers: { Authorization: apiKey } });
        if (!response.ok) {
          return json({ error: `Pexels ${response.status}`, detail: (await response.text()).slice(0, 300) }, 502);
        }
        const payload = await response.json();
        const videos = (payload.videos ?? []).map((video: Json) => {
          const files = Array.isArray(video.video_files) ? video.video_files as Json[] : [];
          const mp4 = files
            .filter((file) => String(file.file_type ?? "") === "video/mp4")
            .sort((a, b) => Number(b.height ?? 0) - Number(a.height ?? 0))[0];
          return {
            id: video.id,
            duration: video.duration,
            video_url: mp4?.link ?? null,
            width: mp4?.width ?? null,
            height: mp4?.height ?? null,
          };
        }).filter((video: Json) => Boolean(video.video_url));
        return json({ videos });
      }

      case "seed_demo_eric": {
        const monthStart = String(body.month_start ?? body.monthStart ?? "2026-07-01");
        const monthEnd = String(body.month_end ?? body.monthEnd ?? "2026-07-31");
        const result = await seedEricDemo(admin, monthStart, monthEnd);
        return json(result);
      }

      default:
        return json({ error: `unknown action: ${action}` }, 400);
    }
  } catch (e) {
    console.error("montage-worker error", e instanceof Error ? e.message : String(e));
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
