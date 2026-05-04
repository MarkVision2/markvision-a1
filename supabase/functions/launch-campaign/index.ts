// Прокси-эндпоинт для запуска кампании в n8n.
// Принимает FormData от фронта, обогащает payload секретным META_ACCESS_TOKEN
// и добавляет UPPER_CASE-алиасы (ACCESS_TOKEN / AD_ACCOUNT / PAGE_ID),
// которые ожидает нода "Upload Photo to FB" в n8n.

const N8N_WEBHOOK = "https://n8n.zapoinov.com/webhook/ai-target-launch";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN");
    if (!META_ACCESS_TOKEN) {
      return new Response(
        JSON.stringify({ error: "META_ACCESS_TOKEN is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const incoming = await req.formData();
    const payloadStr = incoming.get("payload");
    if (typeof payloadStr !== "string") {
      return new Response(JSON.stringify({ error: "Missing 'payload' field" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = JSON.parse(payloadStr) as Record<string, unknown>;
    const client = (payload.clientConfig ?? {}) as Record<string, unknown>;

    // Проставляем токен в clientConfig (если фронт прислал пустой)
    if (!client.fb_token) client.fb_token = META_ACCESS_TOKEN;
    if (!client.access_token) client.access_token = META_ACCESS_TOKEN;
    payload.clientConfig = client;

    // UPPER_CASE-алиасы, которые читает n8n код-нода:
    // "missing ACCESS_TOKEN or AD_ACCOUNT" → она смотрит именно эти ключи.
    const adAccountRaw =
      (client.ad_account_id as string | undefined) ||
      (payload.ad_account_id as string | undefined) ||
      "";
    const adAccount = adAccountRaw.startsWith("act_")
      ? adAccountRaw
      : adAccountRaw
        ? `act_${adAccountRaw.replace(/\D/g, "")}`
        : "";

    payload.ACCESS_TOKEN = META_ACCESS_TOKEN;
    payload.AD_ACCOUNT = adAccount;
    payload.PAGE_ID = (client.page_id as string | undefined) || "";
    payload.PAGE_NAME = (client.page_name as string | undefined) || "";
    payload.INSTAGRAM_ID = (client.instagram_actor_id as string | undefined) || "";
    payload.PIXEL_ID = (client.fb_pixel_id as string | undefined) || "";
    payload.BUSINESS_ID = (client.business_id as string | undefined) || "";
    payload.APP_ID = (client.app_id as string | undefined) || "";
    payload.LEAD_FORM_ID = (client.lead_form_id as string | undefined) || "";

    if (!payload.AD_ACCOUNT) {
      return new Response(
        JSON.stringify({
          error:
            "AD_ACCOUNT is empty: у выбранного кабинета не указан ad_account_id",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Пересобираем FormData для n8n (с обновлённым payload + файлами)
    const out = new FormData();
    out.append("payload", JSON.stringify(payload));
    for (const [key, value] of incoming.entries()) {
      if (key === "payload") continue;
      out.append(key, value);
    }

    const res = await fetch(N8N_WEBHOOK, { method: "POST", body: out });
    const text = await res.text();

    return new Response(
      JSON.stringify({ ok: res.ok, status: res.status, response: text.slice(0, 2000) }),
      {
        status: res.ok ? 200 : 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
