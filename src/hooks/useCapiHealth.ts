import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeTable } from "@/hooks/useRealtimeTable";

export type CapiHealth = {
  loading: boolean;
  /** У проекта есть кабинет с заданным Pixel ID — CAPI можно слать. */
  configured: boolean;
  sent: number;
  pending: number;
  failed: number;
  skipped: number;
  /** Текст последней ошибки Meta — для подсказки «протух токен» и т.п. */
  lastError: string | null;
};

const EMPTY: CapiHealth = {
  loading: false,
  configured: false,
  sent: 0,
  pending: 0,
  failed: 0,
  skipped: 0,
  lastError: null,
};

/**
 * Здоровье CAPI по проекту: подключён ли пиксель и что с последними событиями.
 * Обновляется в реальном времени по capi_outbox. Используется для статус-значка
 * в шапке проекта и предупреждений при сбоях доставки.
 */
export function useCapiHealth(projectId?: string | null): CapiHealth {
  const [health, setHealth] = useState<CapiHealth>({ ...EMPTY, loading: true });

  const load = useCallback(async () => {
    if (!projectId) { setHealth(EMPTY); return; }

    const { data: cabs } = await (supabase.from("ad_cabinets" as any) as any)
      .select("id").eq("project_id", projectId).not("pixel_id", "is", null).limit(1);
    const configured = ((cabs as unknown[] | null)?.length ?? 0) > 0;

    const { data: rows } = await (supabase.from("capi_outbox" as any) as any)
      .select("status, last_error")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(200);

    let sent = 0, pending = 0, failed = 0, skipped = 0;
    let lastError: string | null = null;
    for (const r of (rows ?? []) as Array<{ status: string; last_error: string | null }>) {
      if (r.status === "sent") sent++;
      else if (r.status === "pending") pending++;
      else if (r.status === "failed") { failed++; if (!lastError) lastError = r.last_error; }
      else if (r.status === "skipped") { skipped++; if (!lastError) lastError = r.last_error; }
    }
    setHealth({ loading: false, configured, sent, pending, failed, skipped, lastError });
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);
  useRealtimeTable("capi_outbox", () => void load());

  return health;
}
