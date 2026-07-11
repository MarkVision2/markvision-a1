// Эксклюзивная привязка HeyGen-аватара к одному проекту (project_avatars).
// Аватары в HeyGen общие на весь аккаунт — этот справочник позволяет закрепить
// конкретный аватар только за одним проектом, чтобы он перестал быть виден
// в остальных (см. AvatarPicker в CreateMontage.tsx).
import { supabase } from "@/integrations/supabase/client";

export type AvatarKind = "avatar" | "talking_photo";

const keyOf = (kind: AvatarKind, avatarId: string) => `${kind}:${avatarId}`;

// Таблицы нет в сгенерированных типах — нетипизированный клиент.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** avatar_kind:avatar_id → project_id, по всем проектам, видимым текущему пользователю (RLS). */
export async function fetchAllAvatarAssignments(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const { data } = await db.from("project_avatars").select("project_id,avatar_id,kind");
    for (const row of data ?? []) map.set(keyOf(row.kind, row.avatar_id), row.project_id);
  } catch {
    /* нет доступа/оффлайн — считаем, что привязок нет (безопасный откат к общему списку) */
  }
  return map;
}

/** Закрепляет аватар за проектом. Если аватар уже был закреплён за другим
 *  проектом — перезаписывает владельца (см. unique-индекс в миграции). */
export async function assignAvatarToProject(projectId: string, avatarId: string, kind: AvatarKind): Promise<void> {
  if (!projectId || !avatarId) return;
  await db
    .from("project_avatars")
    .upsert({ project_id: projectId, avatar_id: avatarId, kind }, { onConflict: "avatar_id,kind" });
}

/** Открепляет аватар — он снова становится общим (виден всем проектам). */
export async function unassignAvatar(avatarId: string, kind: AvatarKind): Promise<void> {
  if (!avatarId) return;
  await db.from("project_avatars").delete().eq("avatar_id", avatarId).eq("kind", kind);
}
