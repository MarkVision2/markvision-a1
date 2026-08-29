// Подключение Binotel конкретного проекта: одна запись на проект.
// Секреты живут в project_binotel_settings и читаются только service-role
// клиентом — клиенту доступна лишь view project_binotel_settings_safe.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import type { BinotelCredentials } from "./binotel.ts";

export type ProjectBinotel = {
  project_id: string;
  enabled: boolean;
  api_key: string | null;
  api_secret: string | null;
  operator: string | null;
  pbx_number: string | null;
  crm_base_url: string | null;
  auto_create_leads: boolean;
};

const COLUMNS =
  "project_id, enabled, api_key, api_secret, operator, pbx_number, crm_base_url, auto_create_leads";

/** Ошибка «колонок ещё нет» — миграция не применена. */
export function isMissingSchema(message: string | undefined): boolean {
  return /does not exist|schema cache|relation .* does not/i.test(message ?? "");
}

export async function loadProjectBinotel(
  admin: SupabaseClient,
  projectId: string,
): Promise<{ row: ProjectBinotel | null; error: string | null }> {
  const { data, error } = await admin
    .from("project_binotel_settings").select(COLUMNS)
    .eq("project_id", projectId).maybeSingle();
  if (error) return { row: null, error: error.message };
  return { row: (data as ProjectBinotel) ?? null, error: null };
}

/**
 * Чей это звонок. Binotel не передаёт идентификатор проекта, зато передаёт номер
 * АТС — он уникален на проект (unique index), поэтому маршрутизируем по нему.
 * Если номер не пришёл (например, исходящий) и подключение в системе всего одно —
 * берём его: двусмысленности всё равно нет.
 */
export async function resolveProjectByPbxNumber(
  admin: SupabaseClient,
  pbxNumber: string | null,
): Promise<ProjectBinotel | null> {
  const digits = String(pbxNumber ?? "").replace(/\D/g, "");
  if (digits) {
    const { data } = await admin
      .from("project_binotel_settings").select(COLUMNS).eq("enabled", true);
    const rows = (data ?? []) as ProjectBinotel[];
    const hit = rows.find((r) => String(r.pbx_number ?? "").replace(/\D/g, "") === digits);
    if (hit) return hit;
    // Номер не совпал ни с одним проектом — но если подключение одно, звонок его.
    if (rows.length === 1) return rows[0];
    return null;
  }

  const { data } = await admin
    .from("project_binotel_settings").select(COLUMNS).eq("enabled", true).limit(2);
  const rows = (data ?? []) as ProjectBinotel[];
  return rows.length === 1 ? rows[0] : null;
}

export function credentialsOf(row: ProjectBinotel): BinotelCredentials | null {
  return row.api_key && row.api_secret ? { key: row.api_key, secret: row.api_secret } : null;
}
