/**
 * Хранилище конфигурации и пользовательского контента AI РОПа.
 *
 * ШАГ 2: данные теперь живут в Supabase (таблицы ai_rop_*). Чтобы не ломать UI,
 * публичный API остался синхронным: getX()/saveX() работают через in-memory cache
 * (с зеркалом в localStorage для мгновенного первого рендера). Реальная
 * синхронизация с базой:
 *   - hydrateAiRopStorage(projectId, userId) → подтягивает всё из Supabase в кэш.
 *   - saveX(...) → пишет в кэш + LS, и параллельно (fire-and-forget) делает
 *     upsert/delete в Supabase.
 *   - subscribeAiRop(key, cb) → подписка на изменения кэша (после hydrate
 *     или после внешнего сохранения).
 *
 * Никакие компоненты не обязаны менять get/save сигнатуры — достаточно один раз
 * вызвать hydrateAiRopStorage на маунте страницы и подписаться через subscribeAiRop.
 */

import { supabase } from "@/integrations/supabase/client";

const PREFIX = "mv:ai-rop:";

type CacheKey = "settings" | "scripts" | "content-ideas" | "trainer-sessions";

const memCache = new Map<CacheKey, unknown>();
const listeners = new Map<CacheKey, Set<() => void>>();

let currentProjectId: string | null = null;
let currentUserId: string | null = null;
let hydrateSeq = 0;

function isCurrentHydration(seq: number, projectId: string | null, userId: string | null): boolean {
  return seq === hydrateSeq && currentProjectId === projectId && currentUserId === userId;
}

function read<T>(key: CacheKey, fallback: T): T {
  if (memCache.has(key)) return memCache.get(key) as T;
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (!raw) {
      memCache.set(key, fallback);
      return fallback;
    }
    const parsed = JSON.parse(raw) as T;
    memCache.set(key, parsed);
    return parsed;
  } catch {
    return fallback;
  }
}

function writeLocal<T>(key: CacheKey, value: T): void {
  memCache.set(key, value);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch (e) {
    // QuotaExceededError / SecurityError. Не критично — данные останутся в БД
    // и в memCache; на следующем заходе подтянутся через гидратацию.
    // Логируем, чтобы поймать неожиданные кейсы.
    console.warn("[aiRop] localStorage write failed:", key, e);
  }
}

function emit(key: CacheKey) {
  const subs = listeners.get(key);
  if (!subs) return;
  subs.forEach((cb) => {
    try { cb(); } catch { /* swallow */ }
  });
}

export function subscribeAiRop(key: CacheKey, cb: () => void): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(cb);
  return () => { set?.delete(cb); };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ensureUuid(id: string | undefined | null): string {
  if (id && UUID_RE.test(id)) return id;
  try {
    return (crypto as Crypto).randomUUID();
  } catch {
    // fallback (RFC4122-ish)
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}

// ─── Настройки РОПа ─────────────────────────────────────────────────────────

export type RopSettings = {
  systemPrompt: string;
  watchList: string[];
  sla: {
    firstResponseMin: number;
    callbackHours: number;
    chatIdleHours: number;
  };
  kpi: {
    minConversionPct: number;
    minDialPct: number;
    maxRejectPct: number;
  };
  tone: "strict" | "neutral" | "supportive";
  autoActions: {
    suggestScripts: boolean;
    flagMissedSLA: boolean;
    generateContentIdeas: boolean;
    scoreCalls: boolean;
    scoreChats: boolean;
  };
};

export const DEFAULT_ROP_SETTINGS: RopSettings = {
  systemPrompt: `Ты — AI-РОП (руководитель отдела продаж) частной клиники.
Твоя задача — следить за работой администраторов: качество звонков, переписок,
скорость ответа, отработка возражений. Анализируешь общение клиентов и менеджеров,
даёшь рекомендации, формируешь скрипты и контент-план на основе реальных запросов.
Стиль общения — деловой, по фактам, без воды. Всегда опирайся на данные CRM
и не выдумывай метрики, которых нет.`,
  watchList: [
    "Скорость первого ответа",
    "% дозвона",
    "Отработка возражений по цене",
    "Назначение визита в конце разговора",
    "Использование скриптов",
    "Эмпатия и тон администратора",
  ],
  sla: {
    firstResponseMin: 5,
    callbackHours: 2,
    chatIdleHours: 4,
  },
  kpi: {
    minConversionPct: 10,
    minDialPct: 70,
    maxRejectPct: 30,
  },
  tone: "neutral",
  autoActions: {
    suggestScripts: true,
    flagMissedSLA: true,
    generateContentIdeas: true,
    scoreCalls: true,
    scoreChats: true,
  },
};

function rowToSettings(r: Record<string, unknown>): RopSettings {
  return {
    systemPrompt: (r.system_prompt as string) ?? DEFAULT_ROP_SETTINGS.systemPrompt,
    watchList: (r.watch_list as string[]) ?? DEFAULT_ROP_SETTINGS.watchList,
    sla: {
      firstResponseMin: Number(r.sla_first_response_min ?? DEFAULT_ROP_SETTINGS.sla.firstResponseMin),
      callbackHours: Number(r.sla_callback_hours ?? DEFAULT_ROP_SETTINGS.sla.callbackHours),
      chatIdleHours: Number(r.sla_chat_idle_hours ?? DEFAULT_ROP_SETTINGS.sla.chatIdleHours),
    },
    kpi: {
      minConversionPct: Number(r.kpi_min_conversion_pct ?? DEFAULT_ROP_SETTINGS.kpi.minConversionPct),
      minDialPct: Number(r.kpi_min_dial_pct ?? DEFAULT_ROP_SETTINGS.kpi.minDialPct),
      maxRejectPct: Number(r.kpi_max_reject_pct ?? DEFAULT_ROP_SETTINGS.kpi.maxRejectPct),
    },
    tone: ((r.tone as RopSettings["tone"]) ?? "neutral"),
    autoActions: {
      suggestScripts: Boolean(r.auto_suggest_scripts ?? true),
      flagMissedSLA: Boolean(r.auto_flag_sla ?? true),
      generateContentIdeas: Boolean(r.auto_generate_content ?? true),
      scoreCalls: Boolean(r.auto_score_calls ?? true),
      scoreChats: Boolean(r.auto_score_chats ?? true),
    },
  };
}

function settingsToRow(s: RopSettings, projectId: string | null, userId: string | null) {
  return {
    project_id: projectId,
    user_id: userId,
    system_prompt: s.systemPrompt,
    watch_list: s.watchList,
    sla_first_response_min: s.sla.firstResponseMin,
    sla_callback_hours: s.sla.callbackHours,
    sla_chat_idle_hours: s.sla.chatIdleHours,
    kpi_min_conversion_pct: s.kpi.minConversionPct,
    kpi_min_dial_pct: s.kpi.minDialPct,
    kpi_max_reject_pct: s.kpi.maxRejectPct,
    tone: s.tone,
    auto_suggest_scripts: s.autoActions.suggestScripts,
    auto_flag_sla: s.autoActions.flagMissedSLA,
    auto_generate_content: s.autoActions.generateContentIdeas,
    auto_score_calls: s.autoActions.scoreCalls,
    auto_score_chats: s.autoActions.scoreChats,
  };
}

export function getRopSettings(): RopSettings {
  return { ...DEFAULT_ROP_SETTINGS, ...read<Partial<RopSettings>>("settings", {} as Partial<RopSettings>) } as RopSettings;
}

export function saveRopSettings(s: RopSettings): void {
  writeLocal("settings", s);
  emit("settings");
  if (!currentProjectId) return;
  void supabase
    .from("ai_rop_settings")
    .upsert(settingsToRow(s, currentProjectId, currentUserId), { onConflict: "project_id" })
    .then(({ error }) => {
      if (error) console.warn("[aiRop] saveRopSettings failed:", error.message);
    });
}

// ─── Скрипты ────────────────────────────────────────────────────────────────

export type ScriptCategory =
  | "greeting"
  | "objection_price"
  | "objection_no_time"
  | "objection_thinking"
  | "closing"
  | "follow_up"
  | "missed_call"
  | "custom";

export const SCRIPT_CATEGORIES: { id: ScriptCategory; label: string; emoji: string }[] = [
  { id: "greeting", label: "Приветствие", emoji: "👋" },
  { id: "objection_price", label: "Возражение «дорого»", emoji: "💸" },
  { id: "objection_no_time", label: "Возражение «нет времени»", emoji: "⏰" },
  { id: "objection_thinking", label: "Возражение «подумаю»", emoji: "🤔" },
  { id: "closing", label: "Закрытие на запись", emoji: "✅" },
  { id: "follow_up", label: "Дожим после паузы", emoji: "🔁" },
  { id: "missed_call", label: "Не дозвонились", emoji: "📵" },
  { id: "custom", label: "Свой сценарий", emoji: "✨" },
];

export type RopScript = {
  id: string;
  category: ScriptCategory;
  title: string;
  body: string;
  tags: string[];
  source: "manual" | "ai";
  usageCount: number;
  effectiveness: number | null;
  createdAt: string;
  updatedAt: string;
};

const now = () => new Date().toISOString();

export const DEFAULT_SCRIPTS: RopScript[] = [
  {
    id: "scr-1",
    category: "greeting",
    title: "Первое приветствие после заявки",
    body:
      "Здравствуйте, {имя}! Это {клиника}, вы оставляли заявку на консультацию. " +
      "Удобно сейчас 1–2 минуты обсудить детали и подобрать вам время визита?",
    tags: ["whatsapp", "первый контакт"],
    source: "manual",
    usageCount: 0,
    effectiveness: null,
    createdAt: now(),
    updatedAt: now(),
  },
  {
    id: "scr-2",
    category: "objection_price",
    title: "Когда говорят «дорого»",
    body:
      "Понимаю, цена — важный момент. Сравните: у нас в стоимость уже входит {что_входит}. " +
      "Многие пациенты в итоге выбирают нас, потому что не доплачивают потом отдельно. " +
      "Давайте я запишу вас на диагностику — посмотрим конкретно по вашему случаю, и вы решите.",
    tags: ["возражение", "цена"],
    source: "manual",
    usageCount: 0,
    effectiveness: null,
    createdAt: now(),
    updatedAt: now(),
  },
  {
    id: "scr-3",
    category: "closing",
    title: "Закрытие на запись на диагностику",
    body:
      "Хорошо, тогда смотрите — у меня есть {слот_1} или {слот_2}, какой удобнее? " +
      "Я закреплю за вами время, и пришлю напоминание в WhatsApp за день до визита.",
    tags: ["запись", "закрытие"],
    source: "manual",
    usageCount: 0,
    effectiveness: null,
    createdAt: now(),
    updatedAt: now(),
  },
  {
    id: "scr-4",
    category: "missed_call",
    title: "Сообщение если не дозвонились",
    body:
      "{имя}, добрый день! Это {клиника}. Не смогли вам дозвониться — возможно, было неудобно. " +
      "Когда вам перезвонить? Или напишите сразу здесь, я подберу время визита.",
    tags: ["без_ответа", "whatsapp"],
    source: "manual",
    usageCount: 0,
    effectiveness: null,
    createdAt: now(),
    updatedAt: now(),
  },
];

function rowToScript(r: Record<string, unknown>): RopScript {
  return {
    id: r.id as string,
    category: r.category as ScriptCategory,
    title: (r.title as string) ?? "",
    body: (r.body as string) ?? "",
    tags: (r.tags as string[]) ?? [],
    source: (r.source as "manual" | "ai") ?? "manual",
    usageCount: Number(r.usage_count ?? 0),
    effectiveness: r.effectiveness == null ? null : Number(r.effectiveness),
    createdAt: (r.created_at as string) ?? now(),
    updatedAt: (r.updated_at as string) ?? now(),
  };
}

function scriptToRow(s: RopScript, projectId: string | null, userId: string | null) {
  return {
    id: s.id,
    project_id: projectId,
    category: s.category,
    title: s.title,
    body: s.body,
    tags: s.tags ?? [],
    source: s.source,
    usage_count: s.usageCount ?? 0,
    effectiveness: s.effectiveness,
    created_by: userId,
  };
}

export function getScripts(): RopScript[] {
  return read<RopScript[]>("scripts", DEFAULT_SCRIPTS);
}

export function saveScripts(list: RopScript[]): void {
  // Гарантируем UUID-идентификаторы перед отправкой в БД
  const normalized = list.map((s) => (UUID_RE.test(s.id) ? s : { ...s, id: ensureUuid(s.id) }));
  const prev = (memCache.get("scripts") as RopScript[] | undefined) ?? [];
  writeLocal("scripts", normalized);
  emit("scripts");
  if (!currentProjectId) return;
  void syncCollection({
    table: "ai_rop_scripts",
    prev,
    next: normalized,
    toRow: (s) => scriptToRow(s, currentProjectId, currentUserId),
  });
}

// ─── Контент-план ───────────────────────────────────────────────────────────

export type ContentIdea = {
  id: string;
  title: string;
  format: "reels" | "post" | "story" | "article" | "video";
  hook: string;
  body: string;
  basedOn: string;
  audience: string;
  cta: string;
  priority: "high" | "mid" | "low";
  status: "idea" | "in_progress" | "published" | "rejected";
  createdAt: string;
};

export const DEFAULT_CONTENT_IDEAS: ContentIdea[] = [
  {
    id: "ci-1",
    title: "Сколько стоит имплант под ключ и почему цены так отличаются",
    format: "reels",
    hook: "«Везде по-разному, кому верить?» — самый частый вопрос пациентов.",
    body:
      "1. Объяснить, из чего складывается цена импланта.\n" +
      "2. Показать на цифрах разницу между «эконом» и полной услугой.\n" +
      "3. Развенчать миф о «скрытых доплатах».",
    basedOn: "10 чатов за неделю с возражением «дорого»",
    audience: "Взрослые 30-55, рассматривают имплантацию",
    cta: "Бесплатная консультация по подбору импланта",
    priority: "high",
    status: "idea",
    createdAt: now(),
  },
  {
    id: "ci-2",
    title: "Что входит в диагностику за 5000 ₸",
    format: "post",
    hook: "Пациенты часто думают, что диагностика — это только осмотр.",
    body:
      "Раскрыть состав диагностики: КТ, консультация, план лечения.\n" +
      "Показать пример заключения, рассказать, что пациент получает на руки.",
    basedOn: "Повторяющийся вопрос в WhatsApp",
    audience: "Лиды на этапе «думаю»",
    cta: "Записаться на диагностику",
    priority: "mid",
    status: "idea",
    createdAt: now(),
  },
];

function rowToIdea(r: Record<string, unknown>): ContentIdea {
  return {
    id: r.id as string,
    title: (r.title as string) ?? "",
    format: r.format as ContentIdea["format"],
    hook: (r.hook as string) ?? "",
    body: (r.body as string) ?? "",
    basedOn: (r.based_on as string) ?? "",
    audience: (r.audience as string) ?? "",
    cta: (r.cta as string) ?? "",
    priority: (r.priority as ContentIdea["priority"]) ?? "mid",
    status: (r.status as ContentIdea["status"]) ?? "idea",
    createdAt: (r.created_at as string) ?? now(),
  };
}

function ideaToRow(i: ContentIdea, projectId: string | null, userId: string | null) {
  return {
    id: i.id,
    project_id: projectId,
    title: i.title,
    format: i.format,
    priority: i.priority,
    status: i.status,
    hook: i.hook || null,
    body: i.body || null,
    audience: i.audience || null,
    cta: i.cta || null,
    based_on: i.basedOn || null,
    created_by: userId,
  };
}

export function getContentIdeas(): ContentIdea[] {
  return read<ContentIdea[]>("content-ideas", DEFAULT_CONTENT_IDEAS);
}

export function saveContentIdeas(list: ContentIdea[]): void {
  const normalized = list.map((i) => (UUID_RE.test(i.id) ? i : { ...i, id: ensureUuid(i.id) }));
  const prev = (memCache.get("content-ideas") as ContentIdea[] | undefined) ?? [];
  writeLocal("content-ideas", normalized);
  emit("content-ideas");
  if (!currentProjectId) return;
  void syncCollection({
    table: "ai_rop_content_ideas",
    prev,
    next: normalized,
    toRow: (i) => ideaToRow(i, currentProjectId, currentUserId),
  });
}

// ─── Тренажёр: сценарии ─────────────────────────────────────────────────────

export type TrainerScenario = {
  id: string;
  role: "patient" | "lead";
  title: string;
  difficulty: "easy" | "medium" | "hard";
  context: string;
  goals: string[];
  channel: "phone" | "whatsapp" | "instagram";
};

export const TRAINER_SCENARIOS: TrainerScenario[] = [
  {
    id: "tr-1",
    role: "patient",
    title: "Тёплый лид с рекламы, спрашивает цену имплантации",
    difficulty: "easy",
    context:
      "Ты — пациент, оставил заявку на имплантацию после рекламы в Instagram. " +
      "У тебя нет одного зуба, давно откладываешь. Ты осторожен, хочешь понять цену, " +
      "но готов слушать. Не сдавайся слишком быстро — задавай уточняющие вопросы.",
    goals: [
      "Установить контакт и собрать информацию о пациенте",
      "Презентовать ценность диагностики",
      "Записать на бесплатную консультацию",
    ],
    channel: "phone",
  },
  {
    id: "tr-2",
    role: "patient",
    title: "Скептик: «У вас дорого, в соседней клинике дешевле»",
    difficulty: "medium",
    context:
      "Ты — пациент с возражением «дорого». Уже звонил конкуренту, тебе там назвали " +
      "цену на 30% ниже. Ты пришёл сравнить. Будь упрямым, но открытым к аргументам про качество.",
    goals: [
      "Не уйти в защиту, отработать возражение «дорого»",
      "Выяснить истинную причину сомнений",
      "Закрыть на диагностику без сброса цены",
    ],
    channel: "phone",
  },
  {
    id: "tr-3",
    role: "lead",
    title: "Холодный чат: пишет «сколько стоит?» одним сообщением",
    difficulty: "easy",
    context:
      "Ты — лид, написал в WhatsApp одно сообщение: «Сколько стоит имплант?». " +
      "Если тебе сразу пришлют прайс — ты пропадёшь. Если зададут вопросы и предложат " +
      "консультацию — можешь продолжить общение.",
    goals: [
      "Не отправлять прайс в первом ответе",
      "Задать квалифицирующие вопросы",
      "Предложить бесплатную консультацию или диагностику",
    ],
    channel: "whatsapp",
  },
  {
    id: "tr-4",
    role: "patient",
    title: "Сложный: пациент после второго отказа",
    difficulty: "hard",
    context:
      "Ты — пациент, дважды отказался: «дорого» и «подумаю». Прошло 7 дней, тебе пишут снова. " +
      "Ты раздражён, но всё ещё нуждаешься в лечении. Если администратор продавит — пропадёшь.",
    goals: [
      "Не давить, перейти на эмпатию",
      "Выяснить, что изменилось / не изменилось",
      "Предложить мягкий следующий шаг",
    ],
    channel: "whatsapp",
  },
];

// ─── Тренажёр: история сессий ───────────────────────────────────────────────

export type TrainerMessage = {
  id: string;
  role: "user" | "ai";
  content: string;
  at: string;
};

export type TrainerSession = {
  id: string;
  scenarioId: string;
  scenarioTitle: string;
  messages: TrainerMessage[];
  score: number | null;
  feedback: string | null;
  startedAt: string;
  finishedAt: string | null;
};

function rowToTrainerSession(r: Record<string, unknown>): TrainerSession {
  return {
    id: r.id as string,
    scenarioId: (r.scenario_id as string) ?? "",
    scenarioTitle: (r.scenario_title as string) ?? "",
    messages: (r.messages as TrainerMessage[]) ?? [],
    score: r.score == null ? null : Number(r.score),
    feedback: (r.feedback as string) ?? null,
    startedAt: (r.started_at as string) ?? now(),
    finishedAt: (r.finished_at as string) ?? null,
  };
}

function trainerSessionToRow(s: TrainerSession, projectId: string | null, userId: string | null) {
  const scenario = TRAINER_SCENARIOS.find((sc) => sc.id === s.scenarioId);
  return {
    id: s.id,
    project_id: projectId,
    user_id: userId,
    scenario_id: s.scenarioId,
    scenario_title: s.scenarioTitle,
    scenario_role: scenario?.role ?? "patient",
    scenario_channel: scenario?.channel ?? "phone",
    difficulty: scenario?.difficulty ?? "easy",
    messages: s.messages,
    score: s.score,
    feedback: s.feedback,
    started_at: s.startedAt,
    finished_at: s.finishedAt,
  };
}

export function getTrainerSessions(): TrainerSession[] {
  return read<TrainerSession[]>("trainer-sessions", []);
}

export function saveTrainerSessions(list: TrainerSession[]): void {
  const normalized = list.map((s) => (UUID_RE.test(s.id) ? s : { ...s, id: ensureUuid(s.id) }));
  const prev = (memCache.get("trainer-sessions") as TrainerSession[] | undefined) ?? [];
  writeLocal("trainer-sessions", normalized);
  emit("trainer-sessions");
  if (!currentUserId) return;
  void syncCollection({
    table: "ai_rop_trainer_sessions",
    prev,
    next: normalized,
    toRow: (s) => trainerSessionToRow(s, currentProjectId, currentUserId),
  });
}

// ─── Утилиты ────────────────────────────────────────────────────────────────

export function newId(prefix = "id"): string {
  // Возвращаем валидный UUID, чтобы запись могла уехать в БД без переименования
  return ensureUuid(`${prefix}-bootstrap`);
}

// ─── Sync helpers ───────────────────────────────────────────────────────────

type Identifiable = { id: string };

async function syncCollection<T extends Identifiable>(opts: {
  table: "ai_rop_scripts" | "ai_rop_content_ideas" | "ai_rop_trainer_sessions";
  prev: T[];
  next: T[];
  toRow: (item: T) => Record<string, unknown>;
}) {
  const { table, prev, next, toRow } = opts;
  try {
    const nextIds = new Set(next.map((n) => n.id));
    const removed = prev.filter((p) => !nextIds.has(p.id)).map((p) => p.id);
    if (removed.length) {
      const { error } = await supabase.from(table).delete().in("id", removed);
      if (error) console.warn(`[aiRop] delete from ${table} failed:`, error.message);
    }
    if (next.length) {
      const rows = next.map(toRow);
      const { error } = await supabase.from(table).upsert(rows as never, { onConflict: "id" });
      if (error) console.warn(`[aiRop] upsert into ${table} failed:`, error.message);
    }
  } catch (e) {
    console.warn(`[aiRop] sync ${table} threw:`, e);
  }
}

// ─── Hydration ──────────────────────────────────────────────────────────────

/**
 * Загружает все данные AI РОПа из Supabase в in-memory cache. Вызывается
 * один раз при маунте страницы /sales-ai (или при смене активного проекта).
 *
 * - settings: одна строка на проект; если нет — сидим дефолтами (без записи в БД).
 * - scripts / content-ideas: если в БД пусто и в LS пусто → сидим дефолтами и
 *   пушим в БД, чтобы команда увидела стартовый набор.
 * - trainer-sessions: личные сессии пользователя в рамках проекта.
 */
export async function hydrateAiRopStorage(projectId: string | null, userId: string | null): Promise<void> {
  const seq = ++hydrateSeq;
  // Сбрасываем кэш и LS-зеркало при смене проекта ИЛИ юзера (включая выход в
  // null = logout). Иначе после logout/login следующий юзер на пол-секунды видит
  // настройки/скрипты/сессии предыдущего, пока идёт гидратация.
  const projectChanged = currentProjectId !== projectId;
  const userChanged = currentUserId !== userId;
  const shouldReset = projectChanged || userChanged;
  currentProjectId = projectId;
  currentUserId = userId;
  if (shouldReset) {
    memCache.delete("settings");
    memCache.delete("scripts");
    memCache.delete("content-ideas");
    memCache.delete("trainer-sessions");
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(PREFIX + "settings");
        window.localStorage.removeItem(PREFIX + "scripts");
        window.localStorage.removeItem(PREFIX + "content-ideas");
        window.localStorage.removeItem(PREFIX + "trainer-sessions");
      } catch {
        /* ignore */
      }
    }
    emit("settings");
    emit("scripts");
    emit("content-ideas");
    emit("trainer-sessions");
  }
  // shouldReset защищает от устаревших данных. Реальная подгрузка из БД ниже —
  // только если есть и проект, и юзер (без auth не пройдёт RLS).
  if (!projectId) return;
  // seq используется внутри хелперов ниже через isCurrentHydration() —
  // чтобы поздний ответ медленной гидратации не затёр результаты новой.
  void seq;

  // 1. Settings
  try {
    const { data, error } = await supabase
      .from("ai_rop_settings")
      .select("*")
      .eq("project_id", projectId)
      .maybeSingle();
    if (error) throw error;
    if (!isCurrentHydration(seq, projectId, userId)) return;
    if (data) {
      writeLocal("settings", rowToSettings(data as Record<string, unknown>));
    } else {
      // нет настроек в БД — оставляем то, что в LS (или дефолт)
      const fallback = getRopSettings();
      writeLocal("settings", fallback);
    }
    emit("settings");
  } catch (e) {
    console.warn("[aiRop] hydrate settings failed:", e);
  }

  // 2. Scripts
  try {
    const { data, error } = await supabase
      .from("ai_rop_scripts")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    if (!isCurrentHydration(seq, projectId, userId)) return;
    const rows = (data ?? []) as Record<string, unknown>[];
    if (rows.length) {
      writeLocal("scripts", rows.map(rowToScript));
      emit("scripts");
    } else {
      // Сидим дефолтами с валидными UUID
      const seeded = DEFAULT_SCRIPTS.map((s) => ({ ...s, id: ensureUuid(s.id) }));
      writeLocal("scripts", seeded);
      emit("scripts");
      void syncCollection({
        table: "ai_rop_scripts",
        prev: [],
        next: seeded,
        toRow: (s) => scriptToRow(s, projectId, userId),
      });
    }
  } catch (e) {
    console.warn("[aiRop] hydrate scripts failed:", e);
  }

  // 3. Content ideas
  try {
    const { data, error } = await supabase
      .from("ai_rop_content_ideas")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    if (!isCurrentHydration(seq, projectId, userId)) return;
    const rows = (data ?? []) as Record<string, unknown>[];
    if (rows.length) {
      writeLocal("content-ideas", rows.map(rowToIdea));
      emit("content-ideas");
    } else {
      const seeded = DEFAULT_CONTENT_IDEAS.map((i) => ({ ...i, id: ensureUuid(i.id) }));
      writeLocal("content-ideas", seeded);
      emit("content-ideas");
      void syncCollection({
        table: "ai_rop_content_ideas",
        prev: [],
        next: seeded,
        toRow: (i) => ideaToRow(i, projectId, userId),
      });
    }
  } catch (e) {
    console.warn("[aiRop] hydrate content-ideas failed:", e);
  }

  // 4. Trainer sessions (only current user)
  if (userId) {
    try {
      const { data, error } = await supabase
        .from("ai_rop_trainer_sessions")
        .select("*")
        .eq("project_id", projectId)
        .eq("user_id", userId)
        .order("started_at", { ascending: false });
      if (error) throw error;
      if (!isCurrentHydration(seq, projectId, userId)) return;
      const rows = (data ?? []) as Record<string, unknown>[];
      writeLocal("trainer-sessions", rows.map(rowToTrainerSession));
      emit("trainer-sessions");
    } catch (e) {
      console.warn("[aiRop] hydrate trainer-sessions failed:", e);
    }
  }
}

/** Текущий проект, в контексте которого идут сохранения. */
export function getAiRopProjectId(): string | null {
  return currentProjectId;
}
