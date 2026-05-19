// Принимает callback от n8n о ходе запуска рекламной кампании
// и обновляет соответствующую запись в public.ad_campaigns.
//
// n8n должен вызывать этот URL POST-ом с JSON:
// {
//   "launchId": "<uuid>",                 // обязателен (тот же, что прислали в payload)
//   "status": "queued|running|success|error",
//   "step": "uploading_image" | "creating_campaign" | ...,
//   "message": "Загружаем картинку",
//   "metaCampaignId": "...", "metaAdsetId": "...", "metaAdId": "...",
//   "error": "сообщение об ошибке если status=error"
// }
//
// Защита: требуется заголовок X-Callback-Secret == секрет N8N_CALLBACK_SECRET.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-callback-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const expected = Deno.env.get("N8N_CALLBACK_SECRET");
    if (!expected) {
      // SECURITY: refuse to accept callbacks when the shared secret is not configured.
      return new Response(JSON.stringify({ error: "Server misconfigured: N8N_CALLBACK_SECRET not set" }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const got = req.headers.get("x-callback-secret");
    if (got !== expected) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as Record<string, unknown>;
    const launchId = typeof body.launchId === "string" ? body.launchId : "";
    if (!launchId) {
      return new Response(JSON.stringify({ error: "Missing launchId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const status =
      typeof body.status === "string" && body.status ? body.status : "running";
    const step = typeof body.step === "string" ? body.step : null;
    const message = typeof body.message === "string" ? body.message : null;
    const error = typeof body.error === "string" ? body.error : null;
    const metaCampaignId =
      typeof body.metaCampaignId === "string" ? body.metaCampaignId : null;
    const metaAdsetId =
      typeof body.metaAdsetId === "string" ? body.metaAdsetId : null;
    const metaAdId = typeof body.metaAdId === "string" ? body.metaAdId : null;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const patch: Record<string, unknown> = {
      status,
      status_step: step,
      status_message: message,
      status_updated_at: new Date().toISOString(),
    };
    if (metaCampaignId) patch.meta_campaign_id = metaCampaignId;
    if (metaAdsetId) patch.meta_adset_id = metaAdsetId;
    if (metaAdId) patch.meta_ad_id = metaAdId;
    if (error) patch.last_error = error;
    if (status === "success" || status === "error") {
      patch.completed_at = new Date().toISOString();
    }

    const { error: dbErr } = await admin
      .from("ad_campaigns")
      .update(patch)
      .eq("launch_id", launchId);

    if (dbErr) {
      // Не валим n8n — просто отдаём ошибку.
      return new Response(JSON.stringify({ ok: false, error: dbErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});