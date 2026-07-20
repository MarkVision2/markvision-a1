// Reels TTS + публикация — раздел «Reels-видео» (VPS-воркер Reels Factory мёртв).
// TTS делаем здесь: edge-функция из сети Supabase дотягивается до api.elevenlabs.io
// (сессия Claude — нет, egress-политика), генерит mp3 выбранным голосом, кладёт в
// bucket `renders`. Claude-сессия качает mp3 (Supabase доступен), строит графику в
// Remotion, заливает финал (sign_upload) и публикует (publish): reels_usage +
// reels_jobs=done + Telegram проекта.
//
// Авторизация: как montage-worker — verify_jwt off + x-montage-key против
// montage_settings.worker_key (fail-closed).
// Секрет: ELEVENLABS_API_KEY; TELEGRAM_BOT_TOKEN (общий, как у montage-worker).
//
// Действия (POST JSON { action, ... }):
//   voices                              → список голосов аккаунта (GET /v1/voices)
//   tts {text, voiceId, path, modelId?} → синтез → upload в renders → {publicUrl}
//   sign_upload {path}                  → signed upload URL в renders + publicUrl
//   publish {jobId, videoUrl, title?, description?, durationSec?, coverUrl?, notifyTelegram?}
//                                        → reels_usage + reels_jobs=done + Telegram
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { decryptProviderKey, type ReelsProvider } from "../_lib/reelsCredentials.ts";

type Json = Record<string, unknown>;
const json = (body: Json, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const EL = "https://api.elevenlabs.io/v1";
const DEFAULT_MODEL = "eleven_multilingual_v2"; // говорит по-русски
const TG_LIMIT = 49 * 1024 * 1024;

async function tg(token: string, method: string, body: Json): Promise<boolean> {
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    return r.ok && j?.ok !== false;
  } catch { return false; }
}

async function sendVideo(token: string, chatId: string, url: string, caption: string): Promise<void> {
  try {
    const fileRes = await fetch(url);
    if (fileRes.ok) {
      const bytes = new Uint8Array(await fileRes.arrayBuffer());
      if (bytes.byteLength > 0 && bytes.byteLength <= TG_LIMIT) {
        const form = new FormData();
        form.append("chat_id", chatId);
        form.append("caption", caption);
        form.append("video", new Blob([bytes], { type: "video/mp4" }), "reel.mp4");
        const r = await fetch(`https://api.telegram.org/bot${token}/sendVideo`, { method: "POST", body: form });
        const j = await r.json().catch(() => ({}));
        if (r.ok && j?.ok !== false) return;
      }
    }
  } catch { /* fall through to link */ }
  await tg(token, "sendMessage", { chat_id: chatId, text: `${caption}\n${url}` });
}

async function projectProviderKey(
  admin: ReturnType<typeof createClient>,
  jobId: string,
  provider: ReelsProvider,
): Promise<string> {
  const { data: job } = await admin
    .from("reels_jobs")
    .select("project_id")
    .eq("id", jobId)
    .maybeSingle();
  if (!job?.project_id) throw new Error("job not found");
  const { data: credential } = await admin
    .from("reels_provider_credentials")
    .select("encrypted_key")
    .eq("project_id", job.project_id)
    .eq("provider", provider)
    .eq("enabled", true)
    .maybeSingle();
  if (!credential?.encrypted_key) throw new Error(`${provider === "pexels" ? "Pexels" : "Kie.ai"} key not configured`);
  return decryptProviderKey(String(credential.encrypted_key));
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: settings } = await admin.from("montage_settings").select("worker_key").eq("id", 1).maybeSingle();
  const expected = settings?.worker_key as string | undefined;
  const provided = req.headers.get("x-montage-key");
  if (!expected || !provided || provided !== expected) return json({ error: "forbidden" }, 403);

  let body: Json;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const action = String(body.action ?? "");

  try {
    switch (action) {
      case "next": {
        // Атомарный забор: queued → rendering (одна заявка).
        const { data: queued } = await admin
          .from("reels_jobs")
          .select("*")
          .eq("status", "queued")
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (!queued) return json({ job: null });
        const { data: claimed, error } = await admin
          .from("reels_jobs")
          .update({
            status: "rendering",
            stage: "взято в работу",
            progress: 1,
            updated_at: new Date().toISOString(),
          })
          .eq("id", queued.id)
          .eq("status", "queued")
          .select("*")
          .maybeSingle();
        if (error) return json({ error: error.message }, 500);
        return json({ job: claimed ?? null });
      }

      case "update": {
        const id = String(body.id ?? body.jobId ?? "");
        if (!id) return json({ error: "id required" }, 400);
        const patch: Json = { updated_at: new Date().toISOString() };
        if (typeof body.status === "string") patch.status = body.status;
        if (typeof body.stage === "string") patch.stage = body.stage;
        if (typeof body.progress === "number") patch.progress = body.progress;
        if (typeof body.error === "string") patch.error = body.error;
        const { error } = await admin.from("reels_jobs").update(patch).eq("id", id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      case "fail": {
        const id = String(body.id ?? body.jobId ?? "");
        if (!id) return json({ error: "id required" }, 400);
        const message = String(body.error ?? "reels не удался");
        const { error } = await admin.from("reels_jobs").update({
          status: "failed",
          stage: "ошибка",
          error: message,
          updated_at: new Date().toISOString(),
        }).eq("id", id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      case "voices":
      case "tts": {
        const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
        if (!apiKey) return json({ error: "ELEVENLABS_API_KEY not set in Supabase secrets" }, 500);
        if (action === "voices") {
          const r = await fetch(`${EL}/voices`, { headers: { "xi-api-key": apiKey } });
          if (!r.ok) return json({ error: `elevenlabs voices ${r.status}`, detail: await r.text() }, 502);
          const j = await r.json();
          const voices = (j.voices ?? []).map((v: Json) => ({ voice_id: v.voice_id, name: v.name, category: v.category, labels: v.labels ?? {} }));
          return json({ voices });
        }
        const text = String(body.text ?? "").trim();
        const voiceId = String(body.voiceId ?? "").trim();
        const path = String(body.path ?? "").replace(/^\/+/, "");
        const modelId = String(body.modelId ?? DEFAULT_MODEL);
        if (!text || !voiceId || !path) return json({ error: "text, voiceId, path required" }, 400);
        const r = await fetch(`${EL}/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
          method: "POST",
          headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({ text, model_id: modelId, voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true } }),
        });
        if (!r.ok) return json({ error: `elevenlabs tts ${r.status}`, detail: await r.text() }, 502);
        const bytes = new Uint8Array(await r.arrayBuffer());
        const { error: upErr } = await admin.storage.from("renders").upload(path, bytes, { contentType: "audio/mpeg", upsert: true });
        if (upErr) return json({ error: `upload: ${upErr.message}` }, 500);
        const { data: pub } = admin.storage.from("renders").getPublicUrl(path);
        return json({ ok: true, path, publicUrl: pub.publicUrl, bytes: bytes.byteLength });
      }

      case "sign_upload": {
        const path = String(body.path ?? "").replace(/^\/+/, "");
        if (!path) return json({ error: "path required" }, 400);
        const { data, error } = await admin.storage.from("renders").createSignedUploadUrl(path);
        if (error) return json({ error: error.message }, 500);
        const { data: pub } = admin.storage.from("renders").getPublicUrl(path);
        return json({ path, token: data.token, publicUrl: pub.publicUrl });
      }

      case "job_sources": {
        const jobId = String(body.jobId ?? "");
        if (!jobId) return json({ error: "jobId required" }, 400);
        const { data: job } = await admin
          .from("reels_jobs")
          .select("project_id,config")
          .eq("id", jobId)
          .maybeSingle();
        if (!job) return json({ error: "job not found" }, 404);
        const config = (job.config ?? {}) as Json;
        const mode = String(config.brollMode ?? "auto");
        const requestedFolders = Array.isArray(config.assetFolderIds)
          ? config.assetFolderIds.map(String).filter(Boolean).slice(0, 20)
          : [];
        let assets: Json[] = [];
        if (mode === "library" && requestedFolders.length) {
          const { data } = await admin
            .from("reels_assets")
            .select("id,folder_id,name,media_type,public_url,metadata")
            .eq("project_id", job.project_id)
            .in("folder_id", requestedFolders)
            .limit(500);
          assets = [...(data ?? [])]
            .sort(() => Math.random() - 0.5)
            .slice(0, 60);
        }
        return json({
          projectId: job.project_id,
          brollMode: mode,
          assetFolderIds: requestedFolders,
          assets,
          fallbackToAuto: mode === "library" && assets.length === 0,
        });
      }

      case "pexels_search": {
        const jobId = String(body.jobId ?? "");
        const query = String(body.query ?? "").trim().slice(0, 120);
        const perPage = Math.min(20, Math.max(1, Number(body.perPage ?? 8)));
        if (!jobId || !query) return json({ error: "jobId and query required" }, 400);
        const apiKey = await projectProviderKey(admin, jobId, "pexels");
        const url = new URL("https://api.pexels.com/v1/videos/search");
        url.searchParams.set("query", query);
        url.searchParams.set("orientation", "portrait");
        url.searchParams.set("per_page", String(perPage));
        const response = await fetch(url, { headers: { Authorization: apiKey } });
        if (!response.ok) return json({ error: `Pexels ${response.status}`, detail: (await response.text()).slice(0, 300) }, 502);
        const payload = await response.json();
        const videos = (payload.videos ?? []).map((video: Json) => {
          const files = Array.isArray(video.video_files) ? video.video_files as Json[] : [];
          const mp4 = files
            .filter((file) => String(file.file_type ?? "") === "video/mp4")
            .sort((a, b) => Number(b.height ?? 0) - Number(a.height ?? 0))[0];
          const user = video.user as Json | undefined;
          return {
            id: video.id,
            duration: video.duration,
            page_url: video.url,
            preview_url: video.image,
            video_url: mp4?.link ?? null,
            width: mp4?.width ?? null,
            height: mp4?.height ?? null,
            author: user?.name ?? null,
          };
        }).filter((video: Json) => Boolean(video.video_url));
        return json({ videos });
      }

      case "kie_create": {
        const jobId = String(body.jobId ?? "");
        // Kling 2.6: prompt max 1000; v2-1-master снят с маркета («Operation not found»).
        const prompt = String(body.prompt ?? "").trim().slice(0, 1000);
        if (!jobId || !prompt) return json({ error: "jobId and prompt required" }, 400);
        const apiKey = await projectProviderKey(admin, jobId, "kie");
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
        const jobId = String(body.jobId ?? "");
        const taskId = String(body.taskId ?? "").trim();
        if (!jobId || !taskId) return json({ error: "jobId and taskId required" }, 400);
        const apiKey = await projectProviderKey(admin, jobId, "kie");
        const url = new URL("https://api.kie.ai/api/v1/jobs/recordInfo");
        url.searchParams.set("taskId", taskId);
        const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) return json({ error: `Kie.ai ${response.status}`, detail: payload }, 502);
        return json({ task: payload.data ?? payload });
      }

      case "publish": {
        const jobId = String(body.jobId ?? "");
        const videoUrl = String(body.videoUrl ?? "");
        if (!jobId || !videoUrl) return json({ error: "jobId and videoUrl required" }, 400);
        const { data: job } = await admin.from("reels_jobs").select("project_id").eq("id", jobId).maybeSingle();
        if (!job) return json({ error: "job not found" }, 404);
        const projectId = String(job.project_id);
        const title = String(body.title ?? "Reels").slice(0, 80);
        const description = (body.description as string | undefined) ?? null;
        const durationSec = (body.durationSec as number | undefined) ?? null;
        const coverUrl = (body.coverUrl as string | undefined) ?? null;
        const warnings: string[] = [];

        const { error: insErr } = await admin.from("reels_usage").insert({
          job_id: jobId, project_id: projectId, source: "reels-pipeline", mode: "reels",
          ref_id: `reels-${jobId}`, status: "done", title, video_url: videoUrl,
          cover_url: coverUrl, thumbnail_url: coverUrl, description, duration_sec: durationSec, cost_usd: null,
        });
        if (insErr) warnings.push(`reels_usage: ${insErr.message}`);

        const { error: updErr } = await admin.from("reels_jobs").update({
          status: "done", progress: 100, stage: "готово", error: null,
        }).eq("id", jobId);
        if (updErr) warnings.push(`reels_jobs: ${updErr.message}`);

        if (body.notifyTelegram !== false) {
          const token = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
          if (token) {
            const { data: link } = await admin.from("telegram_links").select("chat_id").eq("project_id", projectId).limit(1).maybeSingle();
            const chatId = link?.chat_id as string | undefined;
            if (chatId) {
              await sendVideo(token, chatId, videoUrl, `🎬 Reels готов: ${title}`);
              if (description) await tg(token, "sendMessage", { chat_id: chatId, text: description.slice(0, 3800) });
            } else warnings.push("telegram: чат не привязан к проекту");
          } else warnings.push("telegram: TELEGRAM_BOT_TOKEN не задан");
        }
        return json({ ok: true, warnings });
      }

      default:
        return json({ error: `unknown action: ${action}` }, 400);
    }
  } catch (e) {
    console.error("reels-tts error", e instanceof Error ? e.message : String(e));
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
