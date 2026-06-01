// Public webhook for Instagram organic funnel events.
// Source: n8n, GreenAPI, or any other automation that watches
// Instagram Direct conversations / link clicks / form submissions.
//
// Events tracked:
//   1. codeword_dm — user sent a DM containing a known code-word
//   2. link_click  — user clicked the link the bot sent back
//   3. lead        — user filled a form and became a lead (lead_id reference)
//
// Example payload:
//   POST /functions/v1/instagram-organic-intake
//   {
//     "project_id": "uuid",
//     "event_type": "codeword_dm",
//     "codeword": "smile",
//     "username": "@maria_kz",
//     "contact": "+7700...",          // optional
//     "reel_url": "https://www.instagram.com/reel/...",
//     "payload": { "raw": "..." }
//   }
//
// Auth: requires header `x-intake-token` matching project token
// (issued via SettingsConnection), so any public webhook source can call this
// without service-role credentials.

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
  event_type: z.enum(["codeword_dm", "link_click", "lead"]),
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

function normalizeCodeword(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  return t;
}

async function resolveProjectId(req: Request, body: IntakePayload): Promise<string | null> {
  // Always require a valid intake token. Do NOT trust body.project_id alone,
  // since project UUIDs may be discoverable by other authenticated users.
  const headerToken = req.headers.get("x-intake-token") || body.token || null;
  if (!headerToken) return null;
  const { data } = await admin
    .from("projects")
    .select("id")
    .eq("intake_token", headerToken)
    .maybeSingle();
  const tokenProject = (data as { id?: string } | null)?.id ?? null;
  if (!tokenProject) return null;
  // If body also provides project_id, it must match the token's project.
  if (body.project_id && body.project_id !== tokenProject) return null;
  return tokenProject;
}

async function resolveCodeword(projectId: string, codeword: string | null) {
  if (!codeword) return null;
  const { data } = await admin
    .from("instagram_codewords")
    .select("id, reel_id, reel_url, target_url, short_id")
    .eq("project_id", projectId)
    .eq("codeword", codeword)
    .maybeSingle();
  return data as { id: string; reel_id: string | null; reel_url: string | null; target_url: string | null; short_id: string | null } | null;
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const raw = await parseBody(req);
  const parsed = Schema.safeParse(raw);
  if (!parsed.success) {
    return json({ ok: false, error: "invalid_payload", issues: parsed.error.issues }, 400);
  }
  const body = parsed.data;
  const codeword = normalizeCodeword(body.codeword);

  const projectId = await resolveProjectId(req, body);
  if (!projectId) return json({ ok: false, error: "project_not_resolved" }, 401);

  const codewordRow = await resolveCodeword(projectId, codeword);

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
    payload: body.payload ?? {},
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

  const base = SUPABASE_URL.replace(/\/$/, "");
  const shortId = (codewordRow as { short_id?: string } | null)?.short_id ?? null;
  return json({
    ok: true,
    event_id: (data as { id: string }).id,
    codeword_id: codewordRow?.id ?? null,
    target_url: codewordRow?.target_url ?? null,
    short_id: shortId,
    redirect_url: shortId ? `${base}/functions/v1/ig-organic-redirect?c=${encodeURIComponent(shortId)}` : null,
  });
});
