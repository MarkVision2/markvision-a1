export type LeadStage = {
  id: string;
  title: string;
  color: string; // tailwind text/bg class hue (e.g. "primary", "warning")
  icon: "zap" | "bell" | "message" | "card" | "calendar" | "map" | "check" | "ban";
};

export type LeadStatus = "new" | "no_answer" | "in_progress" | "invoice" | "scheduled" | "visit" | "paid" | "rejected" | string;

export type UtmTags = {
  source?: string;   // utm_source
  medium?: string;   // utm_medium
  campaign?: string; // utm_campaign
  content?: string;  // utm_content
  term?: string;     // utm_term
};

export type StageHistoryEntry = {
  stageId: string;
  at: string;
};

export type RejectReason =
  | "expensive"
  | "no_contact"
  | "changed_mind"
  | "competitor"
  | "other";

export const REJECT_REASONS: { id: RejectReason; label: string; emoji: string }[] = [
  { id: "expensive", label: "Дорого", emoji: "💸" },
  { id: "no_contact", label: "Не дозвонились", emoji: "📵" },
  { id: "changed_mind", label: "Передумал", emoji: "🤔" },
  { id: "competitor", label: "Ушёл к конкуренту", emoji: "🏃" },
  { id: "other", label: "Другое", emoji: "❓" },
];

export type LeadChannel = "whatsapp" | "telegram" | "instagram" | "phone" | "web";

export type PaymentMethod = "cash" | "card" | "kaspi" | "transfer";

export type LeadTask = {
  id: string;
  title: string;
  dueAt: string; // ISO
  doneAt?: string;
};

export type LeadEventType =
  | "created"
  | "stage_changed"
  | "message_sent"
  | "call_made"
  | "task_created"
  | "task_done"
  | "amount_changed"
  | "visit_scheduled"
  | "paid"
  | "rejected"
  | "automation_followup_2h"
  | "automation_24h_sent"
  | "automation_revival_7d"
  | "call_attempt";

export type LeadEvent = {
  id: string;
  type: LeadEventType;
  at: string;
  payload?: Record<string, string | number | boolean>;
};

export type Lead = {
  id: string;
  name: string;
  phone: string;
  email?: string;
  source: string;
  stageId: string;
  amount: number; // $
  aiScore: number; // 0-100
  note?: string;
  utm?: UtmTags;
  referrer?: string;
  landingUrl?: string;
  firstTouchAt?: string;
  stageHistory?: StageHistoryEntry[];
  createdAt: string;
  lastActivityAt: string;
  // Growth-CRM extensions
  assigneeId?: string;       // team member id
  rejectReason?: RejectReason;
  rejectedAt?: string;
  pinned?: boolean;
  firstResponseAt?: string;  // when manager first replied
  channel?: LeadChannel;
  cabinetId?: string | null;
  // Meta attribution — set by trigger from utm_content / utm_campaign
  metaAdId?: string | null;
  metaAdsetId?: string | null;
  metaCampaignId?: string | null;
  // Card extensions (rich lead workspace)
  service?: string;
  city?: string;
  age?: number;
  nextVisitAt?: string;
  paid?: boolean;
  paymentMethod?: PaymentMethod;
  paidAt?: string;
  /** Цена диагностики, фиксируется при переходе в этап «Запись на диагностику». 0 = бесплатно. */
  diagnosticAmount?: number;
  tasks?: LeadTask[];
  events?: LeadEvent[];
  /**
   * Отметка «личное» — заявку на самом деле прислал не клиент, а кто-то из
   * личных контактов владельца WhatsApp. Такие лиды полностью скрыты из CRM:
   * не отображаются ни в воронке, ни в чатах, ни в базе, ни в аналитике.
   */
  isPersonal?: boolean;
};

export type ChatMessage = {
  id: string;
  leadId: string;
  fromMe: boolean;
  text: string;
  at: string;
  /** "message" (default) or "call" — calls are rendered as call entries in the timeline */
  kind?: "message" | "call";
  /** Channel the message was sent through */
  channel?: "whatsapp" | "telegram" | "instagram" | "phone" | "sms";
  /** Delivery status for messages */
  status?: "sent" | "delivered" | "read" | "failed";
  /** Outcome for kind="call" */
  callStatus?: "answered" | "missed" | "outgoing" | "incoming";
  /** Call duration in seconds, for kind="call" */
  callDurationSec?: number;
  /** Key of the template used to compose the message, if any */
  templateKey?: string;
};

export type WhatsAppConfig = {
  connected: boolean;
  phone?: string;
  displayName?: string;
  connectedAt?: string;
};