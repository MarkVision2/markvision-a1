/** Формат: `{projectId}:{batchId}:{styleId}` — позволяет грузить все results проекта. */
export function buildContentFactoryRequestId(
  projectId: string,
  batchId: string,
  styleId: string,
): string {
  if (!projectId) return `${batchId}:${styleId}`;
  return `${projectId}:${batchId}:${styleId}`;
}

export function parseContentFactoryRequestId(requestId: string): {
  projectId?: string;
  batchId: string;
  styleId?: string;
} {
  const parts = requestId.split(":");
  if (parts.length >= 3) {
    return {
      projectId: parts[0],
      batchId: parts[1],
      styleId: parts.slice(2).join(":"),
    };
  }
  if (parts.length === 2) {
    return { batchId: parts[0], styleId: parts[1] };
  }
  return { batchId: parts[0] ?? requestId };
}

export function requestIdBelongsToProject(
  requestId: string,
  projectId: string,
  knownSessionIds: Set<string>,
): boolean {
  if (!requestId || !projectId) return false;
  const parsed = parseContentFactoryRequestId(requestId);
  if (parsed.projectId) return parsed.projectId === projectId;
  return knownSessionIds.has(parsed.batchId);
}
