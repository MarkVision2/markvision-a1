// Хранилище кампаний рассылок (по базе CRM или загруженному списку),
// каналы WhatsApp / SMS, разовые и запланированные. localStorage по проектам,
// подписка через useSyncExternalStore (см. hooks/useBroadcasts.ts).
//
// Отправка WhatsApp — реальная, через edge function greenapi-proxy
// (см. lib/broadcastSender.ts). SMS требует подключения провайдера.

import { normalizePhone } from "./telephony";

const PREFIX = "mv:broadcasts:";

export type BroadcastChannel = "whatsapp" | "sms";
export type AudienceSource = "crm" | "upload";
export type BroadcastStatus =
  | "draft"
  | "scheduled"
  | "sending"
  | "sent"
  | "partial"
  | "failed"
  | "canceled";

export type BroadcastContact = { name: string; phone: string };

export type CrmFilter = {
  /** Этапы воронки (ключи). Пусто = все этапы. */
  stageKeys: string[];
  /** Источники лида. Пусто = все источники. */
  sources: string[];
};

export type BroadcastResult = {
  phone: string;
  name: string;
  status: "sent" | "failed";
  error?: string;
  at: string;
};

export type Broadcast = {
  id: string;
  name: string;
  channel: BroadcastChannel;
  audienceSource: AudienceSource;
  /** Снимок фильтра CRM (для audienceSource === "crm"). */
  crmFilter: CrmFilter;
  /** Загруженные контакты (для audienceSource === "upload"). */
  uploadedContacts: BroadcastContact[];
  /** Необязательный заголовок — добавляется жирной строкой перед текстом. */
  title: string;
  /** Текст сообщения. Поддерживает переменные {имя} и {ссылка}. */
  message: string;
  /** Целевая ссылка для переменной {ссылка} (трекинг переходов). */
  targetUrl: string;
  schedule: { mode: "now" | "scheduled"; at: string | null };
  status: BroadcastStatus;
  /** Кол-во получателей на момент последней оценки/отправки. */
  recipientsCount: number;
  stats: { total: number; sent: number; failed: number };
  results: BroadcastResult[];
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
};

export const CHANNEL_META: Record<BroadcastChannel, { label: string; available: boolean; note: string }> = {
  whatsapp: { label: "WhatsApp", available: true, note: "Отправка через подключённый WhatsApp Business" },
  sms: { label: "SMS", available: false, note: "Требуется подключить SMS-провайдера" },
};

export const STATUS_META: Record<BroadcastStatus, { label: string; tone: "success" | "warning" | "muted" | "destructive" | "primary" }> = {
  draft: { label: "Черновик", tone: "muted" },
  scheduled: { label: "Запланирована", tone: "primary" },
  sending: { label: "Отправляется", tone: "warning" },
  sent: { label: "Отправлена", tone: "success" },
  partial: { label: "Частично", tone: "warning" },
  failed: { label: "Ошибка", tone: "destructive" },
  canceled: { label: "Отменена", tone: "muted" },
};

// ─── Утилиты ─────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function newId(): string {
  try {
    return (crypto as Crypto).randomUUID();
  } catch {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}

const nowIso = () => new Date().toISOString();

/** Подставляет имя получателя вместо {имя}/{name}, ссылку вместо {ссылка} и
 *  склеивает заголовок с текстом. `link` — для превью (реальный трекинг-URL
 *  на получателя подставляет воркер при отправке). */
export function renderMessage(
  title: string,
  message: string,
  contact: { name?: string },
  link = "",
): string {
  const firstName = (contact.name ?? "").trim().split(/\s+/)[0] ?? "";
  let body = (message ?? "")
    .replace(/\{имя\}/gi, firstName)
    .replace(/\{name\}/gi, firstName);
  if (link) body = body.replace(/\{ссылка\}/gi, link).replace(/\{link\}/gi, link);
  const head = (title ?? "").trim();
  return head ? `*${head}*\n\n${body}` : body;
}

/**
 * Парсит вставленный список контактов. Каждая строка: «Имя, +7…» / «+7…; Имя»
 * / «Имя<TAB>номер» и т.п. Телефон определяется по цифрам, остальное — имя.
 * Дедуп по нормализованному номеру.
 */
export function parseContacts(raw: string): BroadcastContact[] {
  const seen = new Set<string>();
  const out: BroadcastContact[] = [];
  for (const line of (raw ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/[,;\t]/).map((p) => p.trim()).filter(Boolean);
    // Находим часть, похожую на телефон (>= 8 цифр)
    let phonePart = "";
    let namePart = "";
    for (const p of parts) {
      const digits = p.replace(/\D/g, "");
      if (!phonePart && digits.length >= 8 && digits.length <= 15) phonePart = p;
      else if (!namePart) namePart = p;
    }
    if (!phonePart) {
      // вся строка может быть просто номером
      const digits = trimmed.replace(/\D/g, "");
      if (digits.length >= 8 && digits.length <= 15) phonePart = trimmed;
      else continue;
    }
    const phone = normalizePhone(phonePart);
    const key = phone.replace(/\D/g, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ name: namePart || "", phone });
  }
  return out;
}

// ─── In-memory store ─────────────────────────────────────────────────────────

const memCache = new Map<string, Broadcast[]>();
const listeners = new Set<() => void>();

function keyFor(projectId: string | null): string {
  return projectId || "__noproject__";
}
function storageKey(projectId: string | null): string {
  return PREFIX + keyFor(projectId);
}

function normalize(raw: Partial<Broadcast>): Broadcast {
  return {
    id: raw.id && UUID_RE.test(raw.id) ? raw.id : newId(),
    name: raw.name ?? "Без названия",
    channel: raw.channel === "sms" ? "sms" : "whatsapp",
    audienceSource: raw.audienceSource === "upload" ? "upload" : "crm",
    crmFilter: {
      stageKeys: Array.isArray(raw.crmFilter?.stageKeys) ? raw.crmFilter!.stageKeys : [],
      sources: Array.isArray(raw.crmFilter?.sources) ? raw.crmFilter!.sources : [],
    },
    uploadedContacts: Array.isArray(raw.uploadedContacts)
      ? raw.uploadedContacts
          .map((c) => ({ name: (c.name ?? "").toString(), phone: normalizePhone((c.phone ?? "").toString()) }))
          .filter((c) => c.phone)
      : [],
    title: raw.title ?? "",
    message: raw.message ?? "",
    targetUrl: raw.targetUrl ?? "",
    schedule: {
      mode: raw.schedule?.mode === "scheduled" ? "scheduled" : "now",
      at: raw.schedule?.at ?? null,
    },
    status: raw.status ?? "draft",
    recipientsCount: raw.recipientsCount ?? 0,
    stats: {
      total: raw.stats?.total ?? 0,
      sent: raw.stats?.sent ?? 0,
      failed: raw.stats?.failed ?? 0,
    },
    results: Array.isArray(raw.results) ? raw.results : [],
    createdAt: raw.createdAt ?? nowIso(),
    updatedAt: raw.updatedAt ?? nowIso(),
    sentAt: raw.sentAt ?? null,
  };
}

function persist(projectId: string | null, list: Broadcast[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(storageKey(projectId), JSON.stringify(list));
  } catch (e) {
    console.warn("[broadcasts] localStorage write failed:", e);
  }
}

export function readBroadcasts(projectId: string | null): Broadcast[] {
  const k = keyFor(projectId);
  const cached = memCache.get(k);
  if (cached) return cached;
  let list: Broadcast[];
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(storageKey(projectId)) : null;
    const parsed = raw ? (JSON.parse(raw) as Partial<Broadcast>[]) : [];
    list = Array.isArray(parsed) ? parsed.map(normalize) : [];
  } catch {
    list = [];
  }
  memCache.set(k, list);
  return list;
}

function commit(projectId: string | null, list: Broadcast[]): void {
  memCache.set(keyFor(projectId), list);
  persist(projectId, list);
  for (const l of listeners) l();
}

export function subscribeBroadcasts(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export type BroadcastDraft = Pick<
  Broadcast,
  | "name"
  | "channel"
  | "audienceSource"
  | "crmFilter"
  | "uploadedContacts"
  | "title"
  | "message"
  | "targetUrl"
  | "schedule"
  | "recipientsCount"
>;

export function emptyBroadcastDraft(): BroadcastDraft {
  return {
    name: "",
    channel: "whatsapp",
    audienceSource: "crm",
    crmFilter: { stageKeys: [], sources: [] },
    uploadedContacts: [],
    title: "",
    message: "",
    targetUrl: "",
    schedule: { mode: "now", at: null },
    recipientsCount: 0,
  };
}

export function createBroadcast(projectId: string | null, draft: BroadcastDraft): Broadcast {
  const status: BroadcastStatus = draft.schedule.mode === "scheduled" ? "scheduled" : "draft";
  const item = normalize({ ...draft, status });
  commit(projectId, [item, ...readBroadcasts(projectId)]);
  return item;
}

export function updateBroadcast(projectId: string | null, id: string, patch: Partial<Broadcast>): void {
  const list = readBroadcasts(projectId).map((b) =>
    b.id === id ? normalize({ ...b, ...patch, updatedAt: nowIso() }) : b,
  );
  commit(projectId, list);
}

export function removeBroadcast(projectId: string | null, id: string): void {
  commit(projectId, readBroadcasts(projectId).filter((b) => b.id !== id));
}

export function getBroadcast(projectId: string | null, id: string): Broadcast | undefined {
  return readBroadcasts(projectId).find((b) => b.id === id);
}
