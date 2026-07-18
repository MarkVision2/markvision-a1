// reels-broll — free stock b-roll from Pexels for the "Видео с озвучкой" track.
// The Claude session can't reach api.pexels.com (egress), so this edge function
// searches Pexels, picks the best portrait clip per query, downloads it and
// stores it in the `renders` bucket; the session then pulls the Supabase URL.
//
// Auth: verify_jwt off + x-montage-key against montage_settings.worker_key.
// Secret: PEXELS_API_KEY (Supabase → Edge Functions → Secrets).
//
// Action (POST JSON { action:"pexels", jobId, queries:[...], orientation?, perQuery? }):
//   for each query → search → best vertical mp4 → upload → { query, url, dur, w, h }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

type Json = Record<string, unknown>;
const json = (b: Json, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const slug = (q: string) => q.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "clip";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: settings } = await admin.from("montage_settings").select("worker_key").eq("id", 1).maybeSingle();
  const expected = settings?.worker_key as string | undefined;
  const provided = req.headers.get("x-montage-key");
  if (!expected || !provided || provided !== expected) return json({ error: "forbidden" }, 403);

  const apiKey = Deno.env.get("PEXELS_API_KEY");
  if (!apiKey) return json({ error: "PEXELS_API_KEY not set in Supabase secrets" }, 500);

  let body: Json;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  if (String(body.action ?? "") !== "pexels") return json({ error: "unknown action" }, 400);

  const jobId = String(body.jobId ?? "job");
  const orientation = String(body.orientation ?? "portrait");
  const perQuery = Math.min(Number(body.perQuery ?? 1), 3);
  const queries = Array.isArray(body.queries) ? (body.queries as string[]) : [];
  if (!queries.length) return json({ error: "queries[] required" }, 400);

  // pick a portrait mp4 around 1080x1920, HD if available, reasonable size
  const pickFiles = (v: Json, n: number): Json[] => {
    const files = (v.video_files as Json[] ?? [])
      .filter((f) => String(f.file_type) === "video/mp4" && Number(f.height) >= Number(f.width))
      .sort((a, b) => Math.abs(Number(a.height) - 1920) - Math.abs(Number(b.height) - 1920));
    return files.slice(0, n);
  };

  const out: Json[] = [];
  const warnings: string[] = [];
  for (const q of queries) {
    try {
      const r = await fetch(`https://api.pexels.com/videos/search?query=${encodeURIComponent(q)}&orientation=${orientation}&size=medium&per_page=8`, { headers: { Authorization: apiKey } });
      if (!r.ok) { warnings.push(`${q}: pexels ${r.status}`); continue; }
      const j = await r.json();
      const vids = (j.videos as Json[] ?? []).filter((v) => Number(v.duration) >= 3 && Number(v.duration) <= 30);
      let taken = 0;
      for (const v of vids) {
        if (taken >= perQuery) break;
        const file = pickFiles(v, 1)[0];
        if (!file) continue;
        const fr = await fetch(String(file.link));
        if (!fr.ok) continue;
        const bytes = new Uint8Array(await fr.arrayBuffer());
        if (bytes.byteLength < 10000) continue;
        const path = `broll/${jobId}/${slug(q)}-${v.id}.mp4`;
        const up = await admin.storage.from("renders").upload(path, bytes, { contentType: "video/mp4", upsert: true });
        if (up.error) { warnings.push(`${q}: upload ${up.error.message}`); continue; }
        const { data: pub } = admin.storage.from("renders").getPublicUrl(path);
        out.push({ query: q, url: pub.publicUrl, dur: v.duration, w: file.width, h: file.height, credit: v.user && (v.user as Json).name });
        taken++;
      }
      if (!taken) warnings.push(`${q}: no suitable vertical clip`);
    } catch (e) {
      warnings.push(`${q}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return json({ ok: true, clips: out, warnings });
});
