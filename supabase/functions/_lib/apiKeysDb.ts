/**
 * Проверка API-ключа по таблице api_keys. Отдельно от apiKeys.ts, чтобы чистая
 * часть не тянула supabase-js в vitest.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { extractApiKey, hashApiKey, normalizeScopes, type ApiKeyContext } from "./apiKeys.ts";

interface ApiKeyRow {
  id: string;
  project_id: string;
  name: string;
  scopes: string[] | null;
  expires_at: string | null;
  revoked_at: string | null;
}

export type ApiKeyCheck =
  | { ok: true; ctx: ApiKeyContext }
  | { ok: false; status: number; error: string };

/** Ключ из запроса → проект и права. Обновляет last_used_at, не дожидаясь ответа. */
export async function resolveApiKey(req: Request, admin: SupabaseClient, now = Date.now()): Promise<ApiKeyCheck> {
  const key = extractApiKey(req.headers);
  if (!key) return { ok: false, status: 401, error: "нужен API-ключ: заголовок Authorization: Bearer mv_live_… или x-api-key" };
  const hash = await hashApiKey(key);
  const { data } = await admin
    .from("api_keys").select("id, project_id, name, scopes, expires_at, revoked_at")
    .eq("key_hash", hash).maybeSingle();
  const row = data as ApiKeyRow | null;
  if (!row) return { ok: false, status: 401, error: "API-ключ не найден" };
  if (row.revoked_at) return { ok: false, status: 401, error: "API-ключ отозван" };
  if (row.expires_at && Date.parse(row.expires_at) <= now) return { ok: false, status: 401, error: "срок API-ключа истёк" };

  // Ждём запись: edge-runtime может оборвать фоновые промисы после ответа,
  // и «использован» в интерфейсе останется пустым. Ошибка записи ключ не блокирует.
  await admin.from("api_keys").update({ last_used_at: new Date(now).toISOString() }).eq("id", row.id)
    .then(() => undefined, () => undefined);

  return {
    ok: true,
    ctx: { keyId: row.id, projectId: row.project_id, name: row.name, scopes: normalizeScopes(row.scopes) },
  };
}

