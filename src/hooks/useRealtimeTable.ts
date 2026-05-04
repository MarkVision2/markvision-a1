import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Subscribe to realtime changes for a Supabase table and trigger a callback
 * (typically a re-fetch) on every INSERT / UPDATE / DELETE.
 *
 * `debounceMs` — coalesce a burst of events into a single callback invocation.
 * Default 400 ms. Set to 0 to disable.
 */
export function useRealtimeTable(
  table: string,
  onChange: () => void,
  enabled = true,
  debounceMs = 400,
) {
  const cbRef = useRef(onChange);
  cbRef.current = onChange;
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fire = () => {
      if (debounceMs <= 0) {
        cbRef.current();
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        cbRef.current();
      }, debounceMs);
    };
    const channel = supabase
      .channel(`rt-${table}-${Math.random().toString(36).slice(2, 8)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        fire,
      )
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, enabled, debounceMs]);
}