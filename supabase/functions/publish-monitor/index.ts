/**
 * Сторож контура публикаций: токены и аварийные аккаунты.
 *
 *   { mode: "tokens" } — крон раз в сутки. Проверяет живость токена каждого
 *     активного аккаунта, помечает мёртвые token_expired и присылает в
 *     Telegram список тех, кого надо переподключить.
 *   { mode: "errors" } — крон каждые 15 минут. Аккаунт с серией отказов
 *     гасится (status=error, publish_enabled=false), чтобы очередь не долбила
 *     площадку и не копила бан.
 *
 * Пороги здесь, а не в SQL: их меняют по опыту эксплуатации.
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { requireUser, userHasAnyRole } from "../_lib/auth.ts";
import {
  automationKeyValid,
  CORS_HEADERS,
  decryptSecret,
  json,
  notifyProject,
  type PublishAccount,
} from "../_lib/publishing.ts";

/** Сколько отказов подряд считаем поломкой аккаунта, а не невезением. */
const ERROR_STREAK_LIMIT = 3;
/** За сколько дней до истечения токена начинаем предупреждать. */
const TOKEN_WARN_DAYS = 7;

const GRAPH_IG = "https://graph.instagram.com/v21.0";
const GRAPH_FB = "https://graph.facebook.com/v21.0";

/** Живость токена: самый дешёвый вызов графа от имени аккаунта. */
async function instagramTokenAlive(
  externalId: string,
  token: string,
): Promise<{ alive: boolean; reason?: string }> {
  const graph = /^IG/i.test(token) ? GRAPH_IG : GRAPH_FB;
  try {
    const res = await fetch(`${graph}/${externalId}?fields=id&access_token=${token}`);
    const body = await res.json().catch(() => ({}));
    if (body?.error) {
      const code = body.error.code;
      // Мёртвым считаем только отказ авторизации: 4/17/32 — это лимиты, токен жив.
      if (code === 190 || code === 102 || code === 10 || code === 200) {
        return { alive: false, reason: body.error.message as string };
      }
      return { alive: true };
    }
    return { alive: Boolean(body?.id) };
  } catch {
    // Сеть не ответила — это не повод объявлять токен мёртвым.
    return { alive: true };
  }
}

async function checkTokens(admin: SupabaseClient) {
  const { data } = await admin.from("publish_accounts")
    .select("*").in("status", ["active", "limited"]);
  const accounts = (data ?? []) as PublishAccount[];

  const dead: PublishAccount[] = [];
  const expiring: PublishAccount[] = [];
  const soon = Date.now() + TOKEN_WARN_DAYS * 86_400_000;

  for (const account of accounts) {
    if (account.token_expires_at && new Date(account.token_expires_at).getTime() < soon) {
      expiring.push(account);
    }
    if (account.platform !== "instagram") continue; // остальные площадки — по мере подключения

    let token: string | null = null;
    try { token = await decryptSecret(account.access_token_encrypted); } catch { token = null; }
    if (!token) { dead.push(account); continue; }

    const alive = await instagramTokenAlive(account.external_account_id, token);
    if (!alive.alive) dead.push(account);
  }

  for (const account of dead) {
    await admin.from("publish_accounts").update({
      status: "token_expired",
      last_error: "токен не проходит проверку — нужен reconnect",
    }).eq("id", account.id);
  }

  // Одно сообщение на проект, а не на аккаунт: иначе при массовом протухании
  // токенов чат превращается в свалку.
  const byProject = new Map<string, string[]>();
  for (const account of dead) {
    const list = byProject.get(account.project_id) ?? [];
    list.push(`${account.account_name} (${account.platform})`);
    byProject.set(account.project_id, list);
  }
  for (const [projectId, names] of byProject) {
    await notifyProject(
      admin, projectId,
      `🔑 Требуется переподключение аккаунтов (${names.length}):\n• ${names.join("\n• ")}\n\nПубликации в них поставлены на паузу.`,
    );
  }

  return {
    checked: accounts.length,
    token_expired: dead.length,
    expiring_soon: expiring.length,
    accounts: dead.map((a) => ({ id: a.id, account_name: a.account_name, platform: a.platform })),
  };
}

async function checkErrors(admin: SupabaseClient) {
  const { data } = await admin.from("publish_accounts")
    .select("*")
    .gte("consecutive_errors", ERROR_STREAK_LIMIT)
    .eq("status", "active");
  const broken = (data ?? []) as PublishAccount[];

  for (const account of broken) {
    await admin.from("publish_accounts").update({
      status: "error",
      publish_enabled: false,
    }).eq("id", account.id);
    await notifyProject(
      admin, account.project_id,
      `🛑 Аккаунт «${account.account_name}» (${account.platform}) отключён от публикаций: ${account.consecutive_errors} ошибок подряд.\nПоследняя: ${account.last_error ?? "—"}`,
    );
  }

  // Заодно показываем, сколько заданий ждёт ручного разбора.
  const { count } = await admin.from("publish_jobs")
    .select("id", { count: "exact", head: true }).eq("status", "manual_review");

  return {
    disabled: broken.length,
    manual_review: count ?? 0,
    accounts: broken.map((a) => ({ id: a.id, account_name: a.account_name, errors: a.consecutive_errors })),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  if (!(await automationKeyValid(req, admin))) {
    const auth = await requireUser(req);
    if (!auth.ok) return json({ error: "unauthorized" }, 401);
    if (!(await userHasAnyRole(auth.userId, ["admin", "manager"]))) {
      return json({ error: "forbidden" }, 403);
    }
  }

  const body = await req.json().catch(() => ({}));
  const mode = String(body?.mode ?? "errors");

  if (mode === "tokens") return json({ ok: true, mode, ...(await checkTokens(admin)) });
  if (mode === "errors") return json({ ok: true, mode, ...(await checkErrors(admin)) });
  return json({ error: `неизвестный режим: ${mode}` }, 400);
});
