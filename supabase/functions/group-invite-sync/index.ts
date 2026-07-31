/**
 * Sync real WhatsApp group joins for tracked public invite links
 * (group_invite_links).
 *
 * 1) First run: snapshot current members as baseline (not counted as joins)
 * 2) Later runs: new phones → join_count++, CRM stage joined_group
 *
 * Auth: x-automation-key == cron_secret (same as broadcast-group-sync).
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import {
  DEFAULT_GREEN_API_BASE_URL,
  validateGreenApiBaseUrl,
} from "../_lib/green_api_url.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-automation-key",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
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

type Creds = { idInstance: string; apiToken: string; baseUrl: string };

async function authorize(req: Request): Promise<boolean> {
  const key = req.headers.get("x-automation-key");
  if (!key) return false;
  const { data } = await admin.from("automation_settings").select("cron_secret").eq("id", true).maybeSingle();
  const secret = (data as { cron_secret?: string | null } | null)?.cron_secret;
  return !!secret && key === secret;
}

async function resolveCreds(projectId: string): Promise<Creds | null> {
  const { data } = await admin
    .from("whatsapp_config")
    .select("id_instance, api_token, api_url")
    .eq("project_id", projectId)
    .maybeSingle();
  const row = data as { id_instance?: string; api_token?: string; api_url?: string } | null;
  if (!row?.id_instance || !row.api_token) return null;
  let baseUrl = DEFAULT_GREEN_API_BASE_URL;
  try {
    baseUrl = validateGreenApiBaseUrl(row.api_url ?? "");
  } catch {
    return null;
  }
  return { idInstance: row.id_instance, apiToken: (row.api_token ?? "").trim(), baseUrl };
}

async function groupParticipants(creds: Creds, groupId: string): Promise<Set<string> | null> {
  try {
    const url = `${creds.baseUrl}/waInstance${creds.idInstance}/getGroupData/${creds.apiToken}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId }),
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null) as { participants?: { id?: string }[] } | null;
    const parts = data?.participants;
    if (!Array.isArray(parts)) return null;
    const set = new Set<string>();
    for (const p of parts) {
      const d = digits(p?.id);
      if (d.length >= 8) set.add(d);
    }
    return set;
  } catch {
    return null;
  }
}

async function resolveJoinedStageId(projectId: string): Promise<string | null> {
  const { data: pipe } = await admin.from("pipelines").select("id")
    .eq("project_id", projectId).eq("is_default", true)
    .order("created_at", { ascending: true }).limit(1).maybeSingle();
  let pipelineId = (pipe as { id?: string } | null)?.id ?? null;
  if (!pipelineId) {
    const { data: any } = await admin.from("pipelines").select("id")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true }).limit(1).maybeSingle();
    pipelineId = (any as { id?: string } | null)?.id ?? null;
  }
  if (!pipelineId) return null;
  const { data: stages } = await admin.from("pipeline_stages")
    .select("id, key, stage_role")
    .eq("pipeline_id", pipelineId)
    .order("order_index", { ascending: true });
  const rows = (stages ?? []) as { id: string; key: string | null; stage_role: string | null }[];
  const hit = rows.find((s) => s.key === "joined_group" || s.stage_role === "joined_group");
  return (hit ?? rows[0])?.id ?? null;
}

async function findLeadByPhone(projectId: string, d: string): Promise<{ id: string; stage_id: string | null } | null> {
  if (d.length < 8) return null;
  const needle = d.slice(-10);
  const { data } = await admin.from("leads").select("id, phone, stage_id")
    .eq("project_id", projectId)
    .eq("is_personal", false)
    .or(`phone.eq.+${d},phone.eq.${d},phone.like.%${needle}`)
    .order("created_at", { ascending: false })
    .limit(20);
  const hit = (data ?? []).find((r: { phone?: string }) => {
    const p = digits(r.phone);
    return p === d || p.endsWith(needle) || needle.endsWith(p.slice(-10));
  }) as { id?: string; stage_id?: string | null } | undefined;
  if (!hit?.id) return null;
  return { id: hit.id, stage_id: hit.stage_id ?? null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!(await authorize(req))) return json({ error: "unauthorized" }, 401);

  const { data: links } = await admin
    .from("group_invite_links")
    .select("id, project_id, group_id, baseline_taken, join_count")
    .eq("is_active", true)
    .not("group_id", "is", null);

  const rows = (links ?? []) as Array<{
    id: string;
    project_id: string;
    group_id: string;
    baseline_taken: boolean;
    join_count: number;
  }>;

  let baselines = 0;
  let joins = 0;
  let advanced = 0;

  const credsCache = new Map<string, Creds | null>();

  for (const link of rows) {
    if (!credsCache.has(link.project_id)) {
      credsCache.set(link.project_id, await resolveCreds(link.project_id));
    }
    const creds = credsCache.get(link.project_id) ?? null;
    if (!creds) continue;

    const members = await groupParticipants(creds, link.group_id);
    if (!members || members.size === 0) continue;

    const { data: knownRows } = await admin
      .from("group_invite_members")
      .select("phone_digits")
      .eq("link_id", link.id);
    const known = new Set(
      ((knownRows ?? []) as { phone_digits: string }[]).map((r) => r.phone_digits),
    );

    const fresh = [...members].filter((p) => !known.has(p));
    if (fresh.length === 0) continue;

    if (!link.baseline_taken) {
      // First snapshot — everyone already in the group is baseline, not a "join via link".
      const inserts = fresh.map((phone) => ({
        link_id: link.id,
        project_id: link.project_id,
        phone_digits: phone,
        joined_via_link: false,
      }));
      const { error } = await admin.from("group_invite_members").upsert(inserts, {
        onConflict: "link_id,phone_digits",
        ignoreDuplicates: true,
      });
      if (!error) {
        await admin.from("group_invite_links")
          .update({ baseline_taken: true })
          .eq("id", link.id);
        baselines += fresh.length;
      }
      continue;
    }

    const stageId = await resolveJoinedStageId(link.project_id);
    const nowIso = new Date().toISOString();
    let newJoins = 0;

    for (const phone of fresh) {
      let leadId: string | null = null;
      const existing = await findLeadByPhone(link.project_id, phone);
      if (existing) {
        leadId = existing.id;
        if (stageId && existing.stage_id !== stageId) {
          const { error: upErr } = await admin.from("leads")
            .update({ stage_id: stageId, last_activity_at: nowIso })
            .eq("id", existing.id);
          if (!upErr) advanced += 1;
        }
      }

      const { error } = await admin.from("group_invite_members").insert({
        link_id: link.id,
        project_id: link.project_id,
        phone_digits: phone,
        joined_via_link: true,
        lead_id: leadId,
        first_seen_at: nowIso,
      });
      if (!error) newJoins += 1;
    }

    if (newJoins > 0) {
      await admin.from("group_invite_links")
        .update({ join_count: (link.join_count ?? 0) + newJoins })
        .eq("id", link.id);
      joins += newJoins;
    }
  }

  return json({
    ok: true,
    links: rows.length,
    baselines,
    joins,
    advanced,
    ran_at: new Date().toISOString(),
  });
});
