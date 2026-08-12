// Зеркало кабинетов в client_configs ВНЕШНЕГО клиентского проекта
// (szfgdruhlebfvcmlvxdk) — туда смотрят n8n и контент-завод.
//
// ВАЖНО: раньше зеркало писалось через локальный service-клиент этого проекта,
// где таблицы client_configs нет вообще → upsert падал (PGRST205) и ошибка
// только логировалась. Пишем строго во внешний проект по секретам
// CLIENT_SUPABASE_URL / CLIENT_SUPABASE_SERVICE_ROLE_KEY.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const DEFAULT_CLIENT_URL = "https://szfgdruhlebfvcmlvxdk.supabase.co";

export interface ClientConfigRow {
  cabinet_id: string;
  name: string;
  type: string;
  daily_budget?: unknown;
  city?: unknown;
  ad_account_id?: unknown;
  page_id?: unknown;
  page_name?: unknown;
  instagram_id?: unknown;
  access_token?: unknown;
  telegram_group_id?: unknown;
  whatsapp_number?: unknown;
  pixel_id?: unknown;
  pixel_event?: unknown;
  website_url?: unknown;
  brief?: unknown;
}

export function getClientConfigDb(): SupabaseClient | null {
  const url = (Deno.env.get("CLIENT_SUPABASE_URL") || DEFAULT_CLIENT_URL).replace(/\/+$/, "");
  const key = Deno.env.get("CLIENT_SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Upsert строки client_configs во внешнем проекте. */
export async function upsertClientConfig(
  row: ClientConfigRow,
): Promise<{ ok: boolean; error?: string }> {
  const db = getClientConfigDb();
  if (!db) {
    return { ok: false, error: "CLIENT_SUPABASE_SERVICE_ROLE_KEY не задан" };
  }
  const payload: Record<string, unknown> = { ...row };
  // Не затираем токен пустым значением.
  if (payload.access_token === null || payload.access_token === undefined) {
    delete payload.access_token;
  }
  const { error } = await db.from("client_configs").upsert(payload, { onConflict: "cabinet_id" });
  if (error) {
    console.error("[clientConfig] upsert:", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/** Удаление зеркала кабинета. */
export async function deleteClientConfig(
  cabinetId: string,
): Promise<{ ok: boolean; error?: string }> {
  const db = getClientConfigDb();
  if (!db) {
    return { ok: false, error: "CLIENT_SUPABASE_SERVICE_ROLE_KEY не задан" };
  }
  const { error } = await db.from("client_configs").delete().eq("cabinet_id", cabinetId);
  if (error) {
    console.error("[clientConfig] delete:", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/** Собрать строку зеркала из записи ad_cabinets. */
export function toClientConfigRow(
  cabinetId: string,
  cab: Record<string, unknown>,
  accessToken?: string | null,
): ClientConfigRow {
  return {
    cabinet_id: cabinetId,
    name: String(cab.name ?? cab.ad_account_id ?? "Кабинет"),
    type: cab.type === "Агентский" ? "Агентский" : "Личный",
    daily_budget: cab.daily_budget ?? null,
    city: cab.city ?? null,
    ad_account_id: cab.ad_account_id ?? cab.external_id ?? null,
    page_id: cab.page_id ?? null,
    page_name: cab.page_name ?? null,
    instagram_id: cab.instagram_id ?? null,
    telegram_group_id: cab.telegram_group_id ?? null,
    whatsapp_number: cab.whatsapp_number ?? null,
    pixel_id: cab.pixel_id ?? null,
    pixel_event: cab.pixel_event ?? "Lead",
    website_url: cab.website_url ?? null,
    brief: cab.brief ?? null,
    access_token: accessToken ?? null,
  };
}
