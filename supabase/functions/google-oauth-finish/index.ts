// Шаг 3 (только если у Google-логина несколько customer-аккаунтов): завершает
// подключение по явному выбору пользователя из google-oauth-callback.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const SELECTION_TTL_MS = 15 * 60_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function normalizeCustomerId(id: string): string {
  return id.replace(/^customers\//i, "").replace(/[^0-9]/g, "");
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
    const selectionId = body?.selection_id as string | undefined;
    const customerId = body?.customer_id as string | undefined;
    if (!selectionId || !customerId) return json({ error: "selection_id, customer_id required" }, 400);

    const supa = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: selection } = await supa
      .from("google_oauth_pending_selections")
      .select("project_id, user_id, refresh_token, login_customer_id, google_email, accounts, created_at")
      .eq("id", selectionId).maybeSingle();
    // Одноразовый выбор.
    await supa.from("google_oauth_pending_selections").delete().eq("id", selectionId);

    if (!selection) return json({ error: "Выбор устарел или уже применён, начните заново" }, 400);
    const sel = selection as {
      project_id: string; user_id: string; refresh_token: string;
      login_customer_id: string | null; google_email: string | null;
      accounts: Array<{ id: string; name: string }>; created_at: string;
    };
    if (sel.user_id !== user.id) return json({ error: "forbidden" }, 403);
    if (Date.now() - new Date(sel.created_at).getTime() > SELECTION_TTL_MS) {
      return json({ error: "Выбор устарел, начните заново" }, 400);
    }

    const external = normalizeCustomerId(customerId);
    const chosen = sel.accounts.find((a) => normalizeCustomerId(a.id) === external);
    if (!chosen) return json({ error: "customer not in selection" }, 400);

    // Гарантируем подключение проекта (refresh-токен) и создаём кабинет.
    await supa.from("google_ads_connections").upsert({
      project_id: sel.project_id,
      refresh_token: sel.refresh_token,
      login_customer_id: sel.login_customer_id,
      google_email: sel.google_email,
      created_by: sel.user_id,
      updated_at: new Date().toISOString(),
    }, { onConflict: "project_id" });

    const { data: existing } = await supa.from("ad_cabinets")
      .select("id").eq("project_id", sel.project_id).eq("provider", "google").eq("external_id", external).maybeSingle();
    if (!existing) {
      await supa.from("ad_cabinets").insert({
        project_id: sel.project_id,
        provider: "google",
        external_id: external,
        ad_account_id: external,
        name: chosen.name ?? `Google Ads — ${external}`,
        type: "Личный",
        currency: "KZT",
        created_by: sel.user_id,
      });
    }

    return json({ ok: true, summary: `Google Ads: ${chosen.name ?? external}` });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});
