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
  token: z.string().trim().max(120).optional().nullable(),
  // Атрибуция Meta (cookies со стороны лендинга)
  fbc: z.string().trim().max(255).optional().nullable(),
  fbp: z.string().trim().max(255).optional().nullable(),
  fbclid: z.string().trim().max(255).optional().nullable(),
  // Сквозная атрибуция «креатив → лид»
  ad_id: z.string().trim().max(40).optional().nullable(),
  adset_id: z.string().trim().max(40).optional().nullable(),
  campaign_id: z.string().trim().max(40).optional().nullable(),
  cw: z.string().trim().max(80).optional().nullable(),
  codeword: z.string().trim().max(80).optional().nullable(),
  ig_user: z.string().trim().max(120).optional().nullable(),
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
//   1) project-scoped default pipeline
//   2) any project-scoped pipeline
//   3) global default pipeline (legacy)
//   4) any pipeline at all
async function getDefaultStage(
  projectId: string | null,
): Promise<{ pipeline_id: string; stage_id: string } | null> {
  const tryPipe = async (id: string | null | undefined) => {
    if (!id) return null;
    const stage_id = await firstStage(id);
    return stage_id ? { pipeline_id: id, stage_id } : null;
  };

  if (projectId) {
    const { data: defaultProj } = await admin
      .from("pipelines")
      .select("id")
      .eq("project_id", projectId)
      .eq("is_default", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const r1 = await tryPipe(defaultProj?.id);
    if (r1) return r1;

    const { data: anyProj } = await admin
      .from("pipelines")
      .select("id")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const r2 = await tryPipe(anyProj?.id);
    if (r2) return r2;
  }

  const { data: defaultGlobal } = await admin
    .from("pipelines")
    .select("id")
    .is("project_id", null)
    .eq("is_default", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const r3 = await tryPipe(defaultGlobal?.id);
  if (r3) return r3;

  const { data: anyPipe } = await admin
    .from("pipelines")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return tryPipe(anyPipe?.id);
}

async function findExistingLeadByPhone(
  phone: string,
  projectId: string | null,
): Promise<string | null> {
  const d = digits(phone);
  if (!d) return null;
  // Phone dedupe is scoped per-project (one client = one project).
  // Without a projectId we fall back to global match for legacy intakes.
  let q = admin.from("leads").select("id, phone").or(`phone.eq.+${d},phone.eq.${d}`).limit(1);
  if (projectId) q = q.eq("project_id", projectId);
  const { data } = await q;
  if (data && data.length > 0) return data[0].id;

  let scan = admin
    .from("leads")
    .select("id, phone")
    .order("created_at", { ascending: false })
    .limit(500);
  if (projectId) scan = scan.eq("project_id", projectId);
  const { data: recent } = await scan;
  return (recent ?? []).find((l) => digits(l.phone) === d)?.id ?? null;
}

// Path: /functions/v1/lead-intake/t/<token>  →  returns the token, else null.
function extractToken(req: Request): string | null {
  try {
    const path = new URL(req.url).pathname;
    const m = path.match(/\/lead-intake\/t\/([A-Za-z0-9_\-x]{8,64})\/?$/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}


function normalizeCodeword(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim().toLowerCase();
  return t || null;
}

async function recordInstagramOrganicLead(
  projectId: string,
  codeword: string,
  leadId: string,
  username: string | null,
): Promise<void> {
  const { data: cw } = await admin
    .from("instagram_codewords")
    .select("id, reel_id, reel_url")
    .eq("project_id", projectId)
    .eq("codeword", codeword)
    .maybeSingle();

  const occurredAt = new Date();
  const dateKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Almaty",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(occurredAt);

  const { error } = await admin.from("instagram_organic_events").insert({
    project_id: projectId,
    codeword_id: cw?.id ?? null,
    codeword,
    reel_id: cw?.reel_id ?? null,
    reel_url: cw?.reel_url ?? null,
    event_type: "lead",
    username,
    lead_id: leadId,
    date: dateKey,
    occurred_at: occurredAt.toISOString(),
    payload: { via: "lead-intake" },
  });
  if (error) console.error("[lead-intake] instagram organic lead event", error);
}

async function projectFromToken(token: string): Promise<string | null> {
  const { data } = await admin
    .from("projects")
    .select("id")
    .eq("intake_token", token)
    .maybeSingle();
  return data?.id ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  // Token from path: /lead-intake/t/<token>. When present, lead is bound to
  // exactly that project — its pipeline, its dedupe scope.
  const tokenFromPath = extractToken(req);
  const tokenProjectId = tokenFromPath ? await projectFromToken(tokenFromPath) : null;
  if (tokenFromPath && !tokenProjectId) {
    return json({ error: "Invalid intake token" }, 404);
  }

  if (req.method === "GET") {
    return json({
      ok: true,
      hint: "POST your lead here. Required: phone. Recommended: name, utm_*",
      project_bound: !!tokenProjectId,
    });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const raw = await parseBody(req);

  // Honeypot — silently 200 if a bot filled the hidden field. Two common
  // names so users can pick whichever fits their form.
  const hp = String((raw as Record<string, unknown>)._hp ?? (raw as Record<string, unknown>).company ?? "").trim();
  if (hp) {
    return json({ ok: true, leadId: null, skipped: "honeypot" });
  }
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
    wa: "whatsapp", whatsapp: "whatsapp", whats: "whatsapp", waapi: "whatsapp", greenapi: "whatsapp",
    ig: "instagram", insta: "instagram",
    fb: "facebook", meta: "facebook", facebook_ads: "facebook", fb_ads: "facebook",
    tg: "telegram", telegram: "telegram",
    tilda: "site", web: "site", website: "site", landing: "site", form: "site",
    google: "google", googleads: "google", adwords: "google", gads: "google", google_ads: "google",
    yandex: "yandex", ya: "yandex",
    tt: "tiktok", tiktok: "tiktok", tiktokads: "tiktok",
    yt: "youtube", youtube: "youtube",
    vk: "vk", vkontakte: "vk",
    cpc: "ads", advert: "ads",
    leadform: "lead_form", call: "phone",
  };
  // Detect source from referrer host if no explicit source/utm_source.
  // Покрывает ещё WhatsApp Web, мобильные приложения, t.me-ссылки и др.
  function detectFromReferrer(ref: string | null | undefined): string | null {
    if (!ref) return null;
    const r = ref.toLowerCase();
    if (/(?:^|\.)wa\.me|whatsapp\.com|api\.whatsapp/.test(r)) return "whatsapp";
    if (/facebook\.com|fb\.com|fb\.me/.test(r)) return "facebook";
    if (/instagram\.com|instagr\.am/.test(r)) return "instagram";
    if (/google\./.test(r)) return "google";
    if (/tiktok\.com/.test(r)) return "tiktok";
    if (/youtube\.com|youtu\.be/.test(r)) return "youtube";
    if (/yandex\./.test(r)) return "yandex";
    if (/vk\.com/.test(r)) return "vk";
    if (/t\.me|telegram\./.test(r)) return "telegram";
    return null;
  }
  // Если канал явно whatsapp/telegram/phone — это важнее, чем неявный source.
  // Решает кейс: лид с сайта по клику на WhatsApp-кнопку должен быть source=whatsapp,
  // а не site, потому что менеджер дальше пишет ему в WhatsApp.
  const organicCodeword =
    normalizeCodeword(v.cw) ||
    normalizeCodeword(v.codeword) ||
    (v.utm_source?.toLowerCase() === "instagram" ? normalizeCodeword(v.utm_campaign) : null);

  const rawSource =
    (organicCodeword ? "instagram" : null) ||
    (v.source && v.source.trim()) ||
    (v.utm_source && v.utm_source.trim()) ||
    detectFromReferrer(v.referrer) ||
    (v.channel && v.channel.trim() !== "web" ? v.channel.trim() : null) ||
    "site";
  const source = SOURCE_ALIASES[rawSource.toLowerCase()] ?? rawSource.toLowerCase();
  // channel is a DB enum: whatsapp | telegram | instagram | phone | web
  const channelInput = organicCodeword
    ? "instagram"
    : (v.channel && v.channel.trim()) || "web";
  const ALLOWED_CHANNELS = new Set(["whatsapp", "telegram", "instagram", "phone", "web"]);
  const channel = ALLOWED_CHANNELS.has(channelInput) ? channelInput : "web";
  const note = [v.message, v.note].filter(Boolean).join("\n").trim() || null;
  const landingUrl = v.landing_url || v.page || null;

  // Resolve project_id and cabinet_id.
  // Priority: URL token > body project_id > inbound_tokens(body token) > cabinet_id > ad_account_id.
  // URL token wins — it is the secret bound to the project on creation.
  let projectId: string | null = tokenProjectId ?? v.project_id ?? null;
  let cabinetId: string | null = v.cabinet_id || null;

  // Inbound token: один из самых надёжных способов привязки лида к клиенту.
  if (v.token) {
    try {
      const { data: tok } = await admin
        .from("inbound_tokens")
        .select("client_id, project_id, is_active")
        .eq("token", v.token.trim())
        .maybeSingle();
      if (tok && tok.is_active !== false) {
        if (!cabinetId && tok.client_id) cabinetId = String(tok.client_id);
        if (!projectId && tok.project_id) projectId = String(tok.project_id);
      }
    } catch { /* нет таблицы / иное — fallback на старую логику */ }
  }

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
    // Сквозная атрибуция: ad_id может прийти явно или в utm_content (шаблон {{ad.id}}).
    const numericId = (s: string | null | undefined) =>
      s && /^[0-9]{6,}$/.test(s.trim()) ? s.trim() : null;
    const metaAdId = (v.ad_id && v.ad_id.trim()) || numericId(v.utm_content);
    const metaAdsetId = (v.adset_id && v.adset_id.trim()) || numericId(v.utm_term);
    const metaCampaignId = (v.campaign_id && v.campaign_id.trim()) || numericId(v.utm_campaign);
    const clickId = (v.fbclid && v.fbclid.trim()) || null;

    // Dedupe by phone — scoped to the resolved project.
    const existingId = await findExistingLeadByPhone(phoneE164, projectId);
    if (existingId) {
      const patch: Record<string, unknown> = { last_activity_at: new Date().toISOString() };
      if (Object.keys(utm).length) patch.utm = utm;
      if (metaAdId) patch.meta_ad_id = metaAdId;
      if (metaAdsetId) patch.meta_adset_id = metaAdsetId;
      if (metaCampaignId) patch.meta_campaign_id = metaCampaignId;
      if (clickId) patch.click_id = clickId;
      await admin
        .from("leads")
        .update(patch)
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

    // Create new — pipeline is resolved within the project's scope.
    const def = await getDefaultStage(projectId);
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
        meta_ad_id: metaAdId,
        meta_adset_id: metaAdsetId,
        meta_campaign_id: metaCampaignId,
        click_id: clickId,
      })
      .select("id")
      .single();

    if (error || !created) {
      console.error("createLead error", error);
      return json({ error: "Internal server error" }, 500);
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

    if (projectId && organicCodeword) {
      const igUser = v.ig_user?.trim() || (typeof raw.ig_user === "string" ? raw.ig_user.trim() : null) || null;
      await recordInstagramOrganicLead(projectId, organicCodeword, created.id, igUser);
    }

    return json({ ok: true, leadId: created.id });
  } catch (e) {
    console.error("intake error", e);
    return json({ error: "Internal server error" }, 500);
  }
});
