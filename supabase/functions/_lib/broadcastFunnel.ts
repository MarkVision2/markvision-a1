// Воронка рассылки для edge-функций (зеркало src/lib/broadcastFunnel.ts).
// Нужна, чтобы broadcast-group-sync / broadcast-worker писали полный stats
// (joined + webinar + sales), а не затирали CRM-поля сырыми status-счётчиками.

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
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  clicked: number;
  joined: number;
  groupJoined: number;
  webinarAttended: number;
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

export function phoneKey(phone: string): string {
  const d = digitsPhone(phone);
  if (!d) return "";
  return d.length >= 10 ? d.slice(-10) : d;
}

function countDelivery(recipients: BroadcastRecipientLite[]) {
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
    const isRead = READ.has(s) || !!r.readAt || !!r.clickedAt || !!r.joinedAt;
    const isReplied = REPLIED.has(s) || !!r.repliedAt;
    if (isSent) sent += 1;
    if (isDelivered) delivered += 1;
    if (isRead) read += 1;
    if (isReplied) replied += 1;
  }
  return { total: recipients.length, queued, sent, delivered, read, replied, failed, optout };
}

function isWebinarOk(lead: BroadcastLeadLite): boolean {
  const role = (lead.stageRole ?? "").toLowerCase();
  return (
    lead.webinarStatus === "attended" ||
    lead.webinarStatus === "late" ||
    WEBINAR_ROLES.has(role)
  );
}

function isDepositOk(lead: BroadcastLeadLite): boolean {
  const role = (lead.stageRole ?? "").toLowerCase();
  return DEPOSIT_ROLES.has(role) || Number(lead.depositAmount ?? 0) > 0;
}

function isPaidOk(lead: BroadcastLeadLite): boolean {
  const role = (lead.stageRole ?? "").toLowerCase();
  return lead.paid === true || PAID_ROLES.has(role);
}

export function matchRecipientLeads(
  recipients: BroadcastRecipientLite[],
  leads: BroadcastLeadLite[],
): Map<string, BroadcastLeadLite> {
  const byId = new Map(leads.map((l) => [l.id, l]));
  const byPhone = new Map<string, BroadcastLeadLite>();
  for (const l of leads) {
    const k = phoneKey(l.phone);
    if (k && !byPhone.has(k)) byPhone.set(k, l);
  }
  const out = new Map<string, BroadcastLeadLite>();
  for (const r of recipients) {
    if (r.leadId && byId.has(r.leadId)) {
      out.set(r.id, byId.get(r.leadId)!);
      continue;
    }
    const hit = byPhone.get(phoneKey(r.phone));
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
  const outcomeLeadIds = new Set<string>();
  const outcomePhones = new Set<string>();

  for (const r of recipients) {
    if (r.clickedAt || r.joinedAt) clicked += 1;
    if (r.joinedAt) {
      joined += 1;
      const lead = matched.get(r.id);
      if (r.leadId || lead) {
        joinedInCrm += 1;
        if (lead) outcomeLeadIds.add(lead.id);
        else if (r.leadId) outcomeLeadIds.add(r.leadId);
      }
      const pk = phoneKey(r.phone);
      if (pk) outcomePhones.add(pk);
      if (lead) {
        const lpk = phoneKey(lead.phone);
        if (lpk) outcomePhones.add(lpk);
      }
    }
  }

  if (joined === 0) {
    for (const lead of matched.values()) {
      outcomeLeadIds.add(lead.id);
      const pk = phoneKey(lead.phone);
      if (pk) outcomePhones.add(pk);
    }
  }

  const seenLeads = new Set<string>();
  let groupJoined = 0;
  for (const lead of matched.values()) {
    if (seenLeads.has(lead.id)) continue;
    seenLeads.add(lead.id);
    const role = (lead.stageRole ?? "").toLowerCase();
    if (GROUP_ROLES.has(role)) groupJoined += 1;
  }

  type Agg = { webinar: boolean; deposit: boolean; paid: boolean; revenue: number };
  const byPerson = new Map<string, Agg>();
  for (const lead of leads) {
    const pk = phoneKey(lead.phone);
    const inOutcome = outcomeLeadIds.has(lead.id) || (!!pk && outcomePhones.has(pk));
    if (!inOutcome) continue;
    const key = pk || `id:${lead.id}`;
    const cur = byPerson.get(key) ?? {
      webinar: false,
      deposit: false,
      paid: false,
      revenue: 0,
    };
    if (isWebinarOk(lead)) cur.webinar = true;
    if (isDepositOk(lead)) cur.deposit = true;
    if (isPaidOk(lead)) {
      cur.paid = true;
      cur.revenue = Math.max(cur.revenue, Number(lead.amount ?? 0));
    }
    byPerson.set(key, cur);
  }

  let webinarAttended = 0;
  let deposits = 0;
  let sales = 0;
  let revenue = 0;
  for (const a of byPerson.values()) {
    if (a.webinar) webinarAttended += 1;
    if (a.deposit) deposits += 1;
    if (a.paid) {
      sales += 1;
      revenue += a.revenue;
    }
  }

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

/** Stats jsonb: сырые status-счётчики (mapRow их кумулятивит) + CRM-поля из воронки. */
export function funnelToCampaignStats(
  recipients: { status: string; clickedAt: string | null; joinedAt: string | null }[],
  funnel: BroadcastFunnel,
  extra?: { sending?: number },
): Record<string, number> {
  const count = (s: string) => recipients.filter((r) => r.status === s).length;
  return {
    total: recipients.length,
    queued: count("queued"),
    sending: extra?.sending ?? count("sending"),
    sent: count("sent"),
    delivered: count("delivered"),
    read: count("read"),
    replied: count("replied"),
    converted: count("converted"),
    failed: count("failed"),
    optout: count("skipped_optout"),
    clicked: recipients.filter((r) => !!r.clickedAt || !!r.joinedAt).length,
    joined: funnel.joined,
    leads: funnel.leads,
    webinarAttended: funnel.webinarAttended,
    sales: funnel.sales,
    deposits: funnel.deposits,
    revenue: funnel.revenue,
  };
}
