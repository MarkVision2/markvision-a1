/**
 * Подключение и обслуживание аккаунтов площадок для очереди публикаций.
 *
 * Онбординг Instagram по ТЗ: аккаунт переведён в Business/Creator и привязан к
 * Facebook-странице → пользователь один раз проходит Meta OAuth (существующие
 * facebook-oauth-*) → здесь он выбирает пачку страниц, и мы сохраняем
 * ig_user_id + page-токен (шифротекстом). Дальше руками не трогаем ничего.
 *
 *   { action: "available",  project_id }                     — что можно подключить
 *   { action: "connect",    project_id, page_ids: [...] }    — подключить пачкой
 *   { action: "list",       project_id }                     — что подключено
 *   { action: "update",     account_id, ... }                — вкл/выкл, лимит, статус
 *   { action: "disconnect", account_id }                     — отключить
 *
 * Группы («залить во все клиники») — тот же endpoint:
 *   { action: "group_list",   project_id }
 *   { action: "group_upsert", project_id, id?, name, account_ids, platform?, publish_strategy?, per_hour? }
 *   { action: "group_delete", group_id }
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { requireProjectAccess, requireUser } from "../_lib/auth.ts";
import { resolveMetaAccessToken } from "../_lib/metaToken.ts";
import {
  automationKeyValid,
  CORS_HEADERS,
  encryptSecret,
  isPlatform as isPlatformName,
  json,
  tokenKeyConfigured,
} from "../_lib/publishing.ts";

const GRAPH = "https://graph.facebook.com/v21.0";

interface IgBusinessAccount {
  id: string;
  username?: string;
  name?: string;
}

interface MetaPage {
  id: string;
  name?: string;
  access_token?: string;
  instagram_business_account?: IgBusinessAccount;
}

async function metaPages(token: string): Promise<{ pages: MetaPage[]; error?: string }> {
  const res = await fetch(
    `${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username,name}&limit=200&access_token=${token}`,
  );
  const body = await res.json().catch(() => ({}));
  if (body?.error) return { pages: [], error: body.error.message as string };
  return { pages: (body?.data ?? []) as MetaPage[] };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const body = await req.json().catch(() => ({}));
  const action = String(body?.action ?? "list");
  const projectId = body?.project_id ? String(body.project_id) : null;

  // Скриптовый онбординг ходит с ключом автоматизации, интерфейс — под пользователем.
  const viaAutomation = await automationKeyValid(req, admin);
  if (!viaAutomation) {
    const auth = await requireUser(req);
    if (!auth.ok) return json({ error: "unauthorized" }, 401);

    // Действия по аккаунту проверяем через проект, которому он принадлежит.
    let scopeProject = projectId;
    if (!scopeProject && body?.group_id) {
      const { data } = await admin
        .from("publish_account_groups").select("project_id").eq("id", String(body.group_id)).maybeSingle();
      scopeProject = (data as { project_id?: string } | null)?.project_id ?? null;
    }
    if (!scopeProject && body?.account_id) {
      const { data } = await admin
        .from("publish_accounts").select("project_id").eq("id", String(body.account_id)).maybeSingle();
      scopeProject = (data as { project_id?: string } | null)?.project_id ?? null;
    }
    if (!scopeProject) return json({ error: "project_id обязателен" }, 400);
    const access = await requireProjectAccess(auth.authHeader, scopeProject);
    if (!access.ok) return access.response;
  }

  try {
    if (action === "list") {
      if (!projectId) return json({ error: "project_id обязателен" }, 400);
      const { data, error } = await admin.from("publish_accounts")
        .select(
          "id, platform, account_name, handle, external_account_id, fb_page_id, status, publish_enabled, daily_limit, last_post_at, consecutive_errors, last_error, token_expires_at",
        )
        .eq("project_id", projectId).order("platform").order("account_name");
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, accounts: data ?? [] });
    }

    if (action === "available") {
      if (!projectId) return json({ error: "project_id обязателен" }, 400);
      const token = await resolveMetaAccessToken({
        admin, projectId, bodyToken: typeof body?.meta_token === "string" ? body.meta_token : null,
      });
      if (!token) {
        return json({
          error: "Meta-токен не найден. Подключите Facebook в Настройках → Meta или передайте meta_token.",
        }, 400);
      }
      const { pages, error } = await metaPages(token);
      if (error) return json({ error }, 400);

      // Уже подключённые помечаем, чтобы интерфейс не предлагал их снова.
      const { data: existing } = await admin.from("publish_accounts")
        .select("external_account_id").eq("project_id", projectId).eq("platform", "instagram");
      const connected = new Set(((existing ?? []) as { external_account_id: string }[]).map((r) => r.external_account_id));

      return json({
        ok: true,
        pages: pages.map((p) => ({
          page_id: p.id,
          page_name: p.name ?? null,
          ig_user_id: p.instagram_business_account?.id ?? null,
          ig_username: p.instagram_business_account?.username ?? null,
          ig_name: p.instagram_business_account?.name ?? null,
          // Страница без Business/Creator-аккаунта публиковать не может.
          connectable: Boolean(p.instagram_business_account?.id),
          already_connected: connected.has(p.instagram_business_account?.id ?? ""),
        })),
      });
    }

    if (action === "connect") {
      if (!projectId) return json({ error: "project_id обязателен" }, 400);
      if (!tokenKeyConfigured()) {
        return json({ error: "PUBLISH_TOKEN_KEY не задан в секретах Supabase — токены сохранять некуда" }, 500);
      }
      const pageIds = (Array.isArray(body?.page_ids) ? body.page_ids : []).map(String);
      if (!pageIds.length) return json({ error: "page_ids обязателен" }, 400);

      const token = await resolveMetaAccessToken({
        admin, projectId, bodyToken: typeof body?.meta_token === "string" ? body.meta_token : null,
      });
      if (!token) return json({ error: "Meta-токен не найден" }, 400);

      const { pages, error } = await metaPages(token);
      if (error) return json({ error }, 400);

      const connected: unknown[] = [];
      const skipped: unknown[] = [];

      for (const pageId of pageIds) {
        const page = pages.find((p) => p.id === pageId);
        if (!page) { skipped.push({ page_id: pageId, reason: "страница вне охвата токена" }); continue; }
        const ig = page.instagram_business_account;
        if (!ig?.id) { skipped.push({ page_id: pageId, reason: "к странице не привязан Instagram Business/Creator" }); continue; }
        if (!page.access_token) { skipped.push({ page_id: pageId, reason: "Meta не отдала page-токен" }); continue; }

        const { data, error: upsertError } = await admin.from("publish_accounts").upsert({
          project_id: projectId,
          platform: "instagram",
          account_name: ig.name ?? ig.username ?? page.name ?? "Instagram",
          handle: ig.username ?? null,
          external_account_id: ig.id,
          fb_page_id: page.id,
          access_token_encrypted: await encryptSecret(page.access_token),
          status: "active",
          publish_enabled: true,
          consecutive_errors: 0,
          last_error: null,
        }, { onConflict: "project_id,platform,external_account_id" })
          .select("id, account_name, handle").maybeSingle();

        if (upsertError) skipped.push({ page_id: pageId, reason: upsertError.message });
        else connected.push(data);
      }

      return json({ ok: true, connected, skipped });
    }

    if (action === "update") {
      const accountId = String(body?.account_id ?? "");
      if (!accountId) return json({ error: "account_id обязателен" }, 400);

      const patch: Record<string, unknown> = {};
      if (typeof body?.publish_enabled === "boolean") patch.publish_enabled = body.publish_enabled;
      if (typeof body?.daily_limit === "number") patch.daily_limit = Math.min(Math.max(body.daily_limit, 0), 200);
      if (typeof body?.account_name === "string") patch.account_name = body.account_name;
      if (typeof body?.notes === "string") patch.notes = body.notes;
      if (typeof body?.status === "string") {
        const allowed = ["active", "token_expired", "limited", "error", "disabled"];
        if (!allowed.includes(body.status)) return json({ error: `недопустимый статус: ${body.status}` }, 400);
        patch.status = body.status;
        // Возврат в строй — обнуляем серию ошибок, иначе монитор погасит снова.
        if (body.status === "active") { patch.consecutive_errors = 0; patch.last_error = null; }
      }
      if (!Object.keys(patch).length) return json({ error: "нечего менять" }, 400);

      const { data, error } = await admin.from("publish_accounts")
        .update(patch).eq("id", accountId)
        .select("id, account_name, status, publish_enabled, daily_limit").maybeSingle();
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, account: data });
    }

    /* ── группы аккаунтов ── */

    if (action === "group_list") {
      if (!projectId) return json({ error: "project_id обязателен" }, 400);
      const { data, error } = await admin.from("publish_account_groups")
        .select("*").eq("project_id", projectId).order("name");
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, groups: data ?? [] });
    }

    if (action === "group_upsert") {
      if (!projectId) return json({ error: "project_id обязателен" }, 400);
      const name = typeof body?.name === "string" ? body.name.trim() : "";
      if (!name) return json({ error: "name обязателен" }, 400);
      const accountIds = (Array.isArray(body?.account_ids) ? body.account_ids : []).map(String);

      // Группа не должна тянуть чужие аккаунты: сверяем принадлежность проекту.
      if (accountIds.length) {
        const { data: own } = await admin.from("publish_accounts")
          .select("id").eq("project_id", projectId).in("id", accountIds);
        const known = new Set(((own ?? []) as { id: string }[]).map((r) => r.id));
        const alien = accountIds.filter((id: string) => !known.has(id));
        if (alien.length) return json({ error: `аккаунты не из этого проекта: ${alien.join(", ")}` }, 400);
      }

      const row: Record<string, unknown> = {
        project_id: projectId,
        name,
        account_ids: accountIds,
        platform: isPlatformName(body?.platform) ? body.platform : null,
      };
      if (typeof body?.publish_strategy === "string") {
        const allowed = ["all_at_once", "drip", "daily"];
        if (!allowed.includes(body.publish_strategy)) {
          return json({ error: `недопустимая стратегия: ${body.publish_strategy}` }, 400);
        }
        row.publish_strategy = body.publish_strategy;
      }
      if (typeof body?.per_hour === "number") row.per_hour = Math.min(Math.max(body.per_hour, 1), 120);
      if (typeof body?.id === "string") row.id = body.id;

      const { data, error } = await admin.from("publish_account_groups")
        .upsert(row).select("*").maybeSingle();
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, group: data });
    }

    if (action === "group_delete") {
      const groupId = String(body?.group_id ?? "");
      if (!groupId) return json({ error: "group_id обязателен" }, 400);
      const { error } = await admin.from("publish_account_groups").delete().eq("id", groupId);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    if (action === "disconnect") {
      const accountId = String(body?.account_id ?? "");
      if (!accountId) return json({ error: "account_id обязателен" }, 400);
      const { error } = await admin.from("publish_accounts").delete().eq("id", accountId);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    return json({ error: `неизвестное действие: ${action}` }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
