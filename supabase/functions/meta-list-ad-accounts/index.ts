import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { resolveMetaAccessToken } from "../_lib/metaToken.ts";
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

function humanizeTokenError(raw: string): string {
  if (/session has been invalidated|validating access token|#190|expired/i.test(raw)) {
    return (
      "Токен Meta истёк или сброшен (смена пароля / сессии Facebook). "
      + "Откройте Настройки → Meta и переподключите Facebook."
    );
  }
  return raw;
}

async function callerHasAdminOrManager(userId: string): Promise<boolean> {
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["admin", "manager"]);
  return (data ?? []).length > 0;
}

async function resolveTokenFromTokenId(tokenId: string): Promise<string | null> {
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data } = await admin
    .from("meta_tokens")
    .select("access_token")
    .eq("id", tokenId)
    .maybeSingle();
  const t = (data as { access_token?: string | null } | null)?.access_token;
  return t?.trim() || null;
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

    const bodyToken = typeof body.access_token === "string" ? body.access_token : null;
    const projectId = typeof body.project_id === "string" ? body.project_id : null;
    const tokenId = typeof body.token_id === "string" ? body.token_id : null;
    const allowSharedFallback = await callerHasAdminOrManager(user.id);

    let token: string | null = null;
    if (bodyToken?.trim()) {
      token = bodyToken.trim();
    } else if (tokenId) {
      token = await resolveTokenFromTokenId(tokenId);
    } else if (projectId) {
      const admin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const { data: projectToken } = await admin
        .from("meta_tokens")
        .select("access_token")
        .eq("project_id", projectId)
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      token = (projectToken as { access_token?: string | null } | null)?.access_token?.trim() || null;
      if (!token && allowSharedFallback) {
        token = await resolveMetaAccessToken({ bodyToken: null });
      }
    } else if (allowSharedFallback) {
      token = await resolveMetaAccessToken({ bodyToken: null });
    }

    if (!token) {
      return jsonResponse({
        error: projectId
          ? "Нет активного Meta-токена у проекта. Откройте Настройки → Meta и переподключите Facebook."
          : allowSharedFallback
          ? "Meta access token не настроен. Укажите токен в Настройках → Автоматизация или в поле ниже."
          : "Meta access token не передан. Переподключите Facebook в Настройки → Meta или вставьте User Access Token.",
        accounts: [],
      }, 400);
    }

    const fetched = await fetchAllMetaAdAccounts(token);
    if (fetched.meta_hint && /session has been invalidated|validating access token|#190/i.test(fetched.meta_hint)) {
      return jsonResponse({
        error: humanizeTokenError(fetched.meta_hint),
        accounts: [],
        code: 190,
      }, 401);
    }

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
    return jsonResponse({ error: humanizeTokenError(msg), accounts: [] }, 500);
  }
});
