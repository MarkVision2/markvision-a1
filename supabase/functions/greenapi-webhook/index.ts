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

async function getDefaultStage(): Promise<{ pipeline_id: string; stage_id: string } | null> {
  const { data: pipe } = await admin
    .from("pipelines")
    .select("id")
    .eq("is_default", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!pipe?.id) return null;
  const { data: stage } = await admin
    .from("pipeline_stages")
    .select("id")
    .eq("pipeline_id", pipe.id)
    .order("order_index", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!stage?.id) return null;
  return { pipeline_id: pipe.id, stage_id: stage.id };
}

async function findOrCreateLead(
  phone: string,
  displayName: string,
): Promise<string | null> {
  const d = digits(phone);
  if (!d) return null;

  // Try to find by normalized phone digits
  const { data: existing } = await admin
    .from("leads")
    .select("id, phone")
    .or(`phone.eq.${phone},phone.eq.+${d},phone.eq.${d}`)
    .limit(1);

  if (existing && existing.length > 0) return existing[0].id;

  // Broader search: scan recent leads matching by digits (fallback)
  const { data: recent } = await admin
    .from("leads")
    .select("id, phone")
    .order("created_at", { ascending: false })
    .limit(500);
  const match = (recent ?? []).find((l) => digits(l.phone) === d);
  if (match) return match.id;

  // Create new lead
  const def = await getDefaultStage();
  if (!def) {
    console.error("No default pipeline/stage found");
    return null;
  }
  const { data: created, error } = await admin
    .from("leads")
    .insert({
      name: displayName || `+${d}`,
      phone: `+${d}`,
      source: "whatsapp",
      channel: "whatsapp",
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
      const leadId = await findOrCreateLead(phone, name);
      if (!leadId) return json({ ok: false, error: "lead not created" }, 500);
      const text = extractText(messageData);
      await insertCommunication({ leadId, direction: "in", text, externalId: idMessage });
      return json({ ok: true, leadId });
    }

    if (
      type === "outgoingMessageReceived" ||
      type === "outgoingAPIMessageReceived"
    ) {
      const senderData = body.senderData as { chatId?: string } | undefined;
      const messageData = body.messageData as Record<string, unknown> | undefined;
      const phone = chatIdToPhone(senderData?.chatId);
      if (!phone) return json({ ok: true, skipped: "no phone" });
      const leadId = await findOrCreateLead(phone, "");
      if (!leadId) return json({ ok: false, error: "lead not created" }, 500);
      const text = extractText(messageData);
      await insertCommunication({
        leadId,
        direction: "out",
        text,
        isAuto: type === "outgoingAPIMessageReceived",
        externalId: idMessage,
      });
      return json({ ok: true, leadId });
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
