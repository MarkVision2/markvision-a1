// Public lead intake webhook.
// Accepts POST from website forms (Tilda, custom landings, etc.).
// Body can be JSON or application/x-www-form-urlencoded / multipart/form-data.
//
// Supported fields (all optional except name+phone):
//   name, phone, email, message|note, service, city
//   source (override) — falls back to utm_source, then "web"
//   channel (override) — defaults to "web"
//   utm_source, utm_medium, utm_campaign, utm_content, utm_term
//   referrer, landing_url | page
//
// Response: { ok: true, leadId, duplicate?: true }
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { z } from "https://esm.sh/zod@3.23.8";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function digits(s: unknown): string {
  return String(s ?? "").replace(/\D/g, "");
}

const Schema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().min(1).max(40),
  email: z.string().trim().max(160).optional().nullable(),
  message: z.string().trim().max(2000).optional().nullable(),
  note: z.string().trim().max(2000).optional().nullable(),
  service: z.string().trim().max(160).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  source: z.string().trim().max(60).optional().nullable(),
  channel: z.string().trim().max(40).optional().nullable(),
  utm_source: z.string().trim().max(120).optional().nullable(),
  utm_medium: z.string().trim().max(120).optional().nullable(),
  utm_campaign: z.string().trim().max(160).optional().nullable(),
  utm_content: z.string().trim().max(160).optional().nullable(),
  utm_term: z.string().trim().max(160).optional().nullable(),
  referrer: z.string().trim().max(500).optional().nullable(),
  landing_url: z.string().trim().max(500).optional().nullable(),
  page: z.string().trim().max(500).optional().nullable(),
  project_id: z.string().trim().uuid().optional().nullable(),
  cabinet_id: z.string().trim().uuid().optional().nullable(),
  ad_account_id: z.string().trim().max(80).optional().nullable(),
});

async function parseBody(req: Request): Promise<Record<string, unknown>> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    try {
      return (await req.json()) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  // form-data / urlencoded
  try {
    const fd = await req.formData();
    const obj: Record<string, unknown> = {};
    fd.forEach((v, k) => {
      obj[k] = typeof v === "string" ? v : "";
    });
    return obj;
  } catch {
    /* fallthrough */
  }
  // last-ditch: try url-search-params from text
  try {
    const text = await req.text();
    if (text.includes("=")) {
      const sp = new URLSearchParams(text);
      const obj: Record<string, unknown> = {};
      sp.forEach((v, k) => (obj[k] = v));
      return obj;
    }
  } catch {
    /* ignore */
  }
  return {};
}

async function getDefaultStage(): Promise<{ pipeline_id: string; stage_id: string } | null> {
  const { data: pipe } = await admin
    .from("pipelines")
    .select("id")
    .eq("is_default", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!pipe?.id) {
    // fallback: first pipeline overall
    const { data: anyPipe } = await admin
      .from("pipelines")
      .select("id")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!anyPipe?.id) return null;
    const { data: stage } = await admin
      .from("pipeline_stages")
      .select("id")
      .eq("pipeline_id", anyPipe.id)
      .order("order_index", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!stage?.id) return null;
    return { pipeline_id: anyPipe.id, stage_id: stage.id };
  }
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

async function findExistingLeadByPhone(phone: string): Promise<string | null> {
  const d = digits(phone);
  if (!d) return null;
  const { data } = await admin
    .from("leads")
    .select("id, phone")
    .or(`phone.eq.+${d},phone.eq.${d}`)
    .limit(1);
  if (data && data.length > 0) return data[0].id;
  // broader scan
  const { data: recent } = await admin
    .from("leads")
    .select("id, phone")
    .order("created_at", { ascending: false })
    .limit(500);
  return (recent ?? []).find((l) => digits(l.phone) === d)?.id ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method === "GET") {
    return json({
      ok: true,
      hint: "POST your lead here. Required: phone. Recommended: name, utm_*",
    });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const raw = await parseBody(req);
  const parsed = Schema.safeParse(raw);
  if (!parsed.success) {
    return json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      400,
    );
  }
  const v = parsed.data;
  const phoneDigits = digits(v.phone);
  if (phoneDigits.length < 8 || phoneDigits.length > 15) {
    return json({ error: "Invalid phone number" }, 400);
  }
  const phoneE164 = `+${phoneDigits}`;
  const name = v.name?.trim() || phoneE164;

  const utm: Record<string, string> = {};
  if (v.utm_source) utm.source = v.utm_source;
  if (v.utm_medium) utm.medium = v.utm_medium;
  if (v.utm_campaign) utm.campaign = v.utm_campaign;
  if (v.utm_content) utm.content = v.utm_content;
  if (v.utm_term) utm.term = v.utm_term;

  // Normalize source synonyms so all rows in DB use canonical keys.
  const SOURCE_ALIASES: Record<string, string> = {
    wa: "whatsapp", ig: "instagram", fb: "facebook", meta: "facebook", tg: "telegram",
    tilda: "site", web: "site", website: "site",
    google: "google", googleads: "google", adwords: "google", gads: "google",
    yandex: "yandex", ya: "yandex",
    tt: "tiktok", tiktok: "tiktok", tiktokads: "tiktok",
    yt: "youtube", youtube: "youtube",
    vk: "vk", vkontakte: "vk",
    cpc: "ads", advert: "ads",
    leadform: "lead_form", call: "phone",
  };
  // Detect source from referrer host if no explicit source/utm_source
  function detectFromReferrer(ref: string | null | undefined): string | null {
    if (!ref) return null;
    const r = ref.toLowerCase();
    if (/facebook\.com|fb\.com/.test(r)) return "facebook";
    if (/instagram\.com/.test(r)) return "instagram";
    if (/google\./.test(r)) return "google";
    if (/tiktok\.com/.test(r)) return "tiktok";
    if (/youtube\.com|youtu\.be/.test(r)) return "youtube";
    if (/yandex\./.test(r)) return "yandex";
    if (/vk\.com/.test(r)) return "vk";
    if (/t\.me|telegram\./.test(r)) return "telegram";
    return null;
  }
  const rawSource =
    (v.source && v.source.trim()) ||
    (v.utm_source && v.utm_source.trim()) ||
    detectFromReferrer(v.referrer) ||
    "site";
  const source = SOURCE_ALIASES[rawSource.toLowerCase()] ?? rawSource.toLowerCase();
  // channel is a DB enum: whatsapp | telegram | instagram | phone | web
  const channelInput = (v.channel && v.channel.trim()) || "web";
  const ALLOWED_CHANNELS = new Set(["whatsapp", "telegram", "instagram", "phone", "web"]);
  const channel = ALLOWED_CHANNELS.has(channelInput) ? channelInput : "web";
  const note = [v.message, v.note].filter(Boolean).join("\n").trim() || null;
  const landingUrl = v.landing_url || v.page || null;

  // Resolve project_id and cabinet_id: explicit > via cabinet_id > via ad_account_id
  let projectId: string | null = v.project_id || null;
  let cabinetId: string | null = v.cabinet_id || null;
  if (cabinetId) {
    const { data } = await admin.from("ad_cabinets").select("project_id").eq("id", cabinetId).maybeSingle();
    if (!projectId) projectId = data?.project_id ?? null;
  }
  if (!cabinetId && v.ad_account_id) {
    const raw = v.ad_account_id.trim();
    const norm = raw.startsWith("act_") ? raw : `act_${raw}`;
    const numeric = raw.replace(/^act_/, "");
    const { data } = await admin
      .from("ad_cabinets")
      .select("id, project_id")
      .in("ad_account_id", [raw, norm, numeric])
      .limit(1);
    cabinetId = data?.[0]?.id ?? null;
    if (!projectId) projectId = data?.[0]?.project_id ?? null;
  }
  // Last resort: try utm_source as external_id
  if (!cabinetId && utm.utm_source) {
    const { data } = await admin
      .from("ad_cabinets")
      .select("id, project_id")
      .eq("external_id", utm.utm_source)
      .limit(1);
    if (data?.[0]) {
      cabinetId = data[0].id;
      if (!projectId) projectId = data[0].project_id ?? null;
    }
  }

  try {
    // Dedupe by phone
    const existingId = await findExistingLeadByPhone(phoneE164);
    if (existingId) {
      await admin
        .from("leads")
        .update({ last_activity_at: new Date().toISOString() })
        .eq("id", existingId);
      await admin.from("events").insert({
        lead_id: existingId,
        event_type: "created",
        payload: {
          repeat: true,
          source,
          channel,
          ...(landingUrl ? { landing_url: landingUrl } : {}),
        },
      });
      if (note) {
        await admin.from("communications").insert({
          lead_id: existingId,
          type: "message",
          direction: "in",
          channel: "web",
          content: note,
          status: "delivered",
          is_draft: false,
          is_auto: false,
        });
      }
      return json({ ok: true, leadId: existingId, duplicate: true });
    }

    // Create new
    const def = await getDefaultStage();
    if (!def) {
      return json({ error: "No default pipeline/stage configured" }, 500);
    }

    const { data: created, error } = await admin
      .from("leads")
      .insert({
        pipeline_id: def.pipeline_id,
        stage_id: def.stage_id,
        project_id: projectId,
        cabinet_id: cabinetId,
        name,
        phone: phoneE164,
        email: v.email || null,
        source,
        channel,
        note,
        service: v.service || null,
        city: v.city || null,
        utm: Object.keys(utm).length ? utm : null,
        referrer: v.referrer || null,
        landing_url: landingUrl,
        first_touch_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error || !created) {
      console.error("createLead error", error);
      return json({ error: error?.message ?? "Insert failed" }, 500);
    }

    if (note) {
      await admin.from("communications").insert({
        lead_id: created.id,
        type: "message",
        direction: "in",
        channel: "web",
        content: note,
        status: "delivered",
        is_draft: false,
        is_auto: false,
      });
    }

    return json({ ok: true, leadId: created.id });
  } catch (e) {
    console.error("intake error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
