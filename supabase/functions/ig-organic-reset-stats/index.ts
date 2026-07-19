// One-shot helper: wipe Instagram codeword funnel test events.
// POST /functions/v1/ig-organic-reset-stats
// Header: x-confirm: mv-reset-ig-stats-20260719
// Deletes codeword_comment / codeword_dm / link_click / lead from instagram_organic_events.
// Does NOT delete codewords or CRM leads rows.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CONFIRM = "mv-reset-ig-stats-20260719";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-confirm",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), {
      status: 405,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const confirm = req.headers.get("x-confirm") ?? "";
  if (confirm !== CONFIRM) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const types = ["codeword_comment", "codeword_dm", "link_click", "lead"] as const;

  const { count: before, error: countErr } = await admin
    .from("instagram_organic_events")
    .select("id", { count: "exact", head: true })
    .in("event_type", [...types]);

  if (countErr) {
    console.error("[ig-organic-reset-stats] count", countErr);
    return new Response(JSON.stringify({ error: countErr.message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const { error: delErr } = await admin
    .from("instagram_organic_events")
    .delete()
    .in("event_type", [...types]);

  if (delErr) {
    console.error("[ig-organic-reset-stats] delete", delErr);
    return new Response(JSON.stringify({ error: delErr.message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const { count: after } = await admin
    .from("instagram_organic_events")
    .select("id", { count: "exact", head: true })
    .in("event_type", [...types]);

  return new Response(
    JSON.stringify({
      ok: true,
      deleted_approx: before ?? null,
      remaining: after ?? 0,
      event_types: types,
    }),
    { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
  );
});
