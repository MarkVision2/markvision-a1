// sipuni-cdr-webhook
// Принимает POST от Sipuni при завершении звонка (CDR notification).
// Регистрируется в Sipuni: Интеграции → Уведомления → URL для CDR.
//
// 1. Сверяет секрет (env SIPUNI_WEBHOOK_SECRET — query ?secret= или header x-sipuni-secret).
// 2. Парсит JSON / x-www-form-urlencoded / multipart / raw key=value.
// 3. ВСЕГДА пишет строку в sipuni_cdr_log (полный аудит входящих CDR).
// 4. Находит лид по нормализованному телефону (последний по created_at).
// 5. Пишет communication type=call с recording_url/duration (триггер сам обновит lead.last_*).
// 6. Если есть recording_url, лид найден и duration > 15 сек — fire-and-forget зовёт
//    ai-rop-analyze-call (x-internal-key = SERVICE_ROLE_KEY).
//
// verify_jwt = false (см. config.toml). Sipuni не шлёт JWT.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sipuni-secret",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SIPUNI_SECRET = Deno.env.get("SIPUNI_WEBHOOK_SECRET") ?? "";
const MIN_DURATION_FOR_ANALYSIS = 15; // сек

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizePhone(p: string): string {
  return String(p ?? "").replace(/\D/g, "");
}

async function parseBody(req: Request): Promise<Record<string, unknown>> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    try {
      return (await req.json()) ?? {};
    } catch {
      return {};
    }
  }
  if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
    const fd = await req.formData();
    const out: Record<string, unknown> = {};
    for (const [k, v] of fd.entries()) out[k] = typeof v === "string" ? v : v.name;
    return out;
  }
  const text = await req.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    const out: Record<string, unknown> = {};
    for (const pair of text.split("&")) {
      const [k, v] = pair.split("=");
      if (k) out[decodeURIComponent(k)] = v ? decodeURIComponent(v) : "";
    }
    return out;
  }
}

function pickPhone(body: Record<string, unknown>): {
  phone: string;
  direction: "in" | "out" | null;
} {
  const dirRaw = String(body.type ?? body.direction ?? "").toLowerCase();
  let direction: "in" | "out" | null = null;
  if (dirRaw === "in" || dirRaw === "incoming" || dirRaw === "0") direction = "in";
  else if (dirRaw === "out" || dirRaw === "outgoing" || dirRaw === "1") direction = "out";

  const caller = String(body.caller ?? body.src ?? body.from ?? "");
  const called = String(body.called ?? body.dst ?? body.to ?? "");
  const generic = String(body.phone ?? body.number ?? "");

  let phone = "";
  if (direction === "in") phone = caller || generic;
  else if (direction === "out") phone = called || generic;
  else phone = generic || caller || called;

  return { phone: normalizePhone(phone), direction };
}

function pickRecording(body: Record<string, unknown>): string {
  return String(
    body.recording_url ?? body.record ?? body.record_url ?? body.recordUrl ?? body.link ?? "",
  ).trim();
}

function pickDuration(body: Record<string, unknown>): number | null {
  const raw =
    body.duration ?? body.duration_sec ?? body.talk_duration ?? body.billsec ?? body.length;
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

function pickStartedAt(body: Record<string, unknown>): string {
  const raw = body.started_at ?? body.started ?? body.start_time ?? body.time ?? body.timestamp;
  if (!raw) return new Date().toISOString();
  if (typeof raw === "number" || /^\d+$/.test(String(raw))) {
    const n = Number(raw);
    const ms = n < 1e12 ? n * 1000 : n;
    return new Date(ms).toISOString();
  }
  const d = new Date(String(raw));
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

async function findLeadByPhone(phone: string) {
  if (!phone || phone.length < 6) return null;
  const tail = phone.slice(-10);
  const { data } = await admin
    .from("leads")
    .select("id, project_id, assigned_to, phone")
    .ilike("phone", `%${tail}`)
    .order("created_at", { ascending: false })
    .limit(1);
  return data?.[0] ?? null;
}

async function logCdr(row: {
  raw_payload: unknown;
  phone_normalized: string | null;
  recording_url: string | null;
  duration_sec: number | null;
  started_at: string | null;
  processing_status: "lead_found" | "lead_not_found" | "parse_error";
  lead_id_resolved: string | null;
  error_text: string | null;
}) {
  try {
    await admin.from("sipuni_cdr_log").insert(row);
  } catch (e) {
    console.error("[sipuni-cdr] cdr_log insert failed", e);
  }
}

async function triggerAnalyzeCall(payload: {
  lead_id: string;
  recording_url: string;
  duration_sec: number | null;
  manager_id: string | null;
  call_at: string;
}) {
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/ai-rop-analyze-call`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-key": SERVICE_KEY,
      },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const t = await r.text();
      console.warn("[sipuni-cdr] analyze-call non-2xx", r.status, t.slice(0, 200));
    }
  } catch (e) {
    console.warn("[sipuni-cdr] analyze-call fetch failed", e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method === "GET") return json({ ok: true, service: "sipuni-cdr-webhook" });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let rawPayload: Record<string, unknown> = {};

  try {
    // 1. Secret check — обязателен. Ранее при пустом SIPUNI_WEBHOOK_SECRET
    // webhook принимал любые запросы (это позволяло кому угодно создавать
    // фейковые звонки и триггерить дорогой analyze-call). Теперь без секрета
    // отдаём 503 и просим админа его задать.
    if (!SIPUNI_SECRET) {
      console.error("[sipuni-cdr] SIPUNI_WEBHOOK_SECRET is not configured");
      return json(
        { error: "webhook secret is not configured on server" },
        503,
      );
    }
    const url = new URL(req.url);
    const qSecret = url.searchParams.get("secret") ?? "";
    const hSecret = req.headers.get("x-sipuni-secret") ?? "";
    if (qSecret !== SIPUNI_SECRET && hSecret !== SIPUNI_SECRET) {
      console.warn("[sipuni-cdr] bad secret");
      return json({ error: "forbidden" }, 403);
    }

    rawPayload = await parseBody(req);
    console.log("[sipuni-cdr] payload keys:", Object.keys(rawPayload));

    const { phone, direction } = pickPhone(rawPayload);
    const recording = pickRecording(rawPayload);
    const duration = pickDuration(rawPayload);
    const startedAt = pickStartedAt(rawPayload);

    if (!phone) {
      await logCdr({
        raw_payload: rawPayload,
        phone_normalized: null,
        recording_url: recording || null,
        duration_sec: duration,
        started_at: startedAt,
        processing_status: "parse_error",
        lead_id_resolved: null,
        error_text: "no phone in payload",
      });
      return json({ ok: true, skipped: "no phone in payload" });
    }

    const lead = await findLeadByPhone(phone);
    if (!lead) {
      await logCdr({
        raw_payload: rawPayload,
        phone_normalized: phone,
        recording_url: recording || null,
        duration_sec: duration,
        started_at: startedAt,
        processing_status: "lead_not_found",
        lead_id_resolved: null,
        error_text: null,
      });
      return json({ ok: true, skipped: "lead not found", phone });
    }

    // 2. Insert communication (триггер on_communication_inserted сам напишет event call_made)
    const commContent = [
      recording ? `🎙 Запись: ${recording}` : "",
      duration != null ? `Длительность: ${duration} сек` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const { error: commErr } = await admin.from("communications").insert({
      lead_id: lead.id,
      type: "call",
      channel: "phone",
      direction: direction ?? "in",
      content: commContent || null,
      external_id: rawPayload.id ? String(rawPayload.id) : null,
      created_at: startedAt,
      is_draft: false,
      is_auto: false,
      created_by: lead.assigned_to ?? null,
    });
    if (commErr) {
      console.error("[sipuni-cdr] communication insert error", commErr);
    }

    // 3. Audit log
    await logCdr({
      raw_payload: rawPayload,
      phone_normalized: phone,
      recording_url: recording || null,
      duration_sec: duration,
      started_at: startedAt,
      processing_status: "lead_found",
      lead_id_resolved: lead.id,
      error_text: commErr ? `comm_insert: ${commErr.message}` : null,
    });

    // 4. Триггерим разбор, если есть запись и звонок осмысленной длины
    let analysisTriggered = false;
    if (recording && (duration ?? 0) >= MIN_DURATION_FOR_ANALYSIS) {
      analysisTriggered = true;
      triggerAnalyzeCall({
        lead_id: lead.id,
        recording_url: recording,
        duration_sec: duration,
        manager_id: lead.assigned_to ?? null,
        call_at: startedAt,
      }).catch((e) => console.warn("[sipuni-cdr] trigger failed", e));
    }

    return json({
      ok: true,
      lead_id: lead.id,
      direction,
      duration_sec: duration,
      recording: Boolean(recording),
      analysis_triggered: analysisTriggered,
    });
  } catch (e) {
    console.error("[sipuni-cdr] error", e);
    await logCdr({
      raw_payload: rawPayload,
      phone_normalized: null,
      recording_url: null,
      duration_sec: null,
      started_at: null,
      processing_status: "parse_error",
      lead_id_resolved: null,
      error_text: e instanceof Error ? e.message : "unknown",
    });
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});
