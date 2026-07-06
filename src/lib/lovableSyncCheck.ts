const GITHUB_SYNC_JSON =
  "https://raw.githubusercontent.com/MarkVision2/markvision-a1/main/public/lovable-sync.json";

export type LovableSyncInfo = {
  git_sha?: string;
  updated_at?: string;
  label?: string;
  publish_hint?: string;
};

export async function fetchLiveLovableSync(): Promise<LovableSyncInfo | null> {
  try {
    const r = await fetch(`/lovable-sync.json?t=${Date.now()}`);
    if (!r.ok) return null;
    return (await r.json()) as LovableSyncInfo;
  } catch {
    return null;
  }
}

export async function fetchGithubLovableSync(): Promise<LovableSyncInfo | null> {
  try {
    const r = await fetch(`${GITHUB_SYNC_JSON}?t=${Date.now()}`);
    if (!r.ok) return null;
    return (await r.json()) as LovableSyncInfo;
  } catch {
    return null;
  }
}

export function isLovableDeployStale(
  live: LovableSyncInfo | null,
  github: LovableSyncInfo | null,
): boolean {
  if (!live?.git_sha || !github?.git_sha) return false;
  return live.git_sha !== github.git_sha;
}
