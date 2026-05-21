/**
 * Локальное хранилище конфигурации и пользовательского контента AI РОПа.
 * До того как Lovable сделает миграции под Supabase, всё живёт в localStorage
 * с ключом `mv:ai-rop:<key>`. После миграции достаточно подменить здесь
 * реализацию `get`/`set` на supabase-вызовы — публичный API не меняется.
 */

const PREFIX = "mv:ai-rop:";

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* quota */
  }
}

// ─── Настройки РОПа ─────────────────────────────────────────────────────────

export type RopSettings = {
  /** Системный промпт — описывает роль ИИ-РОПа, его задачи, стиль. */
  systemPrompt: string;
  /** Что именно отслеживать (чек-лист). */
  watchList: string[];
  /** SLA-пороги для алертов. */
  sla: {
    firstResponseMin: number;     // норма ответа на лид
    callbackHours: number;        // время на перезвон
    chatIdleHours: number;        // молчание в чате
  };
  /** KPI-цели по менеджерам. */
  kpi: {
    minConversionPct: number;
    minDialPct: number;
    maxRejectPct: number;
  };
  /** Тон голоса для всех ответов и оценок. */
  tone: "strict" | "neutral" | "supportive";
  /** Автодействия: что РОП делает сам. */
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

export function getRopSettings(): RopSettings {
  return { ...DEFAULT_ROP_SETTINGS, ...read<Partial<RopSettings>>("settings", {}) };
}

export function saveRopSettings(s: RopSettings): void {
  write("settings", s);
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
  /** Источник: автогенерация по реальным разговорам или ручной ввод. */
  source: "manual" | "ai";
  /** Сколько раз скрипт реально использовался менеджерами. */
  usageCount: number;
  /** Средняя оценка применения (0-100), считается ИИ-РОПом. */
  effectiveness: number | null;
  createdAt: string;
  updatedAt: string;
};

export function getScripts(): RopScript[] {
  return read<RopScript[]>("scripts", DEFAULT_SCRIPTS);
}

export function saveScripts(list: RopScript[]): void {
  write("scripts", list);
}

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

// ─── Контент-план ───────────────────────────────────────────────────────────

export type ContentIdea = {
  id: string;
  title: string;
  format: "reels" | "post" | "story" | "article" | "video";
  hook: string;             // зацепляющая фраза
  body: string;             // тело/тезисы
  basedOn: string;          // на основе чего (фрагмент чата/звонка)
  audience: string;         // целевая аудитория
  cta: string;              // призыв к действию
  priority: "high" | "mid" | "low";
  status: "idea" | "in_progress" | "published" | "rejected";
  createdAt: string;
};

export function getContentIdeas(): ContentIdea[] {
  return read<ContentIdea[]>("content-ideas", DEFAULT_CONTENT_IDEAS);
}

export function saveContentIdeas(list: ContentIdea[]): void {
  write("content-ideas", list);
}

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

// ─── Тренажёр: сценарии ─────────────────────────────────────────────────────

export type TrainerScenario = {
  id: string;
  role: "patient" | "lead";
  title: string;
  difficulty: "easy" | "medium" | "hard";
  /** Контекст для ИИ: кого он играет, какие возражения у пациента, какова цель администратора. */
  context: string;
  /** Цели администратора — по ним ИИ оценивает разговор. */
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
  score: number | null;          // 0-100, проставляется по завершении
  feedback: string | null;        // итоговый разбор ИИ
  startedAt: string;
  finishedAt: string | null;
};

export function getTrainerSessions(): TrainerSession[] {
  return read<TrainerSession[]>("trainer-sessions", []);
}

export function saveTrainerSessions(list: TrainerSession[]): void {
  write("trainer-sessions", list);
}

// ─── Утилиты ────────────────────────────────────────────────────────────────

export function newId(prefix = "id"): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;
}
