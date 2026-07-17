// Каталог голосов ElevenLabs, доступных по API на любом ключе (premade library
// из GET /v1/voices). Все работают с моделью eleven_multilingual_v2 — то есть
// говорят по-русски. voice_id стабильны у ElevenLabs. Воркер Reels Factory
// подставляет ключ из секретов и рендерит озвучку выбранным voice_id
// (config.elevenVoice). Если поле пустое — воркер берёт голос по умолчанию.
//
// Подбор — под наш бренд (динамично-энергичная подача, маркетинг/эксперт):
// вперёд вынесены уверенные, «продающие» голоса.

export interface ElevenVoice {
  id: string; // voice_id ElevenLabs
  name: string; // как в ElevenLabs
  label: string; // подпись в UI (рус.)
  gender: "male" | "female";
  vibe: string; // короткая характеристика тембра/подачи
  cloned?: boolean; // клон твоего голоса (аккаунтный) — не premade
}

export const ELEVEN_VOICES: ElevenVoice[] = [
  // — Твои голоса (клоны в аккаунте) — лучший выбор для русской озвучки —
  { id: "cVZnQMhhdT61ndLV3YEK", name: "Юрий Катаева", label: "Юрий — твой голос (клон)", gender: "male", vibe: "твой клонированный голос, русский — родная подача бренда", cloned: true },
  { id: "B2rcpdU3qbTVXFEoJRhT", name: "Юрий Катаева", label: "Юрий — твой голос (клон 2)", gender: "male", vibe: "второй вариант твоего клона — сравни, какой звучит лучше", cloned: true },

  // — Мужские: уверенные, для оффера/эксперта —
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel", label: "Daniel — уверенный, ведущий", gender: "male", vibe: "глубокий, авторитетный — под экспертный/новостной тон" },
  { id: "nPczCjzI2devNBz1zQrb", name: "Brian", label: "Brian — глубокий, солидный", gender: "male", vibe: "низкий и спокойный — доверие, премиум" },
  { id: "TX3LPaxmHKxFdv7VOQHJ", name: "Liam", label: "Liam — энергичный, молодой", gender: "male", vibe: "драйвовый — под динамичный хайп/оффер" },
  { id: "pqHfZKP75CvOlQylNhV4", name: "Bill", label: "Bill — тёплый, надёжный", gender: "male", vibe: "дружелюбный рассказчик — сторителлинг" },
  { id: "pNInz6obpgDQGcFmaJgB", name: "Adam", label: "Adam — насыщенный, классика", gender: "male", vibe: "универсальный ровный баритон" },
  { id: "cjVigY5qzO86Huf0OWal", name: "Eric", label: "Eric — деловой, чёткий", gender: "male", vibe: "ровный корпоративный тон" },

  // — Женские: тёплые/уверенные —
  { id: "XB0fDUnXU5powFXDhCwa", name: "Charlotte", label: "Charlotte — тёплая, обаятельная", gender: "female", vibe: "мягкая, вовлекающая подача" },
  { id: "Xb7hH8MSUJpSbSDYk0k2", name: "Alice", label: "Alice — уверенная, чёткая", gender: "female", vibe: "собранная, деловая — эксперт" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", label: "Sarah — мягкая, новостная", gender: "female", vibe: "спокойная, ровная дикция" },
  { id: "XrExE9yKIg1WjnnlVkGX", name: "Matilda", label: "Matilda — тёплая, дружелюбная", gender: "female", vibe: "лёгкая, живая подача" },
];

export const DEFAULT_ELEVEN_VOICE = ELEVEN_VOICES[0].id; // Юрий (твой клон)

export function elevenVoiceById(id: string | undefined): ElevenVoice | undefined {
  if (!id) return undefined;
  return ELEVEN_VOICES.find((v) => v.id === id);
}
