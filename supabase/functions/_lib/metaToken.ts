import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

interface ResolveOpts {
  /** Кабинет, чей OAuth-токен использовать в первую очередь. */
  cabinetId?: string | null;
  /** Проект — берём активный токен из meta_tokens. */
  projectId?: string | null;
  /** Явный токен из тела запроса — высший приоритет. */
  bodyToken?: string | null;
  /** Переиспользуемый admin-клиент (иначе создаётся свой). */
  admin?: SupabaseClient;
}

/**
 * Резолвит Meta access token.
 *
 * Порядок:
 *   1. bodyToken (если явно передан)
 *   2. ad_cabinets.access_token выбранного кабинета (OAuth Facebook)
 *   3. meta_tokens.access_token активного токена проекта
 *   4. automation_settings.meta_access_token → env META_ACCESS_TOKEN
 */
export async function resolveMetaAccessToken(
  arg?: string | null | ResolveOpts,
): Promise<string | null> {
  const opts: ResolveOpts = (typeof arg === "string" || arg == null) ? { bodyToken: arg } : arg;

  if (opts?.bodyToken?.trim()) return opts.bodyToken.trim();

  const admin = opts?.admin ?? createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  if (opts?.cabinetId) {
    const { data } = await admin
      .from("ad_cabinets")
      .select("access_token")
      .eq("id", opts.cabinetId)
      .maybeSingle();
    const cabinetToken = (data as { access_token?: string | null } | null)?.access_token;
    if (cabinetToken && cabinetToken.trim()) return cabinetToken.trim();
  }

  if (opts?.projectId) {
    const { data: projectToken } = await admin
      .from("meta_tokens")
      .select("access_token")
      .eq("project_id", opts.projectId)
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const t = (projectToken as { access_token?: string | null } | null)?.access_token;
    if (t && t.trim()) return t.trim();
  }

  const { data: settings } = await admin
    .from("automation_settings")
    .select("meta_access_token")
    .eq("id", true)
    .maybeSingle();
  return (settings as { meta_access_token?: string | null } | null)?.meta_access_token
    ?? Deno.env.get("META_ACCESS_TOKEN")
    ?? null;
}
