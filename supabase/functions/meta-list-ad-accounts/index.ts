import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import {
  fetchAllMetaAdAccounts,
  mapAdAccounts,
  normalizeActId,
} from "../_lib/meta_list_ad_accounts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function resolveMetaToken(
  bodyToken: string | null | undefined,
): Promise<string | null> {
  if (bodyToken?.trim()) return bodyToken.trim();

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: settings } = await admin
    .from("automation_settings")
    .select("meta_access_token")
    .eq("id", true)
    .maybeSingle();
  return settings?.meta_access_token ?? Deno.env.get("META_ACCESS_TOKEN") ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Unauthorized", accounts: [] }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
        Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) {
      return jsonResponse({ error: "Unauthorized", accounts: [] }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const excludeRaw: string[] = Array.isArray(body.exclude_act_ids)
      ? body.exclude_act_ids
      : [];
    const exclude = excludeRaw.map((x) => normalizeActId(String(x)));

    const token = await resolveMetaToken(
      typeof body.access_token === "string" ? body.access_token : null,
    );
    if (!token) {
      return jsonResponse({
        error: "Meta access token не настроен. Укажите токен в Настройках → Автоматизация или в поле ниже.",
        accounts: [],
      }, 400);
    }

    const fetched = await fetchAllMetaAdAccounts(token);
    const accounts = mapAdAccounts(fetched.rows, exclude);
    return jsonResponse({
      ok: true,
      accounts,
      meta_hint: fetched.meta_hint,
      token_identity: fetched.token_identity,
      sources: fetched.sources,
      raw_count: fetched.rows.length,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return jsonResponse({ error: msg, accounts: [] }, 500);
  }
});
