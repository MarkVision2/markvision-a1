/**
 * Демо-наполнение проекта «Эрик» (июль 2026).
 * Auth: x-montage-key = montage_settings.worker_key (как montage-worker).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { seedEricDemo } from "../_lib/ericDemoSeed.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: settings } = await admin.from("montage_settings").select("worker_key").eq("id", 1).maybeSingle();
  const expected = settings?.worker_key as string | undefined;
  const provided = req.headers.get("x-montage-key");
  if (!expected || !provided || provided !== expected) return json({ error: "forbidden" }, 403);

  let body: { month_start?: string; month_end?: string } = {};
  try {
    const text = await req.text();
    if (text.trim()) body = JSON.parse(text);
  } catch {
    return json({ error: "bad json" }, 400);
  }

  try {
    const result = await seedEricDemo(
      admin,
      body.month_start ?? "2026-07-01",
      body.month_end ?? "2026-07-31",
    );
    return json(result);
  } catch (e) {
    console.error("seed-demo-eric", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
