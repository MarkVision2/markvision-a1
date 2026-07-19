// Public webhook for Instagram organic funnel events.
// Source: n8n, GreenAPI, or any other automation that watches
// Instagram Direct conversations / comments / link clicks.
//
// On codeword_dm / codeword_comment the API picks random variants from
// comment_replies, dm_messages, target_urls and returns them for the bot.

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

const Schema = z.object({
  project_id: z.string().uuid().optional().nullable(),
  token: z.string().trim().max(120).optional().nullable(),
  event_type: z.enum(["codeword_dm", "codeword_comment", "link_click", "lead"]),
  codeword: z.string().trim().max(80).optional().nullable(),
  reel_id: z.string().trim().max(120).optional().nullable(),
  reel_url: z.string().trim().max(500).optional().nullable(),
  username: z.string().trim().max(120).optional().nullable(),
  contact: z.string().trim().max(80).optional().nullable(),
  lead_id: z.string().uuid().optional().nullable(),
  occurred_at: z.string().datetime().optional().nullable(),
  payload: z.record(z.unknown()).optional().nullable(),
});

type IntakePayload = z.infer<typeof Schema>;

interface CodewordRow {
  id: string;
  reel_id: string | null;
  reel_url: string | null;
  target_url: string | null;
  short_id: string | null;
  comment_replies: unknown;
  dm_messages: unknown;
  target_urls: unknown;
}

function normalizeCodeword(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  return t;
}

function asStringArray(raw: unknown, max = 10): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((v) => String(v).trim()).filter(Boolean).slice(0, max);
}

function pickRandom(items: string[]): { value: string; index: number } | null {
  if (items.length === 0) return null;
  const index = Math.floor(Math.random() * items.length);
  return { value: items[index], index };
}

function resolveTargetUrls(row: CodewordRow | null): string[] {
  if (!row) return [];
  const urls = asStringArray(row.target_urls);
  if (urls.length > 0) return urls;
  if (row.target_url?.trim()) return [row.target_url.trim()];
  return [];
}

function buildVariants(row: CodewordRow | null) {
  const commentReplies = asStringArray(row?.comment_replies);
  const dmMessages = asStringArray(row?.dm_messages);
  const targetUrls = resolveTargetUrls(row);
  const comment = pickRandom(commentReplies);
  const dm = pickRandom(dmMessages);
  const link = pickRandom(targetUrls);
  return {
    comment_reply: comment?.value ?? null,
    comment_reply_index: comment?.index ?? null,
    dm_message: dm?.value ?? null,
    dm_message_index: dm?.index ?? null,
    target_url: link?.value ?? row?.target_url ?? null,
    target_url_index: link?.index ?? null,
    comment_replies_count: commentReplies.length,
    dm_messages_count: dmMessages.length,
    target_urls_count: targetUrls.length,
  };
}

async function resolveProjectId(req: Request, body: IntakePayload): Promise<string | null> {
  const headerToken = req.headers.get("x-intake-token") || body.token || null;
  if (!headerToken) return null;
  const { data } = await admin
    .from("projects")
    .select("id")
    .eq("intake_token", headerToken)
    .maybeSingle();
  const tokenProject = (data as { id?: string } | null)?.id ?? null;
  if (!tokenProject) return null;
  if (body.project_id && body.project_id !== tokenProject) return null;
  return tokenProject;
}

async function resolveCodeword(projectId: string, codeword: string | null) {
  if (!codeword) return null;
  const { data } = await admin
    .from("instagram_codewords")
    .select("id, reel_id, reel_url, target_url, short_id, comment_replies, dm_messages, target_urls")
    .eq("project_id", projectId)
    .eq("codeword", codeword)
    .eq("active", true)
    .maybeSingle();
  return data as CodewordRow | null;
}

async function parseBody(req: Request): Promise<Record<string, unknown>> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    try {
      return (await req.json()) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  try {
    const fd = await req.formData();
    const obj: Record<string, unknown> = {};
    fd.forEach((v, k) => { obj[k] = typeof v === "string" ? v : ""; });
    return obj;
  } catch {
    return {};
  }
}

function buildRedirectUrl(shortId: string, username: string | null | undefined, linkIndex: number | null) {
  const base = SUPABASE_URL.replace(/\/$/, "");
  const params = new URLSearchParams({ c: shortId });
  const u = (username ?? "").trim().replace(/^@/, "");
  if (u) params.set("u", u);
  if (linkIndex != null && linkIndex >= 0) params.set("v", String(linkIndex));
  return `${base}/functions/v1/ig-organic-redirect?${params.toString()}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const url = new URL(req.url);
  const raw = await parseBody(req);

  // One-shot wipe of test funnel stats (codeword writes + button clicks + organic leads).
  // Gated by x-confirm / body.confirm — does not touch codewords or CRM leads rows.
  // NOTE: field name is mv_op (not "action") — some gateways strip "action" from JSON.
  const RESET_CONFIRM = "mv-reset-ig-stats-20260719";
  const op =
    (typeof raw.mv_op === "string" ? raw.mv_op : "") ||
    (typeof raw.op === "string" ? raw.op : "") ||
    (typeof raw.action === "string" ? raw.action : "") ||
    (url.searchParams.get("mv_op") ?? "") ||
    (url.searchParams.get("action") ?? "");
  if (op === "reset_stats") {
    const confirm =
      req.headers.get("x-confirm") ||
      (typeof raw.confirm === "string" ? raw.confirm : "") ||
      (url.searchParams.get("confirm") ?? "");
    if (confirm !== RESET_CONFIRM) return json({ ok: false, error: "forbidden", build: "reset-v3" }, 403);

    const types = ["codeword_comment", "codeword_dm", "link_click", "lead"];
    const { count: before, error: countErr } = await admin
      .from("instagram_organic_events")
      .select("id", { count: "exact", head: true })
      .in("event_type", types);
    if (countErr) return json({ ok: false, error: countErr.message }, 500);

    const { error: delErr } = await admin
      .from("instagram_organic_events")
      .delete()
      .in("event_type", types);
    if (delErr) return json({ ok: false, error: delErr.message }, 500);

    const { count: after } = await admin
      .from("instagram_organic_events")
      .select("id", { count: "exact", head: true })
      .in("event_type", types);

    return json({
      ok: true,
      reset: true,
      deleted_approx: before ?? null,
      remaining: after ?? 0,
      event_types: types,
      build: "reset-v3",
    });
  }

  const parsed = Schema.safeParse(raw);
  if (!parsed.success) {
    return json({ ok: false, error: "invalid_payload", issues: parsed.error.issues }, 400);
  }
  const body = parsed.data;
  const codeword = normalizeCodeword(body.codeword);

  const projectId = await resolveProjectId(req, body);
  if (!projectId) return json({ ok: false, error: "project_not_resolved" }, 401);

  const codewordRow = await resolveCodeword(projectId, codeword);
  const variants = buildVariants(codewordRow);

  const occurredAt = body.occurred_at ? new Date(body.occurred_at) : new Date();
  const dateKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Almaty",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(occurredAt);

  const row = {
    project_id: projectId,
    codeword_id: codewordRow?.id ?? null,
    codeword,
    reel_id: body.reel_id ?? codewordRow?.reel_id ?? null,
    reel_url: body.reel_url ?? codewordRow?.reel_url ?? null,
    event_type: body.event_type,
    username: body.username ?? null,
    contact: body.contact ?? null,
    lead_id: body.lead_id ?? null,
    date: dateKey,
    occurred_at: occurredAt.toISOString(),
    payload: {
      ...(body.payload ?? {}),
      variants,
    },
  };

  const { data, error } = await admin
    .from("instagram_organic_events")
    .insert(row)
    .select("id")
    .single();

  if (error) {
    console.error("[instagram-organic-intake] insert failed", error);
    return json({ ok: false, error: "Internal server error" }, 500);
  }

  const shortId = codewordRow?.short_id ?? null;
  const redirectUrl = shortId
    ? buildRedirectUrl(shortId, body.username, variants.target_url_index)
    : null;

  return json({
    ok: true,
    event_id: (data as { id: string }).id,
    codeword_id: codewordRow?.id ?? null,
    short_id: shortId,
    target_url: variants.target_url,
    redirect_url: redirectUrl,
    comment_reply: variants.comment_reply,
    comment_reply_index: variants.comment_reply_index,
    dm_message: variants.dm_message,
    dm_message_index: variants.dm_message_index,
    target_url_index: variants.target_url_index,
    variants,
  });
});
