// Broadcast group sync — детект реального вступления в WhatsApp-группу +
// атрибуция в CRM.
//
// Для кампаний с привязанной группой (broadcast_campaigns.group_id = …@g.us)
// опрашивает у Green состав группы (getGroupData), матчит участников с
// получателями по телефону и:
//   1) ставит broadcast_recipients.joined_at (реальное вступление);
//   2) заводит/привязывает лида в CRM и forward-only двигает стадию на
//      «в группе» — дальше по воронке CRM (подтвердил участие → … → оплата).
//
// Запускается pg_cron раз в 5 минут. Auth: x-automation-key == cron_secret.
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import {
  DEFAULT_GREEN_API_BASE_URL,
  validateGreenApiBaseUrl,
} from "../_lib/green_api_url.ts";
import {
  buildBroadcastFunnel,
  funnelToCampaignStats,
  phoneKey,
  type BroadcastLeadLite,
  type BroadcastRecipientLite,
} from "../_lib/broadcastFunnel.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-automation-key",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Порядок стадий CRM — только вперёд, как в crm-stage-update. */
const ROLE_ORDER: Record<string, number> = {
  new: 1,
  bot_activated: 2,
  whatsapp: 2,
  joined_group: 3,
  warming: 3,
  confirmed: 4,
  attended: 5,
  deposit: 6,
  interest: 7,
  call_scheduled: 7,
  call_done: 8,
  offer: 9,
  paid: 10,
  student: 11,
  graduate: 12,
  rejected: 99,
  other: 0,
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function digits(s: string | null | undefined): string {
  return String(s ?? "").replace(/\D/g, "");
}

function normalizeRole(role: string | null | undefined, key: string | null | undefined): string {
  const r = (role ?? "").toLowerCase();
  if (r === "whatsapp") return "bot_activated";
  if (r === "warming") return "joined_group";
  if (r === "interest") return "call_scheduled";
  if (r) return r;
  const k = (key ?? "").toLowerCase();
  if (k === "joined_group" || k === "warming") return "joined_group";
  if (k === "bot_activated" || k === "whatsapp") return "bot_activated";
  if (k) return k;
  return "other";
}

function canAdvance(from: string, to: string): boolean {
  if (from === to) return false;
  if (to === "rejected") return true;
  if (from === "rejected" || from === "graduate") return false;
  if (from === "paid" && to !== "student" && to !== "graduate") return false;
  if (from === "student" && to !== "graduate") return false;
  return (ROLE_ORDER[to] ?? 0) >= (ROLE_ORDER[from] ?? 0);
}

type Creds = { idInstance: string; apiToken: string; baseUrl: string };

async function resolveCreds(projectId: string): Promise<Creds | null> {
  const { data } = await admin
    .from("whatsapp_config")
    .select("id_instance, api_token, api_url")
    .eq("project_id", projectId)
    .maybeSingle();
  const row = data as { id_instance?: string; api_token?: string; api_url?: string } | null;
  if (!row?.id_instance || !row.api_token) return null;
  let baseUrl = DEFAULT_GREEN_API_BASE_URL;
  try { baseUrl = validateGreenApiBaseUrl(row.api_url ?? ""); } catch { return null; }
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

// ─── CRM-атрибуция ───────────────────────────────────────────────────────────
type JoinStage = {
  pipeline_id: string;
  stage_id: string;
  /** stage_id → normalized role */
  roleByStageId: Map<string, string>;
} | null;

/** Стадия для вступивших: приоритет «joined_group», иначе первая стадия. */
async function resolveJoinStage(projectId: string): Promise<JoinStage> {
  const pickPipe = async (): Promise<string | null> => {
    const { data: def } = await admin.from("pipelines").select("id")
      .eq("project_id", projectId).eq("is_default", true)
      .order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (def?.id) return def.id as string;
    const { data: any } = await admin.from("pipelines").select("id")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true }).limit(1).maybeSingle();
    return (any?.id as string) ?? null;
  };
  const pipelineId = await pickPipe();
  if (!pipelineId) return null;
  const { data: stages } = await admin.from("pipeline_stages")
    .select("id, key, stage_role, order_index")
    .eq("pipeline_id", pipelineId)
    .order("order_index", { ascending: true });
  const rows = (stages ?? []) as { id: string; key: string | null; stage_role: string | null; order_index: number }[];
  if (rows.length === 0) return null;
  const roleByStageId = new Map<string, string>();
  for (const s of rows) {
    roleByStageId.set(s.id, normalizeRole(s.stage_role, s.key));
  }
  const joined = rows.find((s) => s.key === "joined_group" || s.stage_role === "joined_group");
  return {
    pipeline_id: pipelineId,
    stage_id: (joined ?? rows[0]).id,
    roleByStageId,
  };
}

async function projectOwner(projectId: string): Promise<string | null> {
  const { data } = await admin.from("projects").select("created_by").eq("id", projectId).maybeSingle();
  return (data as { created_by?: string | null } | null)?.created_by ?? null;
}

async function findLeadByPhone(projectId: string, d: string): Promise<string | null> {
  if (d.length < 8) return null;
  const needle = d.slice(-10);
  const { data } = await admin.from("leads").select("id, phone")
    .eq("project_id", projectId)
    .eq("is_personal", false)
    .or(`phone.eq.+${d},phone.eq.${d},phone.like.%${needle}`)
    .order("created_at", { ascending: false })
    .limit(20);
  const hit = (data ?? []).find((r: { phone?: string }) => {
    const p = digits(r.phone);
    return p === d || p.endsWith(needle) || needle.endsWith(p.slice(-10));
  });
  return (hit as { id?: string } | null)?.id ?? null;
}

/**
 * Привязка к кампании + forward-only сдвиг на «Вступил в группу».
 * Не откатывает лида, который уже дальше (confirmed / paid / …).
 */
async function attributeAndAdvanceJoin(
  leadId: string,
  campaignId: string,
  joinStage: NonNullable<JoinStage>,
): Promise<"advanced" | "attributed" | "unchanged"> {
  const { data: lead } = await admin.from("leads")
    .select("id, stage_id, pipeline_id, broadcast_campaign_id")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) return "unchanged";

  const row = lead as {
    id: string;
    stage_id: string | null;
    pipeline_id: string | null;
    broadcast_campaign_id: string | null;
  };

  const patch: Record<string, unknown> = {};
  if (!row.broadcast_campaign_id) {
    patch.broadcast_campaign_id = campaignId;
  }

  const currentRole = joinStage.roleByStageId.get(row.stage_id ?? "") ?? "other";
  if (canAdvance(currentRole, "joined_group")) {
    patch.stage_id = joinStage.stage_id;
    if (!row.pipeline_id) patch.pipeline_id = joinStage.pipeline_id;
  }

  if (Object.keys(patch).length === 0) return "unchanged";
  await admin.from("leads").update(patch).eq("id", leadId);
  return patch.stage_id ? "advanced" : "attributed";
}

async function authorize(req: Request): Promise<boolean> {
  const { data } = await admin.from("automation_settings").select("cron_secret").eq("id", true).maybeSingle();
  const secret = (data as { cron_secret?: string } | null)?.cron_secret ?? null;
  const provided = req.headers.get("x-automation-key");
  if (secret && provided && provided === secret) return true;
  const auth = req.headers.get("Authorization") ?? "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (jwt && ANON_KEY) {
    const uc = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user } } = await uc.auth.getUser();
    if (user?.id) {
      const { data: role } = await admin.from("user_roles").select("role")
        .eq("user_id", user.id).eq("role", "admin").maybeSingle();
      if (role) return true;
    }
  }
  return false;
}

async function groupInviteLink(creds: Creds, groupId: string): Promise<string | null> {
  try {
    const url = `${creds.baseUrl}/waInstance${creds.idInstance}/getGroupData/${creds.apiToken}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId }),
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null) as { groupInviteLink?: string } | null;
    return data?.groupInviteLink ?? null;
  } catch {
    return null;
  }
}

function inviteCode(u: string | null | undefined): string | null {
  if (!u) return null;
  const m = String(u).match(/chat\.whatsapp\.com\/([A-Za-z0-9_-]+)/i);
  return m?.[1] ?? null;
}

/** Кампании с invite-URL, но без group_id — подтягиваем chatId группы. */
async function bindMissingGroupIds(credsCache: Map<string, Creds | null>): Promise<number> {
  const since = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
  const { data } = await admin
    .from("broadcast_campaigns")
    .select("id, project_id, target_url")
    .is("group_id", null)
    .not("target_url", "is", null)
    .in("status", ["sending", "sent", "partial"])
    .gte("updated_at", since)
    .limit(50);
  const rows = (data ?? []) as { id: string; project_id: string; target_url: string }[];
  let bound = 0;
  const contactsCache = new Map<string, { id: string }[]>();

  for (const c of rows) {
    const code = inviteCode(c.target_url);
    if (!code) continue;
    if (!credsCache.has(c.project_id)) credsCache.set(c.project_id, await resolveCreds(c.project_id));
    const creds = credsCache.get(c.project_id) ?? null;
    if (!creds) continue;

    if (!contactsCache.has(c.project_id)) {
      try {
        const url = `${creds.baseUrl}/waInstance${creds.idInstance}/getContacts/${creds.apiToken}`;
        const res = await fetch(url);
        const contacts = res.ok ? await res.json().catch(() => []) : [];
        const groups = (Array.isArray(contacts) ? contacts : [])
          .filter((x: { id?: string }) => String(x.id ?? "").endsWith("@g.us"))
          .map((x: { id?: string }) => ({ id: String(x.id) }));
        contactsCache.set(c.project_id, groups);
      } catch {
        contactsCache.set(c.project_id, []);
      }
    }
    const groups = contactsCache.get(c.project_id) ?? [];
    for (const g of groups) {
      const link = await groupInviteLink(creds, g.id);
      if (link && inviteCode(link) === code) {
        await admin.from("broadcast_campaigns").update({ group_id: g.id }).eq("id", c.id);
        bound += 1;
        break;
      }
    }
  }
  return bound;
}

type Campaign = { id: string; project_id: string; group_id: string };
type Rec = { id: string; phone: string; name: string; lead_id: string | null; campaign_id: string; status: string };

/** Пересчёт stats кампании (доставка + CRM вебинар/оплата) + touch updated_at. */
async function refreshCampaignStats(campaignId: string) {
  const { data: camp } = await admin
    .from("broadcast_campaigns")
    .select("id, project_id")
    .eq("id", campaignId)
    .maybeSingle();
  if (!camp) return;
  const projectId = (camp as { project_id: string }).project_id;

  const { data } = await admin
    .from("broadcast_recipients")
    .select(
      "id, name, phone, status, lead_id, sent_at, delivered_at, read_at, replied_at, clicked_at, converted_at, joined_at, error",
    )
    .eq("campaign_id", campaignId)
    .limit(50000);

  const recipients: BroadcastRecipientLite[] = ((data ?? []) as Array<Record<string, unknown>>).map(
    (row) => ({
      id: String(row.id),
      name: String(row.name ?? ""),
      phone: String(row.phone ?? ""),
      status: String(row.status ?? "queued"),
      leadId: (row.lead_id as string | null) ?? null,
      sentAt: (row.sent_at as string | null) ?? null,
      deliveredAt: (row.delivered_at as string | null) ?? null,
      readAt: (row.read_at as string | null) ?? null,
      repliedAt: (row.replied_at as string | null) ?? null,
      clickedAt: (row.clicked_at as string | null) ?? null,
      convertedAt: (row.converted_at as string | null) ?? null,
      joinedAt: (row.joined_at as string | null) ?? null,
      error: (row.error as string | null) ?? null,
    }),
  );

  const leadIds = [
    ...new Set(recipients.map((r) => r.leadId).filter((x): x is string => !!x)),
  ];
  const phones = [
    ...new Set(recipients.map((r) => phoneKey(r.phone)).filter(Boolean)),
  ];

  const [{ data: stagesData }, leadsByIdRes, leadsByPhoneRes] = await Promise.all([
    admin.from("pipeline_stages").select("id, key, stage_role"),
    leadIds.length
      ? admin
          .from("leads")
          .select("id, name, phone, stage_id, paid, amount, deposit_amount, webinar_status")
          .in("id", leadIds)
          .limit(10000)
      : Promise.resolve({ data: [] as unknown[] }),
    phones.length
      ? admin
          .from("leads")
          .select("id, name, phone, stage_id, paid, amount, deposit_amount, webinar_status")
          .eq("project_id", projectId)
          .eq("is_personal", false)
          .limit(8000)
      : Promise.resolve({ data: [] as unknown[] }),
  ]);

  const stageById = new Map<string, { key: string | null; role: string | null }>();
  for (const s of (stagesData ?? []) as Array<{ id: string; key?: string; stage_role?: string }>) {
    stageById.set(s.id, { key: s.key ?? null, role: s.stage_role ?? null });
  }

  const phoneSet = new Set(phones);
  const leadIdSet = new Set(leadIds);
  const leadMap = new Map<string, BroadcastLeadLite>();
  const ingest = (rows: Array<Record<string, unknown>>) => {
    for (const r of rows) {
      const id = String(r.id);
      if (leadMap.has(id)) continue;
      const phone = String(r.phone ?? "");
      const linkedById = leadIdSet.has(id);
      const linkedByPhone = phoneSet.has(phoneKey(phone));
      if (!linkedById && !linkedByPhone) continue;
      const stage = stageById.get(String(r.stage_id ?? ""));
      leadMap.set(id, {
        id,
        name: String(r.name ?? "").trim(),
        phone,
        stageKey: stage?.key ?? null,
        stageRole: stage?.role ?? null,
        paid: r.paid === true,
        amount: Number(r.amount ?? 0),
        depositAmount: Number(r.deposit_amount ?? 0),
        webinarStatus: (r.webinar_status as string | null) ?? null,
      });
    }
  };
  ingest((leadsByIdRes.data ?? []) as Array<Record<string, unknown>>);
  ingest((leadsByPhoneRes.data ?? []) as Array<Record<string, unknown>>);

  const funnel = buildBroadcastFunnel(recipients, [...leadMap.values()]);
  const stats = funnelToCampaignStats(recipients, funnel);

  await admin
    .from("broadcast_campaigns")
    .update({ stats, updated_at: new Date().toISOString() })
    .eq("id", campaignId);
}

/**
 * Создать / привязать лида + сдвинуть на joined_group.
 * Возвращает leadId и флаг создания.
 */
async function ensureJoinCrm(
  r: Rec,
  projectId: string,
  joinStage: NonNullable<JoinStage>,
  owner: string | null,
): Promise<{ leadId: string | null; created: boolean; advanced: boolean }> {
  let leadId = r.lead_id;
  let created = false;

  if (!leadId) {
    const d = digits(r.phone);
    leadId = await findLeadByPhone(projectId, d);
  }

  if (!leadId && joinStage) {
    const d = digits(r.phone);
    if (d.length >= 8) {
      const { data: createdRow } = await admin.from("leads").insert({
        name: r.name || `+${d}`,
        phone: `+${d}`,
        source: "broadcast",
        channel: "whatsapp",
        project_id: projectId,
        pipeline_id: joinStage.pipeline_id,
        stage_id: joinStage.stage_id,
        created_by: owner,
        assigned_to: owner,
        broadcast_campaign_id: r.campaign_id,
      }).select("id").single();
      leadId = (createdRow as { id?: string } | null)?.id ?? null;
      if (leadId) created = true;
    }
  }

  if (!leadId) return { leadId: null, created: false, advanced: false };

  let advanced = false;
  if (created) {
    // Уже на joined_group при insert — только привязка recipient.
    await admin.from("leads")
      .update({ broadcast_campaign_id: r.campaign_id })
      .eq("id", leadId)
      .is("broadcast_campaign_id", null);
  } else {
    const result = await attributeAndAdvanceJoin(leadId, r.campaign_id, joinStage);
    advanced = result === "advanced";
  }

  if (r.lead_id !== leadId) {
    await admin.from("broadcast_recipients").update({ lead_id: leadId }).eq("id", r.id);
  }

  return { leadId, created, advanced };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!(await authorize(req))) return json({ error: "unauthorized" }, 401);

  const credsCache = new Map<string, Creds | null>();
  const bound = await bindMissingGroupIds(credsCache);

  const since = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
  const { data: camps } = await admin
    .from("broadcast_campaigns")
    .select("id, project_id, group_id")
    .not("group_id", "is", null)
    .in("status", ["sending", "sent", "partial"])
    .gte("updated_at", since);

  const campaigns = (camps ?? []) as Campaign[];
  if (campaigns.length === 0) {
    return json({ ok: true, note: "no group campaigns", bound, ran_at: new Date().toISOString() });
  }

  const byProject = new Map<string, Map<string, string[]>>();
  for (const c of campaigns) {
    if (!byProject.has(c.project_id)) byProject.set(c.project_id, new Map());
    const g = byProject.get(c.project_id)!;
    if (!g.has(c.group_id)) g.set(c.group_id, []);
    g.get(c.group_id)!.push(c.id);
  }

  let marked = 0;
  let leadsCreated = 0;
  let leadsAdvanced = 0;
  let repaired = 0;
  const touchedCampaigns = new Set<string>();

  for (const [projectId, groups] of byProject) {
    if (!credsCache.has(projectId)) credsCache.set(projectId, await resolveCreds(projectId));
    const creds = credsCache.get(projectId) ?? null;
    if (!creds) continue;

    let joinStage: JoinStage = null;
    let owner: string | null = null;
    let resolvedCrm = false;

    const ensureCrmReady = async () => {
      if (resolvedCrm) return;
      joinStage = await resolveJoinStage(projectId);
      owner = await projectOwner(projectId);
      resolvedCrm = true;
    };

    for (const [groupId, campaignIds] of groups) {
      const members = await groupParticipants(creds, groupId);
      if (!members || members.size === 0) continue;

      const { data: recData } = await admin
        .from("broadcast_recipients")
        .select("id, phone, name, lead_id, campaign_id, status")
        .in("campaign_id", campaignIds)
        .is("joined_at", null)
        .limit(20000);
      const newly = ((recData ?? []) as Rec[]).filter((r) => members.has(digits(r.phone)));

      if (newly.length > 0) {
        await ensureCrmReady();
        if (!joinStage) continue;

        const now = new Date().toISOString();
        for (const r of newly) {
          // Вступление = точно получил/открыл ссылку. Статусы доставки Green API
          // иногда зависают на sent — догоняем по факту join.
          const patch: Record<string, unknown> = {
            joined_at: now,
            clicked_at: now,
            delivered_at: now,
            read_at: now,
          };
          if (["queued", "sending", "sent", "delivered", "read"].includes(r.status)) {
            patch.status = "clicked";
          }
          await admin.from("broadcast_recipients").update(patch).eq("id", r.id);
          marked += 1;
          touchedCampaigns.add(r.campaign_id);

          const result = await ensureJoinCrm(r, projectId, joinStage, owner);
          if (result.created) leadsCreated += 1;
          if (result.advanced) leadsAdvanced += 1;
        }
      }

      // Ремонт: уже вступившие, но без лида / без сдвига стадии (баг старой версии).
      await ensureCrmReady();
      if (!joinStage) continue;

      const { data: joinedData } = await admin
        .from("broadcast_recipients")
        .select("id, phone, name, lead_id, campaign_id, status")
        .in("campaign_id", campaignIds)
        .not("joined_at", "is", null)
        .limit(20000);
      for (const r of (joinedData ?? []) as Rec[]) {
        if (!members.has(digits(r.phone))) continue;
        const before = r.lead_id;
        const result = await ensureJoinCrm(r, projectId, joinStage, owner);
        if (result.created) leadsCreated += 1;
        if (result.advanced || (!before && result.leadId)) {
          repaired += 1;
          touchedCampaigns.add(r.campaign_id);
        }
        if (result.advanced) leadsAdvanced += 1;
      }

      // Даже без новых join — периодически освежаем stats, чтобы UI не замирал.
      for (const cid of campaignIds) touchedCampaigns.add(cid);
    }
  }

  for (const cid of touchedCampaigns) {
    try {
      await refreshCampaignStats(cid);
    } catch (e) {
      console.warn("refreshCampaignStats failed", cid, e);
    }
  }

  return json({
    ok: true,
    marked,
    leadsCreated,
    leadsAdvanced,
    repaired,
    bound,
    campaignsRefreshed: touchedCampaigns.size,
    ran_at: new Date().toISOString(),
  });
});
