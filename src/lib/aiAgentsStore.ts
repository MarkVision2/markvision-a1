// Хранилище ИИ-агентов отдела продаж.
//
// Агент — это настроенный под канал (WhatsApp / Instagram) ИИ-ассистент,
// который по системному промту и базе знаний отвечает на входящие вопросы
// клиентов. Здесь — конфигурация агентов: промты, приветствия, база знаний,
// статус и канал подключения.
//
// Данные живут в localStorage и разделены по проектам (как и остальной
// контент приложения). Публичный API синхронный + подписка через
// useSyncExternalStore (см. hooks/useAiAgents.ts). Реальный движок ответов —
// edge function `report-ai-chat` (тот же LLM-шлюз, что и в тренажёре AI РОПа);
// он вызывается из теста агента и из продакшн-вебхуков мессенджеров.

const PREFIX = "mv:ai-agents:";

export type AgentChannel = "whatsapp" | "instagram";
export type AgentStatus = "active" | "paused" | "draft";

export type AgentKnowledgeItem = {
  id: string;
  question: string;
  answer: string;
};

export type AiAgent = {
  id: string;
  name: string;
  /** Канал, в котором агент отвечает на входящие. */
  channel: AgentChannel;
  /** Привязка канала: номер для WhatsApp или @ник для Instagram. */
  handle: string;
  status: AgentStatus;
  /** Модель LLM (пресет шлюза Lovable AI). */
  model: string;
  /** Короткая роль/персона для заголовка карточки. */
  role: string;
  /** Главные инструкции — по ним агент формирует ответы. */
  systemPrompt: string;
  /** Первое сообщение, которое агент отправляет в начале диалога. */
  greeting: string;
  /** Что отвечать / делать, когда агент не знает ответа. */
  fallback: string;
  /** Креативность ответов 0..1 (для отображения и будущего проброса). */
  temperature: number;
  /** Отвечать на входящие автоматически. */
  autoReply: boolean;
  /** Передавать диалог живому менеджеру, если вопрос вне базы. */
  handoffOnUnknown: boolean;
  /** Часы работы — вне их агент не отвечает (или отвечает дежурным сообщением). */
  workingHours: { enabled: boolean; from: string; to: string };
  /** Мини-база знаний: частые вопросы и ответы. */
  knowledge: AgentKnowledgeItem[];
  /** Накопительная статистика (заполняется вебхуками мессенджеров). */
  stats: { handled: number; resolved: number; handoff: number };
  createdAt: string;
  updatedAt: string;
};

export const CHANNEL_META: Record<
  AgentChannel,
  { label: string; placeholder: string; hint: string }
> = {
  whatsapp: {
    label: "WhatsApp",
    placeholder: "+7 700 000 00 00",
    hint: "Номер WhatsApp Business, к которому подключён агент",
  },
  instagram: {
    label: "Instagram",
    placeholder: "@username",
    hint: "Аккаунт Instagram, в Direct которого отвечает агент",
  },
};

export const MODEL_OPTIONS: { id: string; label: string; hint: string }[] = [
  { id: "google/gemini-2.5-flash", label: "Быстрый", hint: "Gemini 2.5 Flash · мгновенные ответы" },
  { id: "google/gemini-2.5-pro", label: "Умный", hint: "Gemini 2.5 Pro · сложные вопросы" },
];

export const STATUS_META: Record<AgentStatus, { label: string; tone: "success" | "warning" | "muted" }> = {
  active: { label: "Активен", tone: "success" },
  paused: { label: "На паузе", tone: "warning" },
  draft: { label: "Черновик", tone: "muted" },
};

// ─── Шаблоны агентов ─────────────────────────────────────────────────────────

export type AgentTemplate = {
  id: string;
  title: string;
  emoji: string;
  role: string;
  channel: AgentChannel;
  systemPrompt: string;
  greeting: string;
  knowledge: { question: string; answer: string }[];
};

export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: "clinic",
    title: "Администратор клиники",
    emoji: "🦷",
    role: "Администратор медицинской клиники",
    channel: "whatsapp",
    systemPrompt: `Ты — ИИ-администратор частной клиники. Твоя задача — отвечать на входящие
вопросы пациентов, квалифицировать заявку и записывать на бесплатную
консультацию или диагностику.
Правила:
- Не отправляй прайс первым сообщением. Сначала задай 1–2 уточняющих вопроса.
- Отрабатывай возражение «дорого» через ценность, а не скидку.
- Всегда веди к записи на конкретное время.
- Пиши тепло, по-человечески, без воды. Одно сообщение — одна мысль.`,
    greeting:
      "Здравствуйте! 👋 Это клиника MarkVision. Подскажите, что вас беспокоит или какая услуга интересует — подберём удобное время визита.",
    knowledge: [
      { question: "Сколько стоит консультация?", answer: "Первичная консультация — бесплатная. На ней врач составит план лечения и точную смету." },
      { question: "Где вы находитесь?", answer: "Мы в центре города. Пришлю точный адрес и геометку, как только подберём удобное вам время." },
    ],
  },
  {
    id: "store",
    title: "Менеджер интернет-магазина",
    emoji: "🛍️",
    role: "Менеджер по продажам интернет-магазина",
    channel: "instagram",
    systemPrompt: `Ты — ИИ-менеджер интернет-магазина. Отвечаешь на вопросы по товарам,
наличию, доставке и оплате, помогаешь выбрать и оформить заказ.
Правила:
- Уточни, какой товар/размер/цвет интересует, прежде чем называть цену.
- Предлагай 1–2 подходящих варианта, не вываливай весь каталог.
- Всегда заверши предложением оформить заказ или отправить ссылку на товар.
- Тон — дружелюбный, на «вы», с лёгкими эмодзи.`,
    greeting:
      "Привет! 💜 Спасибо, что написали. Что вас заинтересовало — подскажу по наличию, цене и доставке.",
    knowledge: [
      { question: "Как происходит доставка?", answer: "Доставляем курьером по городу за 1–2 дня и почтой по стране за 3–5 дней. Стоимость рассчитаю после оформления." },
      { question: "Можно ли оплатить при получении?", answer: "Да, доступна оплата картой онлайн и наложенным платежом при получении." },
    ],
  },
  {
    id: "beauty",
    title: "Администратор салона красоты",
    emoji: "💅",
    role: "Администратор салона красоты",
    channel: "instagram",
    systemPrompt: `Ты — ИИ-администратор салона красоты. Записываешь клиентов на услуги,
консультируешь по процедурам, мастерам и ценам.
Правила:
- Уточни услугу и желаемую дату/время.
- Предложи ближайшие свободные слоты.
- Напомни взять с собой/подготовиться, если нужно.
- Пиши заботливо и по-дружески, с эмодзи в меру.`,
    greeting:
      "Здравствуйте! ✨ Салон MarkVision на связи. На какую процедуру хотите записаться?",
    knowledge: [
      { question: "Сколько длится маникюр?", answer: "В среднем 1.5–2 часа в зависимости от покрытия и дизайна." },
    ],
  },
  {
    id: "blank",
    title: "Пустой агент",
    emoji: "✨",
    role: "ИИ-ассистент",
    channel: "whatsapp",
    systemPrompt: `Ты — ИИ-ассистент компании. Вежливо и по делу отвечай на входящие
вопросы клиентов в мессенджере, опираясь на базу знаний ниже. Если вопрос
выходит за рамки — мягко предложи связать с живым менеджером.`,
    greeting: "Здравствуйте! Чем могу помочь?",
    knowledge: [],
  },
];

// ─── In-memory store + подписка ──────────────────────────────────────────────

const memCache = new Map<string, AiAgent[]>();
const listeners = new Set<() => void>();

function keyFor(projectId: string | null): string {
  return projectId || "__noproject__";
}

function storageKey(projectId: string | null): string {
  return PREFIX + keyFor(projectId);
}

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

function normalize(raw: Partial<AiAgent>): AiAgent {
  return {
    id: raw.id && UUID_RE.test(raw.id) ? raw.id : newId(),
    name: raw.name ?? "Без названия",
    channel: raw.channel === "instagram" ? "instagram" : "whatsapp",
    handle: raw.handle ?? "",
    status: raw.status === "active" || raw.status === "paused" ? raw.status : "draft",
    model: raw.model ?? MODEL_OPTIONS[0].id,
    role: raw.role ?? "ИИ-ассистент",
    systemPrompt: raw.systemPrompt ?? "",
    greeting: raw.greeting ?? "",
    fallback:
      raw.fallback ??
      "Хороший вопрос! Уточню у коллеги и вернусь с ответом. Можно ваш контактный номер?",
    temperature: typeof raw.temperature === "number" ? raw.temperature : 0.5,
    autoReply: raw.autoReply ?? true,
    handoffOnUnknown: raw.handoffOnUnknown ?? true,
    workingHours: {
      enabled: raw.workingHours?.enabled ?? false,
      from: raw.workingHours?.from ?? "09:00",
      to: raw.workingHours?.to ?? "21:00",
    },
    knowledge: Array.isArray(raw.knowledge)
      ? raw.knowledge.map((k) => ({
          id: k.id && UUID_RE.test(k.id) ? k.id : newId(),
          question: k.question ?? "",
          answer: k.answer ?? "",
        }))
      : [],
    stats: {
      handled: raw.stats?.handled ?? 0,
      resolved: raw.stats?.resolved ?? 0,
      handoff: raw.stats?.handoff ?? 0,
    },
    createdAt: raw.createdAt ?? nowIso(),
    updatedAt: raw.updatedAt ?? nowIso(),
  };
}

function seedDefaults(): AiAgent[] {
  // Один пример-черновик, чтобы раздел не был пустым и было от чего оттолкнуться.
  const tpl = AGENT_TEMPLATES[0];
  return [
    normalize({
      name: "Администратор клиники",
      channel: tpl.channel,
      handle: "",
      status: "draft",
      role: tpl.role,
      systemPrompt: tpl.systemPrompt,
      greeting: tpl.greeting,
      knowledge: tpl.knowledge.map((k) => ({ id: newId(), ...k })),
    }),
  ];
}

function persist(projectId: string | null, list: AiAgent[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(storageKey(projectId), JSON.stringify(list));
  } catch (e) {
    console.warn("[aiAgents] localStorage write failed:", e);
  }
}

/** Текущий список агентов проекта (стабильная ссылка для useSyncExternalStore). */
export function readAgents(projectId: string | null): AiAgent[] {
  const k = keyFor(projectId);
  const cached = memCache.get(k);
  if (cached) return cached;

  let list: AiAgent[];
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(storageKey(projectId)) : null;
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AiAgent>[];
      list = Array.isArray(parsed) ? parsed.map(normalize) : [];
    } else {
      list = seedDefaults();
      persist(projectId, list);
    }
  } catch {
    list = [];
  }
  memCache.set(k, list);
  return list;
}

function commit(projectId: string | null, list: AiAgent[]): void {
  memCache.set(keyFor(projectId), list);
  persist(projectId, list);
  for (const l of listeners) l();
}

export function subscribeAgents(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export type AgentDraft = Omit<AiAgent, "id" | "createdAt" | "updatedAt" | "stats">;

export function emptyAgentDraft(): AgentDraft {
  const tpl = AGENT_TEMPLATES.find((t) => t.id === "blank") ?? AGENT_TEMPLATES[0];
  return {
    name: "",
    channel: "whatsapp",
    handle: "",
    status: "draft",
    model: MODEL_OPTIONS[0].id,
    role: tpl.role,
    systemPrompt: tpl.systemPrompt,
    greeting: tpl.greeting,
    fallback: "Хороший вопрос! Уточню у коллеги и вернусь с ответом. Можно ваш контактный номер?",
    temperature: 0.5,
    autoReply: true,
    handoffOnUnknown: true,
    workingHours: { enabled: false, from: "09:00", to: "21:00" },
    knowledge: [],
  };
}

export function createAgent(projectId: string | null, draft: AgentDraft): AiAgent {
  const agent = normalize({ ...draft });
  const list = [agent, ...readAgents(projectId)];
  commit(projectId, list);
  return agent;
}

export function updateAgent(
  projectId: string | null,
  id: string,
  patch: Partial<AgentDraft>,
): void {
  const list = readAgents(projectId).map((a) =>
    a.id === id ? normalize({ ...a, ...patch, updatedAt: nowIso() }) : a,
  );
  commit(projectId, list);
}

export function setAgentStatus(projectId: string | null, id: string, status: AgentStatus): void {
  updateAgent(projectId, id, { status });
}

export function removeAgent(projectId: string | null, id: string): void {
  const list = readAgents(projectId).filter((a) => a.id !== id);
  commit(projectId, list);
}

export function duplicateAgent(projectId: string | null, id: string): AiAgent | null {
  const src = readAgents(projectId).find((a) => a.id === id);
  if (!src) return null;
  const copy = normalize({
    ...src,
    id: newId(),
    name: `${src.name} (копия)`,
    status: "draft",
    handle: "",
    knowledge: src.knowledge.map((k) => ({ ...k, id: newId() })),
    stats: { handled: 0, resolved: 0, handoff: 0 },
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  commit(projectId, [copy, ...readAgents(projectId)]);
  return copy;
}
