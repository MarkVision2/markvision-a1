// Reels TTS — озвучка ElevenLabs для раздела «Reels-видео».
// VPS-воркер Reels Factory мёртв, поэтому TTS делаем здесь: edge-функция из сети
// Supabase дотягивается до api.elevenlabs.io (сессия Claude — нет, egress-политика),
// генерит mp3 выбранным голосом, кладёт в bucket `renders` и отдаёт публичный URL.
// Claude-сессия качает mp3 (Supabase доступен), строит графику в Remotion и
// публикует ролик как обычно (reels_usage + Telegram).
//
// Авторизация: как montage-worker — verify_jwt off + x-montage-key против
// montage_settings.worker_key (fail-closed).
// Секрет: ELEVENLABS_API_KEY (задать в Supabase → Edge Functions → Secrets).
//
// Действия (POST JSON { action, ... }):
//   voices                              → список голосов аккаунта (GET /v1/voices)
//   tts {text, voiceId, path, modelId?} → синтез → upload в renders → {publicUrl}
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

type Json = Record<string, unknown>;
const json = (body: Json, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const EL = "https://api.elevenlabs.io/v1";
const DEFAULT_MODEL = "eleven_multilingual_v2"; // говорит по-русски

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // fail-closed: тот же ключ, что у montage-worker.
  const { data: settings } = await admin.from("montage_settings").select("worker_key").eq("id", 1).maybeSingle();
  const expected = settings?.worker_key as string | undefined;
  const provided = req.headers.get("x-montage-key");
  if (!expected || !provided || provided !== expected) return json({ error: "forbidden" }, 403);

  const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
  if (!apiKey) return json({ error: "ELEVENLABS_API_KEY not set in Supabase secrets" }, 500);

  let body: Json;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const action = String(body.action ?? "");

  try {
    switch (action) {
      case "voices": {
        const r = await fetch(`${EL}/voices`, { headers: { "xi-api-key": apiKey } });
        if (!r.ok) return json({ error: `elevenlabs voices ${r.status}`, detail: await r.text() }, 502);
        const j = await r.json();
        const voices = (j.voices ?? []).map((v: Json) => ({
          voice_id: v.voice_id,
          name: v.name,
          category: v.category,
          labels: v.labels ?? {},
        }));
        return json({ voices });
      }

      case "tts": {
        const text = String(body.text ?? "").trim();
        const voiceId = String(body.voiceId ?? "").trim();
        const path = String(body.path ?? "").replace(/^\/+/, "");
        const modelId = String(body.modelId ?? DEFAULT_MODEL);
        if (!text || !voiceId || !path) return json({ error: "text, voiceId, path required" }, 400);

        const r = await fetch(`${EL}/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
          method: "POST",
          headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            model_id: modelId,
            voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true },
          }),
        });
        if (!r.ok) return json({ error: `elevenlabs tts ${r.status}`, detail: await r.text() }, 502);
        const bytes = new Uint8Array(await r.arrayBuffer());

        const { error: upErr } = await admin.storage.from("renders").upload(path, bytes, {
          contentType: "audio/mpeg",
          upsert: true,
        });
        if (upErr) return json({ error: `upload: ${upErr.message}` }, 500);
        const { data: pub } = admin.storage.from("renders").getPublicUrl(path);
        return json({ ok: true, path, publicUrl: pub.publicUrl, bytes: bytes.byteLength });
      }

      default:
        return json({ error: `unknown action: ${action}` }, 400);
    }
  } catch (e) {
    console.error("reels-tts error", e instanceof Error ? e.message : String(e));
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
