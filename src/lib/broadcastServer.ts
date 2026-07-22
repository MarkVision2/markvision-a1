// Серверное хранилище рассылок (Supabase) — заменяет localStorage-стор.
//
// Кампания живёт в broadcast_campaigns, получатели — в broadcast_recipients.
// Реальную отправку делает edge-функция broadcast-worker (по pg_cron), поэтому
// клиент только создаёт кампанию + получателей и «запускает» её (status=sending);
// прогресс подтягивается realtime-подпиской (stats обновляет воркер).
//
// Таблиц ещё нет в сгенерированных типах Supabase — используем принятый в
// проекте каст (supabase.from("x" as any) as any), как в CapiSettings.
import { supabase } from "@/integrations/supabase/client";
import type { LeadContact } from "@/hooks/useLeadContacts";
import {
  buildBroadcastFunnel,
  countDelivery,
  digitsPhone,
  type BroadcastFunnel,
  type BroadcastLeadLite,
  type BroadcastRecipientLite,
} from "@/lib/broadcastFunnel";
import {
  type Broadcast,
  type BroadcastDraft,
  type BroadcastStatus,
} from "@/lib/broadcastStore";

/** Один получатель для вставки в broadcast_recipients. */
export type RecipientRow = { name: string; phone: string; lead_id: string | null };

function phoneIndex(contacts: LeadContact[]): Map<string, LeadContact> {
  const m = new Map<string, LeadContact>();
  for (const c of contacts) {
    const key = digitsPhone(c.phone);
    if (key && !m.has(key)) m.set(key, c);
  }
  return m;
}

/** CRM-фильтр / загрузка → строки получателей (lead_id для трекинга конверсий). */
export function resolveRecipientRows(draft: BroadcastDraft, crmContacts: LeadContact[]): RecipientRow[] {
  const byPhone = phoneIndex(crmContacts);
  if (draft.audienceSource === "upload") {
    return draft.uploadedContacts.map((c) => {
      const hit = byPhone.get(digitsPhone(c.phone));
      return { name: c.name, phone: c.phone, lead_id: hit?.id ?? null };
    });
  }
  const { stageKeys, sources } = draft.crmFilter;
  const seen = new Set<string>();
  const out: RecipientRow[] = [];
  for (const c of crmContacts) {
    if (stageKeys.length && !stageKeys.includes(c.stageKey)) continue;
    if (sources.length && !sources.includes(c.source || "—")) continue;
    const key = digitsPhone(c.phone);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ name: c.name, phone: c.phone, lead_id: c.id });
  }
  return out;
}

const DB_TO_STATUS: Record<string, BroadcastStatus> = {
  draft: "draft",
  scheduled: "scheduled",
  sending: "sending",
  sent: "sent",
  partial: "partial",
  failed: "failed",
  canceled: "canceled",
  paused: "partial", // авто-пауза kill-switch — показываем как «частично»
};

type CampaignRow = {
  id: string;
  name: string;
  channel: string;
  audience_source: string;
  crm_filter: { stageKeys?: string[]; sources?: string[] } | null;
  title: string;
  message: string;
  schedule_mode: string;
  scheduled_at: string | null;
  status: string;
  stats: Record<string, number> | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
};

function mapRow(r: CampaignRow): Broadcast {
  const s = r.stats ?? {};
  // В jsonb воркер пишет «сырые» status=X. Для списка показываем кумулятив.
  const raw = {
    total: s.total ?? 0,
    queued: s.queued ?? 0,
    sent: s.sent ?? 0,
    delivered: s.delivered ?? 0,
    read: s.read ?? 0,
    replied: s.replied ?? 0,
    converted: s.converted ?? 0,
    failed: s.failed ?? 0,
    clicked: s.clicked ?? 0,
  };
  const sent =
    raw.sent + raw.delivered + raw.read + raw.replied + raw.converted;
  const delivered = raw.delivered + raw.read + raw.replied + raw.converted;
  const read = raw.read + raw.replied + raw.converted;
  const replied = raw.replied + raw.converted;
  return {
    id: r.id,
    name: r.name,
    channel: r.channel === "sms" ? "sms" : "whatsapp",
    audienceSource: r.audience_source === "upload" ? "upload" : "crm",
    crmFilter: {
      stageKeys: r.crm_filter?.stageKeys ?? [],
      sources: r.crm_filter?.sources ?? [],
    },
    uploadedContacts: [], // хранятся как строки broadcast_recipients
    title: r.title ?? "",
    message: r.message ?? "",
    schedule: { mode: r.schedule_mode === "scheduled" ? "scheduled" : "now", at: r.scheduled_at },
    status: DB_TO_STATUS[r.status] ?? "draft",
    recipientsCount: raw.total,
    stats: {
      total: raw.total,
      sent,
      delivered,
      read,
      replied,
      failed: raw.failed,
      clicked: raw.clicked,
      converted: raw.converted,
    },
    results: [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    sentAt: r.finished_at ?? (r as CampaignRow & { started_at?: string | null }).started_at ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => supabase as any;

export async function listCampaigns(projectId: string): Promise<Broadcast[]> {
  const { data, error } = await db()
    .from("broadcast_campaigns")
    .select("*")
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return ((data ?? []) as CampaignRow[]).map(mapRow);
}

function scheduledIso(draft: BroadcastDraft): string | null {
  if (draft.schedule.mode !== "scheduled" || !draft.schedule.at) return null;
  const d = new Date(draft.schedule.at);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** Вставка получателей пачками (unique(campaign_id, phone) отсекает дубли). */
async function insertRecipients(
  campaignId: string,
  projectId: string,
  rows: RecipientRow[],
  scheduledAt: string | null,
): Promise<void> {
  const payload = rows.map((r) => ({
    campaign_id: campaignId,
    project_id: projectId,
    lead_id: r.lead_id,
    name: r.name,
    phone: r.phone,
    status: "queued",
    scheduled_at: scheduledAt,
  }));
  for (let i = 0; i < payload.length; i += 500) {
    const chunk = payload.slice(i, i + 500);
    const { error } = await db()
      .from("broadcast_recipients")
      .upsert(chunk, { onConflict: "campaign_id,phone", ignoreDuplicates: true });
    if (error) throw error;
  }
}

export async function createCampaign(
  projectId: string,
  draft: BroadcastDraft,
  crmContacts: LeadContact[],
): Promise<Broadcast> {
  const scheduledAt = scheduledIso(draft);
  const rows = resolveRecipientRows(draft, crmContacts);
  const status = draft.schedule.mode === "scheduled" ? "scheduled" : "draft";
  const stats = { total: rows.length, queued: rows.length, sent: 0, delivered: 0, read: 0, replied: 0, converted: 0, failed: 0, optout: 0 };

  const { data, error } = await db()
    .from("broadcast_campaigns")
    .insert({
      project_id: projectId,
      name: draft.name,
      channel: draft.channel,
      audience_source: draft.audienceSource,
      crm_filter: draft.crmFilter,
      title: draft.title,
      message: draft.message,
      schedule_mode: draft.schedule.mode,
      scheduled_at: scheduledAt,
      status,
      stats,
    })
    .select("*")
    .single();
  if (error) throw error;
  const campaign = data as CampaignRow;
  if (rows.length) await insertRecipients(campaign.id, projectId, rows, scheduledAt);
  return mapRow(campaign);
}

export async function updateCampaign(
  projectId: string,
  id: string,
  draft: BroadcastDraft,
  crmContacts: LeadContact[],
): Promise<void> {
  const scheduledAt = scheduledIso(draft);
  const rows = resolveRecipientRows(draft, crmContacts);

  // Пересобираем получателей только пока кампания не ушла в отправку.
  const { data: current } = await db()
    .from("broadcast_campaigns")
    .select("status")
    .eq("id", id)
    .maybeSingle();
  const editable = ["draft", "scheduled"].includes((current as { status?: string } | null)?.status ?? "draft");

  const patch: Record<string, unknown> = {
    name: draft.name,
    channel: draft.channel,
    audience_source: draft.audienceSource,
    crm_filter: draft.crmFilter,
    title: draft.title,
    message: draft.message,
    schedule_mode: draft.schedule.mode,
    scheduled_at: scheduledAt,
  };
  if (editable) {
    patch.status = draft.schedule.mode === "scheduled" ? "scheduled" : "draft";
    patch.stats = { total: rows.length, queued: rows.length, sent: 0, delivered: 0, read: 0, replied: 0, converted: 0, failed: 0, optout: 0 };
  }

  const { error } = await db().from("broadcast_campaigns").update(patch).eq("id", id);
  if (error) throw error;

  if (editable) {
    await db().from("broadcast_recipients").delete().eq("campaign_id", id);
    if (rows.length) await insertRecipients(id, projectId, rows, scheduledAt);
  }
}

export async function removeCampaign(id: string): Promise<void> {
  const { error } = await db().from("broadcast_campaigns").delete().eq("id", id);
  if (error) throw error;
}

/** Запуск немедленной отправки: воркер подхватит status=sending на ближайшем тике. */
export async function launchCampaign(id: string): Promise<void> {
  const { error } = await db()
    .from("broadcast_campaigns")
    .update({ status: "sending", started_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/** Живые счётчики получателей кампании (для прогресса запуска). */
export type RecipientCounts = {
  total: number; queued: number; sent: number; delivered: number;
  read: number; replied: number; failed: number; optout: number;
};

export async function fetchRecipientCounts(campaignId: string): Promise<RecipientCounts> {
  const { data } = await db()
    .from("broadcast_recipients")
    .select("status")
    .eq("campaign_id", campaignId)
    .limit(20000);
  const rows = (data ?? []) as { status: string }[];
  const recipients = rows.map((r, i) => ({
    id: String(i),
    name: "",
    phone: "",
    status: r.status,
    leadId: null,
    sentAt: null,
    deliveredAt: null,
    readAt: null,
    repliedAt: null,
    clickedAt: null,
    convertedAt: null,
    error: null,
  }));
  const d = countDelivery(recipients);
  return {
    total: d.total,
    queued: d.queued,
    sent: d.sent,
    delivered: d.delivered,
    read: d.read,
    replied: d.replied,
    failed: d.failed,
    optout: d.optout,
  };
}

export type CampaignDetail = {
  campaign: Broadcast;
  recipients: BroadcastRecipientLite[];
  funnel: BroadcastFunnel;
  leads: BroadcastLeadLite[];
};

type RecipientDbRow = {
  id: string;
  name: string | null;
  phone: string;
  status: string;
  lead_id: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  replied_at: string | null;
  clicked_at: string | null;
  converted_at: string | null;
  error: string | null;
};

function mapRecipient(r: RecipientDbRow): BroadcastRecipientLite {
  return {
    id: r.id,
    name: r.name ?? "",
    phone: r.phone,
    status: r.status,
    leadId: r.lead_id,
    sentAt: r.sent_at,
    deliveredAt: r.delivered_at,
    readAt: r.read_at,
    repliedAt: r.replied_at,
    clickedAt: r.clicked_at,
    convertedAt: r.converted_at,
    error: r.error,
  };
}

/** Кампания + получатели + воронка CRM (лиды / группа / вебинар / продажи). */
export async function fetchCampaignDetail(
  campaignId: string,
  projectId: string,
): Promise<CampaignDetail | null> {
  const { data: camp, error } = await db()
    .from("broadcast_campaigns")
    .select("*")
    .eq("id", campaignId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) throw error;
  if (!camp) return null;

  const { data: recData, error: recErr } = await db()
    .from("broadcast_recipients")
    .select(
      "id, name, phone, status, lead_id, sent_at, delivered_at, read_at, replied_at, clicked_at, converted_at, error",
    )
    .eq("campaign_id", campaignId)
    .order("sent_at", { ascending: false, nullsFirst: false })
    .limit(20000);
  if (recErr) throw recErr;
  const recipients = ((recData ?? []) as RecipientDbRow[]).map(mapRecipient);

  const leadIds = [
    ...new Set(recipients.map((r) => r.leadId).filter((x): x is string => !!x)),
  ];
  const phones = [
    ...new Set(recipients.map((r) => digitsPhone(r.phone)).filter(Boolean)),
  ];

  const [{ data: stagesData }, leadsByIdRes, leadsByPhoneRes] = await Promise.all([
    db().from("pipeline_stages").select("id, key, stage_role"),
    leadIds.length
      ? db()
          .from("leads")
          .select("id, phone, stage_id, paid, amount, deposit_amount, webinar_status")
          .in("id", leadIds)
          .limit(5000)
      : Promise.resolve({ data: [] }),
    phones.length
      ? db()
          .from("leads")
          .select("id, phone, stage_id, paid, amount, deposit_amount, webinar_status")
          .eq("project_id", projectId)
          .eq("is_personal", false)
          .limit(5000)
      : Promise.resolve({ data: [] }),
  ]);

  const stageById = new Map<string, { key: string | null; role: string | null }>();
  for (const s of (stagesData ?? []) as Array<{ id: string; key?: string; stage_role?: string }>) {
    stageById.set(s.id, { key: s.key ?? null, role: s.stage_role ?? null });
  }

  const phoneSet = new Set(phones);
  const leadMap = new Map<string, BroadcastLeadLite>();
  const ingest = (rows: Array<Record<string, unknown>>) => {
    for (const r of rows) {
      const id = String(r.id);
      if (leadMap.has(id)) continue;
      const phone = String(r.phone ?? "");
      const linkedById = leadIds.includes(id);
      const linkedByPhone = phoneSet.has(digitsPhone(phone));
      if (!linkedById && !linkedByPhone) continue;
      const stage = stageById.get(String(r.stage_id ?? ""));
      leadMap.set(id, {
        id,
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

  const leads = [...leadMap.values()];
  const funnel = buildBroadcastFunnel(recipients, leads);
  const campaign = mapRow(camp as CampaignRow);
  // Подменяем stats живой воронкой (не устаревший jsonb).
  campaign.stats = {
    total: funnel.total,
    sent: funnel.sent,
    delivered: funnel.delivered,
    read: funnel.read,
    replied: funnel.replied,
    failed: funnel.failed,
    clicked: funnel.clicked,
    converted: funnel.sales,
  };
  campaign.recipientsCount = funnel.total;

  return { campaign, recipients, funnel, leads };
}

export async function getCampaign(campaignId: string, projectId: string): Promise<Broadcast | null> {
  const { data, error } = await db()
    .from("broadcast_campaigns")
    .select("*")
    .eq("id", campaignId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return mapRow(data as CampaignRow);
}
