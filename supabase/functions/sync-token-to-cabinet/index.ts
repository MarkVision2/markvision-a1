import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { requireUser, userHasRole } from "../_lib/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = await requireUser(req);
    if (!auth.ok) return auth.response;
    if (!(await userHasRole(auth.userId, "admin"))) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN");
    if (!META_ACCESS_TOKEN) {
      return new Response(JSON.stringify({ error: "META_ACCESS_TOKEN not set" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await admin
      .from("ad_cabinets")
      .update({ access_token: META_ACCESS_TOKEN })
      .not("ad_account_id", "is", null)
      .neq("ad_account_id", "")
      .select("id, name");

    if (error) throw error;

    return new Response(JSON.stringify({ updated: data }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
