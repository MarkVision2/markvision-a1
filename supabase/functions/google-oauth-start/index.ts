// Шаг 1 подключения Google Ads: проверяет доступ пользователя к проекту,
// создаёт одноразовый state и возвращает ссылку на согласие Google OAuth.
// Фронтенду остаётся сделать window.open(url) (мирроринг facebook-oauth-start).
//
// Требуется секрет edge-функции: GOOGLE_OAUTH_CLIENT_ID (id OAuth-клиента из
// Google Cloud). redirect_uri фиксирован на google-oauth-callback и должен быть
// добавлен в список Authorized redirect URIs OAuth-клиента.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Google Ads API + email для отображения, offline-доступ для refresh-токена.
const SCOPES = [
  "https://www.googleapis.com/auth/adwords",
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
].join(" ");

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
    const CLIENT_ID = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
    if (!CLIENT_ID) {
      return json({
        error: "google_oauth_not_configured",
        hint: "Задайте секрет GOOGLE_OAUTH_CLIENT_ID (OAuth client из Google Cloud) в настройках edge-функций.",
      }, 503);
    }

    const supaUser = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await supaUser.auth.getUser();
    if (!user) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const { project_id, return_url } = body ?? {};
    if (!project_id || !return_url) return json({ error: "project_id, return_url required" }, 400);

    const supa = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: proj } = await supa.from("projects").select("created_by").eq("id", project_id).maybeSingle();
    if (proj?.created_by !== user.id) {
      const { data: mem } = await supa.from("project_members")
        .select("user_id").eq("project_id", project_id).eq("user_id", user.id).maybeSingle();
      if (!mem) return json({ error: "forbidden" }, 403);
    }

    const { data: state, error } = await supa
      .from("google_oauth_states")
      .insert({ project_id, user_id: user.id, return_url })
      .select("id")
      .single();
    if (error || !state) return json({ error: error?.message ?? "failed to create state" }, 500);

    const redirectUri = `${SUPABASE_URL}/functions/v1/google-oauth-callback`;
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("state", state.id);
    authUrl.searchParams.set("scope", SCOPES);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("access_type", "offline");     // нужен refresh_token
    authUrl.searchParams.set("prompt", "consent");          // всегда выдаёт refresh_token
    authUrl.searchParams.set("include_granted_scopes", "true");

    return json({ url: authUrl.toString() });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});
