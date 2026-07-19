// Edge Function: crm-stage-update
// Safe stage moves for n8n / automations. Auth via x-automation-key
// (automation_settings.cron_secret). Never expose this secret to the frontend.
//
// POST JSON:
// {
//   project_id: uuid,
//   lead_id?: uuid,
//   phone?: string,
//   event: CrmAutomationEvent,
//   idempotency_key: string,
//   confidence?: number,
//   tags?: string[],
//   temperature?: "hot"|"warm"|"cold",
//   metadata?: object
// }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-automation-key",
};

const EVENT_TO_ROLE: Record<string, string> = {
  whatsapp_messaged: "whatsapp",
  warming_started: "warming",
  attendance_confirmed: "confirmed",
  webinar_attended: "attended",
  webinar_late: "attended",
  webinar_no_show: "rejected",
  interest_detected: "interest",
  call_scheduled: "call_scheduled",
  call_completed: "call_done",
  offer_sent: "offer",
  deposit_received: "deposit",
  payment_received: "paid",
  student_created: "student",
  rejected: "rejected",
};

const ROLE_ORDER: Record<string, number> = {
  new: 1,
  whatsapp: 2,
  warming: 3,
  confirmed: 4,
  attended: 5,
  interest: 6,
  call_scheduled: 7,
  call_done: 8,
  offer: 9,
  deposit: 10,
  paid: 11,
  student: 12,
  rejected: 99,
  other: 0,
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function digits(s: unknown): string {
  return String(s ?? "").replace(/\D/g, "");
}

function canAdvance(from: string, to: string): boolean {
  if (from === to) return false;
  if (to === "rejected") return true;
  if (from === "rejected" || from === "paid" || from === "student") return false;
  return (ROLE_ORDER[to] ?? 0) >= (ROLE_ORDER[from] ?? 0);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: settings, error: setErr } = await supabase
    .from("automation_settings")
    .select("cron_secret")
    .eq("id", true)
    .single();
  if (setErr || !settings?.cron_secret) {
    return json({ error: "settings_missing", detail: setErr?.message }, 500);
  }

  const provided = req.headers.get("x-automation-key") ?? "";
  if (!provided || provided !== settings.cron_secret) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const projectId = String(body.project_id ?? "").trim();
  const leadId = String(body.lead_id ?? "").trim() || null;
  const phone = digits(body.phone);
  const event = String(body.event ?? "").trim();
  const idempotencyKey = String(body.idempotency_key ?? "").trim();
  const confidence = typeof body.confidence === "number" ? body.confidence : null;
  const tags = Array.isArray(body.tags)
    ? body.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 20)
    : [];
  const temperature = ["hot", "warm", "cold"].includes(String(body.temperature ?? ""))
    ? String(body.temperature)
    : null;
  const metadata = (body.metadata && typeof body.metadata === "object")
    ? body.metadata as Record<string, unknown>
    : {};

  if (!projectId) return json({ error: "project_id_required" }, 400);
  if (!idempotencyKey) return json({ error: "idempotency_key_required" }, 400);
  if (!EVENT_TO_ROLE[event]) return json({ error: "unknown_event", event }, 400);
  if (!leadId && phone.length < 7) return json({ error: "lead_id_or_phone_required" }, 400);

  // Idempotency: if we've already processed this key, return prior result.
  const { data: existing } = await supabase
    .from("crm_automation_events")
    .select("*")
    .eq("project_id", projectId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existing) {
    return json({
      ok: true,
      status: "duplicate",
      lead_id: existing.lead_id,
      to_stage_id: existing.to_stage_id,
      event: existing.event,
    });
  }

  // Resolve lead
  let lead: {
    id: string;
    stage_id: string;
    pipeline_id: string | null;
    tags: string[] | null;
    temperature: string | null;
    webinar_status: string | null;
    deposit_amount: number | null;
  } | null = null;

  if (leadId) {
    const { data } = await supabase
      .from("leads")
      .select("id, stage_id, pipeline_id, tags, temperature, webinar_status, deposit_amount")
      .eq("id", leadId)
      .eq("project_id", projectId)
      .maybeSingle();
    lead = data as typeof lead;
  } else {
    // Match by phone suffix (last 10 digits) within project
    const needle = phone.slice(-10);
    const { data } = await supabase
      .from("leads")
      .select("id, stage_id, pipeline_id, tags, temperature, webinar_status, deposit_amount, phone")
      .eq("project_id", projectId)
      .eq("is_personal", false)
      .order("created_at", { ascending: false })
      .limit(50);
    const hit = (data ?? []).find((r: { phone?: string }) =>
      digits(r.phone).endsWith(needle) || needle.endsWith(digits(r.phone).slice(-10))
    );
    lead = (hit as typeof lead) ?? null;
  }

  if (!lead) {
    await supabase.from("crm_automation_events").insert({
      project_id: projectId,
      lead_id: null,
      event,
      idempotency_key: idempotencyKey,
      confidence,
      tags,
      metadata,
      source: "n8n",
      status: "error",
      error: "lead_not_found",
    });
    return json({ error: "lead_not_found" }, 404);
  }

  const targetRole = EVENT_TO_ROLE[event];

  // Load pipeline stages
  let pipelineId = lead.pipeline_id;
  if (!pipelineId) {
    const { data: pipe } = await supabase
      .from("pipelines")
      .select("id")
      .eq("project_id", projectId)
      .eq("is_default", true)
      .limit(1)
      .maybeSingle();
    pipelineId = pipe?.id ?? null;
  }
  if (!pipelineId) return json({ error: "pipeline_not_found" }, 404);

  const { data: stages } = await supabase
    .from("pipeline_stages")
    .select("id, key, stage_role, order_index, is_terminal")
    .eq("pipeline_id", pipelineId)
    .order("order_index");

  const stageList = stages ?? [];
  const current = stageList.find((s) => s.id === lead!.stage_id);
  const fromRole = (current as { stage_role?: string } | undefined)?.stage_role
    ?? current?.key
    ?? "other";
  const target = stageList.find((s) =>
    (s as { stage_role?: string }).stage_role === targetRole
  );

  if (!target) {
    await supabase.from("crm_automation_events").insert({
      project_id: projectId,
      lead_id: lead.id,
      event,
      idempotency_key: idempotencyKey,
      from_stage_id: lead.stage_id,
      confidence,
      tags,
      metadata,
      source: "n8n",
      status: "error",
      error: `stage_role_missing:${targetRole}`,
    });
    return json({ error: "stage_role_missing", role: targetRole }, 409);
  }

  const patch: Record<string, unknown> = {
    last_activity_at: new Date().toISOString(),
  };

  // Tags / temperature always merge even if stage doesn't move
  if (tags.length) {
    const merged = Array.from(new Set([...(lead.tags ?? []), ...tags])).slice(0, 30);
    patch.tags = merged;
  }
  if (temperature) patch.temperature = temperature;

  if (event === "webinar_attended") patch.webinar_status = "attended";
  if (event === "webinar_late") patch.webinar_status = "late";
  if (event === "webinar_no_show") patch.webinar_status = "no_show";
  if (event === "deposit_received") {
    const amount = Number((metadata as { amount?: number }).amount ?? 10000);
    if (Number.isFinite(amount) && amount > 0) patch.deposit_amount = amount;
  }
  if (event === "payment_received") {
    patch.paid = true;
    patch.paid_at = new Date().toISOString();
    const amount = Number((metadata as { amount?: number }).amount);
    if (Number.isFinite(amount) && amount > 0) patch.amount = amount;
  }

  let status: "applied" | "skipped" = "applied";
  if (!canAdvance(String(fromRole), targetRole)) {
    status = "skipped";
  } else {
    patch.stage_id = target.id;
  }

  const { error: updErr } = await supabase.from("leads").update(patch).eq("id", lead.id);
  if (updErr) {
    await supabase.from("crm_automation_events").insert({
      project_id: projectId,
      lead_id: lead.id,
      event,
      idempotency_key: idempotencyKey,
      from_stage_id: lead.stage_id,
      to_stage_id: target.id,
      confidence,
      tags,
      metadata,
      source: "n8n",
      status: "error",
      error: updErr.message,
    });
    return json({ error: "update_failed", detail: updErr.message }, 500);
  }

  await supabase.from("events").insert({
    lead_id: lead.id,
    event_type: "launch_action",
    payload: {
      source: "automation",
      event,
      from_role: fromRole,
      to_role: targetRole,
      status,
      confidence: confidence ?? null,
    },
  });

  await supabase.from("crm_automation_events").insert({
    project_id: projectId,
    lead_id: lead.id,
    event,
    idempotency_key: idempotencyKey,
    from_stage_id: lead.stage_id,
    to_stage_id: status === "applied" ? target.id : lead.stage_id,
    confidence,
    tags,
    metadata,
    source: "n8n",
    status,
  });

  return json({
    ok: true,
    status,
    lead_id: lead.id,
    event,
    from_role: fromRole,
    to_role: targetRole,
    to_stage_key: target.key,
  });
});
