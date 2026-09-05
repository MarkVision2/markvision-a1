/** Точка входа edge-функции `api`; логика — в handler.ts. */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { handle, type Deps } from "./handler.ts";
import type { RateBucket } from "../_lib/apiKeys.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const rateStore = new Map<string, RateBucket>();

Deno.serve((req) => {
  const deps: Deps = {
    admin: createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!),
    supabaseUrl,
    anonKey: Deno.env.get("SUPABASE_ANON_KEY")!,
    fetchFn: fetch,
    rateStore,
    now: Date.now,
  };
  return handle(req, deps);
});
