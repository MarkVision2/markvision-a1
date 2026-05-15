// Лёгкий tracker для лидов, которых n8n авто-передвинул в CRM.
// Хранится в localStorage, TTL 24 ч. Используется в LeadCard для бейджа «🤖 авто».

const STORAGE_KEY = "mv:autoMovedLeads";
const TTL_MS = 24 * 3600 * 1000;

interface Entry {
  ts: number;
  stage?: string;
}
type Store = Record<string, Entry>;

let memCache: Store | null = null;
const listeners = new Set<() => void>();

function read(): Store {
  if (memCache) return memCache;
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    memCache = raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    memCache = {};
  }
  // GC expired
  const now = Date.now();
  let changed = false;
  for (const k of Object.keys(memCache)) {
    if (now - memCache[k].ts > TTL_MS) {
      delete memCache[k];
      changed = true;
    }
  }
  if (changed && typeof localStorage !== "undefined") {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(memCache)); } catch { /* */ }
  }
  return memCache;
}

function write(s: Store) {
  memCache = s;
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch { /* */ }
  for (const l of listeners) l();
}

export function markAutoMoved(leadId: string, stage?: string): void {
  const s = { ...read() };
  s[leadId] = { ts: Date.now(), stage };
  write(s);
}

export function isRecentlyAutoMoved(leadId: string): boolean {
  const e = read()[leadId];
  if (!e) return false;
  return Date.now() - e.ts < TTL_MS;
}

export function subscribeAutoMoved(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

// Snapshot для useSyncExternalStore — возвращает ключ, меняющийся при изменениях
export function getAutoMovedSnapshot(): number {
  return Object.keys(read()).length;
}
