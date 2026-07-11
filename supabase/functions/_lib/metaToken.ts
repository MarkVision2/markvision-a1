import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

interface ResolveOpts {
  /** Кабинет, чей OAuth-токен использовать в первую очередь. */
  cabinetId?: string | null;
  /** Явный токен из тела запроса — высший приоритет. */
  bodyToken?: string | null;
  /** Переиспользуемый admin-клиент (иначе создаётся свой). */
  admin?: SupabaseClient;
}

/**
 * Резолвит Meta access token с приоритетом персонального OAuth-токена кабинета.
 *
 * Порядок:
 *   1. bodyToken (если явно передан)
 *   2. ad_cabinets.access_token выбранного кабинета — токен, полученный при входе
 *      пользователя через Facebook (OAuth). Он владеет страницей и рекламным
 *      аккаунтом, поэтому им работают и расходы, и креативы (video source), и CAPI.
 *   3. Запасной общий токен: automation_settings.meta_access_token → env
 *      META_ACCESS_TOKEN. Нужен только для кабинетов, ещё не переподключённых
 *      через Facebook. После полного перехода на OAuth его можно убрать.
 *
 * Совместимость: вызов без аргументов ведёт себя как раньше (сразу шаг 3).
 */
export async function resolveMetaAccessToken(
  arg?: string | null | ResolveOpts,
): Promise<string | null> {
  // Обратная совместимость: раньше принимался просто bodyToken-строкой.
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

  const { data: settings } = await admin
    .from("automation_settings")
    .select("meta_access_token")
    .eq("id", true)
    .maybeSingle();
  return (settings as { meta_access_token?: string | null } | null)?.meta_access_token
    ?? Deno.env.get("META_ACCESS_TOKEN")
    ?? null;
}
