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
      case "voices":
      case "tts": {
        // Ключ: приоритет у body.apiKey (передаёт воркер из локального .env), иначе секрет.
        const apiKey = String(body.apiKey ?? "").trim() || Deno.env.get("ELEVENLABS_API_KEY");
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

      case "fish_tts": {
        // Стабильная озвучка через Fish Audio из сети Supabase (без MCP-коннектора,
        // который в сессии мигает). reference_id = voiceId (те же id, что у Fish-голосов,
        // напр. Меллстрой). Ключ: body.apiKey (из .env воркера) или секрет FISH_API_KEY.
        const apiKey = String(body.apiKey ?? "").trim() || Deno.env.get("FISH_API_KEY");
        if (!apiKey) return json({ error: "FISH_API_KEY not set in Supabase secrets" }, 500);
        const text = String(body.text ?? "").trim();
        const voiceId = String(body.voiceId ?? "").trim();
        const path = String(body.path ?? "").replace(/^\/+/, "");
        const model = String(body.model ?? "speech-1.6");
        if (!text || !voiceId || !path) return json({ error: "text, voiceId, path required" }, 400);
        const r = await fetch("https://api.fish.audio/v1/tts", {
          method: "POST",
          headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json", "model": model },
          body: JSON.stringify({ text, reference_id: voiceId, format: "mp3", mp3_bitrate: 128, normalize: true, latency: "normal" }),
        });
        if (!r.ok) return json({ error: `fish tts ${r.status}`, detail: (await r.text()).slice(0, 300) }, 502);
        const bytes = new Uint8Array(await r.arrayBuffer());
        if (bytes.byteLength < 200) return json({ error: "fish tts: empty audio", detail: new TextDecoder().decode(bytes) }, 502);
        const { error: upErr } = await admin.storage.from("renders").upload(path, bytes, { contentType: "audio/mpeg", upsert: true });
        if (upErr) return json({ error: `upload: ${upErr.message}` }, 500);
        const { data: pub } = admin.storage.from("renders").getPublicUrl(path);
        return json({ ok: true, path, publicUrl: pub.publicUrl, bytes: bytes.byteLength });
      }

      case "grab": {
        // Забрать внешний медиа-URL (напр. r2.fish.audio, заблокирован egress-политикой
        // песочницы) из сети Supabase и переложить в bucket renders, чтобы Claude-сессия
        // могла его скачать (Supabase доступен, сторонние CDN — нет).
        const url = String(body.url ?? "").trim();
        const path = String(body.path ?? "").replace(/^\/+/, "");
        if (!url || !path) return json({ error: "url and path required" }, 400);
        const r = await fetch(url);
        if (!r.ok) return json({ error: `grab ${r.status}`, detail: (await r.text()).slice(0, 200) }, 502);
        const ct = r.headers.get("content-type") || "application/octet-stream";
        const bytes = new Uint8Array(await r.arrayBuffer());
        const { error: upErr } = await admin.storage.from("renders").upload(path, bytes, { contentType: ct, upsert: true });
        if (upErr) return json({ error: `upload: ${upErr.message}` }, 500);
        const { data: pub } = admin.storage.from("renders").getPublicUrl(path);
        return json({ ok: true, path, publicUrl: pub.publicUrl, bytes: bytes.byteLength, contentType: ct });
      }

      case "sign_upload": {
        const path = String(body.path ?? "").replace(/^\/+/, "");
        if (!path) return json({ error: "path required" }, 400);
        const { data, error } = await admin.storage.from("renders").createSignedUploadUrl(path);
        if (error) return json({ error: error.message }, 500);
        const { data: pub } = admin.storage.from("renders").getPublicUrl(path);
        return json({ path, token: data.token, publicUrl: pub.publicUrl });
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

      case "claim": {
        // Автоконвейер: отдать самую старую необработанную заявку и пометить её
        // rendering (чтобы два прогона не взяли одну). Берём status='queued' и
        // «зависшие» rendering (обновлены >20 мин назад — живого воркера нет).
        const staleIso = new Date(Date.now() - 20 * 60 * 1000).toISOString();
        const { data: jobs, error: selErr } = await admin
          .from("reels_jobs")
          .select("id, project_id, status, script, config, updated_at, created_at")
          .in("status", ["queued", "rendering"])
          .order("created_at", { ascending: true })
          .limit(10);
        if (selErr) return json({ error: `select: ${selErr.message}` }, 500);
        const pick = (jobs ?? []).find((j) =>
          j.status === "queued" || (j.status === "rendering" && String(j.updated_at ?? "") < staleIso));
        if (!pick) return json({ ok: true, job: null });
        await admin.from("reels_jobs").update({ status: "rendering", stage: "монтаж", progress: 10 }).eq("id", pick.id);
        return json({ ok: true, job: { jobId: pick.id, projectId: pick.project_id, script: pick.script, config: pick.config } });
      }

      default:
        return json({ error: `unknown action: ${action}` }, 400);
    }
  } catch (e) {
    console.error("reels-tts error", e instanceof Error ? e.message : String(e));
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
