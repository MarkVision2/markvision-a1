// Public redirect for tracked WhatsApp group invite links.
// GET /functions/v1/group-invite-redirect?s=<slug>
// 1) Resolve active group_invite_links by slug
// 2) Insert group_invite_clicks + bump click_count
// 3) 302 → invite_url (chat.whatsapp.com/…)
//
// Short public URL on site: https://www.markvision.kz/g/<slug>

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

function pickUtm(url: URL): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "src", "ref"]) {
    const v = url.searchParams.get(k);
    if (v && v.trim()) out[k] = v.trim().slice(0, 128);
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const slug = (url.searchParams.get("s") ?? url.searchParams.get("slug") ?? "").trim().toLowerCase();
  if (!slug) {
    return new Response("Missing ?s=slug", { status: 400, headers: corsHeaders });
  }

  const { data: link, error } = await admin
    .from("group_invite_links")
    .select("id, project_id, invite_url, is_active")
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !link) {
    return new Response("Link not found", { status: 404, headers: corsHeaders });
  }

  const inviteUrl = String((link as { invite_url?: string }).invite_url ?? "").trim();
  if (!inviteUrl) {
    return new Response("Invite URL empty", { status: 500, headers: corsHeaders });
  }

  const occurredAt = new Date();
  const dateKey = almatyDateKey(occurredAt);
  const linkId = (link as { id: string }).id;
  const projectId = (link as { project_id: string }).project_id;

  if (req.method === "GET") {
    const utm = pickUtm(url);
    const { error: insErr } = await admin.from("group_invite_clicks").insert({
      link_id: linkId,
      project_id: projectId,
      occurred_at: occurredAt.toISOString(),
      date: dateKey,
      user_agent: (req.headers.get("user-agent") ?? "").slice(0, 512) || null,
      referrer: (req.headers.get("referer") ?? "").slice(0, 512) || null,
      utm,
    });
    if (insErr) console.error("[group-invite-redirect] click insert", insErr);

    const { error: bumpErr } = await admin.rpc("bump_group_invite_click", {
      p_link_id: linkId,
    });
    if (bumpErr) console.warn("[group-invite-redirect] bump", bumpErr.message);
  }

  // Prefer clean invite URL without mode=gi_t noise; WA ignores UTM on chat.whatsapp.com.
  let target = inviteUrl;
  try {
    const u = new URL(inviteUrl);
    // Keep invite code path intact; strip tracking junk from original if any.
    u.search = "";
    target = u.toString();
  } catch {
    /* use as-is */
  }

  return new Response(null, {
    status: 302,
    headers: {
      ...corsHeaders,
      Location: target,
      "Cache-Control": "no-store",
    },
  });
});
