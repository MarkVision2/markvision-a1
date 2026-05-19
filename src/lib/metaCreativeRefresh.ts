// Глобальная очередь для вызовов meta-creative-refresh.
// Meta строго лимитирует количество запросов (#4 Application request limit reached),
// поэтому объединяем дубли, ограничиваем параллелизм и держим cooldown при 4xx/5xx.

import { supabase } from "@/integrations/supabase/client";

export interface RefreshResult {
  ok: boolean;
  video_url?: string | null;
  thumbnail_url?: string | null;
  fallback?: boolean;
  rate_limited?: boolean;
  retry_after_seconds?: number;
}

const cache = new Map<string, RefreshResult>();
const inflight = new Map<string, Promise<RefreshResult>>();
let activeCount = 0;
const MAX_PARALLEL = 1;
const waiters: Array<() => void> = [];
let cooldownUntil = 0;

async function acquire() {
  if (activeCount < MAX_PARALLEL) {
    activeCount++;
    return;
  }
  await new Promise<void>((r) => waiters.push(r));
  activeCount++;
}
function release() {
  activeCount--;
  const next = waiters.shift();
  if (next) next();
}

export function refreshMetaCreative(adId: string): Promise<RefreshResult> {
  if (!adId) return Promise.resolve({ ok: false });
  if (cooldownUntil > Date.now()) return Promise.resolve({ ok: false, fallback: true, rate_limited: true });
  const cached = cache.get(adId);
  if (cached) return Promise.resolve(cached);
  const exists = inflight.get(adId);
  if (exists) return exists;

  const p = (async () => {
    try {
      const wait = cooldownUntil - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      await acquire();
      try {
        if (cooldownUntil > Date.now()) {
          return { ok: false, fallback: true, rate_limited: true };
        }
        // throttle: spacing ~250ms between calls
        await new Promise((r) => setTimeout(r, 250));
        const { data, error } = await supabase.functions.invoke<RefreshResult>(
          "meta-creative-refresh",
          { body: { ad_id: adId } },
        );
        if (error) {
          // Rate-limited or other failure → long cooldown to stop the storm
          cooldownUntil = Date.now() + 300_000;
          const failed: RefreshResult = { ok: false };
          cache.set(adId, failed);
          return failed;
        }
        const res: RefreshResult = data ?? { ok: false };
        if (res.fallback || res.rate_limited) {
          cooldownUntil = Date.now() + Math.max(60, res.retry_after_seconds ?? 300) * 1000;
        }
        cache.set(adId, res);
        return res;
      } finally {
        release();
      }
    } finally {
      inflight.delete(adId);
    }
  })();
  inflight.set(adId, p);
  return p;
}
