// deno-lint-ignore-file no-explicit-any
// Общая логика "сохранить выбранную страницу + рекламный кабинет" —
// используется и при автоподключении (ровно 1 страница/кабинет), и после
// явного выбора пользователя в facebook-oauth-finish.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const GRAPH = "https://graph.facebook.com/v21.0";

export type FbPage = {
  id: string;
  name: string;
  access_token: string;
  // Preview-only, filled in by facebook-oauth-callback so the picker can show
  // which page already has an Instagram account attached — connectPageAndAdAccount
  // always re-fetches this itself and does not read it.
  instagram?: { id: string; username?: string; profile_picture_url?: string } | null;
};
export type FbAdAccount = { id: string; name: string; currency?: string; business?: { id: string; name: string } };

async function upsertProjectMetaToken(
  admin: ReturnType<typeof createClient>,
  projectId: string,
  userToken: string,
  userId?: string | null,
) {
  await admin
    .from("meta_tokens")
    .update({ is_active: false })
    .eq("project_id", projectId)
    .eq("is_active", true);

  const { error } = await admin.from("meta_tokens").insert({
    project_id: projectId,
    label: "Facebook OAuth",
    access_token: userToken,
    is_active: true,
    created_by: userId ?? null,
    last_validated_at: new Date().toISOString(),
    last_validation_status: "ok: facebook oauth",
  });
  if (error) {
    console.error("[facebookConnect] meta_tokens insert:", error.message);
    throw new Error(`Не удалось сохранить Meta-токен: ${error.message}`);
  }
}

export async function connectPageAndAdAccount(
  supa: ReturnType<typeof createClient>,
  projectId: string,
  userToken: string,
  page: FbPage,
  adAccount: FbAdAccount | null,
  opts?: { userId?: string | null },
): Promise<string> {
  const igRes = await fetch(
    `${GRAPH}/${page.id}?fields=instagram_business_account{id,username,name,profile_picture_url,followers_count,follows_count,media_count}&access_token=${page.access_token}`,
  );
  const igJson = await igRes.json();
  if (igJson?.error?.message) {
    const msg = String(igJson.error.message);
    if (/session has been invalidated|validating access token|#190/i.test(msg)) {
      throw new Error(msg);
    }
  }
  const ig = igJson.instagram_business_account as
    | { id: string; username?: string; name?: string; profile_picture_url?: string; followers_count?: number; follows_count?: number; media_count?: number }
    | undefined;

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  // Callers pass service-role client; keep using it for writes.
  const admin = supa;

  // Always persist the fresh long-lived user token for this project —
  // Ads UI / meta-list / validate read meta_tokens before shared fallbacks.
  await upsertProjectMetaToken(admin, projectId, userToken, opts?.userId);

  if (ig?.id) {
    const { error: igErr } = await admin.from("instagram_accounts").upsert({
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
    if (igErr) {
      console.error("[facebookConnect] instagram_accounts:", igErr.message);
      throw new Error(`Не удалось сохранить Instagram: ${igErr.message}`);
    }

    fetch(`${SUPABASE_URL}/functions/v1/instagram-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE}` },
      body: JSON.stringify({ project_id: projectId }),
    }).catch(() => {});

    await fetch(`${GRAPH}/${page.id}/subscribed_apps?subscribed_fields=comments,messages&access_token=${page.access_token}`, { method: "POST" }).catch(() => {});
  }

  if (adAccount) {
    const { data: existing } = await admin
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
      online: true,
    };
    if (opts?.userId) row.created_by = opts.userId;

    if (existing) {
      const { error } = await admin.from("ad_cabinets").update(row).eq("id", (existing as { id: string }).id);
      if (error) {
        console.error("[facebookConnect] ad_cabinets update:", error.message);
        throw new Error(`Не удалось обновить рекламный кабинет: ${error.message}`);
      }
      await mirrorClientConfig(admin, (existing as { id: string }).id, row);
    } else {
      const { data: inserted, error } = await admin.from("ad_cabinets").insert(row).select("id").single();
      if (error) {
        console.error("[facebookConnect] ad_cabinets insert:", error.message);
        throw new Error(`Не удалось сохранить рекламный кабинет: ${error.message}`);
      }
      await mirrorClientConfig(admin, (inserted as { id: string }).id, row);
    }
  }

  return [
    `страница «${page.name}»`,
    ig?.username ? `Instagram @${ig.username}` : "без привязанного Instagram",
    adAccount ? `кабинет «${adAccount.name}»` : "без рекламного кабинета",
  ].join(", ");
}

async function mirrorClientConfig(
  _admin: ReturnType<typeof createClient>,
  cabinetId: string,
  row: Record<string, unknown>,
) {
  const token = typeof row.access_token === "string" && row.access_token.trim()
    ? row.access_token.trim()
    : null;
  await upsertClientConfig(toClientConfigRow(cabinetId, row, token));
}

