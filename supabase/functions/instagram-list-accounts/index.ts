// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GRAPH = "https://graph.facebook.com/v21.0";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

    const supaUser = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await supaUser.auth.getUser();
    if (!user) return json({ error: "unauthorized" }, 401);

    const { project_id } = await req.json();
    if (!project_id) return json({ error: "project_id required" }, 400);

    const supa = createClient(SUPABASE_URL, SERVICE_ROLE);

    // access guard
    const { data: canAccess } = await supa.rpc("user_can_access_project", { _project_id: project_id });
    // RPC may not exist for service role; do a manual check fallback
    if (canAccess !== true) {
      const { data: proj } = await supa.from("projects").select("created_by").eq("id", project_id).maybeSingle();
      if (proj?.created_by !== user.id) {
        const { data: mem } = await supa.from("project_members").select("user_id").eq("project_id", project_id).eq("user_id", user.id).maybeSingle();
        if (!mem) return json({ error: "forbidden" }, 403);
      }
    }

    const { data: settings } = await supa.from("automation_settings").select("meta_access_token").eq("id", true).maybeSingle();
    const token = settings?.meta_access_token;
    if (!token) return json({ error: "meta_access_token not configured", accounts: [] }, 400);

    // Step 1: get pages
    const pagesRes = await fetch(`${GRAPH}/me/accounts?fields=id,name,access_token&limit=100&access_token=${token}`);
    const pagesJson = await pagesRes.json();
    if (pagesJson.error) {
      return json({ error: pagesJson.error.message, code: pagesJson.error.code, accounts: [] }, 400);
    }
    const pages = (pagesJson.data ?? []) as Array<{ id: string; name: string; access_token: string }>;

    // Step 2: for each page, get IG business account
    const accounts: any[] = [];
    for (const p of pages) {
      try {
        const r = await fetch(
          `${GRAPH}/${p.id}?fields=instagram_business_account{id,username,name,profile_picture_url,followers_count,media_count}&access_token=${p.access_token}`,
        );
        const j = await r.json();
        const ig = j.instagram_business_account;
        if (ig?.id) {
          accounts.push({
            ig_user_id: ig.id,
            username: ig.username,
            name: ig.name ?? null,
            profile_picture_url: ig.profile_picture_url ?? null,
            followers_count: ig.followers_count ?? 0,
            media_count: ig.media_count ?? 0,
            page_id: p.id,
            page_name: p.name,
          });
        }
      } catch (_e) { /* skip */ }
    }

    return json({ ok: true, accounts });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});
