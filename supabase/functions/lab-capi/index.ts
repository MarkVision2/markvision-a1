// Meta Conversions API для лендинга AI Marketing Lab (/lab).
// Публичный endpoint (verify_jwt=false): принимает клики по кнопкам WhatsApp
// и PageView, дублирует их в Meta CAPI с event_id для дедупликации с пикселем.
// Токен и pixel_id лежат в public.lab_settings (RLS deny-all, читает service role).
import { createClient } from "jsr:@supabase/supabase-js@2";

const ALLOWED_EVENTS = new Set(["Lead", "PageView"]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: corsHeaders });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "bad json" }), { status: 400, headers: corsHeaders });
  }

  const eventName = String(body.event_name ?? "");
  if (!ALLOWED_EVENTS.has(eventName)) {
    return new Response(JSON.stringify({ error: "event not allowed" }), { status: 400, headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: settings, error } = await supabase
    .from("lab_settings")
    .select("key, value")
    .in("key", ["meta_pixel_id", "meta_capi_token"]);
  if (error || !settings?.length) {
    console.error("lab_settings read failed", error);
    return new Response(JSON.stringify({ error: "config" }), { status: 500, headers: corsHeaders });
  }
  const conf = Object.fromEntries(settings.map((r: { key: string; value: string }) => [r.key, r.value]));
  const pixelId = conf.meta_pixel_id;
  const token = conf.meta_capi_token;
  if (!pixelId || !token) {
    return new Response(JSON.stringify({ error: "config missing" }), { status: 500, headers: corsHeaders });
  }

  const clientIp = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || undefined;
  const userAgent = req.headers.get("user-agent") ?? undefined;

  const userData: Record<string, unknown> = {
    client_user_agent: userAgent,
    client_ip_address: clientIp,
  };
  if (typeof body.fbp === "string" && body.fbp) userData.fbp = body.fbp;
  if (typeof body.fbc === "string" && body.fbc) userData.fbc = body.fbc;

  const event: Record<string, unknown> = {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    action_source: "website",
    event_source_url: typeof body.event_source_url === "string" ? body.event_source_url : undefined,
    user_data: userData,
  };
  if (typeof body.event_id === "string" && body.event_id) event.event_id = body.event_id;
  if (typeof body.content_name === "string" && body.content_name) {
    event.custom_data = { content_name: body.content_name };
  }

  const payload: Record<string, unknown> = { data: [event] };
  if (typeof body.test_event_code === "string" && body.test_event_code) {
    payload.test_event_code = body.test_event_code;
  }

  const resp = await fetch(
    `https://graph.facebook.com/v21.0/${pixelId}/events?access_token=${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  const result = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    console.error("meta capi error", resp.status, JSON.stringify(result));
    return new Response(JSON.stringify({ error: "meta", status: resp.status }), { status: 502, headers: corsHeaders });
  }

  return new Response(JSON.stringify({ ok: true, events_received: result.events_received ?? 1 }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
