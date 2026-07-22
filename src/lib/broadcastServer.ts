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
  type Broadcast,
  type BroadcastDraft,
  type BroadcastStatus,
} from "@/lib/broadcastStore";

/** Один получатель для вставки в broadcast_recipients. */
export type RecipientRow = { name: string; phone: string; lead_id: string | null };

/** CRM-фильтр → строки получателей (с сохранением lead_id для трекинга конверсий). */
export function resolveRecipientRows(draft: BroadcastDraft, crmContacts: LeadContact[]): RecipientRow[] {
  if (draft.audienceSource === "upload") {
    return draft.uploadedContacts.map((c) => ({ name: c.name, phone: c.phone, lead_id: null }));
  }
  const { stageKeys, sources } = draft.crmFilter;
  const seen = new Set<string>();
  const out: RecipientRow[] = [];
  for (const c of crmContacts) {
    if (stageKeys.length && !stageKeys.includes(c.stageKey)) continue;
    if (sources.length && !sources.includes(c.source || "—")) continue;
    const key = c.phone.replace(/\D/g, "");
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
  const reached = (s.sent ?? 0) + (s.delivered ?? 0) + (s.read ?? 0) + (s.replied ?? 0) + (s.converted ?? 0);
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
    recipientsCount: s.total ?? 0,
    stats: { total: s.total ?? 0, sent: reached, failed: s.failed ?? 0 },
    results: [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    sentAt: r.finished_at,
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
  const c = (s: string) => rows.filter((r) => r.status === s).length;
  return {
    total: rows.length,
    queued: c("queued"),
    sent: c("sent"),
    delivered: c("delivered"),
    read: c("read"),
    replied: c("replied"),
    failed: c("failed"),
    optout: c("skipped_optout"),
  };
}
