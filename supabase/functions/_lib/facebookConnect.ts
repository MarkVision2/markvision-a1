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

export async function connectPageAndAdAccount(
  supa: ReturnType<typeof createClient>,
  projectId: string,
  userToken: string,
  page: FbPage,
  adAccount: FbAdAccount | null,
): Promise<string> {
  const igRes = await fetch(
    `${GRAPH}/${page.id}?fields=instagram_business_account{id,username,name,profile_picture_url,followers_count,follows_count,media_count}&access_token=${page.access_token}`,
  );
  const igJson = await igRes.json();
  const ig = igJson.instagram_business_account as
    | { id: string; username?: string; name?: string; profile_picture_url?: string; followers_count?: number; follows_count?: number; media_count?: number }
    | undefined;

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

  return [
    `страница «${page.name}»`,
    ig?.username ? `Instagram @${ig.username}` : "без привязанного Instagram",
    adAccount ? `кабинет «${adAccount.name}»` : "без рекламного кабинета",
  ].join(", ");
}
