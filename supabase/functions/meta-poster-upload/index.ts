// meta-poster-upload — принимает jpeg-кадр (base64), кладёт в Storage и
// сохраняет публичный URL в meta_creatives.poster_url для конкретного ad_id.
//
// Body: { ad_id: string, image_base64: string (data URL или чистый base64) }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { requireUser } from "../_lib/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function decodeBase64(b64: string): Uint8Array {
  const clean = b64.replace(/^data:image\/[a-zA-Z0-9+]+;base64,/, "");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  let body: { ad_id?: string; image_base64?: string } = {};
  try { body = await req.json(); } catch { /* */ }
  const adId = (body.ad_id ?? "").toString().trim();
  const b64 = (body.image_base64 ?? "").toString();
  if (!/^\d+$/.test(adId)) return json({ ok: false, error: "ad_id required" }, 400);
  if (!b64 || b64.length < 200) return json({ ok: false, error: "image_base64 required" }, 400);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Проверяем что креатив существует и берём cabinet_id для пути
  const { data: row, error: rowErr } = await admin
    .from("meta_creatives")
    .select("id, cabinet_id")
    .eq("ad_id", adId)
    .maybeSingle();
  if (rowErr) return json({ ok: false, error: rowErr.message }, 500);
  if (!row) return json({ ok: false, error: "creative not found" }, 404);

  const bytes = decodeBase64(b64);
  if (bytes.byteLength > 2_000_000) {
    return json({ ok: false, error: "image too large (max 2MB)" }, 413);
  }

  const path = `${(row as { cabinet_id?: string }).cabinet_id ?? "shared"}/${adId}.jpg`;
  const { error: upErr } = await admin.storage
    .from("creative-posters")
    .upload(path, bytes, {
      contentType: "image/jpeg",
      cacheControl: "604800",
      upsert: true,
    });
  if (upErr) return json({ ok: false, error: upErr.message }, 500);

  const { data: pub } = admin.storage.from("creative-posters").getPublicUrl(path);
  const publicUrl = pub.publicUrl;

  const { error: dbErr } = await admin
    .from("meta_creatives")
    .update({ poster_url: publicUrl, last_synced_at: new Date().toISOString() })
    .eq("ad_id", adId);
  if (dbErr) return json({ ok: false, error: dbErr.message }, 500);

  return json({ ok: true, poster_url: publicUrl });
});
