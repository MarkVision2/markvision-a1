// Воронка рассылки: доставка WhatsApp + конверсии из CRM по связанным лидам.
// Счётчики доставки — кумулятивные (read входит в delivered и sent), как в UI-воронках.

export type BroadcastDeliveryStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "read"
  | "replied"
  | "converted"
  | "failed"
  | "skipped_optout";

export type BroadcastRecipientLite = {
  id: string;
  name: string;
  phone: string;
  status: string;
  leadId: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  repliedAt: string | null;
  clickedAt: string | null;
  convertedAt: string | null;
  /** Реально появился в составе WhatsApp-группы (детект по getGroupData). */
  joinedAt: string | null;
  error: string | null;
};

export type BroadcastLeadLite = {
  id: string;
  name: string;
  phone: string;
  stageKey: string | null;
  stageRole: string | null;
  paid: boolean;
  amount: number;
  depositAmount: number;
  webinarStatus: string | null;
};

export type BroadcastFunnel = {
  total: number;
  queued: number;
  /** Ушло из очереди успешно (sent|delivered|read|replied|converted). */
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  clicked: number;
  /** Реально вступили в WhatsApp-группу (детект по составу группы). */
  joined: number;
  /** Вступили в WhatsApp / группу (по stage_role связанного лида) — CRM-прокси. */
  groupJoined: number;
  /** Пришли на вебинар (webinar_status или stage_role). */
  webinarAttended: number;
  /** Связанные лиды в CRM. */
  leads: number;
  deposits: number;
  sales: number;
  revenue: number;
  failed: number;
  optout: number;
};

const OUTBOX = new Set(["sent", "delivered", "read", "clicked", "replied", "converted"]);
const DELIVERED = new Set(["delivered", "read", "clicked", "replied", "converted"]);
const READ = new Set(["read", "clicked", "replied", "converted"]);
const REPLIED = new Set(["replied", "converted"]);

const GROUP_ROLES = new Set([
  "whatsapp",
  "bot_activated",
  "warming",
  "joined_group",
  "confirmed",
  "attended",
  "interest",
  "call_scheduled",
  "call_done",
  "offer",
  "deposit",
  "paid",
  "student",
  "graduate",
]);

const WEBINAR_ROLES = new Set([
  "attended",
  "interest",
  "call_scheduled",
  "call_done",
  "offer",
  "deposit",
  "paid",
  "student",
  "graduate",
]);

const PAID_ROLES = new Set(["paid", "student", "graduate"]);
const DEPOSIT_ROLES = new Set(["deposit", "paid", "student", "graduate"]);

export function digitsPhone(phone: string): string {
  return (phone ?? "").replace(/\D/g, "");
}

/**
 * Кумулятивные счётчики доставки.
 * Статус Green API + таймстампы (read_at / delivered_at / …): вебхук иногда
 * опаздывает, а join-sync дописывает факт прочтения/клика по вступлению.
 */
export function countDelivery(recipients: BroadcastRecipientLite[]): Omit<
  BroadcastFunnel,
  "clicked" | "joined" | "groupJoined" | "webinarAttended" | "leads" | "deposits" | "sales" | "revenue"
> {
  let queued = 0;
  let sent = 0;
  let delivered = 0;
  let read = 0;
  let replied = 0;
  let failed = 0;
  let optout = 0;
  for (const r of recipients) {
    const s = r.status;
    if (s === "queued") queued += 1;
    if (s === "failed") failed += 1;
    if (s === "skipped_optout") optout += 1;

    const isSent =
      OUTBOX.has(s) || !!r.sentAt || !!r.deliveredAt || !!r.readAt || !!r.clickedAt || !!r.joinedAt;
    const isDelivered =
      DELIVERED.has(s) || !!r.deliveredAt || !!r.readAt || !!r.clickedAt || !!r.joinedAt;
    // «Открыли» = WhatsApp read receipt (две синие галочки) ИЛИ факт клика/вступления.
    const isRead = READ.has(s) || !!r.readAt || !!r.clickedAt || !!r.joinedAt;
    const isReplied = REPLIED.has(s) || !!r.repliedAt;

    if (isSent) sent += 1;
    if (isDelivered) delivered += 1;
    if (isRead) read += 1;
    if (isReplied) replied += 1;
  }
  return { total: recipients.length, queued, sent, delivered, read, replied, failed, optout };
}

/**
 * Сопоставляет получателей с CRM-лидами: сначала lead_id, иначе телефон.
 * Возвращает Map recipientId → lead.
 */
export function matchRecipientLeads(
  recipients: BroadcastRecipientLite[],
  leads: BroadcastLeadLite[],
): Map<string, BroadcastLeadLite> {
  const byId = new Map(leads.map((l) => [l.id, l]));
  const byPhone = new Map<string, BroadcastLeadLite>();
  for (const l of leads) {
    const d = digitsPhone(l.phone);
    if (d && !byPhone.has(d)) byPhone.set(d, l);
  }
  const out = new Map<string, BroadcastLeadLite>();
  for (const r of recipients) {
    if (r.leadId && byId.has(r.leadId)) {
      out.set(r.id, byId.get(r.leadId)!);
      continue;
    }
    const d = digitsPhone(r.phone);
    const hit = d ? byPhone.get(d) : undefined;
    if (hit) out.set(r.id, hit);
  }
  return out;
}

export function buildBroadcastFunnel(
  recipients: BroadcastRecipientLite[],
  leads: BroadcastLeadLite[],
): BroadcastFunnel {
  const delivery = countDelivery(recipients);
  const matched = matchRecipientLeads(recipients, leads);

  let clicked = 0;
  let joined = 0;
  let joinedInCrm = 0;
  for (const r of recipients) {
    if (r.clickedAt || r.joinedAt) clicked += 1;
    if (r.joinedAt) {
      joined += 1;
      if (r.leadId || matched.has(r.id)) joinedInCrm += 1;
    }
  }

  const seenLeads = new Set<string>();
  let groupJoined = 0;
  let webinarAttended = 0;
  let deposits = 0;
  let sales = 0;
  let revenue = 0;

  for (const lead of matched.values()) {
    if (seenLeads.has(lead.id)) continue;
    seenLeads.add(lead.id);

    const role = (lead.stageRole ?? "").toLowerCase();
    if (GROUP_ROLES.has(role)) groupJoined += 1;

    const webinarOk =
      lead.webinarStatus === "attended" ||
      lead.webinarStatus === "late" ||
      WEBINAR_ROLES.has(role);
    if (webinarOk) webinarAttended += 1;

    if (DEPOSIT_ROLES.has(role) || lead.depositAmount > 0) deposits += 1;

    const paid = lead.paid || PAID_ROLES.has(role);
    if (paid) {
      sales += 1;
      revenue += Number(lead.amount ?? 0);
    }
  }

  // «Лиды / В CRM» в KPI: при наличии вступлений — сколько из них с карточкой CRM;
  // иначе — все совпадения по телефону / lead_id (база из CRM).
  const leadsCount = joined > 0 ? joinedInCrm : seenLeads.size;

  return {
    ...delivery,
    clicked,
    joined,
    groupJoined,
    webinarAttended,
    leads: leadsCount,
    deposits,
    sales,
    revenue,
  };
}

export function funnelStepRate(from: number, to: number): number | null {
  if (from <= 0) return null;
  return Math.round((to / from) * 1000) / 10;
}
