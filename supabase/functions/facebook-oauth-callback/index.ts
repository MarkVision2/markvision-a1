// deno-lint-ignore-file no-explicit-any
// Шаг 2 входа через Facebook: сюда Meta редиректит попап-окно с ?code&state.
// Обменивает code на долгоживущий токен и забирает список страниц + рекламных
// кабинетов. Если у аккаунта ровно одна страница и максимум один кабинет —
// подключает сразу. Если больше одной страницы или кабинета (агентский
// аккаунт) — не угадывает, а откладывает выбор: сохраняет список в
// meta_oauth_pending_selections и просит пользователя выбрать
// (facebook-oauth-finish завершает подключение по выбору).
//
// Публичный эндпоинт (verify_jwt=false): Meta не шлёт наш JWT, доверие
// обеспечивается одноразовым state из meta_oauth_states.
//
// Результат передаётся родительскому окну через postMessage, после чего
// попап закрывается сам. Если попап заблокирован и открылся как обычная
// вкладка (нет window.opener) — запасной вариант: обычный редирект на
// return_url с ?fb_connected/?fb_error/?fb_select.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { connectPageAndAdAccount, type FbAdAccount, type FbPage } from "../_lib/facebookConnect.ts";

const META_APP_ID = "943753324681398";
const GRAPH = "https://graph.facebook.com/v21.0";
const STATE_TTL_MS = 15 * 60_000;

type Page = FbPage;
type AdAccount = FbAdAccount;

function finish(returnUrl: string, payload: Record<string, unknown>) {
  let targetOrigin = "*";
  try { targetOrigin = new URL(returnUrl).origin; } catch { /* keep "*" */ }
  // needsSelection: carry the (already token-free) pages/adAccounts list in the
  // fallback URL itself — a blocked-popup redirect has no other channel to
  // hand that list back to the page for the picker dialog.
  const fallbackParam = payload.success
    ? payload.needsSelection
      ? `fb_select=${encodeURIComponent(JSON.stringify({
          selectionId: payload.selectionId,
          pages: payload.pages,
          adAccounts: payload.adAccounts,
        }))}`
      : `fb_connected=${encodeURIComponent(String(payload.summary ?? ""))}`
    : `fb_error=${encodeURIComponent(String(payload.error ?? "unknown"))}`;
  const fallbackUrl = `${returnUrl}${returnUrl.includes("?") ? "&" : "?"}${fallbackParam}`;

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Facebook</title></head>
<body style="font-family: system-ui, sans-serif; display:grid; place-items:center; height:100vh; margin:0; color:#666;">
<div>Завершаем подключение…</div>
<script>
(function () {
  var payload = ${JSON.stringify({ source: "fb-oauth", ...payload })};
  var targetOrigin = ${JSON.stringify(targetOrigin)};
  var fallbackUrl = ${JSON.stringify(fallbackUrl)};
  try {
    if (window.opener) {
      window.opener.postMessage(payload, targetOrigin);
      window.close();
      setTimeout(function () {
        document.body.firstElementChild.textContent = "Готово, можно закрыть это окно.";
      }, 300);
      return;
    }
  } catch (e) { /* fall through to redirect */ }
  window.location.href = fallbackUrl;
})();
</script>
</body></html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
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
  const { project_id: projectId, user_id: userId, return_url: returnUrl } = stateRow as {
    project_id: string; user_id: string; return_url: string; created_at: string;
  };

  if (Date.now() - new Date((stateRow as any).created_at).getTime() > STATE_TTL_MS) {
    return finish(returnUrl, { success: false, error: "Ссылка авторизации устарела, попробуйте снова" });
  }
  if (oauthError) return finish(returnUrl, { success: false, error: oauthError });
  if (!code) return finish(returnUrl, { success: false, error: "Facebook не вернул код авторизации" });
  if (!APP_SECRET) return finish(returnUrl, { success: false, error: "META_APP_SECRET не настроен на сервере" });

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
    const pages = (pagesJson.data ?? []) as Page[];
    if (pages.length === 0) {
      return finish(returnUrl, { success: false, error: "У этого Facebook-аккаунта нет ни одной страницы" });
    }

    // 4) ad accounts
    const adsRes = await fetch(`${GRAPH}/me/adaccounts?fields=id,name,account_status,currency,business{id,name}&limit=200&access_token=${userToken}`);
    const adsJson = await adsRes.json();
    const adAccounts = (adsJson.data ?? []) as AdAccount[];

    // Ровно одна страница и максимум один кабинет — подключаем сразу, без выбора.
    if (pages.length === 1 && adAccounts.length <= 1) {
      const summary = await connectPageAndAdAccount(supa, projectId, userToken, pages[0], adAccounts[0] ?? null);
      return finish(returnUrl, { success: true, summary });
    }

    // Иначе — не угадываем: откладываем выбор пользователю.
    const { data: selection, error: selErr } = await supa
      .from("meta_oauth_pending_selections")
      .insert({ project_id: projectId, user_id: userId, user_token: userToken, pages, ad_accounts: adAccounts })
      .select("id")
      .single();
    if (selErr || !selection) throw new Error(selErr?.message ?? "failed to store selection");

    return finish(returnUrl, {
      success: true,
      needsSelection: true,
      selectionId: (selection as { id: string }).id,
      pages: pages.map((p) => ({ id: p.id, name: p.name })),
      adAccounts: adAccounts.map((a) => ({ id: a.id, name: a.business?.name || a.name, currency: a.currency ?? null })),
    });
  } catch (e) {
    return finish(returnUrl, { success: false, error: e instanceof Error ? e.message : "unknown error" });
  }
});
