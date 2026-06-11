import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

/** Токен из body → automation_settings → META_ACCESS_TOKEN env (как meta-list-ad-accounts). */
export async function resolveMetaAccessToken(
  bodyToken?: string | null,
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
  return (settings as { meta_access_token?: string | null } | null)?.meta_access_token
    ?? Deno.env.get("META_ACCESS_TOKEN")
    ?? null;
}
