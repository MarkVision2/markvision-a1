// deno-lint-ignore-file no-explicit-any
// Шаг 2 входа через Facebook: сюда Meta редиректит браузер с ?code&state.
// Обменивает code на долгоживущий токен, забирает страницу + Instagram +
// рекламный кабинет и сохраняет всё сразу — без ручного выбора и вставки
// токенов. Публичный эндпоинт (verify_jwt=false): Meta не шлёт наш JWT,
// доверие обеспечивается одноразовым state из meta_oauth_states.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const META_APP_ID = "943753324681398";
const GRAPH = "https://graph.facebook.com/v21.0";
const STATE_TTL_MS = 15 * 60_000;

function redirect(url: string) {
  return new Response(null, { status: 302, headers: { Location: url } });
}

function withParam(url: string, key: string, value: string) {
  const u = new URL(url);
  u.searchParams.set(key, value);
  return u.toString();
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error_description") ?? url.searchParams.get("error");

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const APP_SECRET = Deno.env.get("META_APP_SECRET");
  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);

  if (!state) return new Response("Missing state", { status: 400 });

  const { data: stateRow } = await supa
    .from("meta_oauth_states")
    .select("project_id, user_id, return_url, created_at")
    .eq("id", state)
    .maybeSingle();
  // One-time use: delete immediately, whatever happens next.
  await supa.from("meta_oauth_states").delete().eq("id", state);

  if (!stateRow) return new Response("Unknown or already used state", { status: 400 });
  const { project_id: projectId, return_url: returnUrl } = stateRow as { project_id: string; return_url: string; created_at: string };

  if (Date.now() - new Date((stateRow as any).created_at).getTime() > STATE_TTL_MS) {
    return redirect(withParam(returnUrl, "fb_error", "Ссылка авторизации устарела, попробуйте снова"));
  }
  if (oauthError) return redirect(withParam(returnUrl, "fb_error", oauthError));
  if (!code) return redirect(withParam(returnUrl, "fb_error", "Facebook не вернул код авторизации"));
  if (!APP_SECRET) return redirect(withParam(returnUrl, "fb_error", "META_APP_SECRET не настроен на сервере"));

  try {
    const redirectUri = `${SUPABASE_URL}/functions/v1/facebook-oauth-callback`;

    // 1) code -> short-lived user token
    const shortRes = await fetch(
      `${GRAPH}/oauth/access_token?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${APP_SECRET}&code=${encodeURIComponent(code)}`,
    );
    const shortJson = await shortRes.json();
    if (shortJson.error) throw new Error(shortJson.error.message);
    const shortToken = shortJson.access_token as string;

    // 2) short-lived -> long-lived user token
    const longRes = await fetch(
      `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${META_APP_ID}&client_secret=${APP_SECRET}&fb_exchange_token=${encodeURIComponent(shortToken)}`,
    );
    const longJson = await longRes.json();
    const userToken = (longJson.access_token as string) ?? shortToken;

    // 3) pages available to this user token
    const pagesRes = await fetch(`${GRAPH}/me/accounts?fields=id,name,access_token&limit=200&access_token=${userToken}`);
    const pagesJson = await pagesRes.json();
    if (pagesJson.error) throw new Error(pagesJson.error.message);
    const pages = (pagesJson.data ?? []) as { id: string; name: string; access_token: string }[];
    if (pages.length === 0) {
      return redirect(withParam(returnUrl, "fb_error", "У этого Facebook-аккаунта нет ни одной страницы"));
    }
    const page = pages[0];
    const extraPagesNote = pages.length > 1 ? `; ещё ${pages.length - 1} стр. пропущено — подключите вручную при необходимости` : "";

    // 4) ad accounts
    const adsRes = await fetch(`${GRAPH}/me/adaccounts?fields=id,name,account_status,currency,business{id,name}&limit=200&access_token=${userToken}`);
    const adsJson = await adsRes.json();
    const adAccounts = (adsJson.data ?? []) as { id: string; name: string; currency?: string; business?: { id: string; name: string } }[];
    const adAccount = adAccounts[0];

    // 5) Instagram business account linked to the page
    const igRes = await fetch(
      `${GRAPH}/${page.id}?fields=instagram_business_account{id,username,name,profile_picture_url,followers_count,follows_count,media_count}&access_token=${page.access_token}`,
    );
    const igJson = await igRes.json();
    const ig = igJson.instagram_business_account as
      | { id: string; username?: string; name?: string; profile_picture_url?: string; followers_count?: number; follows_count?: number; media_count?: number }
      | undefined;

    if (ig?.id) {
      await supa.from("instagram_accounts").upsert({
        project_id: projectId,
        ig_user_id: ig.id,
        username: ig.username ?? null,
        name: ig.name ?? null,
        profile_picture_url: ig.profile_picture_url ?? null,
        page_id: page.id,
        page_name: page.name,
        page_access_token: page.access_token,
        followers_count: ig.followers_count ?? 0,
        follows_count: ig.follows_count ?? 0,
        media_count: ig.media_count ?? 0,
        active: true,
        last_error: null,
      }, { onConflict: "project_id" });

      fetch(`${SUPABASE_URL}/functions/v1/instagram-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE}` },
        body: JSON.stringify({ project_id: projectId }),
      }).catch(() => {});

      await fetch(`${GRAPH}/${page.id}/subscribed_apps?subscribed_fields=comments,messages&access_token=${page.access_token}`, { method: "POST" }).catch(() => {});
    }

    if (adAccount) {
      const { data: existing } = await supa
        .from("ad_cabinets")
        .select("id")
        .eq("project_id", projectId)
        .eq("ad_account_id", adAccount.id)
        .maybeSingle();
      const row: Record<string, unknown> = {
        project_id: projectId,
        name: adAccount.business?.name || adAccount.name || page.name,
        external_id: adAccount.id,
        ad_account_id: adAccount.id,
        access_token: userToken,
        page_id: page.id,
        page_name: page.name,
        instagram_id: ig?.id ?? null,
        business_id: adAccount.business?.id ?? null,
        currency: adAccount.currency ?? "KZT",
        provider: "meta",
      };
      if (existing) {
        await supa.from("ad_cabinets").update(row).eq("id", (existing as { id: string }).id);
      } else {
        await supa.from("ad_cabinets").insert(row);
      }
    }

    const summary = [
      `страница «${page.name}»${extraPagesNote}`,
      ig?.username ? `Instagram @${ig.username}` : "без привязанного Instagram",
      adAccount ? `кабинет «${adAccount.name}»` : "без рекламного кабинета",
    ].join(", ");
    return redirect(withParam(returnUrl, "fb_connected", summary));
  } catch (e) {
    return redirect(withParam(returnUrl, "fb_error", e instanceof Error ? e.message : "unknown error"));
  }
});
