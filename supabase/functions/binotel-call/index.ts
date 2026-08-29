// binotel-call
// Click-to-call через Binotel: АТС сначала дозванивается на внутренний номер
// менеджера, после ответа — соединяет с клиентом (calls/internal-number-to-external-number).
//
// Вход: { phone, leadId?, projectId?, mode?: "call" | "test" }
// Auth: JWT пользователя. Подключение берётся из проекта: у каждого проекта своя АТС,
// поэтому проект определяется по лиду (или передаётся явно для проверки связи).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { binotelRequest, toBinotelPhone } from "../_lib/binotel.ts";
import { credentialsOf, isMissingSchema, loadProjectBinotel } from "../_lib/binotelProject.ts";
import { requireLeadAccess, requireProjectAccess, requireUser } from "../_lib/auth.ts";

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
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;
  const userId = auth.userId;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { body = {}; }
  const mode = typeof body?.mode === "string" ? body.mode : "call";
  const phone = toBinotelPhone(String(body?.phone ?? ""));
  const leadId = typeof body?.leadId === "string" && body.leadId.length > 0 ? body.leadId : null;
  let projectId = typeof body?.projectId === "string" && body.projectId.length > 0
    ? body.projectId
    : null;

  if (mode === "call" && phone.length < 6) return json({ ok: false, error: "invalid_phone" }, 400);

  // Проект: по лиду (заодно проверяем доступ к нему) либо явно переданный.
  if (leadId) {
    const leadAccess = await requireLeadAccess(auth.authHeader, leadId);
    if (!leadAccess.ok) return leadAccess.response;
    projectId = leadAccess.projectId ?? projectId;
  } else if (projectId) {
    const projectAccess = await requireProjectAccess(auth.authHeader, projectId);
    if (!projectAccess.ok) return projectAccess.response;
  }

  if (!projectId) {
    return json({
      ok: false,
      error: "project_missing",
      detail: "Не удалось определить проект: у лида не заполнен проект",
    }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { row: settings, error: setErr } = await loadProjectBinotel(admin, projectId);
  if (setErr) {
    return json({
      ok: false,
      error: isMissingSchema(setErr) ? "migration_missing" : "settings_unavailable",
      detail: isMissingSchema(setErr)
        ? "Таблица подключений Binotel отсутствует — примените scripts/apply-binotel-telephony.sql"
        : setErr,
    }, 500);
  }
  if (!settings || !settings.enabled) {
    return json({ ok: false, error: "binotel_disabled", detail: "В этом проекте Binotel не подключён" }, 400);
  }
  const creds = credentialsOf(settings);
  if (!creds) return json({ ok: false, error: "binotel_not_configured" }, 400);

  const { data: profile } = await admin
    .from("profiles").select("sip_extension").eq("id", userId).single();
  const internalNumber =
    (profile?.sip_extension && String(profile.sip_extension).trim()) ||
    (settings.operator ? String(settings.operator).trim() : "");

  // Тест подключения: реальный вызов settings/list-of-employees (только админ).
  // Внутренний номер тут НЕ обязателен — тест как раз и нужен, чтобы увидеть
  // список сотрудников АТС и узнать, какой номер вписывать в настройки.
  if (mode === "test") {
    const { data: roleRow } = await admin
      .from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
    if (!roleRow) return json({ ok: false, error: "admin_only" }, 403);

    const r = await binotelRequest("settings/list-of-employees", {}, creds);
    if (!r.ok) return json({ ok: false, mode: "test", error: r.error, detail: r.error, code: r.code }, 502);

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
      projectId,
      operator: internalNumber || null,
      operatorKnown: known,
      employees: list.slice(0, 50),
      pbxNumber: settings.pbx_number ?? null,
    });
  }

  // Звонок: вот здесь внутренний номер уже обязателен — именно на него АТС
  // звонит первым, прежде чем соединить с клиентом.
  if (!internalNumber) {
    return json({
      ok: false,
      error: "operator_missing",
      detail: "Не задан внутренний номер: укажите свой в профиле или дефолтный в настройках Binotel",
    }, 400);
  }

  const payload: Record<string, unknown> = { internalNumber, externalNumber: phone };
  if (settings.pbx_number) payload.pbxNumber = String(settings.pbx_number).trim();

  const r = await binotelRequest("calls/internal-number-to-external-number", payload, creds);
  const generalCallID = r.ok ? (r.data.generalCallID ?? null) : null;

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
    return json({
      ok: false, error: "binotel_failed", detail: r.error.slice(0, 200),
      code: r.code, fallbackProvider: "tel",
    }, 502);
  }

  return json({ ok: true, provider: "binotel", operator: internalNumber, generalCallID });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    return await handle(req);
  } catch (e) {
    // Без этого любая внутренняя ошибка уходит generic-500 без CORS-заголовков,
    // и браузер показывает лишь «Failed to send a request to the Edge Function».
    console.error("[binotel-call] unhandled", e);
    return json({
      ok: false, error: "internal_error",
      detail: e instanceof Error ? e.message : String(e),
    }, 500);
  }
});
