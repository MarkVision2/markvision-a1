// binotel-call
// Click-to-call через Binotel: АТС сначала дозванивается на внутренний номер
// менеджера, после ответа — соединяет с клиентом (calls/internal-number-to-external-number).
//
// Вход: { phone, leadId?, mode?: "call" | "test" }
// Auth: JWT пользователя (verify_jwt по умолчанию включён).
// Ключи Binotel читаются service-role клиентом и наружу не отдаются.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { binotelRequest, toBinotelPhone } from "../_lib/binotel.ts";
import { requireUser } from "../_lib/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function handle(req: Request): Promise<Response> {
  // 1. Авторизация пользователя — через общий хелпер _lib/auth.ts.
  // Свой getClaims тут был багом: метод появился в supabase-js ~2.49,
  // а функция импортирует 2.45.0 — падало с «getClaims is not a function».
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;
  const userId = auth.userId;

  // 2. Тело запроса
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { body = {}; }
  const mode = typeof body?.mode === "string" ? body.mode : "call";
  const phone = toBinotelPhone(String(body?.phone ?? ""));
  const leadId = typeof body?.leadId === "string" && body.leadId.length > 0 ? body.leadId : null;
  if (mode === "call" && phone.length < 6) return json({ ok: false, error: "invalid_phone" }, 400);

  // 3. Настройки и профиль — через service role
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: settings, error: setErr } = await admin
    .from("automation_settings")
    .select("telephony_provider, binotel_enabled, binotel_key, binotel_secret, binotel_operator, binotel_pbx_number")
    .eq("id", true).single();
  if (setErr || !settings) {
    const noColumns = /column .* does not exist|schema cache/i.test(setErr?.message ?? "");
    return json({
      ok: false,
      error: noColumns ? "migration_missing" : "settings_missing",
      detail: noColumns
        ? "Колонки Binotel отсутствуют — примените scripts/apply-binotel-telephony.sql"
        : (setErr?.message ?? "automation_settings недоступна"),
    }, 500);
  }

  if (!settings.binotel_enabled) return json({ ok: false, error: "binotel_disabled" }, 400);
  if (mode === "call" && settings.telephony_provider !== "binotel") {
    return json(
      { ok: false, error: "binotel_disabled", provider: settings.telephony_provider },
      400,
    );
  }
  if (!settings.binotel_key || !settings.binotel_secret) {
    return json({ ok: false, error: "binotel_not_configured" }, 400);
  }
  const creds = { key: settings.binotel_key as string, secret: settings.binotel_secret as string };

  const { data: profile } = await admin
    .from("profiles").select("sip_extension").eq("id", userId).single();
  const internalNumber =
    (profile?.sip_extension && String(profile.sip_extension).trim()) ||
    (settings.binotel_operator ? String(settings.binotel_operator).trim() : "");

  // 4. Тест подключения: реальный вызов settings/list-of-employees (только админ).
  // Внутренний номер тут НЕ обязателен: тест как раз и нужен, чтобы увидеть
  // список сотрудников АТС и узнать, какой номер вписывать в настройки.
  if (mode === "test") {
    const { data: roleRow } = await admin
      .from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
    if (!roleRow) return json({ ok: false, error: "admin_only" }, 403);

    const r = await binotelRequest("settings/list-of-employees", {}, creds);
    if (!r.ok) return json({ ok: false, mode: "test", error: r.error, code: r.code }, 502);

    const employees = (r.data.listOfEmployees ?? {}) as Record<string, Record<string, unknown>>;
    const list = Object.values(employees).map((e) => ({
      name: String(e?.name ?? ""),
      email: String(e?.email ?? ""),
      internalNumber: String((e?.endpointData as Record<string, unknown>)?.internalNumber ?? ""),
      status: String((e?.endpointData as Record<string, unknown>)?.status ?? ""),
    }));
    const known = Boolean(internalNumber) && list.some((e) => e.internalNumber === internalNumber);
    return json({
      ok: true,
      mode: "test",
      operator: internalNumber || null,
      operatorKnown: known,
      employees: list.slice(0, 50),
      pbxNumber: settings.binotel_pbx_number ?? null,
      provider: settings.telephony_provider,
      enabled: settings.binotel_enabled,
    });
  }

  // 5. Звонок — вот здесь внутренний номер уже обязателен: именно на него
  // АТС звонит первым, прежде чем соединить с клиентом.
  if (!internalNumber) {
    return json({
      ok: false,
      error: "operator_missing",
      detail: "Не задан внутренний номер: укажите свой в профиле или дефолтный в настройках Binotel",
    }, 400);
  }

  const payload: Record<string, unknown> = {
    internalNumber,
    externalNumber: phone,
  };
  if (settings.binotel_pbx_number) payload.pbxNumber = String(settings.binotel_pbx_number).trim();

  const r = await binotelRequest("calls/internal-number-to-external-number", payload, creds);
  const generalCallID = r.ok ? (r.data.generalCallID ?? null) : null;

  // 6. Аудит попытки
  if (leadId) {
    await admin.from("events").insert({
      lead_id: leadId,
      event_type: "call_initiated",
      actor_id: userId,
      payload: {
        provider: "binotel",
        operator: internalNumber,
        ok: r.ok,
        generalCallID,
        response: r.ok ? "success" : r.error.slice(0, 200),
      },
    });
  }

  if (!r.ok) {
    return json({ ok: false, error: "binotel_failed", detail: r.error.slice(0, 200), code: r.code, fallbackProvider: "tel" }, 502);
  }

  return json({ ok: true, provider: "binotel", operator: internalNumber, generalCallID });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    return await handle(req);
  } catch (e) {
    // Без этого любая внутренняя ошибка уходит generic-500 без CORS-заголовков,
    // и браузер показывает лишь «Failed to send a request to the Edge Function»,
    // пряча настоящую причину.
    console.error("[binotel-call] unhandled", e);
    return json({
      ok: false,
      error: "internal_error",
      detail: e instanceof Error ? e.message : String(e),
    }, 500);
  }
});
