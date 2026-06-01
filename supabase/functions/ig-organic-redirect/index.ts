// Public redirect for Instagram organic short links.
// GET /functions/v1/ig-organic-redirect?c=<short_id>&u=<username>
// 1) Resolves codeword by short_id
// 2) Inserts link_click into instagram_organic_events
// 3) 302 → target_url with utm_source=instagram, utm_campaign=<codeword>, cw=<codeword>

import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function almatyDateKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Almaty",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const shortId = (url.searchParams.get("c") ?? "").trim();
  const username = (url.searchParams.get("u") ?? "").trim() || null;

  if (!shortId) {
    return new Response("Missing ?c=short_id", { status: 400, headers: corsHeaders });
  }

  const { data: row, error } = await admin
    .from("instagram_codewords")
    .select("id, project_id, codeword, target_url, reel_id, reel_url, active")
    .eq("short_id", shortId)
    .eq("active", true)
    .maybeSingle();

  if (error || !row?.target_url) {
    return new Response("Link not found", { status: 404, headers: corsHeaders });
  }

  const occurredAt = new Date();
  const dateKey = almatyDateKey(occurredAt);

  if (req.method === "GET") {
    const { error: insErr } = await admin.from("instagram_organic_events").insert({
      project_id: row.project_id,
      codeword_id: row.id,
      codeword: row.codeword,
      reel_id: row.reel_id,
      reel_url: row.reel_url,
      event_type: "link_click",
      username,
      date: dateKey,
      occurred_at: occurredAt.toISOString(),
      payload: { short_id: shortId, user_agent: req.headers.get("user-agent") ?? null },
    });
    if (insErr) console.error("[ig-organic-redirect] link_click insert", insErr);
  }

  let target: URL;
  try {
    target = new URL(row.target_url);
  } catch {
    return new Response("Invalid target URL", { status: 500, headers: corsHeaders });
  }

  if (!target.searchParams.has("utm_source")) {
    target.searchParams.set("utm_source", "instagram");
  }
  if (!target.searchParams.has("utm_campaign")) {
    target.searchParams.set("utm_campaign", row.codeword);
  }
  target.searchParams.set("cw", row.codeword);
  if (username && !target.searchParams.has("ig_user")) {
    target.searchParams.set("ig_user", username);
  }

  return new Response(null, {
    status: 302,
    headers: {
      ...corsHeaders,
      Location: target.toString(),
      "Cache-Control": "no-store",
    },
  });
});
