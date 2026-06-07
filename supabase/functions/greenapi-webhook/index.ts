// Green API webhook receiver.
// Public endpoint (no JWT). Configure this URL in Green API console under
// "Webhooks → URL для получения уведомлений".
//
// Supported notification types:
// - incomingMessageReceived       → save inbound message, create lead if missing
// - outgoingMessageReceived       → save outbound (sent from phone)
// - outgoingAPIMessageReceived    → save outbound (sent via API)
// - outgoingMessageStatus         → update communications.status
// - stateInstanceChanged          → updates whatsapp_config.connected
//
// Multi-instance: routing happens via whatsapp_config.id_instance, so the
// same URL serves every project's Green API instance.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Дебаунс на triggerChatAnalysis: разные окна для входящих и исходящих.
// - "out" (ответил менеджер): 30 сек — переоцениваем переписку быстро.
// - "in"  (только клиент написал): 5 мин — даём шанс менеджеру ответить,
//   чтобы лид с 1+ входящим всё равно попал в статистику (с флагом
//   flag_ghosted_by_manager, если ответа так и не было).
const _aiRopDebounce = new Map<string, number>(); // key = `${dir}:${leadId}`
function triggerChatAnalysis(leadId: string, dir: "in" | "out" = "out") {
  try {
    const now = Date.now();
    const windowMs = dir === "in" ? 5 * 60_000 : 30_000;
    const key = `${dir}:${leadId}`;
    const last = _aiRopDebounce.get(key) ?? 0;
    if (now - last < windowMs) return;
    _aiRopDebounce.set(key, now);
    // Fire-and-forget POST в ai-rop-analyze-chat
    fetch(`${SUPABASE_URL}/functions/v1/ai-rop-analyze-chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-key": SERVICE_ROLE,
      },
      body: JSON.stringify({ lead_id: leadId }),
    }).catch((e) => console.warn("ai-rop-analyze-chat trigger failed:", e));
  } catch (e) {
    console.warn("triggerChatAnalysis threw:", e);
  }
}


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

type InstanceConfig = {
  projectId: string | null;
  ok: boolean;
  adsOnly: boolean;
  botWebhookUrl: string | null;
};

// Resolve which project a webhook belongs to via whatsapp_config.id_instance,
// and verify the per-instance webhook_token if one is configured.
async function projectFromInstance(
  idInstance: number | string | null | undefined,
  presentedToken: string | null,
): Promise<InstanceConfig> {
  if (!idInstance) {
    return { projectId: null, ok: true, adsOnly: false, botWebhookUrl: null };
  }
  const { data } = await admin
    .from("whatsapp_config")
    .select("project_id, webhook_token, ads_only, bot_webhook_url")
    .eq("id_instance", String(idInstance))
    .maybeSingle();
  if (!data) {
    return { projectId: null, ok: true, adsOnly: false, botWebhookUrl: null };
  }
  const row = data as {
    project_id?: string | null;
    webhook_token?: string | null;
    ads_only?: boolean | null;
    bot_webhook_url?: string | null;
  };
  const expected = row.webhook_token ?? null;
  const envToken = Deno.env.get("GREENAPI_WEBHOOK_TOKEN") ?? null;
  const required = expected || envToken;
  if (required && required !== presentedToken) {
    return {
      projectId: row.project_id ?? null,
      ok: false,
      adsOnly: !!row.ads_only,
      botWebhookUrl: row.bot_webhook_url ?? null,
    };
  }
  return {
    projectId: row.project_id ?? null,
    ok: true,
    adsOnly: !!row.ads_only,
    botWebhookUrl: row.bot_webhook_url ?? null,
  };
}

function forwardToBotWebhook(url: string | null | undefined, body: Record<string, unknown>) {
  const target = url?.trim();
  if (!target) return;
  fetch(target, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch((e) => console.warn("bot_webhook forward failed:", e));
}

async function findExistingLeadId(
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
  if (existing && existing.length > 0) {
    return (existing[0] as { id: string }).id;
  }

  let scan = admin
    .from("leads")
    .select("id, phone")
    .order("created_at", { ascending: false })
    .limit(500);
  if (projectId) scan = scan.eq("project_id", projectId);
  const { data: recent } = await scan;
  const match = (recent ?? []).find((l) => digits(l.phone) === d) as { id: string } | undefined;
  return match?.id ?? null;
}

// Best-effort parser of Meta CTWA (Click-To-WhatsApp) referral payload.
// Green API не имеет жёсткой схемы, поэтому ищем известные ключи в нескольких
// местах и собираем то, что нашли.
interface CtwaAttribution {
  meta_ad_id: string | null;
  meta_adset_id: string | null;
  meta_campaign_id: string | null;
  click_id: string | null;
  headline: string | null;
}
function parseCtwa(messageData: Record<string, unknown> | undefined, body: Record<string, unknown>): CtwaAttribution {
  const out: CtwaAttribution = { meta_ad_id: null, meta_adset_id: null, meta_campaign_id: null, click_id: null, headline: null };
  if (!messageData) return out;
  const candidates: Record<string, unknown>[] = [];
  const ext = messageData.extendedTextMessageData as Record<string, unknown> | undefined;
  if (ext) candidates.push(ext);
  const ctx = messageData.contextInfo as Record<string, unknown> | undefined;
  if (ctx) candidates.push(ctx);
  const refTop = body.referralData as Record<string, unknown> | undefined;
  if (refTop) candidates.push(refTop);
  const sender = body.senderData as Record<string, unknown> | undefined;
  if (sender) candidates.push(sender);
  const refExt = ext?.referral as Record<string, unknown> | undefined;
  if (refExt) candidates.push(refExt);
  const refCtx = ctx?.referral as Record<string, unknown> | undefined;
  if (refCtx) candidates.push(refCtx);
  // WhatsApp Cloud API canonical CTWA payload: contextInfo.externalAdReply
  const earCtx = (ctx?.externalAdReply ?? ctx?.external_ad_reply) as Record<string, unknown> | undefined;
  if (earCtx) candidates.push(earCtx);
  const earExt = (ext?.externalAdReply ?? ext?.external_ad_reply) as Record<string, unknown> | undefined;
  if (earExt) candidates.push(earExt);
  const earTop = (messageData.externalAdReply ?? messageData.external_ad_reply) as Record<string, unknown> | undefined;
  if (earTop) candidates.push(earTop);
  const quoted = (messageData.quotedMessage ?? messageData.quoted_message) as Record<string, unknown> | undefined;
  if (quoted) {
    const qctx = (quoted.contextInfo ?? quoted.context_info) as Record<string, unknown> | undefined;
    if (qctx) {
      candidates.push(qctx);
      const qear = (qctx.externalAdReply ?? qctx.external_ad_reply) as Record<string, unknown> | undefined;
      if (qear) candidates.push(qear);
    }
  }

  const tryExtractAdFromUrl = (u: unknown): string | null => {
    if (!u || typeof u !== "string") return null;
    const m1 = u.match(/[?&](?:ad_id|adId|content)=([0-9]{6,})/);
    if (m1) return m1[1];
    const m2 = u.match(/fb\.me\/([0-9]{6,})/);
    if (m2) return m2[1];
    return null;
  };

  for (const c of candidates) {
    const sourceId = c.sourceId ?? c.source_id ?? c.adId ?? c.ad_id;
    if (sourceId && !out.meta_ad_id) out.meta_ad_id = String(sourceId);
    const ctwa = c.ctwaClid ?? c.ctwa_clid ?? c.clickId ?? c.click_id;
    if (ctwa && !out.click_id) out.click_id = String(ctwa);
    const camp = c.campaignId ?? c.campaign_id;
    if (camp && !out.meta_campaign_id) out.meta_campaign_id = String(camp);
    const adset = c.adsetId ?? c.adset_id;
    if (adset && !out.meta_adset_id) out.meta_adset_id = String(adset);
    const headline = c.headline ?? c.title;
    if (headline && !out.headline) out.headline = String(headline);
    if (!out.meta_ad_id) {
      const fromUrl = tryExtractAdFromUrl(c.sourceUrl ?? c.source_url ?? c.url);
      if (fromUrl) out.meta_ad_id = fromUrl;
    }
  }
  return out;
}

// Sticky attribution: try previous CTWA-attributed lead from the same phone,
// then a wa_clicks row matched to this phone. Used when current message has no referral.
async function attributionFromPhone(phone: string, projectId: string | null): Promise<CtwaAttribution | null> {
  const d = digits(phone);
  if (!d) return null;
  let q = admin
    .from("phone_attribution")
    .select("meta_ad_id, meta_adset_id, meta_campaign_id, click_id, captured_at")
    .eq("phone", d)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (projectId) q = q.eq("project_id", projectId);
  const { data } = await q;
  const row = (data ?? [])[0] as { meta_ad_id: string | null; meta_adset_id: string | null; meta_campaign_id: string | null; click_id: string | null; captured_at: string } | undefined;
  if (row?.meta_ad_id) {
    const ageMs = Date.now() - new Date(row.captured_at).getTime();
    if (ageMs <= 30 * 24 * 3600 * 1000) {
      return { meta_ad_id: row.meta_ad_id, meta_adset_id: row.meta_adset_id, meta_campaign_id: row.meta_campaign_id, click_id: row.click_id, headline: null };
    }
  }
  const { data: wc } = await admin
    .from("wa_clicks")
    .select("utm_content, utm_term, utm_campaign, click_id")
    .or(`matched_phone.eq.+${d},matched_phone.eq.${d}`)
    .order("created_at", { ascending: false })
    .limit(1);
  const w = (wc ?? [])[0] as { utm_content: string | null; utm_term: string | null; utm_campaign: string | null; click_id: string | null } | undefined;
  if (w?.utm_content && /^[0-9]{6,}$/.test(w.utm_content)) {
    return { meta_ad_id: w.utm_content, meta_adset_id: w.utm_term, meta_campaign_id: w.utm_campaign, click_id: w.click_id, headline: null };
  }
  return null;
}

async function enrichFromCreative(adId: string): Promise<{ campaign_id: string | null; adset_id: string | null; cabinet_id: string | null; project_id: string | null }> {
  const { data } = await admin
    .from("meta_creatives")
    .select("campaign_id, adset_id, cabinet_id, project_id")
    .eq("ad_id", adId)
    .maybeSingle();
  return {
    campaign_id: data?.campaign_id ?? null,
    adset_id: (data as { adset_id?: string | null } | null)?.adset_id ?? null,
    cabinet_id: data?.cabinet_id ?? null,
    project_id: data?.project_id ?? null,
  };
}

async function findOrCreateLead(
  phone: string,
  displayName: string,
  projectId: string | null,
  attribution?: CtwaAttribution,
): Promise<string | null> {
  const d = digits(phone);
  if (!d) return null;

  // Если CTWA-атрибуция пришла прямо в первом сообщении — сохраняем её в wa_clicks,
  // чтобы потом матчить с пикселем сайта. Делаем перед поиском лида, чтобы запись была
  // даже если лид уже существует.
  if (attribution?.click_id) {
    await admin.from("wa_clicks").upsert({
      click_id: attribution.click_id,
      utm_source: "meta",
      utm_medium: "ctwa",
      utm_campaign: attribution.meta_campaign_id ?? null,
      utm_content: attribution.meta_ad_id ?? null,
      utm_term: attribution.meta_adset_id ?? null,
      matched: true,
      matched_at: new Date().toISOString(),
      matched_phone: `+${d}`,
    }, { onConflict: "click_id" });
  }

  let q = admin
    .from("leads")
    .select("id, phone, meta_ad_id")
    .or(`phone.eq.${phone},phone.eq.+${d},phone.eq.${d}`)
    .limit(1);
  if (projectId) q = q.eq("project_id", projectId);
  const { data: existing } = await q;
  if (existing && existing.length > 0) {
    const row = existing[0] as { id: string; meta_ad_id: string | null };
    if (attribution?.meta_ad_id) {
      await admin.from("leads").update({
        meta_ad_id: attribution.meta_ad_id,
        meta_adset_id: attribution.meta_adset_id,
        meta_campaign_id: attribution.meta_campaign_id,
        click_id: attribution.click_id ?? null,
      }).eq("id", row.id);
    }
    return row.id;
  }

  let scan = admin
    .from("leads")
    .select("id, phone, meta_ad_id")
    .order("created_at", { ascending: false })
    .limit(500);
  if (projectId) scan = scan.eq("project_id", projectId);
  const { data: recent } = await scan;
  const match = (recent ?? []).find((l) => digits(l.phone) === d) as { id: string; meta_ad_id: string | null } | undefined;
  if (match) {
    if (attribution?.meta_ad_id) {
      await admin.from("leads").update({
        meta_ad_id: attribution.meta_ad_id,
        meta_adset_id: attribution.meta_adset_id,
        meta_campaign_id: attribution.meta_campaign_id,
        click_id: attribution.click_id ?? null,
      }).eq("id", match.id);
    }
    return match.id;
  }

  let resolvedProject = projectId;
  let cabinetId: string | null = null;
  let metaCampaignId = attribution?.meta_campaign_id ?? null;
  let metaAdsetId = attribution?.meta_adset_id ?? null;
  if (attribution?.meta_ad_id) {
    const enriched = await enrichFromCreative(attribution.meta_ad_id);
    if (!resolvedProject && enriched.project_id) resolvedProject = enriched.project_id;
    if (!cabinetId && enriched.cabinet_id) cabinetId = enriched.cabinet_id;
    if (!metaCampaignId && enriched.campaign_id) metaCampaignId = enriched.campaign_id;
  }

  // Fallback атрибуции по wa_clicks: если CTWA-referral не пришёл (например,
  // лид написал не первым сообщением, а после кнопки на сайте → пиксель уже
  // зафиксировал клик → wa_clicks имеет запись с этим click_id или phone),
  // подтягиваем ad_id оттуда.
  if (!attribution?.meta_ad_id) {
    const { data: waClick } = await admin
      .from("wa_clicks")
      .select("utm_content, utm_term, utm_campaign, click_id, fbclid")
      .or(`matched_phone.eq.+${d},matched_phone.eq.${d}`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (waClick) {
      const w = waClick as { utm_content?: string | null; utm_term?: string | null; utm_campaign?: string | null; click_id?: string | null; fbclid?: string | null };
      if (!attribution) attribution = { meta_ad_id: null, meta_adset_id: null, meta_campaign_id: null, click_id: null, headline: null };
      if (!attribution.meta_ad_id && w.utm_content) attribution.meta_ad_id = w.utm_content;
      if (!attribution.meta_adset_id && w.utm_term) attribution.meta_adset_id = w.utm_term;
      if (!attribution.meta_campaign_id && w.utm_campaign) attribution.meta_campaign_id = w.utm_campaign;
      if (!attribution.click_id && (w.click_id || w.fbclid)) attribution.click_id = w.click_id || w.fbclid || null;
      if (attribution.meta_ad_id) {
        const enriched = await enrichFromCreative(attribution.meta_ad_id);
        if (!resolvedProject && enriched.project_id) resolvedProject = enriched.project_id;
        if (!cabinetId && enriched.cabinet_id) cabinetId = enriched.cabinet_id;
        if (!metaCampaignId && enriched.campaign_id) metaCampaignId = enriched.campaign_id;
        if (!metaAdsetId && enriched.adset_id) metaAdsetId = enriched.adset_id;
      }
    }
  }

  const def = await getDefaultStage(resolvedProject);
  if (!def) {
    console.error("No default pipeline/stage found", { projectId: resolvedProject });
    return null;
  }

  // Assign to project owner so CRM shows the lead on first stage for the whole team.
  let ownerId: string | null = null;
  if (resolvedProject) {
    const { data: proj } = await admin
      .from("projects")
      .select("created_by")
      .eq("id", resolvedProject)
      .maybeSingle();
    ownerId = (proj as { created_by?: string | null } | null)?.created_by ?? null;
  }

  const { data: created, error } = await admin
    .from("leads")
    .insert({
      name: displayName || `+${d}`,
      phone: `+${d}`,
      source: attribution?.meta_ad_id ? "meta" : "whatsapp",
      channel: "whatsapp",
      project_id: resolvedProject,
      cabinet_id: cabinetId,
      pipeline_id: def.pipeline_id,
      stage_id: def.stage_id,
      created_by: ownerId,
      assigned_to: ownerId,
      meta_ad_id: attribution?.meta_ad_id ?? null,
      meta_adset_id: metaAdsetId,
      meta_campaign_id: metaCampaignId,
      click_id: attribution?.click_id ?? null,
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

  const instanceData = body.instanceData as { idInstance?: number } | undefined;
  const type = body.typeWebhook as string | undefined;
  // Anti-spoof: Green API can append a configurable token to the webhook URL
  // (?token=...) or send it in the body as `webhookUrlToken`. We compare it to
  // the token stored per-instance in whatsapp_config.webhook_token (or to the
  // global GREENAPI_WEBHOOK_TOKEN env). If the instance has a token configured
  // and the presented one doesn't match — reject. Otherwise (no token set) we
  // stay backwards-compatible and accept the call.
  const url = new URL(req.url);
  const presentedToken =
    url.searchParams.get("token") ??
    (typeof body.webhookUrlToken === "string" ? (body.webhookUrlToken as string) : null);
  const instanceCfg = await projectFromInstance(instanceData?.idInstance, presentedToken);
  if (!instanceCfg.ok) {
    console.warn("greenapi-webhook: invalid webhook token", { idInstance: instanceData?.idInstance });
    return json({ error: "invalid webhook token" }, 401);
  }
  const projectId = instanceCfg.projectId;

  try {
    const idMessage = (body.idMessage as string | undefined) ?? null;

    if (type === "incomingMessageReceived") {
      const senderData = body.senderData as
        | { chatId?: string; sender?: string; senderName?: string }
        | undefined;
      const messageData = body.messageData as Record<string, unknown> | undefined;
      const phone = chatIdToPhone(senderData?.chatId ?? senderData?.sender);
      const name = senderData?.senderName?.trim() || "";
      if (!phone) {
        forwardToBotWebhook(instanceCfg.botWebhookUrl, body);
        return json({ ok: true, skipped: "no phone" });
      }
      let attribution: CtwaAttribution | null = parseCtwa(messageData, body);
      if (!attribution?.meta_ad_id) {
        const fallback = await attributionFromPhone(phone, projectId);
        if (fallback) attribution = fallback;
      }
      if (!attribution?.meta_ad_id) {
        console.log("ctwa_no_attribution", JSON.stringify({ phone, projectId, messageData }).slice(0, 4000));
      }

      const existingLeadId = await findExistingLeadId(phone, projectId);
      if (!existingLeadId && instanceCfg.adsOnly && !attribution?.meta_ad_id) {
        forwardToBotWebhook(instanceCfg.botWebhookUrl, body);
        return json({ ok: true, skipped: "ads_only_no_ctwa", projectId });
      }

      const leadId = existingLeadId ??
        await findOrCreateLead(phone, name, projectId, attribution ?? undefined);
      if (!leadId) return json({ ok: false, error: "lead not created" }, 500);
      const text = extractText(messageData);
      await insertCommunication({ leadId, direction: "in", text, externalId: idMessage });
      triggerChatAnalysis(leadId, "in");
      forwardToBotWebhook(instanceCfg.botWebhookUrl, body);
      return json({ ok: true, leadId, projectId, attribution });
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
      // Fire-and-forget: попросим AI-РОПа переоценить переписку.
      // Не блокируем ответ Green API.
      triggerChatAnalysis(leadId, "out");
      forwardToBotWebhook(instanceCfg.botWebhookUrl, body);
      return json({ ok: true, leadId, projectId });
    }


    if (type === "stateInstanceChanged") {
      // Push the live state into the bound row so the UI status badge
      // doesn't go stale between manual "Обновить" clicks.
      const stateInstance = (body.stateInstance as string | undefined) ?? null;
      const isAuth = stateInstance === "authorized";
      const idi = instanceData?.idInstance;
      if (idi) {
        const patch: Record<string, unknown> = {
          connected: isAuth,
          updated_at: new Date().toISOString(),
        };
        if (isAuth) patch.connected_at = new Date().toISOString();
        await admin
          .from("whatsapp_config")
          .update(patch)
          .eq("id_instance", String(idi));
      }
      forwardToBotWebhook(instanceCfg.botWebhookUrl, body);
      return json({ ok: true, state: stateInstance, projectId });
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
      forwardToBotWebhook(instanceCfg.botWebhookUrl, body);
      return json({ ok: true, externalId: idMessage, status: newStatus });
    }

    forwardToBotWebhook(instanceCfg.botWebhookUrl, body);
    return json({ ok: true, skipped: type ?? "unknown" });
  } catch (e) {
    console.error("webhook error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
