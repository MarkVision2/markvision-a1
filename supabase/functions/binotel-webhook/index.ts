// binotel-webhook
// Один endpoint на оба webhook-а Binotel (различаются по полю requestType):
//
//  • apiCallSettings  — прилетает В МОМЕНТ звонка. Отвечаем карточкой клиента:
//    имя лида, ответственный менеджер, ссылка в CRM. Плагин Binotel для Chrome
//    покажет это менеджеру до поднятия трубки. Отвечать надо быстро.
//
//  • apiCallCompleted — прилетает ПОСЛЕ звонка. Пишем communication type=call,
//    скачиваем запись к себе в storage (ссылка Binotel живёт 15 минут) и, если
//    разговор осмысленной длины, зовём ai-rop-analyze-call.
//    ОБЯЗАН вернуть {"status":"success"}, иначе Binotel повторит до 7 раз.
//
// Регистрация в кабинете Binotel: Интеграции → API → URL webhook-ов, с ?secret=<...>.
// verify_jwt = false (см. config.toml) — Binotel не шлёт JWT.
//
// Доступ: секрет в ?secret= / заголовке x-binotel-secret ЛИБО IP из списка
// серверов Binotel. Ни то, ни другое не совпало — 403 (fail-closed).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  callContent,
  callDirection,
  callStartedAt,
  fetchCallRecordUrl,
  isAnswered,
  isRecordable,
  parseCallDetails,
  phoneTail,
  toE164,
  toInt,
} from "../_lib/binotel.ts";
import { archiveRecording, type ArchivedRecording } from "../_lib/callRecording.ts";
import {
  credentialsOf,
  resolveProjectByPbxNumber,
  type ProjectBinotel,
} from "../_lib/binotelProject.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-binotel-secret",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("BINOTEL_WEBHOOK_SECRET") ?? "";

const MIN_DURATION_FOR_ANALYSIS = 15; // сек — короче не отдаём в разбор

// Серверы Binotel (документация: API CALL SETTINGS / список IP).
const BINOTEL_IPS = new Set([
  "194.88.218.116", "194.88.218.114", "194.88.218.117", "194.88.218.118",
  "194.88.219.67", "194.88.219.78", "194.88.219.70", "194.88.219.71",
  "194.88.219.72", "194.88.219.79", "194.88.219.80", "194.88.219.81",
  "194.88.219.82", "194.88.219.83", "194.88.219.84", "194.88.219.85",
  "194.88.219.86", "194.88.219.87", "194.88.219.88", "194.88.219.89",
  "194.88.219.92", "194.88.218.119", "194.88.218.120",
  "185.100.66.145", "185.100.66.146", "185.100.66.147",
]);

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function clientIps(req: Request): string[] {
  const xff = req.headers.get("x-forwarded-for") ?? "";
  const real = req.headers.get("x-real-ip") ?? "";
  return [...xff.split(","), real].map((s) => s.trim()).filter(Boolean);
}

/** Фоновая задача: не держим ответ webhook-а, но и не теряем работу. */
function runInBackground(task: Promise<unknown>) {
  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  const guarded = task.catch((e) => console.warn("[binotel] background task failed", e));
  if (typeof rt?.waitUntil === "function") rt.waitUntil(guarded);
}

async function parseBody(req: Request): Promise<Record<string, unknown>> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    try { return (await req.json()) ?? {}; } catch { return {}; }
  }
  if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
    const fd = await req.formData();
    const out: Record<string, unknown> = {};
    for (const [k, v] of fd.entries()) {
      const val = typeof v === "string" ? v : v.name;
      // Binotel шлёт callDetails[...] как вложенную form-структуру — собираем обратно.
      const m = /^([^[]+)\[(.+)\]$/.exec(k);
      if (m) {
        const [, root, path] = m;
        const bucket = (out[root] ??= {}) as Record<string, unknown>;
        bucket[path.replace(/\]\[/g, ".")] = val;
      } else {
        out[k] = val;
      }
    }
    return out;
  }
  const text = await req.text();
  try { return text ? JSON.parse(text) : {}; } catch { /* ignore */ }
  const out: Record<string, unknown> = {};
  for (const pair of text.split("&")) {
    const [k, v] = pair.split("=");
    if (k) out[decodeURIComponent(k)] = v ? decodeURIComponent(v.replace(/\+/g, " ")) : "";
  }
  return out;
}

// ── лид ─────────────────────────────────────────────────────────────────────

type LeadRow = {
  id: string;
  project_id: string | null;
  assigned_to: string | null;
  phone: string;
  name: string | null;
  source: string | null;
};

async function findLead(phone: string, projectId: string | null): Promise<LeadRow | null> {
  if (phoneTail(phone).length < 9) return null;
  const { data, error } = await admin.rpc("find_lead_by_phone_digits", {
    p_phone: phone,
    p_project_id: projectId,
  });
  if (error) {
    console.warn("[binotel] find_lead rpc failed", error.message);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return (row as LeadRow) ?? null;
}

/** Дефолтная воронка проекта и её первая стадия (как в greenapi-crm-ingest). */
async function defaultStage(projectId: string): Promise<{ pipeline_id: string; stage_id: string } | null> {
  const { data: pipe } = await admin
    .from("pipelines").select("id")
    .eq("project_id", projectId).eq("is_default", true)
    .order("created_at", { ascending: true }).limit(1).maybeSingle();
  const pipelineId = (pipe as { id?: string } | null)?.id;
  if (!pipelineId) return null;

  const { data: stages } = await admin
    .from("pipeline_stages").select("id, key, stage_role, order_index")
    .eq("pipeline_id", pipelineId).order("order_index", { ascending: true });
  const list = (stages ?? []) as { id: string; key: string; stage_role: string | null }[];
  const first = list.find((s) => s.stage_role === "new" || s.key === "new") ?? list[0];
  return first ? { pipeline_id: pipelineId, stage_id: first.id } : null;
}

/**
 * Клиент позвонил впервые — заводим карточку, чтобы звонок не потерялся.
 * Только для входящих и только если админ включил это явно.
 */
async function createLeadFromCall(phone: string, projectId: string): Promise<LeadRow | null> {
  const stage = await defaultStage(projectId);
  if (!stage) {
    console.warn("[binotel] auto-create skipped: no default pipeline in project", projectId);
    return null;
  }
  const { data: proj } = await admin
    .from("projects").select("created_by").eq("id", projectId).maybeSingle();
  const ownerId = (proj as { created_by?: string | null } | null)?.created_by ?? null;

  const e164 = toE164(phone);
  const { data, error } = await admin
    .from("leads")
    .insert({
      name: e164,
      phone: e164,
      source: "binotel",
      channel: "phone",
      project_id: projectId,
      pipeline_id: stage.pipeline_id,
      stage_id: stage.stage_id,
      created_by: ownerId,
      assigned_to: ownerId,
      last_activity_at: new Date().toISOString(),
    })
    .select("id, project_id, assigned_to, phone, name, source")
    .single();
  if (error) {
    console.error("[binotel] auto-create lead failed", error.message);
    return null;
  }
  return data as LeadRow;
}

// ── служебное ───────────────────────────────────────────────────────────────

async function logCall(row: Record<string, unknown>) {
  const { error } = await admin.from("binotel_call_log").insert(row);
  if (error) console.error("[binotel] call_log insert failed", error.message);
}

async function triggerAnalyzeCall(body: Record<string, unknown>) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/ai-rop-analyze-call`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-key": SERVICE_KEY },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    console.warn("[binotel] analyze-call non-2xx", r.status, (await r.text()).slice(0, 200));
  }
}

// ── apiCallSettings ─────────────────────────────────────────────────────────

async function handleCallSettings(payload: Record<string, unknown>) {
  const externalNumber = String(payload.externalNumber ?? "");
  const direction = callDirection(payload.callType);

  // Чей звонок: у каждого проекта своя АТС, различаем по номеру.
  const project = await resolveProjectByPbxNumber(
    admin,
    (payload.pbxNumber as string) ?? null,
  );
  const lead = await findLead(externalNumber, project?.project_id ?? null);

  // Аудит — в фон: телефон уже звонит, лишний roundtrip тут ни к чему.
  runInBackground(logCall({
    request_type: "apiCallSettings",
    general_call_id: null,
    raw_payload: payload,
    phone_normalized: phoneTail(externalNumber) || null,
    direction,
    processing_status: lead ? "lead_found" : "lead_not_found",
    lead_id_resolved: lead?.id ?? null,
  }));

  if (!lead) return json({});

  const profileRes = lead.assigned_to
    ? await admin.from("profiles").select("sip_extension").eq("id", lead.assigned_to).single()
    : { data: null };

  const customerData: Record<string, unknown> = {
    // Плагин Binotel для Chrome обрезает имя примерно на 43 символах.
    name: String(lead.name || "Клиент из CRM").slice(0, 43),
  };
  if (lead.source) customerData.description = `Источник: ${lead.source}`.slice(0, 70);

  const ext = (profileRes.data as { sip_extension?: string | null } | null)?.sip_extension?.trim();
  if (ext) customerData.assignedToEmployeeNumber = ext;

  const rawBase = project?.crm_base_url;
  const base = typeof rawBase === "string" ? rawBase.replace(/\/+$/, "") : "";
  if (base) {
    customerData.linkToCrmUrl = `${base}/crm?lead=${lead.id}`;
    customerData.linkToCrmTitle = "Открыть карточку в CRM";
  }

  return json({ customerData });
}

// ── apiCallCompleted ────────────────────────────────────────────────────────

async function handleCallCompleted(payload: Record<string, unknown>) {
  const details = parseCallDetails(payload);
  if (!details) {
    await logCall({
      request_type: "apiCallCompleted",
      raw_payload: payload,
      processing_status: "parse_error",
      error_text: "no callDetails in payload",
    });
    // Ретрай пришлёт тот же битый payload — подтверждаем, чтобы не долбился 7 раз.
    return json({ status: "success" });
  }

  const generalCallID = details.generalCallID != null ? String(details.generalCallID) : null;
  const externalNumber = String(details.externalNumber ?? "");
  const direction = callDirection(details.callType);
  const disposition = String(details.disposition ?? "");
  const billsec = toInt(details.billsec);
  const startedAt = callStartedAt(details.startTime);
  const answered = isAnswered(disposition);

  // Идемпотентность: Binotel повторяет тот же звонок до 7 раз, пока не увидит success.
  if (generalCallID) {
    const { data: seen } = await admin
      .from("binotel_call_log").select("id")
      .eq("request_type", "apiCallCompleted").eq("general_call_id", generalCallID)
      .maybeSingle();
    if (seen) return json({ status: "success", duplicate: true });
  }

  // Чей звонок: сопоставляем номер АТС из payload с подключением проекта.
  const pbxNumber = (details.pbxNumberData as { number?: string } | undefined)?.number
    ?? (details.pbxNumber as string | undefined)
    ?? null;
  const project: ProjectBinotel | null = await resolveProjectByPbxNumber(admin, pbxNumber);

  let lead = await findLead(externalNumber, project?.project_id ?? null);
  let leadCreated = false;
  if (!lead && direction === "in" && project?.auto_create_leads) {
    lead = await createLeadFromCall(externalNumber, project.project_id);
    leadCreated = Boolean(lead);
  }

  if (!lead) {
    await logCall({
      request_type: "apiCallCompleted",
      general_call_id: generalCallID,
      raw_payload: payload,
      phone_normalized: phoneTail(externalNumber) || null,
      direction,
      disposition: disposition || null,
      duration_sec: billsec,
      started_at: startedAt,
      processing_status: "lead_not_found",
    });
    return json({ status: "success", skipped: "lead not found" });
  }

  // Запись есть только у состоявшихся разговоров. Забираем ссылку и сразу
  // складываем файл к себе — через 15 минут ссылка Binotel протухнет.
  let archived: ArchivedRecording | null = null;
  let rawRecording: string | null = null;
  if (isRecordable(disposition) && generalCallID) {
    const creds = project ? credentialsOf(project) : null;
    if (creds) {
      rawRecording = await fetchCallRecordUrl(generalCallID, creds);
      if (rawRecording) archived = await archiveRecording(admin, rawRecording, lead.id, generalCallID, "binotel");
    }
  }

  const content = callContent({
    answered,
    disposition,
    durationSec: billsec,
    recordingArchived: Boolean(archived),
  });

  const { error: commErr } = await admin.from("communications").insert({
    lead_id: lead.id,
    type: "call",
    channel: "phone",
    direction,
    content: content || null,
    status: answered ? "answered" : "missed",
    duration_sec: billsec,
    external_id: generalCallID,
    created_at: startedAt,
    is_draft: false,
    is_auto: false,
    created_by: lead.assigned_to ?? null,
    media_url: archived?.url ?? null,
    media_kind: archived ? "audio" : null,
    media_mime: archived?.mime ?? null,
    media_filename: archived?.filename ?? null,
  });
  if (commErr) console.error("[binotel] communication insert error", commErr.message);

  await logCall({
    request_type: "apiCallCompleted",
    general_call_id: generalCallID,
    raw_payload: payload,
    phone_normalized: phoneTail(externalNumber) || null,
    direction,
    disposition: disposition || null,
    recording_url: archived?.url ?? rawRecording,
    duration_sec: billsec,
    started_at: startedAt,
    processing_status: "lead_found",
    lead_id_resolved: lead.id,
    error_text: commErr ? `comm_insert: ${commErr.message}` : null,
  });

  // Разбор идёт минуты — держать webhook нельзя (Binotel начнёт ретраи).
  // Строка в binotel_call_log уже записана, поэтому ретрай отсечётся как дубль.
  // В разбор отдаём свою постоянную ссылку: пока ИИ дойдёт до файла,
  // оригинальная ссылка Binotel уже может протухнуть.
  const analysisUrl = archived?.url ?? rawRecording;
  let analysisTriggered = false;
  if (analysisUrl && (billsec ?? 0) >= MIN_DURATION_FOR_ANALYSIS) {
    analysisTriggered = true;
    runInBackground(triggerAnalyzeCall({
      lead_id: lead.id,
      recording_url: analysisUrl,
      duration_sec: billsec,
      manager_id: lead.assigned_to ?? null,
      call_at: startedAt,
    }));
  }

  return json({
    status: "success",
    project_id: project?.project_id ?? null,
    lead_id: lead.id,
    lead_created: leadCreated,
    recording_archived: Boolean(archived),
    analysis_triggered: analysisTriggered,
  });
}

// ── entry ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method === "GET") return json({ ok: true, service: "binotel-webhook" });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  // Доступ: секрет ИЛИ IP Binotel. Fail-closed.
  const url = new URL(req.url);
  const givenSecret = url.searchParams.get("secret") ?? req.headers.get("x-binotel-secret") ?? "";
  const secretOk = Boolean(WEBHOOK_SECRET) && givenSecret === WEBHOOK_SECRET;
  const ipOk = clientIps(req).some((ip) => BINOTEL_IPS.has(ip));
  if (!secretOk && !ipOk) {
    console.warn("[binotel] rejected", { ips: clientIps(req), secretConfigured: Boolean(WEBHOOK_SECRET) });
    return json({ error: "forbidden" }, 403);
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = await parseBody(req);
    const requestType = String(payload.requestType ?? "");
    console.log("[binotel] webhook", requestType, Object.keys(payload));

    if (requestType === "apiCallSettings") return await handleCallSettings(payload);
    if (requestType === "apiCallCompleted") return await handleCallCompleted(payload);

    console.warn("[binotel] unknown requestType", requestType);
    return json({ status: "success", skipped: "unknown requestType" });
  } catch (e) {
    console.error("[binotel] error", e);
    const isSettings = String(payload.requestType ?? "") === "apiCallSettings";
    await logCall({
      request_type: isSettings ? "apiCallSettings" : "apiCallCompleted",
      raw_payload: payload,
      processing_status: "parse_error",
      error_text: e instanceof Error ? e.message : "unknown",
    });
    // apiCallSettings ретраев не имеет — отвечаем пустой карточкой, звонок идёт дальше.
    // apiCallCompleted, наоборот, отдаём НЕ success: Binotel повторит (до 7 раз за 38 ч),
    // и звонок не потеряется, если у нас была временная ошибка.
    if (isSettings) return json({});
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});
