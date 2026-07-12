// Конфиг подключения Google Ads для UI: чтение статуса подключения проекта и
// сохранение конверсионных действий (google_ads_connections закрыта RLS
// deny-all — писать/читать её можно только под service role, поэтому доступ к
// проекту проверяем здесь по JWT пользователя).
//
// POST { project_id, action?: "save", conversion_action_sale?, conversion_action_lead? }
//   action="save" — обновляет два поля (если подключение существует), затем
//   всегда возвращает текущий статус: { connected, google_email,
//   conversion_action_sale, conversion_action_lead }.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

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
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

    const supaUser = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await supaUser.auth.getUser();
    if (!user) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const projectId = body?.project_id as string | undefined;
    if (!projectId) return json({ error: "project_id required" }, 400);

    const supa = createClient(SUPABASE_URL, SERVICE_ROLE);
    // Доступ к проекту: создатель или участник.
    const { data: proj } = await supa.from("projects").select("created_by").eq("id", projectId).maybeSingle();
    if (proj?.created_by !== user.id) {
      const { data: mem } = await supa.from("project_members")
        .select("user_id").eq("project_id", projectId).eq("user_id", user.id).maybeSingle();
      if (!mem) return json({ error: "forbidden" }, 403);
    }

    if (body?.action === "save") {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if ("conversion_action_sale" in body) patch.conversion_action_sale = (body.conversion_action_sale as string | null) || null;
      if ("conversion_action_lead" in body) patch.conversion_action_lead = (body.conversion_action_lead as string | null) || null;
      const { error } = await supa.from("google_ads_connections").update(patch).eq("project_id", projectId);
      if (error) return json({ error: error.message }, 500);
    }

    const { data: conn } = await supa.from("google_ads_connections")
      .select("google_email, conversion_action_sale, conversion_action_lead, login_customer_id, updated_at")
      .eq("project_id", projectId).maybeSingle();

    return json({
      connected: !!conn,
      google_email: conn?.google_email ?? null,
      login_customer_id: conn?.login_customer_id ?? null,
      conversion_action_sale: conn?.conversion_action_sale ?? null,
      conversion_action_lead: conn?.conversion_action_lead ?? null,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});
