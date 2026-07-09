// Сохраняет отдельный Instagram Login access token (Instagram API with
// Instagram Login, graph.instagram.com), который ig-webhook использует
// только для отправки личных сообщений — Page-linked токен для этого не
// работает на этом приложении ("(#3) Application does not have the
// capability to make this API call"), хотя публичные ответы на комментарии
// им же прекрасно идут.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser, requireProjectAccess } from "../_lib/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = await requireUser(req);
    if (!auth.ok) return auth.response;

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const projectId = String(body?.project_id ?? "");
    const token = String(body?.token ?? "").trim();
    if (!projectId) return json({ error: "project_id обязателен" }, 400);
    if (!token) return json({ error: "token обязателен" }, 400);

    const access = await requireProjectAccess(auth.authHeader, projectId);
    if (!access.ok) return access.response;

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supa = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: account } = await supa
      .from("instagram_accounts")
      .select("ig_user_id")
      .eq("project_id", projectId)
      .maybeSingle();
    if (!account?.ig_user_id) return json({ error: "Instagram аккаунт не подключён к проекту" }, 404);

    // Проверяем токен и что он выдан именно для нужного аккаунта, прежде чем сохранять.
    const check = await fetch(`https://graph.instagram.com/v21.0/me?fields=user_id,username&access_token=${encodeURIComponent(token)}`);
    const checkBody = await check.json().catch(() => ({}));
    if (!check.ok || checkBody.error) {
      return json({ error: checkBody?.error?.message ?? "Токен недействителен" }, 400);
    }
    if (String(checkBody.user_id) !== account.ig_user_id) {
      return json({ error: `Токен выдан для другого аккаунта (@${checkBody.username ?? checkBody.user_id}), а не для подключённого` }, 400);
    }

    const { error } = await supa
      .from("instagram_accounts")
      .update({ ig_login_access_token: token })
      .eq("project_id", projectId);
    if (error) return json({ error: error.message }, 500);

    return json({ ok: true, username: checkBody.username ?? null });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});
