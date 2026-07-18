// Скрытые из списка аватары/голоса (на проект). Не удаляет из HeyGen —
// просто убирает из выбора, чтобы список был чистым. Возврат — в режиме «Управлять».
//
// Источник истины — Supabase (heygen_hidden_items), localStorage — быстрый кэш.
// Раньше всё жило только в localStorage: скрытие терялось при смене браузера
// и не работало, если было сделано до выбора проекта (ключ «none»).
import { supabase } from "@/integrations/supabase/client";

type Kind = "avatars" | "voices";

// Таблицы нет в сгенерированных типах — нетипизированный клиент.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const key = (kind: Kind, projectId: string) => `markvision.heygen.hidden.${kind}.${projectId || "none"}`;

function readKey(kind: Kind, projectId: string): string[] {
  try {
    const arr = JSON.parse(localStorage.getItem(key(kind, projectId)) || "[]");
    return Array.isArray(arr) ? (arr as string[]) : [];
  } catch {
    return [];
  }
}

function writeKey(kind: Kind, projectId: string, ids: string[]): void {
  try {
    localStorage.setItem(key(kind, projectId), JSON.stringify(ids));
  } catch {
    /* не критично */
  }
}

/** Локальный кэш скрытых: проектный ключ + legacy-ключ «none» (скрытые до выбора проекта). */
export function loadHidden(kind: Kind, projectId: string): string[] {
  const own = readKey(kind, projectId);
  if (!projectId) return own;
  const legacy = readKey(kind, "");
  return legacy.length ? Array.from(new Set([...own, ...legacy])) : own;
}

/**
 * Синхронизация с сервером: подтягивает скрытые проекта, доливает на сервер
 * то, что было скрыто только локально (включая legacy «none»), обновляет кэш.
 */
export async function syncHidden(kind: Kind, projectId: string): Promise<string[]> {
  const local = loadHidden(kind, projectId);
  if (!projectId) return local;
  try {
    const { data, error } = await db
      .from("heygen_hidden_items")
      .select("item_id")
      .eq("project_id", projectId)
      .eq("kind", kind);
    if (error) return local;

    const server: string[] = ((data ?? []) as { item_id: string }[]).map((r) => String(r.item_id));
    const serverSet = new Set(server);
    const localOnly = local.filter((id) => !serverSet.has(id));
    if (localOnly.length) {
      await db.from("heygen_hidden_items").upsert(
        localOnly.map((item_id) => ({ project_id: projectId, kind, item_id })),
        { onConflict: "project_id,kind,item_id", ignoreDuplicates: true },
      );
    }

    const merged = Array.from(new Set([...server, ...localOnly]));
    writeKey(kind, projectId, merged);
    return merged;
  } catch {
    return local;
  }
}

/** Скрыть/вернуть. Обновляет локальный кэш сразу, сервер — write-through. */
export function toggleHidden(kind: Kind, projectId: string, id: string): string[] {
  const cur = loadHidden(kind, projectId);
  const hiding = !cur.includes(id);
  const next = hiding ? [...cur, id] : cur.filter((x) => x !== id);
  writeKey(kind, projectId, next);
  if (!hiding) {
    // Возврат должен убрать id и из legacy-ключа «none», иначе он «воскреснет».
    const legacy = readKey(kind, "");
    if (legacy.includes(id)) writeKey(kind, "", legacy.filter((x) => x !== id));
  }
  if (projectId) {
    if (hiding) {
      void db.from("heygen_hidden_items").upsert(
        { project_id: projectId, kind, item_id: id },
        { onConflict: "project_id,kind,item_id", ignoreDuplicates: true },
      );
    } else {
      void db
        .from("heygen_hidden_items")
        .delete()
        .eq("project_id", projectId)
        .eq("kind", kind)
        .eq("item_id", id);
    }
  }
  return next;
}
