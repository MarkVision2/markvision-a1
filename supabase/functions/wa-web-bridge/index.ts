// WhatsApp Web bridge (free QR multi-device via Baileys daemon on VPS).
//
 // User (JWT): status | start_pair | logout | send
 // Worker (x-wa-web-key): heartbeat | push_qr | set_state | claim | ack | ingest
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireProjectAccess, requireUser } from "../_lib/auth.ts";
import {
  attributionFromWhatsAppText,
  ctwaFromTextAttr,
  emptyCtwa,
  mergeCtwa,
  parseCtwaPayload,
  resolveLeadSourceLabel,
  type CtwaAttribution,
} from "../_lib/waAttribution.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-wa-web-key",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WORKER_KEY = Deno.env.get("WA_WEB_WORKER_KEY") ?? "";

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

/** Dialable E.164 for CRM. Reject WhatsApp LID opaque ids (13+ digits / fake CC 80). */
function isPlausiblePhone(d: string): boolean {
  if (d.length < 8 || d.length > 12) return false;
  if (d.startsWith("80")) return false;
  return true;
}

function workerOk(req: Request): boolean {
  if (!WORKER_KEY) return false;
  const presented = req.headers.get("x-wa-web-key") ?? "";
  return presented.length > 0 && presented === WORKER_KEY;
}

async function ensureSession(projectId: string) {
  const { data: existing } = await admin
    .from("whatsapp_web_sessions")
    .select("*")
    .eq("project_id", projectId)
    .maybeSingle();
  if (existing) return existing;
  const { data, error } = await admin
    .from("whatsapp_web_sessions")
    .insert({ project_id: projectId, status: "disconnected" })
    .select("*")
    .single();
  if (error) throw error;
  return data;
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

async function getDefaultStage(projectId: string | null): Promise<{ pipeline_id: string; stage_id: string } | null> {
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
  return null;
}

async function attributionFromPhone(
  phone: string,
  projectId: string | null,
): Promise<CtwaAttribution | null> {
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
  const row = (data ?? [])[0] as {
    meta_ad_id: string | null;
    meta_adset_id: string | null;
    meta_campaign_id: string | null;
    click_id: string | null;
    captured_at: string;
  } | undefined;
  if (row?.meta_ad_id) {
    const ageMs = Date.now() - new Date(row.captured_at).getTime();
    if (ageMs <= 30 * 24 * 3600 * 1000) {
      return {
        meta_ad_id: row.meta_ad_id,
        meta_adset_id: row.meta_adset_id,
        meta_campaign_id: row.meta_campaign_id,
        click_id: row.click_id,
        headline: null,
      };
    }
  }
  const { data: wc } = await admin
    .from("wa_clicks")
    .select("utm_content, utm_term, utm_campaign, click_id")
    .or(`matched_phone.eq.+${d},matched_phone.eq.${d}`)
    .order("created_at", { ascending: false })
    .limit(1);
  const w = (wc ?? [])[0] as {
    utm_content: string | null;
    utm_term: string | null;
    utm_campaign: string | null;
    click_id: string | null;
  } | undefined;
  if (w?.utm_content) {
    const ad = String(w.utm_content).match(/^([0-9]{6,})/);
    if (ad) {
      return {
        meta_ad_id: ad[1],
        meta_adset_id: w.utm_term,
        meta_campaign_id: w.utm_campaign,
        click_id: w.click_id,
        headline: null,
      };
    }
  }
  return null;
}

async function enrichFromCreative(adId: string): Promise<{
  campaign_id: string | null;
  adset_id: string | null;
  cabinet_id: string | null;
  project_id: string | null;
}> {
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

async function applyAttributionToExistingLead(
  leadId: string,
  attribution: CtwaAttribution,
  utm: Record<string, string>,
  source: string,
) {
  const { data: lead } = await admin
    .from("leads")
    .select("id, meta_ad_id, utm, source, cabinet_id")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) return;

  const patch: Record<string, unknown> = {};
  const prevUtm = ((lead as { utm?: Record<string, unknown> | null }).utm ?? {}) as Record<
    string,
    unknown
  >;
  const hasMeta = !!(lead as { meta_ad_id?: string | null }).meta_ad_id;

  if (!hasMeta && attribution.meta_ad_id) {
    patch.meta_ad_id = attribution.meta_ad_id;
    patch.meta_adset_id = attribution.meta_adset_id;
    patch.meta_campaign_id = attribution.meta_campaign_id;
    if (attribution.click_id) patch.click_id = attribution.click_id;
    const enriched = await enrichFromCreative(attribution.meta_ad_id);
    if (enriched.cabinet_id && !(lead as { cabinet_id?: string | null }).cabinet_id) {
      patch.cabinet_id = enriched.cabinet_id;
    }
    if (!attribution.meta_campaign_id && enriched.campaign_id) {
      patch.meta_campaign_id = enriched.campaign_id;
    }
    if (!attribution.meta_adset_id && enriched.adset_id) {
      patch.meta_adset_id = enriched.adset_id;
    }
    if (source === "meta" || source === "zapoinovai") patch.source = source;
  }

  if (Object.keys(utm).length > 0) {
    patch.utm = { ...prevUtm, ...utm };
  } else if (source !== "whatsapp" && !(lead as { source?: string }).source) {
    patch.source = source;
  }

  if (Object.keys(patch).length === 0) return;
  patch.updated_at = new Date().toISOString();
  await admin.from("leads").update(patch).eq("id", leadId);
}

async function findOrCreateLead(
  phoneRaw: string,
  name: string,
  projectId: string,
  whatsappLid?: string | null,
  attribution?: CtwaAttribution | null,
  textUtm?: Record<string, string>,
  partnerSource?: string | null,
  textSite?: string | null,
): Promise<string | null> {
  const d = digits(phoneRaw);
  const phoneOk = isPlausiblePhone(d);
  const lid = String(whatsappLid ?? "").replace(/\D/g, "") || null;
  let attr = attribution ? { ...attribution } : emptyCtwa();

  if (phoneOk && attr.click_id) {
    await admin.from("wa_clicks").upsert({
      click_id: attr.click_id,
      utm_source: textUtm?.source ?? "meta",
      utm_medium: textUtm?.medium ?? "ctwa",
      utm_campaign: attr.meta_campaign_id ?? textUtm?.campaign ?? null,
      utm_content: attr.meta_ad_id ?? textUtm?.content ?? null,
      utm_term: attr.meta_adset_id ?? textUtm?.term ?? null,
      matched: true,
      matched_at: new Date().toISOString(),
      matched_phone: `+${d}`,
    }, { onConflict: "click_id" });
  }

  const source = resolveLeadSourceLabel(attr, partnerSource, {
    partnerSource: partnerSource ?? null,
    site: textSite ?? null,
    utm: textUtm ?? {},
    meta_ad_id: attr.meta_ad_id,
    meta_adset_id: attr.meta_adset_id,
    meta_campaign_id: attr.meta_campaign_id,
    click_id: attr.click_id,
  });
  const utmPayload = { ...(textUtm ?? {}) };
  if (attr.meta_ad_id) utmPayload.ad_id = attr.meta_ad_id;
  if (attr.meta_adset_id) utmPayload.adset_id = attr.meta_adset_id;
  if (attr.meta_campaign_id) utmPayload.campaign_id = attr.meta_campaign_id;
  if (!utmPayload.source) {
    if (partnerSource) utmPayload.source = partnerSource;
    else if (attr.meta_ad_id || textSite === "zapoinovai") utmPayload.source = "meta";
  }

  if (phoneOk) {
    const variants = [`+${d}`, d];
    const { data: match } = await admin
      .from("leads")
      .select("id, whatsapp_lid")
      .eq("project_id", projectId)
      .eq("is_personal", false)
      .or(variants.map((p) => `phone.eq.${p}`).join(","))
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (match?.id) {
      if (lid && !(match as { whatsapp_lid?: string | null }).whatsapp_lid) {
        await admin.from("leads").update({ whatsapp_lid: lid }).eq("id", match.id);
      }
      await applyAttributionToExistingLead(match.id as string, attr, utmPayload, source);
      return match.id as string;
    }
  }

  if (lid) {
    const { data: byLid } = await admin
      .from("leads")
      .select("id, phone")
      .eq("project_id", projectId)
      .eq("is_personal", false)
      .eq("whatsapp_lid", lid)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (byLid?.id) {
      if (phoneOk) {
        const cur = digits((byLid as { phone?: string | null }).phone);
        if (!isPlausiblePhone(cur)) {
          await admin.from("leads").update({ phone: `+${d}` }).eq("id", byLid.id);
        }
      }
      await applyAttributionToExistingLead(byLid.id as string, attr, utmPayload, source);
      return byLid.id as string;
    }
  }

  if (!phoneOk && !lid) return null;

  if (phoneOk && !attr.meta_ad_id) {
    const sticky = await attributionFromPhone(phoneRaw, projectId);
    if (sticky) attr = mergeCtwa(attr, sticky);
  }

  let cabinetId: string | null = null;
  let metaCampaignId = attr.meta_campaign_id;
  let metaAdsetId = attr.meta_adset_id;
  if (attr.meta_ad_id) {
    const enriched = await enrichFromCreative(attr.meta_ad_id);
    if (enriched.cabinet_id) cabinetId = enriched.cabinet_id;
    if (!metaCampaignId && enriched.campaign_id) metaCampaignId = enriched.campaign_id;
    if (!metaAdsetId && enriched.adset_id) metaAdsetId = enriched.adset_id;
  }

  const def = await getDefaultStage(projectId);
  if (!def) return null;

  let ownerId: string | null = null;
  const { data: proj } = await admin.from("projects").select("created_by").eq("id", projectId).maybeSingle();
  ownerId = (proj as { created_by?: string | null } | null)?.created_by ?? null;

  const finalSource = resolveLeadSourceLabel(attr, partnerSource, {
    partnerSource: partnerSource ?? null,
    site: textSite ?? null,
    utm: utmPayload,
    meta_ad_id: attr.meta_ad_id,
    meta_adset_id: metaAdsetId,
    meta_campaign_id: metaCampaignId,
    click_id: attr.click_id,
  });

  const { data: created, error } = await admin
    .from("leads")
    .insert({
      name: name?.trim() || (phoneOk ? `+${d}` : "WhatsApp"),
      phone: phoneOk ? `+${d}` : null,
      whatsapp_lid: lid,
      source: finalSource,
      channel: "whatsapp",
      project_id: projectId,
      cabinet_id: cabinetId,
      pipeline_id: def.pipeline_id,
      stage_id: def.stage_id,
      created_by: ownerId,
      assigned_to: ownerId,
      meta_ad_id: attr.meta_ad_id,
      meta_adset_id: metaAdsetId,
      meta_campaign_id: metaCampaignId,
      click_id: attr.click_id,
      ...(Object.keys(utmPayload).length > 0 ? { utm: utmPayload } : {}),
    })
    .select("id")
    .single();
  if (error) {
    console.error("wa-web createLead", error);
    return null;
  }
  return created.id as string;
}

async function insertCommunication(opts: {
  leadId: string;
  direction: "in" | "out";
  text: string;
  externalId?: string | null;
  isAuto?: boolean;
  mediaUrl?: string | null;
  mediaKind?: string | null;
  mediaMime?: string | null;
  mediaFilename?: string | null;
}) {
  if (opts.externalId) {
    const { data: existing } = await admin
      .from("communications")
      .select("id, media_url")
      .eq("external_id", opts.externalId)
      .maybeSingle();
    if (existing?.id) {
      if (opts.mediaUrl && !(existing as { media_url?: string | null }).media_url) {
        await admin.from("communications").update({
          media_url: opts.mediaUrl,
          media_kind: opts.mediaKind,
          media_mime: opts.mediaMime,
          media_filename: opts.mediaFilename,
          content: opts.text || undefined,
        }).eq("id", existing.id);
      }
      return { id: existing.id as string, deduped: true };
    }
  }
  const { data, error } = await admin
    .from("communications")
    .insert({
      lead_id: opts.leadId,
      type: "message",
      direction: opts.direction,
      channel: "whatsapp",
      content: opts.text || (opts.direction === "in" ? "[Сообщение]" : ""),
      status: opts.direction === "in" ? "delivered" : "sent",
      is_draft: false,
      is_auto: !!opts.isAuto,
      external_id: opts.externalId ?? null,
      media_url: opts.mediaUrl ?? null,
      media_kind: opts.mediaKind ?? null,
      media_mime: opts.mediaMime ?? null,
      media_filename: opts.mediaFilename ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id as string, deduped: false };
}

function extFromMime(mime: string, filename?: string | null): string {
  if (filename && /\.[a-z0-9]{2,5}$/i.test(filename)) {
    return filename.split(".").pop()!.toLowerCase();
  }
  const base = (mime || "").split(";")[0].trim().toLowerCase();
  const map: Record<string, string> = {
    "audio/ogg": "ogg",
    "audio/opus": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/aac": "aac",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/3gpp": "3gp",
    "application/pdf": "pdf",
  };
  return map[base] || base.split("/")[1] || "bin";
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function uploadChatMedia(opts: {
  projectId: string;
  leadId: string;
  mime: string;
  filename?: string | null;
  base64: string;
}): Promise<string | null> {
  try {
    const bytes = b64ToBytes(opts.base64);
    if (bytes.byteLength === 0) return null;
    if (bytes.byteLength > 40 * 1024 * 1024) {
      console.error("wa-web media too large", bytes.byteLength);
      return null;
    }
    const ext = extFromMime(opts.mime, opts.filename);
    const path = `${opts.projectId}/${opts.leadId}/${crypto.randomUUID()}.${ext}`;
    const contentType = (opts.mime || "application/octet-stream").split(";")[0].trim();
    const { error } = await admin.storage.from("crm-chat-media").upload(path, bytes, {
      contentType,
      upsert: false,
    });
    if (error) {
      console.error("wa-web media upload", error);
      return null;
    }
    const { data } = admin.storage.from("crm-chat-media").getPublicUrl(path);
    return data.publicUrl as string;
  } catch (e) {
    console.error("wa-web media upload failed", e);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const action = String(body.action ?? "");

  // ── Worker actions ──────────────────────────────────────────────
  if (workerOk(req)) {
    if (action === "heartbeat") {
      const projectId = String(body.project_id ?? "");
      if (projectId) {
        await ensureSession(projectId);
        await admin.from("whatsapp_web_sessions").update({
          worker_heartbeat_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("project_id", projectId);
      } else {
        await admin.from("whatsapp_web_sessions").update({
          worker_heartbeat_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).gte("created_at", "1970-01-01");
      }
      return json({ ok: true });
    }

    if (action === "list_sessions") {
      const { data } = await admin
        .from("whatsapp_web_sessions")
        .select("project_id, status, phone, qr_expires_at, updated_at")
        .in("status", ["pairing", "connected", "error"]);
      return json({ ok: true, sessions: data ?? [] });
    }

    if (action === "push_qr") {
      const projectId = String(body.project_id ?? "");
      const qrData = String(body.qr_data ?? "");
      if (!projectId || !qrData) return json({ error: "project_id + qr_data required" }, 400);
      await ensureSession(projectId);
      await admin.from("whatsapp_web_sessions").update({
        status: "pairing",
        qr_data: qrData,
        qr_expires_at: new Date(Date.now() + 60_000).toISOString(),
        last_error: null,
        worker_heartbeat_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("project_id", projectId);
      return json({ ok: true });
    }

    if (action === "set_state") {
      const projectId = String(body.project_id ?? "");
      const status = String(body.status ?? "");
      if (!projectId || !["disconnected", "pairing", "connected", "error"].includes(status)) {
        return json({ error: "bad status" }, 400);
      }
      await ensureSession(projectId);
      const patch: Record<string, unknown> = {
        status,
        last_error: body.error ? String(body.error) : null,
        worker_heartbeat_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      if (status === "connected") {
        patch.phone = body.phone ? String(body.phone) : null;
        patch.display_name = body.display_name ? String(body.display_name) : null;
        patch.paired_at = new Date().toISOString();
        patch.qr_data = null;
        patch.qr_expires_at = null;
      }
      if (status === "disconnected" || status === "error") {
        patch.qr_data = null;
        patch.qr_expires_at = null;
      }
      await admin.from("whatsapp_web_sessions").update(patch).eq("project_id", projectId);
      return json({ ok: true });
    }

    if (action === "claim") {
      const { data } = await admin
        .from("whatsapp_web_commands")
        .select("*")
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(20);
      return json({ ok: true, commands: data ?? [] });
    }

    if (action === "ack") {
      const id = String(body.id ?? "");
      const status = String(body.status ?? "done");
      if (!id) return json({ error: "id required" }, 400);
      await admin.from("whatsapp_web_commands").update({
        status: status === "failed" ? "failed" : "done",
        result: (body.result as Record<string, unknown>) ?? null,
        processed_at: new Date().toISOString(),
      }).eq("id", id);
      return json({ ok: true });
    }

    if (action === "ingest") {
      const projectId = String(body.project_id ?? "");
      const phone = String(body.phone ?? "");
      const whatsappLid = body.whatsapp_lid ? String(body.whatsapp_lid).replace(/\D/g, "") : null;
      const direction = body.direction === "out" ? "out" : "in";
      const text = String(body.text ?? "");
      const externalId = body.external_id ? String(body.external_id) : null;
      const name = String(body.name ?? "");
      const source = String(body.source ?? "");
      if (!projectId || (!phone && !whatsappLid)) {
        return json({ error: "project_id + (phone|whatsapp_lid) required" }, 400);
      }

      const { data: sessRow } = await admin
        .from("whatsapp_web_sessions")
        .select("status, paired_at")
        .eq("project_id", projectId)
        .maybeSingle();
      const sess = sessRow as { status?: string; paired_at?: string | null } | null;

      // Stop zombie history loops after logout / disconnect.
      if (sess?.status && sess.status !== "connected") {
        return json({ ok: true, skipped: "session_not_connected" });
      }

      // Defense in depth: never create CRM leads from WA history dumps.
      if (
        source === "history"
        || source === "upsert:append"
        || source.startsWith("upsert:append")
      ) {
        return json({ ok: true, skipped: "history" });
      }

      // Drop messages older than session pair time (old daemon may still send history).
      const rawTs = body.message_ts != null ? Number(body.message_ts) : NaN;
      if (Number.isFinite(rawTs) && rawTs > 0) {
        const tsMs = rawTs < 1e12 ? rawTs * 1000 : rawTs;
        const pairedAt = sess?.paired_at;
        if (pairedAt) {
          const pairedMs = new Date(pairedAt).getTime() - 90_000;
          if (Number.isFinite(pairedMs) && tsMs < pairedMs) {
            return json({ ok: true, skipped: "before_pair" });
          }
        }
      }

      const d = digits(phone);
      if (phone && !isPlausiblePhone(d) && !whatsappLid) {
        return json({ error: "invalid phone (looks like WhatsApp LID)" }, 400);
      }

      // Attribution: CTWA payload from daemon + text (ref:/utm_) + sticky phone.
      const textAttr = attributionFromWhatsAppText(text);
      let attribution = mergeCtwa(
        parseCtwaPayload(
          (body.message_data as Record<string, unknown> | undefined)
            ?? (body.attribution as Record<string, unknown> | undefined)
            ?? null,
          body as Record<string, unknown>,
        ),
        ctwaFromTextAttr(textAttr),
      );
      if (!attribution.meta_ad_id && isPlausiblePhone(d) && direction === "in") {
        const sticky = await attributionFromPhone(phone, projectId);
        if (sticky) attribution = mergeCtwa(attribution, sticky);
      }

      let leadId: string | null = body.lead_id ? String(body.lead_id) : null;
      if (direction === "out") {
        // Prefer explicit lead from CRM send; never create leads on outbound.
        if (leadId) {
          const { data: owned } = await admin
            .from("leads")
            .select("id")
            .eq("id", leadId)
            .eq("project_id", projectId)
            .maybeSingle();
          leadId = (owned?.id as string | undefined) ?? null;
        }
        if (!leadId && isPlausiblePhone(d)) {
          const variants = [`+${d}`, d];
          const { data: match } = await admin
            .from("leads")
            .select("id")
            .eq("project_id", projectId)
            .eq("is_personal", false)
            .or(variants.map((p) => `phone.eq.${p}`).join(","))
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          leadId = (match?.id as string | undefined) ?? null;
        }
        if (!leadId && whatsappLid) {
          const { data: byLid } = await admin
            .from("leads")
            .select("id")
            .eq("project_id", projectId)
            .eq("whatsapp_lid", whatsappLid)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          leadId = (byLid?.id as string | undefined) ?? null;
        }
        if (!leadId) {
          return json({ ok: true, skipped: "outbound_no_lead" });
        }
      } else {
        leadId = await findOrCreateLead(
          isPlausiblePhone(d) ? phone : "",
          name,
          projectId,
          whatsappLid,
          attribution,
          textAttr.utm,
          textAttr.partnerSource,
          textAttr.site,
        );
      }
      if (!leadId) return json({ error: "lead not created" }, 500);

      const mediaKind = body.media_kind ? String(body.media_kind) : null;
      const mediaMime = body.media_mime ? String(body.media_mime) : null;
      const mediaFilename = body.media_filename ? String(body.media_filename) : null;
      const mediaBase64 = body.media_base64 ? String(body.media_base64) : null;
      let mediaUrl: string | null = body.media_url ? String(body.media_url) : null;
      if (!mediaUrl && mediaBase64 && mediaMime) {
        mediaUrl = await uploadChatMedia({
          projectId,
          leadId,
          mime: mediaMime,
          filename: mediaFilename,
          base64: mediaBase64,
        });
      }

      const row = await insertCommunication({
        leadId,
        direction,
        text,
        externalId,
        isAuto: !!body.is_auto,
        mediaUrl,
        mediaKind,
        mediaMime,
        mediaFilename,
      });
      // Bump chat sorting in CRM.
      await admin.from("leads").update({
        last_activity_at: new Date().toISOString(),
        ...(name && direction === "in" ? { name } : {}),
      }).eq("id", leadId);
      return json({
        ok: true,
        leadId,
        communicationId: row.id,
        deduped: row.deduped,
        mediaUrl,
        attribution: {
          source: resolveLeadSourceLabel(attribution, textAttr.partnerSource, textAttr),
          meta_ad_id: attribution.meta_ad_id,
          meta_adset_id: attribution.meta_adset_id,
          meta_campaign_id: attribution.meta_campaign_id,
          click_id: attribution.click_id,
          utm: textAttr.utm,
        },
      });
    }

    return json({ error: `unknown worker action: ${action}` }, 400);
  }

  // ── User actions ────────────────────────────────────────────────
  const user = await requireUser(req);
  if (!user.ok) return user.response;

  const projectId = String(body.project_id ?? "");
  if (!projectId) return json({ error: "project_id required" }, 400);
  const access = await requireProjectAccess(user.authHeader, projectId);
  if (!access.ok) return access.response;

  if (action === "status") {
    const session = await ensureSession(projectId);
    const hb = session.worker_heartbeat_at
      ? new Date(session.worker_heartbeat_at as string).getTime()
      : 0;
    const workerOnline = hb > Date.now() - 90_000;
    return json({
      ok: true,
      session: {
        status: session.status,
        phone: session.phone,
        display_name: session.display_name,
        qr_data: session.status === "pairing" ? session.qr_data : null,
        qr_expires_at: session.qr_expires_at,
        last_error: session.last_error,
        paired_at: session.paired_at,
        worker_online: workerOnline,
        worker_heartbeat_at: session.worker_heartbeat_at,
      },
      worker_configured: !!WORKER_KEY,
    });
  }

  if (action === "start_pair") {
    if (!WORKER_KEY) {
      return json({
        error: "WA Web воркер не настроен (нет WA_WEB_WORKER_KEY). Запустите daemon на VPS.",
      }, 503);
    }
    const session = await ensureSession(projectId);
    if (session.status === "connected" && session.phone) {
      return json({
        ok: true,
        already: true,
        session: {
          status: session.status,
          phone: session.phone,
          display_name: session.display_name,
          worker_online: true,
        },
      });
    }
    await admin.from("whatsapp_web_sessions").update({
      status: "pairing",
      qr_data: null,
      last_error: null,
      updated_at: new Date().toISOString(),
    }).eq("project_id", projectId);
    await admin.from("whatsapp_web_commands").insert({
      project_id: projectId,
      action: "pair",
      payload: { force: session.status !== "pairing" },
      status: "pending",
    });
    return json({ ok: true });
  }

  if (action === "logout") {
    await ensureSession(projectId);
    await admin.from("whatsapp_web_commands").insert({
      project_id: projectId,
      action: "logout",
      payload: {},
      status: "pending",
    });
    await admin.from("whatsapp_web_sessions").update({
      status: "disconnected",
      qr_data: null,
      phone: null,
      display_name: null,
      updated_at: new Date().toISOString(),
    }).eq("project_id", projectId);
    return json({ ok: true });
  }

  if (action === "send") {
    const phone = digits(String(body.phone ?? ""));
    const message = String(body.message ?? "").trim();
    const audioBase64 = body.audio_base64 ? String(body.audio_base64) : "";
    const audioMime = body.audio_mime ? String(body.audio_mime) : "";
    if (phone.length < 8 || (!message && !audioBase64)) {
      return json({ error: "phone + (message|audio_base64) required" }, 400);
    }
    if (audioBase64 && audioBase64.length > 22_000_000) {
      return json({ error: "audio too large" }, 413);
    }
    const session = await ensureSession(projectId);
    if (session.status !== "connected") {
      return json({ error: "WhatsApp Web не подключён" }, 409);
    }
    const { data: cmd, error } = await admin
      .from("whatsapp_web_commands")
      .insert({
        project_id: projectId,
        action: "send",
        payload: {
          phone,
          message: message || null,
          lead_id: body.lead_id ?? null,
          ...(audioBase64
            ? { audio_base64: audioBase64, audio_mime: audioMime || "audio/webm" }
            : {}),
        },
        status: "pending",
      })
      .select("id")
      .single();
    if (error) return json({ error: error.message }, 500);

    // Wait briefly for daemon ack (best-effort). Voice may need ffmpeg — allow longer.
    const waitMs = audioBase64 ? 45_000 : 8_000;
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 400));
      const { data: row } = await admin
        .from("whatsapp_web_commands")
        .select("status, result")
        .eq("id", cmd.id)
        .maybeSingle();
      if (row?.status === "done") {
        const idMessage = (row.result as { idMessage?: string } | null)?.idMessage ?? null;
        return json({
          ok: true,
          idMessage,
          pending: !idMessage,
        });
      }
      if (row?.status === "failed") {
        return json({
          ok: false,
          error: (row.result as { error?: string } | null)?.error ?? "send failed",
        }, 502);
      }
    }
    // Still pending — daemon continues; never return command UUID as message id
    // (that used to create a duplicate vs Baileys ingest external_id).
    return json({ ok: true, pending: true });
  }

  return json({ error: `unknown action: ${action}` }, 400);
});
