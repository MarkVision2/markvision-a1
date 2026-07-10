// capi-test-event — отправляет ПРОВЕРОЧНОЕ событие в Meta CAPI, чтобы убедиться,
// что связка pixel + access_token настроена верно и данные реально доходят.
//
// В отличие от боевого пути (триггер → capi_outbox → воркер) здесь:
//   - событие всегда идёт с test_event_code (если задан у кабинета или в body),
//     поэтому попадает в Meta Events Manager → Test Events, а не в реальные конверсии;
//   - ответ Meta (events_received / messages / fbtrace_id) возвращается в UI как есть,
//     чтобы админ видел зелёную галочку или конкретную ошибку.
//
// Вход:  { cabinet_id }  ИЛИ  { pixel_id, access_token, test_event_code? }
//        event_name?     — по умолчанию "Lead"
// Выход: { ok, sent, event_name, test_event_code, fb_response }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_lib/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const META_API_VERSION = "v22.0";

const sha256 = async (s: string) => {
  const data = new TextEncoder().encode(s.trim().toLowerCase());
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const auth = await requireUser(req);
    if (!auth.ok) return auth.response;

    const body = await req.json().catch(() => ({}));
    const {
      cabinet_id,
      pixel_id: pxIn,
      access_token: tokIn,
      test_event_code: codeIn,
      event_name = "Lead",
    } = body || {};

    let pixelId = String(pxIn || "");
    let token = String(tokIn || "");
    let testCode = String(codeIn || "");

    // Резолвим креды из кабинета, если явно не переданы.
    if (cabinet_id && (!pixelId || !token)) {
      const admin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const { data: cab } = await admin
        .from("ad_cabinets")
        .select("pixel_id, access_token, capi_test_event_code")
        .eq("id", cabinet_id)
        .maybeSingle();
      if (cab) {
        pixelId = pixelId || String((cab as Record<string, unknown>).pixel_id || "");
        token = token || String((cab as Record<string, unknown>).access_token || "");
        testCode = testCode || String((cab as Record<string, unknown>).capi_test_event_code || "");
      }
    }

    if (!pixelId || !token) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Не хватает pixel_id или access_token. Заполните их у кабинета.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Синтетические user_data, чтобы Meta приняла событие (нужен хотя бы один matching-ключ).
    const ud: Record<string, string | string[]> = {
      em: [await sha256(`capi-test-${cabinet_id || pixelId}@markvision.local`)],
      external_id: [await sha256(`capi-test-${cabinet_id || pixelId}`)],
    };

    const event: Record<string, unknown> = {
      event_name: event_name || "Lead",
      event_time: Math.floor(Date.now() / 1000),
      action_source: "system_generated",
      event_id: `capi-test-${cabinet_id || pixelId}-${Date.now()}`,
      user_data: ud,
    };

    const payload: Record<string, unknown> = { data: [event] };
    if (testCode) payload.test_event_code = testCode;

    const fbResp = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/${pixelId}/events?access_token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    const fbText = await fbResp.text();
    let fb_response: unknown;
    try { fb_response = JSON.parse(fbText); } catch { fb_response = fbText.slice(0, 800); }

    return new Response(
      JSON.stringify({
        ok: true,
        sent: fbResp.ok,
        event_name: event.event_name,
        test_event_code: testCode || null,
        fb_response,
      }),
      { status: fbResp.ok ? 200 : 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
