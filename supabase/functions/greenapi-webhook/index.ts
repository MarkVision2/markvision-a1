// Green API webhook receiver.
// Public endpoint (no JWT). Configure this URL in Green API console under
// "Webhooks → URL для получения уведомлений".
//
// Supported notification types:
// - incomingMessageReceived       → save inbound message, create lead if missing
// - outgoingMessageReceived       → save outbound (sent from phone)
// - outgoingAPIMessageReceived    → save outbound (sent via API)
// - outgoingMessageStatus         → ignored (could update status later)
// - stateInstanceChanged          → updates whatsapp_config.connected
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ID_INSTANCE = Deno.env.get("GREENAPI_ID_INSTANCE") ?? "";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function digits(s: string | null | undefined): string {
  return String(s ?? "").replace(/\D/g, "");
}

/** Convert chatId like "77051234567@c.us" to "+77051234567" */
function chatIdToPhone(chatId: string | undefined | null): string {
  const d = digits(chatId);
  return d ? `+${d}` : "";
}

function extractText(messageData: Record<string, unknown> | undefined): string {
  if (!messageData) return "";
  const td = messageData.textMessageData as { textMessage?: string } | undefined;
  if (td?.textMessage) return td.textMessage;
  const ext = messageData.extendedTextMessageData as
    | { text?: string }
    | undefined;
  if (ext?.text) return ext.text;
  const tm = messageData.typeMessage as string | undefined;
  if (tm === "imageMessage") return "[Изображение]";
  if (tm === "videoMessage") return "[Видео]";
  if (tm === "audioMessage") return "[Аудио]";
  if (tm === "documentMessage") return "[Документ]";
  if (tm === "stickerMessage") return "[Стикер]";
  if (tm === "locationMessage") return "[Геолокация]";
  if (tm === "contactMessage") return "[Контакт]";
  return "[Сообщение]";
}

async function firstStage(pipelineId: string): Promise<string | null> {
  const { data } = await admin
    .from("pipeline_stages")
    .select("id")
    .eq("pipeline_id", pipelineId)
    .order("order_index", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

// Resolve pipeline + first stage:
//   1) project-scoped default → 2) any project pipeline →
//   3) global default → 4) any. Mirrors lead-intake routing.
async function getDefaultStage(
  projectId: string | null,
): Promise<{ pipeline_id: string; stage_id: string } | null> {
  const tryPipe = async (id: string | null | undefined) => {
    if (!id) return null;
    const sid = await firstStage(id);
    return sid ? { pipeline_id: id, stage_id: sid } : null;
  };
  if (projectId) {
    const { data: d1 } = await admin
      .from("pipelines").select("id")
      .eq("project_id", projectId).eq("is_default", true)
      .order("created_at", { ascending: true }).limit(1).maybeSingle();
    const r1 = await tryPipe(d1?.id);
    if (r1) return r1;
    const { data: d2 } = await admin
      .from("pipelines").select("id")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true }).limit(1).maybeSingle();
    const r2 = await tryPipe(d2?.id);
    if (r2) return r2;
  }
  const { data: d3 } = await admin
    .from("pipelines").select("id")
    .is("project_id", null).eq("is_default", true)
    .order("created_at", { ascending: true }).limit(1).maybeSingle();
  const r3 = await tryPipe(d3?.id);
  if (r3) return r3;
  const { data: d4 } = await admin
    .from("pipelines").select("id")
    .order("created_at", { ascending: true }).limit(1).maybeSingle();
  return tryPipe(d4?.id);
}

// Resolve which project a webhook belongs to via whatsapp_config.id_instance.
// Also returns the ads_only flag — when true, only ad-sourced incoming
// messages create new leads (existing leads still receive every message).
async function configFromInstance(
  idInstance: number | string | null | undefined,
): Promise<{ project_id: string | null; ads_only: boolean }> {
  if (!idInstance) return { project_id: null, ads_only: false };
  const { data } = await admin
    .from("whatsapp_config")
    .select("project_id, ads_only")
    .eq("id_instance", String(idInstance))
    .maybeSingle();
  return {
    project_id: data?.project_id ?? null,
    ads_only: !!data?.ads_only,
  };
}

// Detect Meta Click-to-WhatsApp ad context in a Green API incoming payload.
// Meta forwards ad-click messages with referral metadata: source URL points
// to fb.me / l.facebook / wa.me, the click id (ctwa_clid) appears in URLs,
// or the message is decorated with a `sourceType: "ad"` block.
function isFromMetaAd(body: Record<string, unknown>): boolean {
  const md = body.messageData as Record<string, unknown> | undefined;
  if (!md) return false;

  const haystack = JSON.stringify(body).toLowerCase();
  if (haystack.includes("ctwa_clid")) return true;
  if (haystack.includes("\"sourcetype\":\"ad\"")) return true;
  if (haystack.includes("\"sourceid\":\"ad")) return true;
  if (
    /https?:\/\/(?:[^"\s]*\.)?(?:fb\.me|l\.facebook\.com|facebook\.com\/ads|business\.facebook\.com|wa\.me|api\.whatsapp\.com)/i
      .test(haystack)
  ) {
    // wa.me alone is weak — require it to live alongside fb/instagram/ad markers.
    if (
      haystack.includes("fb.me") ||
      haystack.includes("facebook.com") ||
      haystack.includes("instagram.com") ||
      haystack.includes("ad_id") ||
      haystack.includes("\"sourcetype\"")
    ) {
      return true;
    }
  }
  // Quoted advertisement object (older Green API shape).
  const quoted = md.quotedMessage as Record<string, unknown> | undefined;
  if (quoted && (quoted.advertisement || quoted.externalAdReply)) return true;
  return false;
}

async function findExistingLead(
  phone: string,
  projectId: string | null,
): Promise<string | null> {
  const d = digits(phone);
  if (!d) return null;
  let q = admin
    .from("leads")
    .select("id, phone")
    .or(`phone.eq.${phone},phone.eq.+${d},phone.eq.${d}`)
    .limit(1);
  if (projectId) q = q.eq("project_id", projectId);
  const { data: existing } = await q;
  if (existing && existing.length > 0) return existing[0].id;

  let scan = admin
    .from("leads")
    .select("id, phone")
    .order("created_at", { ascending: false })
    .limit(500);
  if (projectId) scan = scan.eq("project_id", projectId);
  const { data: recent } = await scan;
  const match = (recent ?? []).find((l) => digits(l.phone) === d);
  return match?.id ?? null;
}

async function createLead(
  phone: string,
  displayName: string,
  projectId: string | null,
  source: string,
): Promise<string | null> {
  const d = digits(phone);
  if (!d) return null;
  const def = await getDefaultStage(projectId);
  if (!def) {
    console.error("No default pipeline/stage found", { projectId });
    return null;
  }
  const { data: created, error } = await admin
    .from("leads")
    .insert({
      name: displayName || `+${d}`,
      phone: `+${d}`,
      source,
      channel: "whatsapp",
      project_id: projectId,
      pipeline_id: def.pipeline_id,
      stage_id: def.stage_id,
    })
    .select("id")
    .single();
  if (error) {
    console.error("createLead error", error);
    return null;
  }
  return created.id;
}

async function findOrCreateLead(
  phone: string,
  displayName: string,
  projectId: string | null,
  source = "whatsapp",
): Promise<string | null> {
  const existing = await findExistingLead(phone, projectId);
  if (existing) return existing;
  return createLead(phone, displayName, projectId, source);
}

async function insertCommunication(opts: {
  leadId: string;
  direction: "in" | "out";
  text: string;
  isAuto?: boolean;
  externalId?: string | null;
}) {
  // Dedupe: if a row with this external_id already exists, skip insert
  if (opts.externalId) {
    const { data: existing } = await admin
      .from("communications")
      .select("id")
      .eq("external_id", opts.externalId)
      .maybeSingle();
    if (existing?.id) return;
  }
  await admin.from("communications").insert({
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
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ ok: true, hint: "POST notifications here" });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  // Optional: ignore notifications from other instances
  const instanceData = body.instanceData as { idInstance?: number } | undefined;
  if (
    ID_INSTANCE &&
    instanceData?.idInstance &&
    String(instanceData.idInstance) !== String(ID_INSTANCE)
  ) {
    return json({ ok: true, skipped: "other instance" });
  }

  const type = body.typeWebhook as string | undefined;
  // Resolve project from the Green API instance id. The same webhook URL
  // can serve multiple instances — one per project — so we route based
  // on which instance actually pinged us.
  const projectId = await projectFromInstance(instanceData?.idInstance);

  try {
    const idMessage = (body.idMessage as string | undefined) ?? null;

    if (type === "incomingMessageReceived") {
      const senderData = body.senderData as
        | { chatId?: string; sender?: string; senderName?: string }
        | undefined;
      const messageData = body.messageData as Record<string, unknown> | undefined;
      const phone = chatIdToPhone(senderData?.chatId ?? senderData?.sender);
      const name = senderData?.senderName?.trim() || "";
      if (!phone) return json({ ok: true, skipped: "no phone" });
      const leadId = await findOrCreateLead(phone, name, projectId);
      if (!leadId) return json({ ok: false, error: "lead not created" }, 500);
      const text = extractText(messageData);
      await insertCommunication({ leadId, direction: "in", text, externalId: idMessage });
      return json({ ok: true, leadId, projectId });
    }

    if (
      type === "outgoingMessageReceived" ||
      type === "outgoingAPIMessageReceived"
    ) {
      const senderData = body.senderData as { chatId?: string } | undefined;
      const messageData = body.messageData as Record<string, unknown> | undefined;
      const phone = chatIdToPhone(senderData?.chatId);
      if (!phone) return json({ ok: true, skipped: "no phone" });
      const leadId = await findOrCreateLead(phone, "", projectId);
      if (!leadId) return json({ ok: false, error: "lead not created" }, 500);
      const text = extractText(messageData);
      await insertCommunication({
        leadId,
        direction: "out",
        text,
        isAuto: type === "outgoingAPIMessageReceived",
        externalId: idMessage,
      });
      return json({ ok: true, leadId, projectId });
    }

    if (type === "stateInstanceChanged") {
      // Could refresh whatsapp_config here. Skip for now.
      return json({ ok: true });
    }

    if (type === "outgoingMessageStatus") {
      // Update delivery status of an outgoing message identified by idMessage.
      // Green API status values: "sent", "delivered", "read", "noAccount", "failed".
      const idMessage = (body.idMessage as string | undefined) ?? null;
      const rawStatus = (body.status as string | undefined) ?? "";
      if (!idMessage || !rawStatus) return json({ ok: true, skipped: "no id/status" });

      const map: Record<string, string> = {
        sent: "sent",
        delivered: "delivered",
        read: "read",
        noAccount: "failed",
        failed: "failed",
        notDelivered: "failed",
      };
      const newStatus = map[rawStatus] ?? rawStatus;

      await admin
        .from("communications")
        .update({ status: newStatus })
        .eq("external_id", idMessage);
      return json({ ok: true, externalId: idMessage, status: newStatus });
    }

    return json({ ok: true, skipped: type ?? "unknown" });
  } catch (e) {
    console.error("webhook error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
