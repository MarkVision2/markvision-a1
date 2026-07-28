// capi-test-event — отправляет ПРОВЕРОЧНОЕ событие в Meta CAPI, чтобы убедиться,
// что связка pixel + access_token настроена верно и данные реально доходят.
//
// Авторизация: verify_jwt=true на шлюзе уже гарантирует валидный JWT (не пускаем
// анонимов дальше лёгкой проверки Bearer). Отдельный in-function getClaims не
// используем — он ломался на части версий клиента и давал ложный 401.
//
// Токен: из кабинета (ad_cabinets.access_token) → общий подключённый Meta-токен
// системы (automation_settings.meta_access_token → env META_ACCESS_TOKEN). Тот же,
// что использует синхронизация расходов — вводить токен заново не нужно.
//
// Ответ всегда HTTP 200 (даже при ошибке Meta), чтобы UI мог прочитать тело и
// показать конкретную причину, а не общее «Edge Function returned a non-2xx».

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireCabinetAccess } from "../_lib/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const META_API_VERSION = "v22.0";

const sha256 = async (s: string) => {
  const data = new TextEncoder().encode(s.trim().toLowerCase());
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || req.headers.get("authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json().catch(() => ({}));
    const { cabinet_id, pixel_id: pxIn, access_token: tokIn, test_event_code: codeIn, event_name = "Lead" } = body || {};

    let pixelId = String(pxIn || "");
    let token = String(tokIn || "");
    let testCode = String(codeIn || "");

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    if (cabinet_id && (!pixelId || !token)) {
      const { data: cab } = await admin.from("ad_cabinets").select("pixel_id, access_token, capi_test_event_code").eq("id", cabinet_id).maybeSingle();
      if (cab) {
        pixelId = pixelId || String((cab as Record<string, unknown>).pixel_id || "");
        token = token || String((cab as Record<string, unknown>).access_token || "");
        testCode = testCode || String((cab as Record<string, unknown>).capi_test_event_code || "");
      }
    }

    // Фолбэк на общий подключённый Meta-токен.
    let tokenSource = token ? "cabinet" : "";
    if (!token) {
      const { data: settings } = await admin.from("automation_settings").select("meta_access_token").eq("id", true).maybeSingle();
      token = String((settings as { meta_access_token?: string } | null)?.meta_access_token || Deno.env.get("META_ACCESS_TOKEN") || "");
      if (token) tokenSource = "shared";
    }

    if (!pixelId) {
      return new Response(JSON.stringify({ ok: false, error: "Не задан Pixel ID у кабинета." }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!token) {
      return new Response(JSON.stringify({ ok: false, error: "Нет Meta-токена: ни у кабинета, ни подключённого в системе." }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

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
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
    );
    const fbText = await fbResp.text();
    let fb_response: unknown;
    try { fb_response = JSON.parse(fbText); } catch { fb_response = fbText.slice(0, 800); }

    return new Response(JSON.stringify({ ok: true, sent: fbResp.ok, event_name: event.event_name, test_event_code: testCode || null, token_source: tokenSource, fb_response }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
