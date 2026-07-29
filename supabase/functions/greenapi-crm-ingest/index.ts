// greenapi-crm-ingest — catch-up CRM leads/messages without owning Green webhook.
//
// Bot (n8n) keeps webhookUrl. This poller reads lastIncomingMessages /
// lastOutgoingMessages and upserts into leads + communications so CRM stays
// in sync without setSettings fights that thrash the instance.
//
// Auth: x-automation-key = automation_settings.cron_secret
// Cron: every 2 minutes (pg_cron).
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import {
  DEFAULT_GREEN_API_BASE_URL,
  validateGreenApiBaseUrl,
} from "../_lib/green_api_url.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-automation-key",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type WaRow = {
  project_id: string;
  id_instance: string;
  api_token: string;
  api_url: string | null;
};

type JournalMsg = {
  type?: string;
  idMessage?: string;
  timestamp?: number;
  typeMessage?: string;
  chatId?: string;
  textMessage?: string;
  extendedTextMessage?: { text?: string } | null;
  senderId?: string;
  senderName?: string;
  senderContactName?: string;
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

function msgText(m: JournalMsg): string {
  const t = (m.textMessage ?? "").trim();
  if (t) return t;
  const ext = (m.extendedTextMessage?.text ?? "").trim();
  if (ext) return ext;
  const tm = m.typeMessage ?? "";
  if (tm === "imageMessage") return "[Изображение]";
  if (tm === "videoMessage") return "[Видео]";
  if (tm === "audioMessage" || tm === "pttMessage") return "[Аудио]";
  if (tm === "documentMessage") return "[Документ]";
  if (tm === "stickerMessage") return "[Стикер]";
  return tm ? `[${tm}]` : "";
}

function looksLikeBotStart(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/^\/start\b/i.test(t)) return true;
  if (/^старт([_\s-]|$)/i.test(t)) return true;
  if (/^start([_\s-]|$)/i.test(t)) return true;
  if (/хочу\s+(получить\s+)?доступ/i.test(t)) return true;
  if (/^доступ\b/i.test(t)) return true;
  return false;
}

async function findExistingLeadId(phone: string, projectId: string): Promise<string | null> {
  const d = digits(phone);
  if (!d) return null;
  const needle = d.slice(-10);
  const { data } = await admin
    .from("leads")
    .select("id, phone")
    .eq("project_id", projectId)
    .eq("is_personal", false)
    .or(`phone.eq.+${d},phone.eq.${d},phone.like.%${needle}`)
    .order("created_at", { ascending: false })
    .limit(20);
  const hit = (data ?? []).find((l) => {
    const p = digits((l as { phone?: string }).phone);
    return p === d || p.endsWith(needle) || needle.endsWith(p.slice(-10));
  }) as { id: string } | undefined;
  return hit?.id ?? null;
}

async function getDefaultStage(projectId: string): Promise<{ pipeline_id: string; stage_id: string } | null> {
  const { data: pipe } = await admin
    .from("pipelines")
    .select("id")
    .eq("project_id", projectId)
    .eq("is_default", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const pipelineId = (pipe as { id?: string } | null)?.id;
  if (!pipelineId) return null;
  const { data: stages } = await admin
    .from("pipeline_stages")
    .select("id, key, stage_role, order_index")
    .eq("pipeline_id", pipelineId)
    .order("order_index", { ascending: true });
  const list = (stages ?? []) as { id: string; key: string; stage_role: string | null }[];
  const neu = list.find((s) => s.stage_role === "new" || s.key === "new") ?? list[0];
  if (!neu) return null;
  return { pipeline_id: pipelineId, stage_id: neu.id };
}

async function findOrCreateLead(
  phone: string,
  displayName: string,
  projectId: string,
): Promise<string | null> {
  const d = digits(phone);
  if (!d) return null;
  const existing = await findExistingLeadId(phone, projectId);
  if (existing) return existing;

  const def = await getDefaultStage(projectId);
  if (!def) return null;

  const { data: proj } = await admin
    .from("projects")
    .select("created_by")
    .eq("id", projectId)
    .maybeSingle();
  const ownerId = (proj as { created_by?: string | null } | null)?.created_by ?? null;

  const { data: created, error } = await admin
    .from("leads")
    .insert({
      name: displayName || `+${d}`,
      phone: `+${d}`,
      source: "whatsapp",
      channel: "whatsapp",
      project_id: projectId,
      pipeline_id: def.pipeline_id,
      stage_id: def.stage_id,
      created_by: ownerId,
      assigned_to: ownerId,
      last_activity_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) {
    console.error("greenapi-crm-ingest createLead", error);
    return null;
  }
  return (created as { id: string }).id;
}

async function insertCommunication(opts: {
  leadId: string;
  direction: "in" | "out";
  text: string;
  isAuto?: boolean;
  externalId?: string | null;
}) {
  if (opts.externalId) {
    const { data: existing } = await admin
      .from("communications")
      .select("id")
      .eq("external_id", opts.externalId)
      .maybeSingle();
    if (existing?.id) return false;
  }
  const { error } = await admin.from("communications").insert({
    lead_id: opts.leadId,
    type: "message",
    direction: opts.direction,
    channel: "whatsapp",
    content: opts.text,
    status: opts.direction === "in" ? "delivered" : "sent",
    is_draft: false,
    is_auto: !!opts.isAuto,
    external_id: opts.externalId ?? null,
  });
  if (error) {
    // unique external_id race
    if (/duplicate|unique/i.test(error.message)) return false;
    console.warn("insertCommunication", error);
    return false;
  }
  return true;
}

async function maybeAdvanceBotActivated(leadId: string, reason: string) {
  try {
    const { data: lead } = await admin
      .from("leads")
      .select("id, stage_id, pipeline_id")
      .eq("id", leadId)
      .maybeSingle();
    if (!lead?.stage_id || !lead.pipeline_id) return;

    const { data: pipe } = await admin
      .from("pipelines")
      .select("id, template_key")
      .eq("id", lead.pipeline_id)
      .maybeSingle();
    if ((pipe as { template_key?: string | null } | null)?.template_key !== "launch") return;

    const { data: stages } = await admin
      .from("pipeline_stages")
      .select("id, key, stage_role, order_index")
      .eq("pipeline_id", lead.pipeline_id)
      .order("order_index", { ascending: true });
    const list = (stages ?? []) as {
      id: string;
      key: string;
      stage_role: string | null;
    }[];
    const current = list.find((s) => s.id === lead.stage_id);
    if (!current) return;
    const curRole = current.stage_role || current.key;
    if (curRole !== "new") return;

    const target = list.find(
      (s) =>
        s.stage_role === "bot_activated" ||
        s.key === "bot_activated" ||
        s.key === "whatsapp",
    );
    if (!target || target.id === lead.stage_id) return;

    await admin.from("leads").update({
      stage_id: target.id,
      updated_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
    }).eq("id", leadId);

    await admin.from("lead_status_history").insert({
      lead_id: leadId,
      from_stage_id: lead.stage_id,
      to_stage_id: target.id,
      changed_by: null,
    }).then(() => undefined, () => undefined);

    console.log("greenapi-crm-ingest: bot_activated", { leadId, reason });
  } catch (e) {
    console.warn("maybeAdvanceBotActivated failed", e);
  }
}

async function fetchJournal(
  baseUrl: string,
  idInstance: string,
  apiToken: string,
  kind: "incoming" | "outgoing",
  minutes: number,
): Promise<JournalMsg[]> {
  const path = kind === "incoming" ? "lastIncomingMessages" : "lastOutgoingMessages";
  const url = `${baseUrl}/waInstance${idInstance}/${path}/${apiToken}?minutes=${minutes}`;
  const res = await fetch(url);
  if (res.status === 429) {
    console.warn("greenapi-crm-ingest rate limited", kind);
    return [];
  }
  if (!res.ok) {
    console.warn("greenapi-crm-ingest fetch failed", kind, res.status, await res.text().catch(() => ""));
    return [];
  }
  const data = await res.json().catch(() => null);
  return Array.isArray(data) ? (data as JournalMsg[]) : [];
}

async function ingestProject(row: WaRow, minutes: number) {
  let baseUrl = DEFAULT_GREEN_API_BASE_URL;
  try {
    baseUrl = validateGreenApiBaseUrl(row.api_url ?? "");
  } catch {
    return { projectId: row.project_id, error: "bad_api_url", leads: 0, messages: 0 };
  }

  const incoming = await fetchJournal(baseUrl, row.id_instance, row.api_token, "incoming", minutes);
  // Small pause to avoid Green API 429 between journal calls.
  await new Promise((r) => setTimeout(r, 400));
  const outgoing = await fetchJournal(baseUrl, row.id_instance, row.api_token, "outgoing", minutes);

  let leadsCreated = 0;
  let messages = 0;

  const handle = async (m: JournalMsg, direction: "in" | "out") => {
    const chat = m.chatId || m.senderId || "";
    if (chat.includes("@g.us")) return; // skip groups
    const phone = digits(chat);
    if (phone.length < 8) return;
    const idMessage = m.idMessage ?? null;
    const text = msgText(m);
    const name = (m.senderName || m.senderContactName || "").trim();

  const before = await findExistingLeadId(phone, row.project_id);
  let leadId = before;
  if (!leadId) {
    leadId = await findOrCreateLead(phone, name, row.project_id);
    // Re-check in case of concurrent insert race.
    if (!leadId) leadId = await findExistingLeadId(phone, row.project_id);
  }
  if (!leadId) return;
  if (!before) leadsCreated += 1;

    const isAuto = direction === "out"; // journal outgoing from API/phone; treat as bot/auto for stage
    const inserted = await insertCommunication({
      leadId,
      direction,
      text,
      isAuto: direction === "out",
      externalId: idMessage,
    });
    if (inserted) messages += 1;

    if (direction === "in" && looksLikeBotStart(text)) {
      await maybeAdvanceBotActivated(leadId, "ingest_inbound_start");
    }
    if (direction === "out" && isAuto) {
      await maybeAdvanceBotActivated(leadId, "ingest_outgoing");
    }

    await admin.from("leads").update({
      last_activity_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", leadId);
  };

  // Inbound first so lead exists before outbound greeting advances stage.
  for (const m of incoming) {
    if ((m.type ?? "incoming") !== "incoming") continue;
    await handle(m, "in");
  }
  for (const m of outgoing) {
    if ((m.type ?? "outgoing") !== "outgoing") continue;
    await handle(m, "out");
  }

  return { projectId: row.project_id, leads: leadsCreated, messages, inbound: incoming.length, outbound: outgoing.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const key = req.headers.get("x-automation-key") ?? "";
  const { data: settings } = await admin
    .from("automation_settings")
    .select("cron_secret")
    .eq("id", true)
    .maybeSingle();
  const secret = (settings as { cron_secret?: string } | null)?.cron_secret ?? "";
  if (!secret || key !== secret) return json({ error: "unauthorized" }, 401);

  let minutes = 30;
  let projectId: string | null = null;
  try {
    const body = await req.json().catch(() => ({})) as { minutes?: number; project_id?: string };
    if (typeof body.minutes === "number" && body.minutes >= 5 && body.minutes <= 1440) {
      minutes = Math.floor(body.minutes);
    }
    if (typeof body.project_id === "string" && body.project_id.length > 10) {
      projectId = body.project_id;
    }
  } catch { /* defaults */ }

  let q = admin
    .from("whatsapp_config")
    .select("project_id, id_instance, api_token, api_url")
    .not("project_id", "is", null)
    .not("id_instance", "is", null)
    .not("api_token", "is", null);
  if (projectId) q = q.eq("project_id", projectId);
  const { data: rows, error } = await q;
  if (error) return json({ error: error.message }, 500);

  const results = [];
  for (const row of (rows ?? []) as WaRow[]) {
    if (!row.api_token?.trim() || !row.id_instance) continue;
    try {
      results.push(await ingestProject(row, minutes));
      await new Promise((r) => setTimeout(r, 500));
    } catch (e) {
      results.push({ projectId: row.project_id, error: String(e) });
    }
  }

  return json({ ok: true, minutes, results });
});
