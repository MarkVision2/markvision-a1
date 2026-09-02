// Connect / refresh Instagram via Instagram Login token (graph.instagram.com).
// Does NOT require a Facebook Page–linked Business account — paste the token
// from Meta App Dashboard → Instagram → Generate token for @account.
//
// Also used to attach/replace ig_login_access_token on an already Page-linked row
// (DM sending on this Meta app only works through Instagram Login).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser, requireProjectAccess } from "../_lib/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GRAPH_IG = "https://graph.instagram.com/v21.0";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type IgMe = {
  user_id?: string;
  id?: string;
  username?: string;
  name?: string;
  profile_picture_url?: string;
  followers_count?: number;
  follows_count?: number;
  media_count?: number;
  error?: { message?: string };
};

async function fetchIgMe(token: string): Promise<{ ok: true; me: IgMe } | { ok: false; error: string }> {
  const fields = "user_id,username,name,profile_picture_url,followers_count,follows_count,media_count";
  const res = await fetch(
    `${GRAPH_IG}/me?fields=${fields}&access_token=${encodeURIComponent(token)}`,
  );
  const body = (await res.json().catch(() => ({}))) as IgMe;
  if (!res.ok || body.error) {
    return { ok: false, error: body.error?.message ?? "Токен недействителен" };
  }
  return { ok: true, me: body };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = await requireUser(req);
    if (!auth.ok) return auth.response;

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const projectId = String(body?.project_id ?? "");
    const token = String(body?.token ?? "").trim();
    // connect=true (default): upsert full account from Instagram Login token.
    // connect=false: only update ig_login_access_token on an existing row (legacy).
    const connect = body?.connect === false ? false : true;

    if (!projectId) return json({ error: "project_id обязателен" }, 400);
    if (!token) return json({ error: "token обязателен" }, 400);

    const access = await requireProjectAccess(auth.authHeader, projectId);
    if (!access.ok) return access.response;

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supa = createClient(SUPABASE_URL, SERVICE_ROLE);

    const checked = await fetchIgMe(token);
    if (!checked.ok) return json({ error: checked.error }, 400);
    const me = checked.me;
    const igUserId = String(me.user_id ?? me.id ?? "");
    if (!igUserId) return json({ error: "В токене нет user_id Instagram" }, 400);

    const { data: existing } = await supa
      .from("instagram_accounts")
      .select("ig_user_id, page_id, page_access_token, page_name")
      .eq("project_id", projectId)
      .maybeSingle();

    if (!connect) {
      if (!existing?.ig_user_id) {
        return json({ error: "Instagram аккаунт не подключён к проекту — включите connect" }, 404);
      }
      if (String(existing.ig_user_id) !== igUserId) {
        return json({
          error: `Токен выдан для @${me.username ?? igUserId}, а в проекте подключён другой аккаунт`,
        }, 400);
      }
      const { error } = await supa
        .from("instagram_accounts")
        .update({ ig_login_access_token: token, last_error: null, active: true })
        .eq("project_id", projectId);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, username: me.username ?? null, connected: false });
    }

    // Full connect / reconnect via Instagram Login (no Facebook Page required).
    if (existing?.ig_user_id && existing.ig_user_id !== igUserId) {
      await Promise.all([
        supa.from("instagram_media").delete().eq("project_id", projectId).neq("ig_user_id", igUserId),
        supa.from("instagram_account_daily").delete().eq("project_id", projectId).neq("ig_user_id", igUserId),
        supa.from("instagram_demographics").delete().eq("project_id", projectId).neq("ig_user_id", igUserId),
      ]);
    }

    const keepPageId = existing?.page_id && existing.ig_user_id === igUserId ? existing.page_id : null;
    const keepPageToken =
      existing?.page_access_token && existing.ig_user_id === igUserId ? existing.page_access_token : null;
    const keepPageName =
      existing?.page_name && existing.ig_user_id === igUserId ? existing.page_name : "Instagram Login";

    const { error: upErr } = await supa.from("instagram_accounts").upsert(
      {
        project_id: projectId,
        ig_user_id: igUserId,
        username: me.username ?? null,
        name: me.name ?? null,
        profile_picture_url: me.profile_picture_url ?? null,
        page_id: keepPageId,
        page_name: keepPageName,
        // Prefer existing Page token for Graph FB insights; otherwise reuse login token
        // so sync/webhook have *some* bearer (graph.instagram.com path).
        page_access_token: keepPageToken ?? token,
        ig_login_access_token: token,
        followers_count: me.followers_count ?? 0,
        follows_count: me.follows_count ?? 0,
        media_count: me.media_count ?? 0,
        active: true,
        last_error: null,
        last_sync_at: new Date().toISOString(),
      },
      { onConflict: "project_id" },
    );
    if (upErr) return json({ error: upErr.message }, 500);

    // Subscribe this IG account to comment/message webhooks (Instagram Login path).
    // Without this, codeword auto-replies never fire for page-less accounts.
    await fetch(
      `${GRAPH_IG}/${encodeURIComponent(igUserId)}/subscribed_apps?subscribed_fields=comments,live_comments,messages,messaging_postbacks,messaging_referral,messaging_seen,standby&access_token=${encodeURIComponent(token)}`,
      { method: "POST" },
    ).catch(() => {});

    // Fire-and-forget metrics sync
    fetch(`${SUPABASE_URL}/functions/v1/instagram-sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE}`,
      },
      body: JSON.stringify({ project_id: projectId }),
    }).catch(() => {});

    return json({
      ok: true,
      username: me.username ?? null,
      ig_user_id: igUserId,
      connected: true,
      via: "instagram_login",
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});
