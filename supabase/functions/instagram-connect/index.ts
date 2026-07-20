// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { resolveMetaAccessToken } from "../_lib/metaToken.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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

    const body = await req.json();
    const { project_id, page_id, ig_user_id, meta_token } = body ?? {};
    if (!project_id || !page_id || !ig_user_id) return json({ error: "project_id, page_id, ig_user_id required" }, 400);

    const supa = createClient(SUPABASE_URL, SERVICE_ROLE);

    // access guard
    const { data: proj } = await supa.from("projects").select("created_by").eq("id", project_id).maybeSingle();
    if (proj?.created_by !== user.id) {
      const { data: mem } = await supa.from("project_members").select("user_id").eq("project_id", project_id).eq("user_id", user.id).maybeSingle();
      if (!mem) return json({ error: "forbidden" }, 403);
    }

    const token = await resolveMetaAccessToken({
      admin: supa,
      projectId: project_id,
      bodyToken: typeof meta_token === "string" ? meta_token : null,
    });
    if (!token) {
      return json({
        error:
          "Meta-токен не найден. Добавьте его в Настройки → Meta → Meta-токены, или вставьте токен при подключении.",
      }, 400);
    }

    // Get page access token (long-lived, derived from user token)
    const pagesRes = await fetch(`${GRAPH}/me/accounts?fields=id,name,access_token&limit=200&access_token=${token}`);
    const pagesJson = await pagesRes.json();
    if (pagesJson.error) return json({ error: pagesJson.error.message }, 400);
    const page = (pagesJson.data ?? []).find((p: any) => p.id === page_id);
    if (!page) return json({ error: "page not found in token scope" }, 404);

    // Verify IG account belongs to page
    const igRes = await fetch(
      `${GRAPH}/${page_id}?fields=instagram_business_account{id,username,name,profile_picture_url,followers_count,follows_count,media_count}&access_token=${page.access_token}`,
    );
    const igJson = await igRes.json();
    const ig = igJson.instagram_business_account;
    if (!ig?.id || ig.id !== ig_user_id) return json({ error: "ig account mismatch" }, 400);

    // If project already linked to another IG, drop stale analytics so UI never mixes accounts.
    const { data: existing } = await supa
      .from("instagram_accounts")
      .select("ig_user_id")
      .eq("project_id", project_id)
      .maybeSingle();
    const prevIg = (existing as { ig_user_id?: string } | null)?.ig_user_id ?? null;
    if (prevIg && prevIg !== ig_user_id) {
      await Promise.all([
        supa.from("instagram_media").delete().eq("project_id", project_id).neq("ig_user_id", ig_user_id),
        supa.from("instagram_account_daily").delete().eq("project_id", project_id).neq("ig_user_id", ig_user_id),
        supa.from("instagram_demographics").delete().eq("project_id", project_id).neq("ig_user_id", ig_user_id),
      ]);
    }

    // Upsert account
    const { error: upErr } = await supa.from("instagram_accounts").upsert({
      project_id,
      ig_user_id,
      username: ig.username ?? null,
      name: ig.name ?? null,
      profile_picture_url: ig.profile_picture_url ?? null,
      page_id,
      page_name: page.name,
      page_access_token: page.access_token,
      followers_count: ig.followers_count ?? 0,
      follows_count: ig.follows_count ?? 0,
      media_count: ig.media_count ?? 0,
      active: true,
      last_error: null,
    }, { onConflict: "project_id" });
    if (upErr) return json({ error: upErr.message }, 500);

    // Kick off first sync (fire-and-forget)
    fetch(`${SUPABASE_URL}/functions/v1/instagram-sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE}`,
      },
      body: JSON.stringify({ project_id }),
    }).catch(() => {});

    // Подписка Page на comments/messages (+ referral с рекламы) — без этого
    // ig-webhook не получает код-слова из комментов/Direct и молчит.
    let webhookSubscribed = true;
    let webhookError: string | null = null;
    try {
      const subRes = await fetch(
        `${GRAPH}/${page_id}/subscribed_apps?subscribed_fields=comments,messages,messaging_referral&access_token=${page.access_token}`,
        { method: "POST" },
      );
      const subJson = await subRes.json().catch(() => ({}));
      if (!subRes.ok || subJson?.error) {
        webhookSubscribed = false;
        webhookError = subJson?.error?.message ?? `HTTP ${subRes.status}`;
      }
    } catch (e) {
      webhookSubscribed = false;
      webhookError = e instanceof Error ? e.message : "unknown";
    }

    return json({ ok: true, webhookSubscribed, webhookError });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});
