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

/**
 * Канонический формат телефона для хранения: «+<цифры>». Единый формат нужен,
 * чтобы дедуп (unique campaign_id+phone) и матчинг статусов/opt-out в webhook
 * не сбоили из-за разных форматов. Возвращает "" для явно невалидных номеров
 * (8–15 цифр — международный диапазон E.164).
 */
export function canonicalPhone(raw: string): string {
  const d = (raw ?? "").replace(/\D/g, "");
  if (d.length < 8 || d.length > 15) return "";
  return `+${d}`;
}

/** CRM-фильтр → строки получателей (с сохранением lead_id для трекинга конверсий). */
export function resolveRecipientRows(draft: BroadcastDraft, crmContacts: LeadContact[]): RecipientRow[] {
  const seen = new Set<string>();
  const out: RecipientRow[] = [];
  const push = (name: string, rawPhone: string, leadId: string | null) => {
    const phone = canonicalPhone(rawPhone);
    if (!phone || seen.has(phone)) return;
    seen.add(phone);
    out.push({ name, phone, lead_id: leadId });
  };

  if (draft.audienceSource === "upload") {
    for (const c of draft.uploadedContacts) push(c.name, c.phone, null);
    return out;
  }
  const { stageKeys, sources } = draft.crmFilter;
  for (const c of crmContacts) {
    if (stageKeys.length && !stageKeys.includes(c.stageKey)) continue;
    if (sources.length && !sources.includes(c.source || "—")) continue;
    push(c.name, c.phone, c.id);
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
  message_variants: string[] | null;
  target_url: string | null;
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
    targetUrl: r.target_url ?? "",
    messageVariants: Array.isArray(r.message_variants) ? r.message_variants : [],
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
      message_variants: draft.messageVariants ?? [],
      target_url: draft.targetUrl || null,
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
    message_variants: draft.messageVariants ?? [],
    target_url: draft.targetUrl || null,
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
  read: number; replied: number; clicked: number; converted: number;
  failed: number; optout: number;
};

// ─── Панель безопасности (лимиты / пауза / opt-out) ──────────────────────────
const WARMUP_DAY1 = 20;
const WARMUP_GROWTH = 1.3;
const DEFAULT_DAILY_CAP = 120;

/** Эффективный дневной потолок с учётом прогрева (зеркалит воркер). */
export function warmupDailyCap(warmupStartedOn: string | null): number {
  if (!warmupStartedOn) return WARMUP_DAY1;
  const days = Math.max(
    0,
    Math.floor((Date.now() - new Date(warmupStartedOn + "T00:00:00Z").getTime()) / 86400000),
  );
  const cap = Math.round(WARMUP_DAY1 * Math.pow(WARMUP_GROWTH, days));
  return Math.min(DEFAULT_DAILY_CAP, Math.max(WARMUP_DAY1, cap));
}

export type OptOut = { phone: string; reason: string | null; created_at: string };
export type BroadcastSafety = {
  paused: boolean;
  pauseReason: string | null;
  sentToday: number;
  dailyCap: number;
  warmupStartedOn: string | null;
  optOuts: OptOut[];
};

export async function fetchSafety(projectId: string): Promise<BroadcastSafety> {
  const today = new Date().toISOString().slice(0, 10);
  const [stateRes, dailyRes, optRes] = await Promise.all([
    db().from("broadcast_sender_state").select("paused, pause_reason, warmup_started_on").eq("project_id", projectId).maybeSingle(),
    db().from("broadcast_sender_daily").select("sent").eq("project_id", projectId).eq("day", today).maybeSingle(),
    db().from("broadcast_opt_outs").select("phone, reason, created_at").eq("project_id", projectId).order("created_at", { ascending: false }).limit(500),
  ]);
  const state = (stateRes.data ?? {}) as { paused?: boolean; pause_reason?: string | null; warmup_started_on?: string | null };
  return {
    paused: !!state.paused,
    pauseReason: state.pause_reason ?? null,
    sentToday: ((dailyRes.data as { sent?: number } | null)?.sent) ?? 0,
    dailyCap: warmupDailyCap(state.warmup_started_on ?? null),
    warmupStartedOn: state.warmup_started_on ?? null,
    optOuts: (optRes.data ?? []) as OptOut[],
  };
}

/** Снять авто-паузу номера (kill-switch reset). */
export async function resumeSender(projectId: string): Promise<void> {
  const { error } = await db()
    .from("broadcast_sender_state")
    .upsert({ project_id: projectId, paused: false, pause_reason: null, updated_at: new Date().toISOString() });
  if (error) throw error;
}

/** Убрать номер из отписавшихся (снова можно слать). */
export async function removeOptOut(projectId: string, phone: string): Promise<void> {
  const { error } = await db()
    .from("broadcast_opt_outs")
    .delete()
    .eq("project_id", projectId)
    .eq("phone", phone);
  if (error) throw error;
}

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
    clicked: c("clicked"),
    converted: c("converted"),
    failed: c("failed"),
    optout: c("skipped_optout"),
  };
}
