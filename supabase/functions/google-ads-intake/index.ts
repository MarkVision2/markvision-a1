// Webhook for pre-aggregated Google Ads daily rows.
// Use this when you don't want to wire up OAuth and prefer to push numbers
// from n8n / Zapier / your own ETL.
//
// Body (JSON):
//   {
//     "project_id": "uuid"          // required if no x-intake-token
//     "token":      "..."           // alternative to project_id
//     "cabinet_id": "uuid"          // optional — if cabinet already exists
//     "customer_id": "1234567890"   // Google Ads customer id (no dashes)
//     "rows": [
//       { "date": "2026-05-12",
//         "spend": 12500, "impressions": 4100, "clicks": 78,
//         "leads": 6, "revenue": 0,
//         "currency": "KZT" }
//     ]
//   }
//
// Behavior:
//   • Auto-creates a Google Ads cabinet for the project if needed
//     (name = "Google Ads — <customer_id>", provider="google").
//   • Upserts rows into cabinet_daily_insights (provider='google').

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

const RowSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  spend: z.number().nonnegative().default(0),
  impressions: z.number().nonnegative().default(0),
  clicks: z.number().nonnegative().default(0),
  leads: z.number().nonnegative().default(0),
  revenue: z.number().nonnegative().default(0),
  currency: z.string().trim().max(8).default("KZT"),
});

const BodySchema = z.object({
  project_id: z.string().uuid().optional().nullable(),
  token: z.string().trim().max(120).optional().nullable(),
  cabinet_id: z.string().uuid().optional().nullable(),
  customer_id: z.string().trim().max(40).optional().nullable(),
  rows: z.array(RowSchema).min(1).max(400),
});

async function resolveProjectId(req: Request, projectId: string | null, token: string | null) {
  // SECURITY: always require a valid intake token. Project_id alone is not enough —
  // any team member could otherwise inject fabricated stats into any project.
  const headerToken = req.headers.get("x-intake-token") || token || null;
  if (!headerToken) return null;
  const { data } = await admin
    .from("project_intake_tokens")
    .select("project_id")
    .eq("token", headerToken)
    .maybeSingle();
  const resolved = (data as { project_id?: string } | null)?.project_id ?? null;
  if (!resolved) return null;
  // Optional: if caller also passed project_id, it must match the token's project.
  if (projectId && projectId !== resolved) return null;
  return resolved;
}

async function ensureCabinet(
  projectId: string,
  cabinetId: string | null,
  customerId: string | null,
): Promise<{ id: string; external_id: string } | null> {
  if (cabinetId) {
    const { data } = await admin
      .from("ad_cabinets")
      .select("id, external_id")
      .eq("id", cabinetId)
      .maybeSingle();
    if (data) return data as { id: string; external_id: string };
  }
  if (!customerId) return null;
  const externalId = customerId.replace(/[^0-9]/g, "");
  const { data: existing } = await admin
    .from("ad_cabinets")
    .select("id, external_id")
    .eq("project_id", projectId)
    .eq("provider", "google")
    .eq("external_id", externalId)
    .maybeSingle();
  if (existing) return existing as { id: string; external_id: string };
  const { data: created, error } = await admin
    .from("ad_cabinets")
    .insert({
      project_id: projectId,
      provider: "google",
      external_id: externalId,
      name: `Google Ads — ${externalId}`,
      type: "Личный",
      currency: "KZT",
    })
    .select("id, external_id")
    .single();
  if (error) {
    console.error("[google-ads-intake] cabinet upsert failed", error);
    return null;
  }
  return created as { id: string; external_id: string };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return json({ ok: false, error: "invalid_payload", issues: parsed.error.issues }, 400);
  }

  const projectId = await resolveProjectId(req, parsed.data.project_id ?? null, parsed.data.token ?? null);
  if (!projectId) return json({ ok: false, error: "project_not_resolved" }, 401);

  const cabinet = await ensureCabinet(projectId, parsed.data.cabinet_id ?? null, parsed.data.customer_id ?? null);
  if (!cabinet) return json({ ok: false, error: "cabinet_not_resolved" }, 400);

  const upserts = parsed.data.rows.map((r) => {
    const cpl = r.leads > 0 ? r.spend / r.leads : 0;
    const cpm = r.impressions > 0 ? (r.spend / r.impressions) * 1000 : 0;
    const cpc = r.clicks > 0 ? r.spend / r.clicks : 0;
    const ctr = r.impressions > 0 ? (r.clicks / r.impressions) * 100 : 0;
    return {
      cabinet_id: cabinet.id,
      external_id: cabinet.external_id,
      project_id: projectId,
      date: r.date,
      spend: r.spend, impressions: r.impressions, clicks: r.clicks,
      leads: r.leads, revenue: r.revenue,
      cpl, cpm, cpc, ctr,
      currency: r.currency,
      provider: "google",
      synced_at: new Date().toISOString(),
    };
  });

  const { error } = await admin
    .from("cabinet_daily_insights")
    .upsert(upserts, { onConflict: "external_id,date" });
  if (error) {
    console.error("[google-ads-intake] upsert failed", error);
    return json({ ok: false, error: "Internal server error" }, 500);
  }

  return json({ ok: true, cabinet_id: cabinet.id, rows: upserts.length });
});
