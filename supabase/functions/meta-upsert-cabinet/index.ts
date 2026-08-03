// Upsert ad_cabinets + optional meta_tokens via service role.
// Client direct INSERT often fails: RLS was admin-only, and access_token
// column privileges break RETURNING *. This endpoint verifies project access
// then writes with service role and returns a safe row (no token).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import {
  AUTH_CORS_HEADERS,
  requireProjectAccess,
  requireUser,
} from "../_lib/auth.ts";

const corsHeaders = AUTH_CORS_HEADERS;

const SAFE_FIELDS =
  "id, project_id, created_by, created_at, updated_at, name, external_id, online, type, provider, currency, daily_budget, spend, leads, lead_cost, sales, revenue, city, ad_account_id, page_id, page_name, instagram_id, telegram_group_id, whatsapp_number, pixel_id, pixel_event, website_url, landing_url, utm_template, brief, campaign_objective, optimization_goal, lead_form_id, start_time, end_time, days_of_week, timezone, auto_launch_enabled, launch_hour, target_geo, target_age_min, target_age_max, target_gender, target_languages, target_interests, target_exclusions, creative_headline, creative_primary_text, creative_description, creative_cta, creative_media_urls";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeActId(id: string): string {
  const t = String(id ?? "").trim();
  if (!t) return "";
  if (/^act_\d+$/i.test(t)) return `act_${t.replace(/^act_/i, "")}`;
  if (/^\d+$/.test(t)) return `act_${t}`;
  return t;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = await requireUser(req);
    if (!auth.ok) return auth.response;

    const body = await req.json().catch(() => ({}));
    const projectId = String(body.project_id ?? "").trim();
    if (!projectId) return json({ error: "project_id обязателен" }, 400);

    const access = await requireProjectAccess(auth.authHeader, projectId);
    if (!access.ok) return access.response;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const adAccountId = normalizeActId(String(body.ad_account_id ?? body.external_id ?? ""));
    if (!adAccountId) return json({ error: "ad_account_id обязателен" }, 400);

    const accessToken =
      typeof body.access_token === "string" && body.access_token.trim()
        ? body.access_token.trim()
        : null;

    const row: Record<string, unknown> = {
      project_id: projectId,
      name: String(body.name ?? "").trim() || adAccountId,
      external_id: adAccountId,
      ad_account_id: adAccountId,
      online: body.online !== false,
      type: body.type === "Агентский" ? "Агентский" : "Личный",
      provider: body.provider ?? "meta",
      currency: body.currency ?? "KZT",
      daily_budget: body.daily_budget != null ? Number(body.daily_budget) : null,
      city: body.city ?? null,
      page_id: body.page_id ?? null,
      page_name: body.page_name ?? null,
      instagram_id: body.instagram_id ?? null,
      telegram_group_id: body.telegram_group_id ?? null,
      whatsapp_number: body.whatsapp_number ?? null,
      pixel_id: body.pixel_id ?? null,
      pixel_event: body.pixel_event ?? "Lead",
      website_url: body.website_url ?? null,
      utm_template: body.utm_template ?? null,
      brief: body.brief ?? null,
      business_id: body.business_id ?? null,
    };
    if (accessToken) row.access_token = accessToken;

    const cabinetId = typeof body.id === "string" && body.id.trim() ? body.id.trim() : null;

    let existingId: string | null = cabinetId;
    if (!existingId) {
      const { data: existing } = await admin
        .from("ad_cabinets")
        .select("id")
        .eq("project_id", projectId)
        .eq("ad_account_id", adAccountId)
        .maybeSingle();
      existingId = (existing as { id?: string } | null)?.id ?? null;
    }

    let savedId: string;
    if (existingId) {
      const { data, error } = await admin
        .from("ad_cabinets")
        .update(row)
        .eq("id", existingId)
        .select(SAFE_FIELDS)
        .single();
      if (error) throw error;
      savedId = (data as { id: string }).id;
    } else {
      const { data, error } = await admin
        .from("ad_cabinets")
        .insert({ ...row, created_by: auth.userId })
        .select(SAFE_FIELDS)
        .single();
      if (error) throw error;
      savedId = (data as { id: string }).id;
    }

    if (accessToken) {
      await admin
        .from("meta_tokens")
        .update({ is_active: false })
        .eq("project_id", projectId)
        .eq("is_active", true);

      const { error: tokErr } = await admin.from("meta_tokens").insert({
        project_id: projectId,
        label: "Facebook OAuth",
        access_token: accessToken,
        is_active: true,
        created_by: auth.userId,
        last_validated_at: new Date().toISOString(),
        last_validation_status: "ok: saved with cabinet",
      });
      if (tokErr) {
        console.error("[meta-upsert-cabinet] meta_tokens:", tokErr.message);
      }
    }

    const { data: safe, error: readErr } = await admin
      .from("ad_cabinets")
      .select(SAFE_FIELDS)
      .eq("id", savedId)
      .single();
    if (readErr) throw readErr;

    return json({ ok: true, cabinet: safe });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});
