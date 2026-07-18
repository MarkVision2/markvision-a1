// reels-gen — AI b-roll generation via kie.ai (FLUX images) for the
// "Видео с озвучкой" track, used when Pexels stock has no fitting shot.
// The Claude session can't reach kie.ai (egress), so this edge function calls
// kie.ai, waits for the job, downloads the image and stores it in the `renders`
// bucket; the session then pulls the Supabase URL.
//
// Auth: verify_jwt off + x-montage-key against montage_settings.worker_key.
// Secret: KIE_API_KEY (Supabase → Edge Functions → Secrets).
//
// Action (POST JSON { action:"flux", jobId, prompt, aspectRatio?, model? }):
//   createTask → poll recordInfo → download image → upload → { url }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

type Json = Record<string, unknown>;
const json = (b: Json, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const KIE = "https://api.kie.ai/api/v1/jobs";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Pull the first http(s) media URL out of kie.ai's resultJson (shape varies).
function firstUrl(resultJson: unknown): string | null {
  if (!resultJson) return null;
  let obj: unknown = resultJson;
  if (typeof resultJson === "string") { try { obj = JSON.parse(resultJson); } catch { obj = resultJson; } }
  const s = JSON.stringify(obj);
  const m = s.match(/https?:\/\/[^"'\\ ]+?\.(?:png|jpg|jpeg|webp|mp4)/i);
  return m ? m[0] : null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: settings } = await admin.from("montage_settings").select("worker_key").eq("id", 1).maybeSingle();
  const expected = settings?.worker_key as string | undefined;
  const provided = req.headers.get("x-montage-key");
  if (!expected || !provided || provided !== expected) return json({ error: "forbidden" }, 403);

  const apiKey = Deno.env.get("KIE_API_KEY");
  if (!apiKey) return json({ error: "KIE_API_KEY not set in Supabase secrets" }, 500);

  let body: Json;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  if (String(body.action ?? "") !== "flux") return json({ error: "unknown action" }, 400);

  const prompt = String(body.prompt ?? "").trim();
  const jobId = String(body.jobId ?? "job");
  const aspectRatio = String(body.aspectRatio ?? "9:16");
  const model = String(body.model ?? "flux-2/pro-text-to-image");
  if (!prompt) return json({ error: "prompt required" }, 400);
  const auth = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

  try {
    // 1) create task. Extra model-specific fields can be passed in body.input.
    const extra = (body.input && typeof body.input === "object") ? body.input as Json : {};
    const input = { prompt, aspect_ratio: aspectRatio, resolution: "2K", output_format: "png", ...extra };
    const cr = await fetch(`${KIE}/createTask`, { method: "POST", headers: auth, body: JSON.stringify({ model, input }) });
    const cj = await cr.json().catch(() => ({}));
    const taskId = cj?.data?.taskId ?? cj?.data?.task_id ?? cj?.taskId;
    if (!cr.ok || !taskId) return json({ error: `createTask failed`, detail: cj }, 502);

    // 2) poll recordInfo (~ up to 90s)
    let url: string | null = null;
    let lastState = "";
    for (let i = 0; i < 30; i++) {
      await sleep(3000);
      const rr = await fetch(`${KIE}/recordInfo?taskId=${encodeURIComponent(taskId)}`, { headers: auth });
      const rj = await rr.json().catch(() => ({}));
      const d = rj?.data ?? {};
      lastState = String(d.state ?? d.status ?? "");
      if (["success", "succeeded", "completed"].includes(lastState.toLowerCase())) { url = firstUrl(d.resultJson ?? d.result ?? d); break; }
      if (["fail", "failed", "error"].includes(lastState.toLowerCase())) return json({ error: `kie generation failed: ${d.failMsg ?? ""}` }, 502);
    }
    if (!url) return json({ error: `timeout/no url (state=${lastState})` }, 504);

    // 3) download + store
    const fr = await fetch(url);
    if (!fr.ok) return json({ error: `download ${fr.status}` }, 502);
    const bytes = new Uint8Array(await fr.arrayBuffer());
    const ext = (url.match(/\.(png|jpg|jpeg|webp|mp4)/i)?.[1] ?? "png").toLowerCase();
    const ct = ext === "mp4" ? "video/mp4" : `image/${ext === "jpg" ? "jpeg" : ext}`;
    const path = `broll/${jobId}/gen-${Date.now()}.${ext}`;
    const up = await admin.storage.from("renders").upload(path, bytes, { contentType: ct, upsert: true });
    if (up.error) return json({ error: `upload: ${up.error.message}` }, 500);
    const { data: pub } = admin.storage.from("renders").getPublicUrl(path);
    return json({ ok: true, url: pub.publicUrl, kind: ext === "mp4" ? "clip" : "image" });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
