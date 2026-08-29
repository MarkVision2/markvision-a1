// Серверное хранилище рассылок (Supabase) — заменяет localStorage-стор.
//
// Кампания живёт в broadcast_campaigns, получатели — в broadcast_recipients.
// Реальную отправку делает edge-функция broadcast-worker (по pg_cron), поэтому
// клиент только создаёт кампанию + получателей и «запускает» её (status=sending);
// прогресс подтягивается realtime-подпиской (stats обновляет воркер).
//
// Таблиц ещё нет в сгенерированных типах Supabase — используем принятый в
// проекте каст (supabase.from(<таблица> as any) as any), как в CapiSettings.
import { supabase } from "@/integrations/supabase/client";
import type { LeadContact } from "@/hooks/useLeadContacts";
import {
  PACE_GAPS,
  paceFromGaps,
  normalizeBroadcastLink,
  type Broadcast,
  type BroadcastDraft,
  type BroadcastStatus,
} from "@/lib/broadcastStore";
import {
  buildBroadcastFunnel,
  countDelivery,
  digitsPhone,
  type BroadcastFunnel,
  type BroadcastLeadLite,
  type BroadcastRecipientLite,
} from "@/lib/broadcastFunnel";

/** Один получатель для вставки в broadcast_recipients. */
export type RecipientRow = { name: string; phone: string; lead_id: string | null };

/**
 * Когда есть targetUrl, CTA уходит кнопкой — чистим текстовые хвосты
 * «Вступить в группу: {ссылка}», чтобы в WhatsApp не было голой ссылки.
 */
function scrubCtaTextPlaceholders(message: string, hasTargetUrl: boolean): string {
  let body = message ?? "";
  if (hasTargetUrl) {
    body = body
      .replace(/\n*[ \t]*Вступить в группу:[ \t]*\{ссылка\}[ \t]*/gi, "")
      .replace(/\n*[ \t]*Вступить в группу:[ \t]*\{link\}[ \t]*/gi, "");
  }
  return body.replace(/\n{3,}/g, "\n\n").trim();
}

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

function phoneIndex(contacts: LeadContact[]): Map<string, LeadContact> {
  const m = new Map<string, LeadContact>();
  for (const c of contacts) {
    const key = digitsPhone(c.phone);
    if (key && !m.has(key)) m.set(key, c);
  }
  return m;
}

/** CRM-фильтр / загрузка → строки получателей. lead_id (в т.ч. для загруженных —
 *  матч по телефону) нужен для трекинга конверсий; телефон канонизируется. */
export function resolveRecipientRows(draft: BroadcastDraft, crmContacts: LeadContact[]): RecipientRow[] {
  const byPhone = phoneIndex(crmContacts);
  const seen = new Set<string>();
  const out: RecipientRow[] = [];
  const push = (name: string, rawPhone: string, leadId: string | null) => {
    const phone = canonicalPhone(rawPhone);
    if (!phone || seen.has(phone)) return;
    seen.add(phone);
    out.push({ name, phone, lead_id: leadId });
  };

  if (draft.audienceSource === "upload") {
    for (const c of draft.uploadedContacts) {
      const hit = byPhone.get(digitsPhone(c.phone));
      // Имя из списка; если пусто — подтягиваем из CRM по телефону
      const name = (c.name || "").trim() || (hit?.name || "").trim();
      push(name, c.phone, hit?.id ?? null);
    }
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
  group_id: string | null;
  parent_campaign_id: string | null;
  cta_label: string | null;
  min_gap_seconds: number | null;
  max_gap_seconds: number | null;
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
    joined: s.joined ?? 0,
    webinarAttended: s.webinar_attended ?? s.webinarAttended ?? 0,
    sales: s.sales ?? s.converted ?? 0,
  };
  const sent =
    raw.sent + raw.delivered + raw.read + raw.replied + raw.converted + raw.clicked;
  const delivered = raw.delivered + raw.read + raw.replied + raw.converted + raw.clicked;
  const read = raw.read + raw.replied + raw.converted + raw.clicked;
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
    targetUrl: r.target_url ?? "",
    groupId: r.group_id ?? "",
    parentCampaignId: r.parent_campaign_id ?? "",
    ctaLabel: r.cta_label ?? "",
    messageVariants: Array.isArray(r.message_variants) ? r.message_variants : [],
    sendPace: paceFromGaps(r.min_gap_seconds ?? 50, r.max_gap_seconds ?? 70),
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
      joined: Number(raw.joined) || 0,
      webinarAttended: Number(raw.webinarAttended) || 0,
      sales: Number(raw.sales) || 0,
    },
    results: [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    sentAt: r.finished_at ?? (r as CampaignRow & { started_at?: string | null }).started_at ?? null,
  };
}

/**
 * Живая воронка для списка: доставка + группа + вебинар + оплата из CRM.
 * Тот же buildBroadcastFunnel, что на странице отчёта — цифры совпадают.
 */
async function enrichListCrmStats(list: Broadcast[], projectId: string): Promise<Broadcast[]> {
  const active = list.filter((b) =>
    ["sending", "sent", "partial", "failed"].includes(b.status),
  );
  if (active.length === 0) return list;

  const ids = active.map((b) => b.id);
  const { data: recData, error: recErr } = await db()
    .from("broadcast_recipients")
    .select(
      "id, campaign_id, name, phone, status, lead_id, sent_at, delivered_at, read_at, replied_at, clicked_at, converted_at, joined_at, error",
    )
    .in("campaign_id", ids)
    .limit(100000);
  if (recErr || !recData?.length) return list;

  type RecRow = {
    id: string;
    campaign_id: string;
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
    joined_at: string | null;
    error: string | null;
  };

  const byCamp = new Map<string, BroadcastRecipientLite[]>();
  const leadIds = new Set<string>();
  const phones = new Set<string>();

  for (const row of recData as RecRow[]) {
    const lite: BroadcastRecipientLite = {
      id: row.id,
      name: row.name ?? "",
      phone: row.phone,
      status: row.status,
      leadId: row.lead_id,
      sentAt: row.sent_at,
      deliveredAt: row.delivered_at,
      readAt: row.read_at,
      repliedAt: row.replied_at,
      clickedAt: row.clicked_at,
      convertedAt: row.converted_at,
      joinedAt: row.joined_at,
      error: row.error,
    };
    const arr = byCamp.get(row.campaign_id) ?? [];
    arr.push(lite);
    byCamp.set(row.campaign_id, arr);
    if (row.lead_id) leadIds.add(row.lead_id);
    const d = digitsPhone(row.phone);
    if (d) phones.add(d);
  }

  const [{ data: stagesData }, leadsByIdRes, leadsByPhoneRes] = await Promise.all([
    db().from("pipeline_stages").select("id, key, stage_role"),
    leadIds.size
      ? db()
          .from("leads")
          .select("id, name, phone, stage_id, paid, amount, deposit_amount, webinar_status")
          .in("id", [...leadIds])
          .limit(10000)
      : Promise.resolve({ data: [] }),
    phones.size
      ? db()
          .from("leads")
          .select("id, name, phone, stage_id, paid, amount, deposit_amount, webinar_status")
          .eq("project_id", projectId)
          .eq("is_personal", false)
          .limit(8000)
      : Promise.resolve({ data: [] }),
  ]);

  const stageById = new Map<string, { key: string | null; role: string | null }>();
  for (const s of (stagesData ?? []) as Array<{ id: string; key?: string; stage_role?: string }>) {
    stageById.set(s.id, { key: s.key ?? null, role: s.stage_role ?? null });
  }

  const phoneSet = phones;
  const leadIdSet = leadIds;
  const leadMap = new Map<string, BroadcastLeadLite>();
  const ingest = (rows: Array<Record<string, unknown>>) => {
    for (const r of rows) {
      const id = String(r.id);
      if (leadMap.has(id)) continue;
      const phone = String(r.phone ?? "");
      const linkedById = leadIdSet.has(id);
      const linkedByPhone = phoneSet.has(digitsPhone(phone));
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
  const allLeads = [...leadMap.values()];

  const funnelById = new Map<string, BroadcastFunnel>();
  for (const [campId, recipients] of byCamp) {
    funnelById.set(campId, buildBroadcastFunnel(recipients, allLeads));
  }

  return list.map((b) => {
    const funnel = funnelById.get(b.id);
    if (!funnel) return b;
    return {
      ...b,
      recipientsCount: funnel.total || b.recipientsCount,
      stats: {
        ...b.stats,
        total: funnel.total,
        sent: funnel.sent,
        delivered: funnel.delivered,
        read: funnel.read,
        replied: funnel.replied,
        failed: funnel.failed,
        clicked: funnel.clicked,
        converted: funnel.sales,
        joined: funnel.joined,
        webinarAttended: funnel.webinarAttended,
        sales: funnel.sales,
      },
    };
  });
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
  const list = ((data ?? []) as CampaignRow[]).map(mapRow);
  return enrichListCrmStats(list, projectId);
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

/** Опции создания: явные получатели (догоняющая) + связь цепочки. */
export type CreateCampaignOpts = { explicitRows?: RecipientRow[]; parentCampaignId?: string };

export async function createCampaign(
  projectId: string,
  draft: BroadcastDraft,
  crmContacts: LeadContact[],
  opts?: CreateCampaignOpts,
): Promise<Broadcast> {
  const scheduledAt = scheduledIso(draft);
  // Для догоняющей получатели уже готовы (не отреагировавшие), иначе — из CRM/загрузки.
  const rows = opts?.explicitRows ?? resolveRecipientRows(draft, crmContacts);
  const gaps = PACE_GAPS[draft.sendPace] ?? PACE_GAPS.slow;
  const status = draft.schedule.mode === "scheduled" ? "scheduled" : "draft";
  const stats = { total: rows.length, queued: rows.length, sent: 0, delivered: 0, read: 0, replied: 0, converted: 0, failed: 0, optout: 0, clicked: 0 };
  const link = normalizeBroadcastLink(draft.message, draft.targetUrl);
  const message = scrubCtaTextPlaceholders(link.message, !!link.targetUrl);

  const { data, error } = await db()
    .from("broadcast_campaigns")
    .insert({
      project_id: projectId,
      name: draft.name,
      channel: draft.channel,
      audience_source: draft.audienceSource,
      crm_filter: draft.crmFilter,
      title: draft.title,
      message,
      message_variants: draft.messageVariants ?? [],
      target_url: link.targetUrl || null,
      group_id: draft.groupId || null,
      parent_campaign_id: opts?.parentCampaignId || null,
      cta_label: (draft.ctaLabel || "").trim() || null,
      min_gap_seconds: gaps.min,
      max_gap_seconds: gaps.max,
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

/** Разбивка исключённых из догоняющей (для прозрачности в UI). */
export type FollowUpExcluded = {
  joined: number;    // вступили в группу — им дожим НЕ шлём
  clicked: number;   // перешли по ссылке
  replied: number;   // ответили
  failed: number;    // ошибка / нет WhatsApp
  optout: number;    // отписались
  notReached: number; // не дошло / ещё в очереди
};
export type NonResponders = { rows: RecipientRow[]; total: number; excluded: FollowUpExcluded };

/**
 * Получатели исходной кампании, которые НЕ отреагировали — для догоняющей волны.
 * «Не отреагировал» = сообщение дошло (sent/delivered/read), но человек не
 * кликнул, не вступил в группу и не ответил. Исключаем: вступивших в группу,
 * кликнувших, ответивших, ошибки (нет WhatsApp), отписавшихся и ещё не
 * отправленных. Дедуп по номеру. Возвращает разбивку исключённых для UI.
 */
export async function fetchNonResponders(
  sourceCampaignId: string,
  projectId: string,
): Promise<NonResponders> {
  const [recRes, optRes] = await Promise.all([
    db()
      .from("broadcast_recipients")
      .select("name, phone, lead_id, status, clicked_at, joined_at, replied_at")
      .eq("campaign_id", sourceCampaignId)
      .limit(20000),
    db().from("broadcast_opt_outs").select("phone").eq("project_id", projectId).limit(5000),
  ]);
  const optOut = new Set(
    ((optRes.data ?? []) as { phone: string }[]).map((o) => digitsPhone(o.phone)),
  );
  const reached = new Set(["sent", "delivered", "read"]);
  const rows: RecipientRow[] = [];
  const seen = new Set<string>();
  const excluded: FollowUpExcluded = { joined: 0, clicked: 0, replied: 0, failed: 0, optout: 0, notReached: 0 };
  for (const r of (recRes.data ?? []) as Array<{
    name: string | null;
    phone: string;
    lead_id: string | null;
    status: string;
    clicked_at: string | null;
    joined_at: string | null;
    replied_at: string | null;
  }>) {
    // Считаем причины исключения (приоритет: вступил > кликнул > ответил).
    if (r.joined_at) { excluded.joined += 1; continue; }
    if (r.clicked_at || r.status === "clicked") { excluded.clicked += 1; continue; }
    if (r.replied_at || r.status === "replied" || r.status === "converted") { excluded.replied += 1; continue; }
    if (r.status === "failed") { excluded.failed += 1; continue; }
    if (r.status === "skipped_optout") { excluded.optout += 1; continue; }
    if (!reached.has(r.status)) { excluded.notReached += 1; continue; } // queued / sending
    const phone = canonicalPhone(r.phone);
    if (!phone) { excluded.notReached += 1; continue; }
    const key = digitsPhone(phone);
    if (!key) { excluded.notReached += 1; continue; }
    if (optOut.has(key)) { excluded.optout += 1; continue; }
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ name: r.name ?? "", phone, lead_id: r.lead_id ?? null });
  }
  return { rows, total: rows.length, excluded };
}

/**
 * Контакты кампании для префилла диалога (дублирование / правка списка).
 * Берём из broadcast_recipients — uploadedContacts в кампании не хранятся.
 */
export async function fetchRecipientContacts(
  campaignId: string,
  limit = 50000,
): Promise<{ name: string; phone: string }[]> {
  const { data, error } = await db()
    .from("broadcast_recipients")
    .select("name, phone")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return ((data ?? []) as { name: string | null; phone: string }[]).map((r) => ({
    name: (r.name ?? "").trim(),
    phone: r.phone,
  }));
}

/**
 * Дублирует кампанию как новый черновик с актуальным списком из draft
 * (можно добавить/убрать контакты). История статусов исходной не трогается.
 */
export async function duplicateCampaign(
  projectId: string,
  draft: BroadcastDraft,
  crmContacts: LeadContact[],
): Promise<Broadcast> {
  const name = draft.name.trim() || "Копия рассылки";
  return createCampaign(
    projectId,
    {
      ...draft,
      name,
      schedule: { mode: "now", at: null },
      recipientsCount: draft.recipientsCount,
    },
    crmContacts,
  );
}

export async function updateCampaign(
  projectId: string,
  id: string,
  draft: BroadcastDraft,
  crmContacts: LeadContact[],
): Promise<void> {
  const scheduledAt = scheduledIso(draft);
  const rows = resolveRecipientRows(draft, crmContacts);
  const gaps = PACE_GAPS[draft.sendPace] ?? PACE_GAPS.slow;

  // Пересобираем получателей только пока кампания не ушла в отправку.
  const { data: current } = await db()
    .from("broadcast_campaigns")
    .select("status")
    .eq("id", id)
    .maybeSingle();
  const editable = ["draft", "scheduled"].includes((current as { status?: string } | null)?.status ?? "draft");
  const link = normalizeBroadcastLink(draft.message, draft.targetUrl);

  const patch: Record<string, unknown> = {
    name: draft.name,
    channel: draft.channel,
    audience_source: draft.audienceSource,
    crm_filter: draft.crmFilter,
    title: draft.title,
    message: scrubCtaTextPlaceholders(link.message, !!link.targetUrl),
    message_variants: draft.messageVariants ?? [],
    target_url: link.targetUrl || null,
    group_id: draft.groupId || null,
    cta_label: (draft.ctaLabel || "").trim() || null,
    min_gap_seconds: gaps.min,
    max_gap_seconds: gaps.max,
    schedule_mode: draft.schedule.mode,
    scheduled_at: scheduledAt,
  };
  if (editable) {
    patch.status = draft.schedule.mode === "scheduled" ? "scheduled" : "draft";
    patch.stats = { total: rows.length, queued: rows.length, sent: 0, delivered: 0, read: 0, replied: 0, converted: 0, failed: 0, optout: 0, clicked: 0 };
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

/** Запуск немедленной отправки: ставим sending и сразу дергаем broadcast-worker.
 *  Крон остаётся бэкапом; без kick очередь могла часami висеть при 429 Green API. */
export async function launchCampaign(id: string): Promise<void> {
  const { error } = await db()
    .from("broadcast_campaigns")
    .update({ status: "sending", started_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;

  // Fire-and-forget: ошибка invoke не откатывает запуск — крон догонит.
  void supabase.functions.invoke("broadcast-worker", { body: { source: "launch", campaign_id: id } }).then(
    ({ error: invokeErr }) => {
      if (invokeErr) console.warn("broadcast-worker kick failed:", invokeErr.message);
    },
  );
}

/** Живые счётчики получателей кампании (для прогресса запуска). */
export type RecipientCounts = {
  total: number; queued: number; sent: number; delivered: number;
  read: number; replied: number; clicked: number; converted: number;
  failed: number; optout: number;
};

// ─── Панель безопасности (лимиты / пауза / opt-out) ──────────────────────────
// Формула ОДНА с сервером (_lib/broadcast_limits.ts) — панель показывает ровно
// то число, что реально шлёт воркер.
const WARMUP_DAY1 = 20;
const WARMUP_GROWTH = 1.3;
const WARMUP_CEILING = 120;

function warmupRamp(warmupStartedOn: string | null): number {
  const days = warmupStartedOn
    ? Math.max(0, Math.floor((Date.now() - new Date(warmupStartedOn + "T00:00:00Z").getTime()) / 86400000))
    : 0;
  return Math.min(WARMUP_CEILING, Math.max(WARMUP_DAY1, Math.round(WARMUP_DAY1 * Math.pow(WARMUP_GROWTH, days))));
}

/** Эффективный дневной потолок с учётом лимита кампании и прогрева. */
export function effectiveDailyCap(
  dailyLimit: number,
  warmupEnabled: boolean,
  warmupStartedOn: string | null,
): number {
  const limit = Math.max(0, Math.floor(dailyLimit || 0));
  if (!warmupEnabled) return limit;
  return Math.min(limit, warmupRamp(warmupStartedOn));
}

/** Совместимость: прогревочный потолок номера без лимита кампании. */
export function warmupDailyCap(warmupStartedOn: string | null): number {
  return warmupRamp(warmupStartedOn);
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
  const [stateRes, dailyRes, optRes, campRes] = await Promise.all([
    db().from("broadcast_sender_state").select("paused, pause_reason, warmup_started_on").eq("project_id", projectId).maybeSingle(),
    db().from("broadcast_sender_daily").select("sent").eq("project_id", projectId).eq("day", today).maybeSingle(),
    db().from("broadcast_opt_outs").select("phone, reason, created_at").eq("project_id", projectId).order("created_at", { ascending: false }).limit(500),
    db().from("broadcast_campaigns").select("daily_limit, warmup_enabled, status, updated_at").eq("project_id", projectId).order("updated_at", { ascending: false }).limit(50),
  ]);
  const state = (stateRes.data ?? {}) as { paused?: boolean; pause_reason?: string | null; warmup_started_on?: string | null };
  const camps = (campRes.data ?? []) as { daily_limit?: number; warmup_enabled?: boolean; status?: string }[];
  const gov = camps.find((c) => c.status === "sending" || c.status === "scheduled") ?? camps[0];
  const dailyCap = effectiveDailyCap(
    gov?.daily_limit ?? WARMUP_CEILING,
    gov?.warmup_enabled ?? true,
    state.warmup_started_on ?? null,
  );
  return {
    paused: !!state.paused,
    pauseReason: state.pause_reason ?? null,
    sentToday: ((dailyRes.data as { sent?: number } | null)?.sent) ?? 0,
    dailyCap,
    warmupStartedOn: state.warmup_started_on ?? null,
    optOuts: (optRes.data ?? []) as OptOut[],
  };
}

export type BroadcastHealth = {
  connected: boolean;
  accountState: string;
  phone: string | null;
  riskLevel: "ok" | "warning" | "danger";
  riskReason: string;
  warmupDay: number;
  dailyCap: number;
  sentToday: number;
  remainingToday: number;
  failRatePct: number;
  deliveredRatePct: number;
  recommendations: string[];
  checkedAt: string;
};

/** «Ban-aware» здоровье рассылок: статус аккаунта Green + риск блокировки. */
export async function fetchHealth(projectId: string): Promise<BroadcastHealth | null> {
  const { data, error } = await supabase.functions.invoke("broadcast-health", {
    body: { project_id: projectId },
  });
  if (error) return null;
  return data as BroadcastHealth;
}

export type WaGroup = { id: string; name: string };

async function edgeErrorMessage(error: { message?: string }, data: unknown): Promise<string> {
  const fromBody = (data as { error?: string } | null)?.error;
  if (fromBody) return fromBody;
  const ctx = (error as { context?: Response })?.context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const body = await ctx.json() as { error?: string };
      if (body?.error) return body.error;
    } catch { /* ignore */ }
  }
  return error.message || "Ошибка edge-функции";
}

/** Список WhatsApp-групп, где состоит номер (для выбора цели рассылки). */
export async function fetchGroups(projectId: string): Promise<WaGroup[]> {
  const { data, error } = await supabase.functions.invoke("broadcast-groups", {
    body: { project_id: projectId, action: "list" },
  });
  if (error) throw new Error(await edgeErrorMessage(error, data));
  return (data as { groups?: WaGroup[] } | null)?.groups ?? [];
}

/** Пригласительная ссылка группы (для {ссылка} в тексте). */
export async function fetchGroupInvite(projectId: string, groupId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke("broadcast-groups", {
    body: { project_id: projectId, action: "invite", groupId },
  });
  if (error) throw new Error(await edgeErrorMessage(error, data));
  const invite = (data as { inviteLink?: string } | null)?.inviteLink ?? "";
  if (!invite) throw new Error("Ссылка приглашения не пришла — проверьте права админа в группе");
  return invite;
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

export type RecipientDetail = {
  id: string;
  name: string;
  phone: string;
  status: string;
  sent_at: string | null;
  read_at: string | null;
  replied_at: string | null;
  clicked_at: string | null;
  converted_at: string | null;
  error: string | null;
};

/** Список получателей кампании со статусами (для панели детализации). */
export async function fetchRecipients(campaignId: string, limit = 2000): Promise<RecipientDetail[]> {
  const { data } = await db()
    .from("broadcast_recipients")
    .select("id, name, phone, status, sent_at, read_at, replied_at, clicked_at, converted_at, error")
    .eq("campaign_id", campaignId)
    .order("updated_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as RecipientDetail[];
}

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
    joinedAt: null,
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
    clicked: recipients.filter((r) => r.status === "clicked").length,
    converted: recipients.filter((r) => r.status === "converted").length,
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
  joined_at: string | null;
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
    joinedAt: r.joined_at,
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
      "id, name, phone, status, lead_id, sent_at, delivered_at, read_at, replied_at, clicked_at, converted_at, joined_at, error",
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
          .select("id, name, phone, stage_id, paid, amount, deposit_amount, webinar_status")
          .in("id", leadIds)
          .limit(5000)
      : Promise.resolve({ data: [] }),
    phones.length
      ? db()
          .from("leads")
          .select("id, name, phone, stage_id, paid, amount, deposit_amount, webinar_status")
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
    joined: funnel.joined,
    webinarAttended: funnel.webinarAttended,
    sales: funnel.sales,
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
