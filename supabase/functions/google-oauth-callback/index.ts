// Шаг 2 подключения Google Ads: сюда Google редиректит с ?code&state.
// Меняем code на refresh_token, сохраняем подключение проекта, пытаемся
// перечислить доступные Google Ads customer-аккаунты и:
//   • ровно один аккаунт → сразу создаём кабинет (ad_cabinets, provider='google');
//   • несколько → откладываем выбор (google_oauth_pending_selections),
//     завершает google-oauth-finish;
//   • developer-token не задан / список недоступен → подключение (токен)
//     сохранено, кабинет попросим указать позже.
// Публичный эндпоинт (verify_jwt=false): доверие — одноразовый state.
//
// Как и facebook-oauth-callback, результат возвращаем 302-редиректом на
// return_url с ?google_connected / ?google_error / ?google_select — фронтенд
// (реальная страница) форвардит его открывшему окну через postMessage.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const STATE_TTL_MS = 15 * 60_000;
const ADS_API = "https://googleads.googleapis.com/v18";

function normalizeCustomerId(id: string): string {
  return id.replace(/^customers\//i, "").replace(/[^0-9]/g, "");
}

function finish(returnUrl: string, param: string) {
  const sep = returnUrl.includes("?") ? "&" : "?";
  return new Response(null, { status: 302, headers: { Location: `${returnUrl}${sep}${param}` } });
}
function errRedirect(returnUrl: string, msg: string) {
  return finish(returnUrl, `google_error=${encodeURIComponent(msg)}`);
}

async function fetchAccessToken(code: string, redirectUri: string): Promise<Record<string, unknown>> {
  const params = new URLSearchParams({
    code,
    client_id: Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") ?? "",
    client_secret: Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET") ?? "",
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error_description ?? data?.error ?? `token exchange ${r.status}`);
  return data;
}

async function fetchEmail(accessToken: string): Promise<string | null> {
  try {
    const r = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) return null;
    const j = await r.json();
    return (j?.email as string) ?? null;
  } catch { return null; }
}

// Список customer-аккаунтов, к которым есть доступ. Требует developer-token.
async function listAccessibleCustomers(accessToken: string): Promise<string[]> {
  const devToken = Deno.env.get("GOOGLE_ADS_DEVELOPER_TOKEN");
  if (!devToken) return [];
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": devToken,
  };
  const login = Deno.env.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID");
  if (login) headers["login-customer-id"] = normalizeCustomerId(login);
  const r = await fetch(`${ADS_API}/customers:listAccessibleCustomers`, { headers });
  if (!r.ok) return [];
  const j = await r.json();
  const names = (j?.resourceNames as string[]) ?? [];
  return names.map(normalizeCustomerId).filter(Boolean);
}

// Имя аккаунта (best-effort) — чтобы в списке было понятнее, чем просто id.
async function fetchCustomerName(accessToken: string, customerId: string): Promise<string | null> {
  const devToken = Deno.env.get("GOOGLE_ADS_DEVELOPER_TOKEN");
  if (!devToken) return null;
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": devToken,
      "Content-Type": "application/json",
    };
    const login = Deno.env.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID");
    if (login) headers["login-customer-id"] = normalizeCustomerId(login);
    const r = await fetch(`${ADS_API}/customers/${customerId}/googleAds:searchStream`, {
      method: "POST",
      headers,
      body: JSON.stringify({ query: "SELECT customer.descriptive_name, customer.currency_code FROM customer LIMIT 1" }),
    });
    if (!r.ok) return null;
    const batches = (await r.json()) as Array<{ results?: Array<{ customer?: { descriptiveName?: string } }> }>;
    for (const b of batches) for (const row of b.results ?? []) {
      if (row.customer?.descriptiveName) return row.customer.descriptiveName;
    }
    return null;
  } catch { return null; }
}

async function ensureCabinet(
  supa: ReturnType<typeof createClient>,
  projectId: string,
  createdBy: string,
  customerId: string,
  name: string | null,
): Promise<void> {
  const external = normalizeCustomerId(customerId);
  const { data: existing } = await supa.from("ad_cabinets")
    .select("id").eq("project_id", projectId).eq("provider", "google").eq("external_id", external).maybeSingle();
  if (existing) return;
  await supa.from("ad_cabinets").insert({
    project_id: projectId,
    provider: "google",
    external_id: external,
    ad_account_id: external,
    name: name ?? `Google Ads — ${external}`,
    type: "Личный",
    currency: "KZT",
    created_by: createdBy,
  });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateId = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);

  if (!stateId) return new Response("Missing state", { status: 400 });

  // Загружаем и сразу удаляем state (одноразовый).
  const { data: state } = await supa.from("google_oauth_states")
    .select("project_id, user_id, return_url, created_at").eq("id", stateId).maybeSingle();
  await supa.from("google_oauth_states").delete().eq("id", stateId);

  if (!state) return new Response("Invalid or expired state", { status: 400 });
  const st = state as { project_id: string; user_id: string; return_url: string; created_at: string };
  const returnUrl = st.return_url;

  if (Date.now() - new Date(st.created_at).getTime() > STATE_TTL_MS) {
    return errRedirect(returnUrl, "Ссылка авторизации устарела, начните заново");
  }
  if (oauthError) return errRedirect(returnUrl, oauthError);
  if (!code) return errRedirect(returnUrl, "no_code");

  try {
    const redirectUri = `${SUPABASE_URL}/functions/v1/google-oauth-callback`;
    const tok = await fetchAccessToken(code, redirectUri);
    const refreshToken = tok.refresh_token as string | undefined;
    const accessToken = tok.access_token as string | undefined;
    const scope = (tok.scope as string) ?? null;
    if (!refreshToken) {
      return errRedirect(returnUrl, "Google не вернул refresh_token — переподключитесь (prompt=consent)");
    }

    const email = accessToken ? await fetchEmail(accessToken) : null;
    const loginCustomerId = Deno.env.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID") ?? null;

    // Сохраняем/обновляем подключение проекта (токен — только на сервере).
    await supa.from("google_ads_connections").upsert({
      project_id: st.project_id,
      refresh_token: refreshToken,
      login_customer_id: loginCustomerId,
      google_email: email,
      scope,
      created_by: st.user_id,
      updated_at: new Date().toISOString(),
    }, { onConflict: "project_id" });

    const customers = accessToken ? await listAccessibleCustomers(accessToken) : [];

    if (customers.length === 0) {
      // Токен сохранён, но кабинеты не перечислены (нет developer-token или
      // доступа). Фронт попросит указать customer id позже / через intake.
      return finish(returnUrl, `google_connected=${encodeURIComponent(
        email ? `Google подключён (${email}). Укажите рекламный аккаунт.` : "Google подключён. Укажите рекламный аккаунт.",
      )}`);
    }

    if (customers.length === 1) {
      const name = accessToken ? await fetchCustomerName(accessToken, customers[0]) : null;
      await ensureCabinet(supa, st.project_id, st.user_id, customers[0], name);
      return finish(returnUrl, `google_connected=${encodeURIComponent(
        `Google Ads: ${name ?? customers[0]}`,
      )}`);
    }

    // Несколько аккаунтов — откладываем выбор.
    const accounts: Array<{ id: string; name: string }> = [];
    for (const c of customers.slice(0, 50)) {
      const name = accessToken ? await fetchCustomerName(accessToken, c) : null;
      accounts.push({ id: c, name: name ?? c });
    }
    const { data: pending } = await supa.from("google_oauth_pending_selections").insert({
      project_id: st.project_id,
      user_id: st.user_id,
      refresh_token: refreshToken,
      login_customer_id: loginCustomerId,
      google_email: email,
      accounts,
    }).select("id").single();

    return finish(returnUrl, `google_select=${encodeURIComponent(JSON.stringify({
      selectionId: pending?.id, accounts,
    }))}`);
  } catch (e) {
    return errRedirect(returnUrl, e instanceof Error ? e.message : "unknown");
  }
});
