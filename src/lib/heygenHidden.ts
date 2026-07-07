// Скрытые из списка аватары/голоса (на проект). Не удаляет из HeyGen —
// просто убирает из выбора, чтобы список был чистым. Возврат — в режиме «Управлять».
type Kind = "avatars" | "voices";

const key = (kind: Kind, projectId: string) => `markvision.heygen.hidden.${kind}.${projectId || "none"}`;

export function loadHidden(kind: Kind, projectId: string): string[] {
  try {
    const arr = JSON.parse(localStorage.getItem(key(kind, projectId)) || "[]");
    return Array.isArray(arr) ? (arr as string[]) : [];
  } catch {
    return [];
  }
}

export function toggleHidden(kind: Kind, projectId: string, id: string): string[] {
  const cur = loadHidden(kind, projectId);
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
  try {
    localStorage.setItem(key(kind, projectId), JSON.stringify(next));
  } catch {
    /* не критично */
  }
  return next;
}
