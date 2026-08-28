// deno-lint-ignore-file no-explicit-any
// Шаг 1 полноценного входа через Facebook: проверяет, что пользователь может
// управлять проектом, создаёт одноразовый state и возвращает готовую ссылку
// на диалог авторизации Facebook. Фронтенду остаётся только сделать
// window.location.href = url.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// App ID публичный (не секрет) — безопасно хранить прямо в коде.
const META_APP_ID = "943753324681398";
const SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_metadata",
  "instagram_basic",
  "instagram_manage_insights",
  "instagram_manage_comments",
  "instagram_manage_messages",
  "instagram_content_publish",
  "business_management",
  "ads_read",
  "ads_management",
].join(",");

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

    const supaUser = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await supaUser.auth.getUser();
    if (!user) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const { project_id, return_url } = body ?? {};
    if (!project_id || !return_url) return json({ error: "project_id, return_url required" }, 400);

    // return_url потом используется для 302-редиректа из callback. Фронт всегда
    // передаёт window.location.href, поэтому требуем совпадения origin с тем,
    // откуда пришёл вызов — иначе ссылку можно было бы увести на чужой домен.
    const origin = req.headers.get("Origin");
    if (origin) {
      let sameOrigin = false;
      try {
        sameOrigin = new URL(String(return_url)).origin === new URL(origin).origin;
      } catch {
        sameOrigin = false;
      }
      if (!sameOrigin) return json({ error: "return_url must match request origin" }, 400);
    }

    const supa = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: proj } = await supa.from("projects").select("created_by").eq("id", project_id).maybeSingle();
    if (proj?.created_by !== user.id) {
      const { data: mem } = await supa.from("project_members").select("user_id").eq("project_id", project_id).eq("user_id", user.id).maybeSingle();
      if (!mem) return json({ error: "forbidden" }, 403);
    }

    const { data: state, error } = await supa
      .from("meta_oauth_states")
      .insert({ project_id, user_id: user.id, return_url })
      .select("id")
      .single();
    if (error || !state) return json({ error: error?.message ?? "failed to create state" }, 500);

    const redirectUri = `${SUPABASE_URL}/functions/v1/facebook-oauth-callback`;
    const authUrl = new URL("https://www.facebook.com/v21.0/dialog/oauth");
    authUrl.searchParams.set("client_id", META_APP_ID);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("state", state.id);
    authUrl.searchParams.set("scope", SCOPES);
    authUrl.searchParams.set("response_type", "code");

    return json({ url: authUrl.toString() });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});
