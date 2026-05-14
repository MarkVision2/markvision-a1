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
    const isAdmin = await userHasRole(auth.userId, "admin");
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const url = new URL(req.url);
    const adAccountId = url.searchParams.get("ad_account_id");
    const telegramGroupId = url.searchParams.get("telegram_group_id");
    const cabinetId = url.searchParams.get("cabinet_id");

    let query = admin.from("ad_cabinets").select("*").limit(1);

    if (cabinetId) {
      query = query.eq("id", cabinetId);
    } else if (adAccountId) {
      const rawAdAccountId = adAccountId.trim();
      const normalizedAdAccountId = rawAdAccountId.startsWith("act_")
        ? rawAdAccountId
        : `act_${rawAdAccountId}`;
      const numericAdAccountId = rawAdAccountId.replace(/^act_/, "");
      query = query.in("ad_account_id", [rawAdAccountId, normalizedAdAccountId, numericAdAccountId]);
    } else if (telegramGroupId) {
      query = query.eq("telegram_group_id", telegramGroupId);
    } else {
      return new Response(JSON.stringify({ error: "Provide ad_account_id, cabinet_id, or telegram_group_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data, error } = await query;
    if (error) throw error;

    if (!data || data.length === 0) {
      return new Response(JSON.stringify({ config: null }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const row = data[0];
    // Map to the format n8n expects (clientConfig)
    const config = {
      project_id: row.project_id || row.id,
      client_name: row.name,
      city: row.city || "",
      ad_account_id: row.ad_account_id || "",
      page_id: row.page_id || "",
      instagram_actor_id: row.instagram_id || null,
      instagram_user_id: row.instagram_id || null,
      // Note: fb_token intentionally omitted from client responses to prevent
      // credential leakage. Server-to-server callers should resolve via service role.
      fb_pixel_id: row.pixel_id || null,
      website_url: row.website_url || null,
      whatsapp_number: row.whatsapp_number || "",
      daily_budget: row.daily_budget ? row.daily_budget * 100 : 500, // convert $ to cents
      region_key: "2037",
      pixel_event: row.pixel_event || "Lead",
      brief: row.brief || null,
    };

    return new Response(JSON.stringify({ config }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
