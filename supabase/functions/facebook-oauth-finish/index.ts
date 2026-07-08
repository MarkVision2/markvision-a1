// deno-lint-ignore-file no-explicit-any
// Шаг 3 (только когда у аккаунта больше одной страницы/кабинета): завершает
// подключение по явному выбору пользователя из facebook-oauth-callback.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { connectPageAndAdAccount, type FbAdAccount, type FbPage } from "../_lib/facebookConnect.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const SELECTION_TTL_MS = 15 * 60_000;

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
    const selectionId = body?.selection_id as string | undefined;
    const pageId = body?.page_id as string | undefined;
    const adAccountId = (body?.ad_account_id as string | undefined) || null;
    if (!selectionId || !pageId) return json({ error: "selection_id, page_id required" }, 400);

    const supa = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: selection } = await supa
      .from("meta_oauth_pending_selections")
      .select("project_id, user_id, user_token, pages, ad_accounts, created_at")
      .eq("id", selectionId)
      .maybeSingle();
    // One-time use: delete immediately, whatever happens next.
    await supa.from("meta_oauth_pending_selections").delete().eq("id", selectionId);

    if (!selection) return json({ error: "Выбор устарел или уже применён, начните подключение заново" }, 400);
    const sel = selection as {
      project_id: string; user_id: string; user_token: string;
      pages: FbPage[]; ad_accounts: FbAdAccount[]; created_at: string;
    };
    if (sel.user_id !== user.id) return json({ error: "forbidden" }, 403);
    if (Date.now() - new Date(sel.created_at).getTime() > SELECTION_TTL_MS) {
      return json({ error: "Выбор устарел, начните подключение заново" }, 400);
    }

    const page = sel.pages.find((p) => p.id === pageId);
    if (!page) return json({ error: "page not found in selection" }, 400);
    const adAccount = adAccountId ? sel.ad_accounts.find((a) => a.id === adAccountId) ?? null : null;

    const summary = await connectPageAndAdAccount(supa, sel.project_id, sel.user_token, page, adAccount);
    return json({ ok: true, summary });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});
