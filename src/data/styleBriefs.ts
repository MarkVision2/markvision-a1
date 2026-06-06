/**
 * Технические брифы для каждого формата креатива / нейрофотосессии.
 * При выборе формата на шаге 3 собирается подробное ТЗ для n8n.
 */

import type { CreativeFormatId } from "@/data/creativeFormats";

export type NeuroStyleId =
  | "neuro_business"
  | "neuro_lifestyle"
  | "neuro_studio"
  | "neuro_outdoor"
  | "neuro_fashion"
  | "neuro_sport"
  | "neuro_casual";

export type StyleId = CreativeFormatId | "auto" | NeuroStyleId;

export interface StyleBrief {
  id: StyleId;
  label: string;
  composition: string;
  lighting: string;
  cameraAngle: string;
  subject: string;
  mood: string;
  typography: string;
  colorTreatment: string;
  props: string;
  references: string[];
  promptTemplate: string;
  avoid: string[];
}

export const STYLE_BRIEFS: Record<StyleId, StyleBrief> = {
  auto: {
    id: "auto",
    label: "Авто",
    composition: "ИИ выбирает оптимальную композицию под ТЗ и цель",
    lighting: "адаптивно под нишу",
    cameraAngle: "адаптивно",
    subject: "определяется по ТЗ",
    mood: "соответствует продукту и goal",
    typography: "минимум или акцент по формату",
    colorTreatment: "адаптивно под бренд",
    props: "по контексту",
    references: ["best practice performance-креативов Meta / TikTok"],
    promptTemplate:
      "Подбери оптимальный визуальный формат рекламного креатива под задачу. " +
      "Учти цель (трафик/конверсии/лиды), нишу и тон. " +
      "Best practices: чёткий фокус, читаемый оффер, эмоциональный крючок в первые 0.5 сек. " +
      "Контекст: {{userBrief}}",
    avoid: ["шум", "перегруз элементами", "плохая читаемость", "стоковый глянец"],
  },

  testimonial: {
    id: "testimonial",
    label: "Отзыв",
    composition:
      "карточка отзыва: лицо/аватар слева или сверху, цитата в speech-bubble, звёзды рейтинга, имя клиента",
    lighting: "мягкий натуральный или студийный портретный",
    cameraAngle: "портрет по плечи, дружелюбный взгляд",
    subject: "реальный человек + текст отзыва от первого лица",
    mood: "доверие, искренность, social proof",
    typography: "цитата 2–4 строки, имя + роль мелко, 5 звёзд или «★★★★★»",
    colorTreatment: "чистый фон, тёплые тона лица, акцент бренда на bubble",
    props: "speech-bubble, звёзды, опционально скрин отзыва",
    references: ["Instagram carousel reviews", "Trustpilot cards", "карусели «нам доверяют»"],
    promptTemplate:
      "Создай рекламный креатив в формате ОТЗЫВА (testimonial / social proof). " +
      "Портрет реального человека (не глянцевая модель), цитата от первого лица в speech-bubble. " +
      "Рейтинг 5 звёзд, имя и короткая роль клиента. " +
      "Композиция как карточка отзыва для Instagram/Meta ads. " +
      "Эмоция: доверие, искренность, видимый результат от продукта. " +
      "Контекст: {{userBrief}}",
    avoid: ["агрессивный продающий тон", "мелкий нечитаемый текст", "фейковый сток", "перегруз бейджами"],
  },

  ugc: {
    id: "ugc",
    label: "UGC",
    composition: "вертикальный кадр 9:16, человек по плечи/пояс, продукт в руках, взгляд в камеру",
    lighting: "естественный мягкий свет от окна, без студийных вспышек",
    cameraAngle: "селфи-ракурс с руки или фронтально на телефон",
    subject: "реальный человек держит/использует продукт, нативная рекомендация",
    mood: "искренне, по-домашнему, как личная рекомендация подруге",
    typography: "минимум — короткий subtitle снизу, опционально субтитры",
    colorTreatment: "натуральные тона, лёгкая тёплая коррекция, без HDR",
    props: "бытовой контекст: кухня, ванная, диван, машина",
    references: ["TikTok UGC ads", "Instagram Reels reviews", "блогерские распаковки"],
    promptTemplate:
      "Создай нативный UGC-креатив: вертикальный кадр, человек снимает себя на телефон. " +
      "По плечи или по пояс, держит/показывает продукт, смотрит в камеру. " +
      "Естественный свет, бытовая обстановка. Без рекламного глянца и студийной постановки. " +
      "Эмоция: искренняя личная рекомендация. Минимум текста на кадре. " +
      "Контекст продукта: {{userBrief}}",
    avoid: ["студийный свет", "профессиональные модели", "глянец", "плоский белый фон"],
  },

  before_after: {
    id: "before_after",
    label: "До / После",
    composition:
      "современный split-screen 50/50: вертикальная или горизонтальная граница, стрелка/прогресс между половинами",
    lighting: "одинаковое мягкое в обеих половинах",
    cameraAngle: "идентичный ракурс на «до» и «после»",
    subject: "один объект/человек в двух состояниях — проблема vs результат",
    mood: "контраст трансформации, наглядный прогресс",
    typography: "крупные минималистичные «ДО» / «ПОСЛЕ» или «БЫЛО» / «СТАЛО», sans-serif",
    colorTreatment: "«до» — десатурация, приглушённо; «после» — ярко, насыщенно",
    props: "стрелка, тонкая разделительная линия, опционально % улучшения",
    references: ["современные beauty/fitness ads", "ремонт до/после", "косметология transformation"],
    promptTemplate:
      "Создай современный креатив «До / После» (before-after transformation). " +
      "Split-screen 50/50 с чёткой границей. Идентичный ракурс в обеих половинах. " +
      "Левая/верхняя — «ДО»: проблема, приглушённые десатурированные цвета. " +
      "Правая/нижняя — «ПОСЛЕ»: результат, яркие насыщенные цвета. " +
      "Минималистичные подписи ДО/ПОСЛЕ, опционально стрелка прогресса. " +
      "Контекст трансформации: {{userBrief}}",
    avoid: ["разные ракурсы", "разные объекты", "много мелкого текста", "устаревший коллажный стиль"],
  },

  product_focus: {
    id: "product_focus",
    label: "Продукт",
    composition: "продукт в центре или по правилу третей, лайфстайл-контекст без людей",
    lighting: "естественный свет от окна или мягкий рассеянный",
    cameraAngle: "flat-lay сверху или 45°, иногда макро детали",
    subject: "только продукт — герой кадра",
    mood: "уютно, премиально, аутентично",
    typography: "опционально — название или короткий бенефит",
    colorTreatment: "натуральные тёплые тона, чистая цветопередача упаковки",
    props: "деревянный стол, лен, растение, кофе — по нише",
    references: ["Instagram product still-life", "beauty flat-lay", "e-commerce lifestyle"],
    promptTemplate:
      "Создай креатив с фокусом на ПРОДУКТЕ без людей в кадре. " +
      "Продукт крупно, flat-lay или ракурс 45°. Естественный свет, лайфстайл-обстановка. " +
      "Чистая цветопередача упаковки. Опционально короткая подпись с бенефитом. " +
      "Контекст продукта: {{userBrief}}",
    avoid: ["люди в кадре", "студийный белый фон без контекста", "пластиковый глянец"],
  },

  bold_offer: {
    id: "bold_offer",
    label: "Оффер",
    composition: "текст-оффер 70–90% кадра, продукт — мелкий инсерт или отсутствует",
    lighting: "плоская графика, без 3D-света",
    cameraAngle: "фронтально, без перспективы",
    subject: "цифра, скидка, провокация, короткий оффер",
    mood: "смело, прямо, сразу к сути",
    typography: "огромный bold sans-serif, иерархия: главное слово максимально крупно",
    colorTreatment: "1–2 акцентных цвета на однотонном фоне",
    props: "стрелка, подчёркивание, бейдж «-30%»",
    references: ["performance ads с крупным текстом", "Stripe/Linear плакаты"],
    promptTemplate:
      "Создай графический креатив с ТЕКСТОВЫМ ОФФЕРОМ как главным героем. " +
      "Огромный жирный sans-serif: скидка, цифра результата или короткий провокационный оффер. " +
      "Плоская подача, 1–2 акцентных цвета, однотонный фон. " +
      "Опционально мелкий продукт-инсерт. Максимальная читаемость с первого взгляда. " +
      "Контекст оффера: {{userBrief}}",
    avoid: ["фотореализм как главный элемент", "мелкий текст", "больше 3 цветов"],
  },

  expert: {
    id: "expert",
    label: "Эксперт",
    composition: "портрет по плечи, лицо в верхней трети, прямой контакт глазами",
    lighting: "мягкий ключевой на лицо, нейтральный размытый фон",
    cameraAngle: "фронтально на уровне глаз",
    subject: "эксперт/спикер говорит в камеру",
    mood: "экспертно, доверительно, авторитетно",
    typography: "субтитры или подпись с именем/должностью внизу",
    colorTreatment: "натуральные тона лица, приглушённый фон",
    props: "наушники, микрофон, офис/книжная полка размыто",
    references: ["YouTube эксперт", "подкасты", "корпоративные интервью"],
    promptTemplate:
      "Создай креатив «Эксперт говорит в камеру» (talking head). " +
      "Кадр по плечи, лицо в верхней трети, прямой взгляд. Мягкий свет, нейтральный фон. " +
      "Опционально наушники/микрофон. Подпись с именем и ролью. " +
      "Эмоция: уверенность, доверие, экспертность. " +
      "Контекст и тема: {{userBrief}}",
    avoid: ["полный рост", "профиль", "крикливая типографика", "яркий цветной фон"],
  },

  neuro_business: {
    id: "neuro_business",
    label: "Деловой портрет",
    composition: "портрет по плечи или по пояс, человек по центру, фон нейтральный",
    lighting: "мягкий студийный свет, ключевой источник 45°",
    cameraAngle: "фронтально или лёгкое 3/4 на уровне глаз",
    subject: "человек в деловой одежде, уверенная поза, открытый взгляд",
    mood: "профессионально, надёжно, экспертно",
    typography: "—",
    colorTreatment: "натуральные тона, чистая цветокоррекция",
    props: "костюм, рубашка, блейзер; нейтральный серый/синий/градиентный фон",
    references: ["LinkedIn headshots", "корпоративные сайты"],
    promptTemplate:
      "Создай деловой портрет (нейрофотосессия). Кадр по плечи, деловая одежда, мягкий студийный свет, нейтральный фон. " +
      "Контекст: {{userBrief}}",
    avoid: ["небрежная одежда", "яркий фон", "избыточная ретушь"],
  },

  neuro_lifestyle: {
    id: "neuro_lifestyle",
    label: "Лайфстайл",
    composition: "человек в естественной обстановке, композиция с воздухом",
    lighting: "естественный — окно, кафе, улица",
    cameraAngle: "с уровня глаз, лёгкое 3/4",
    subject: "человек в расслабленной позе",
    mood: "тепло, расслабленно, по-настоящему",
    typography: "—",
    colorTreatment: "тёплые натуральные тона",
    props: "кофе, книга, ноутбук, город",
    references: ["lifestyle-фотография", "Instagram бренды"],
    promptTemplate:
      "Создай лайфстайл-портрет (нейрофотосессия). Естественная обстановка, мягкий свет, расслабленная поза. " +
      "Контекст: {{userBrief}}",
    avoid: ["студийный свет", "официальная поза"],
  },

  neuro_studio: {
    id: "neuro_studio",
    label: "Студия",
    composition: "портрет по центру, чистый цветной фон",
    lighting: "трёхточечная схема",
    cameraAngle: "фронтально или 3/4",
    subject: "человек, акцент на лице",
    mood: "стильно, выразительно",
    typography: "—",
    colorTreatment: "точная цветопередача, насыщенный фон",
    props: "цветной фон, минимум аксессуаров",
    references: ["журнальные портреты"],
    promptTemplate:
      "Создай студийный портрет (нейрофотосессия). Цветной фон, постановочный свет, журнальная подача. " +
      "Контекст: {{userBrief}}",
    avoid: ["бытовой фон", "естественный свет окна"],
  },

  neuro_outdoor: {
    id: "neuro_outdoor",
    label: "На улице",
    composition: "человек в природной/городской среде",
    lighting: "золотой час",
    cameraAngle: "разнообразный",
    subject: "человек в естественной позе",
    mood: "свободно, вдохновенно",
    typography: "—",
    colorTreatment: "тёплые золотистые тона",
    props: "природа, архитектура",
    references: ["outdoor lifestyle"],
    promptTemplate:
      "Создай портрет на улице (нейрофотосессия). Золотой час, естественная локация. " +
      "Контекст: {{userBrief}}",
    avoid: ["студийный свет", "однотонный фон"],
  },

  neuro_fashion: {
    id: "neuro_fashion",
    label: "Фэшн",
    composition: "стильная поза, акцент на образе",
    lighting: "контрастное драматичное или модное мягкое",
    cameraAngle: "экспрессивный",
    subject: "человек как модель",
    mood: "стильно, дерзко, модно",
    typography: "—",
    colorTreatment: "модная цветокоррекция",
    props: "модные луки, аксессуары",
    references: ["Vogue", "fashion-кампании"],
    promptTemplate:
      "Создай фэшн-портрет (нейрофотосессия). Модный лук, выразительная поза, журнальная эстетика. " +
      "Контекст: {{userBrief}}",
    avoid: ["скучные позы", "повседневная одежда"],
  },

  neuro_sport: {
    id: "neuro_sport",
    label: "Спорт",
    composition: "динамичная поза, движение",
    lighting: "контрастное, back-light",
    cameraAngle: "снизу, freeze-кадр",
    subject: "человек в спортивной одежде",
    mood: "энергично, мощно",
    typography: "—",
    colorTreatment: "контрастная, спорт-бренды",
    props: "спортивная форма, инвентарь",
    references: ["Nike ads", "fitness"],
    promptTemplate:
      "Создай спортивный портрет (нейрофотосессия). Активная поза, контрастный свет. " +
      "Контекст: {{userBrief}}",
    avoid: ["статичные позы", "повседневная одежда"],
  },

  neuro_casual: {
    id: "neuro_casual",
    label: "Casual",
    composition: "повседневный портрет по плечи",
    lighting: "дневной мягкий",
    cameraAngle: "фронтально или 3/4",
    subject: "человек в повседневной одежде",
    mood: "дружелюбно, доступно",
    typography: "—",
    colorTreatment: "натуральные мягкие тона",
    props: "футболка, свитер, джинсы",
    references: ["аватарки", "team-фото"],
    promptTemplate:
      "Создай casual-портрет (нейрофотосессия). Повседневная одежда, мягкий дневной свет. " +
      "Контекст: {{userBrief}}",
    avoid: ["деловой костюм", "студийная драма"],
  },
};

export interface BuildBriefInput {
  styleId: StyleId;
  userBrief: string;
  format?: { aspect?: string | null; lang?: string | null; variants?: number | null };
  color?: { id?: string | null; label?: string | null; swatch?: string | null } | null;
  angles?: { id: string; label: string; description: string }[];
  autoCandidates?: { id: string; label: string; description: string }[] | null;
}

export interface BuiltBrief {
  structured: StyleBrief;
  technicalBrief: string;
  avoid: string[];
}

export function buildStyleBrief(input: BuildBriefInput): BuiltBrief {
  const base = STYLE_BRIEFS[input.styleId] ?? STYLE_BRIEFS.auto;
  const userBrief =
    input.userBrief?.trim() || "клиент не оставил описание — используй best-practice по нише";

  const formatLines: string[] = [];
  if (input.format?.aspect) formatLines.push(`Соотношение сторон: ${input.format.aspect}.`);
  if (input.format?.lang) {
    const langMap: Record<string, string> = { ru: "русский", kz: "казахский", en: "английский" };
    const lang = langMap[input.format.lang] ?? input.format.lang;
    formatLines.push(`Язык текста на креативе: ${lang}.`);
  }
  if (input.format?.variants) formatLines.push(`Количество вариантов: ${input.format.variants}.`);

  if (input.color && input.color.id && input.color.id !== "auto" && input.color.label) {
    formatLines.push(
      `Основной фирменный цвет: ${input.color.label}${input.color.swatch && input.color.swatch !== "custom" && input.color.swatch !== "auto" ? ` (${input.color.swatch})` : ""}.`,
    );
  }

  if (input.angles && input.angles.length) {
    formatLines.push(
      `Ракурсы съёмки: ${input.angles.map((a) => `${a.label} (${a.description})`).join(", ")}.`,
    );
  }

  if (input.styleId === "auto" && input.autoCandidates && input.autoCandidates.length) {
    formatLines.push(
      `Возможные форматы: ${input.autoCandidates.map((c) => c.label).join(", ")}. Выбери оптимальный.`,
    );
  }

  const technicalBrief = [
    base.promptTemplate.replace("{{userBrief}}", userBrief),
    "",
    "Технические параметры:",
    ...formatLines.map((l) => `- ${l}`),
    "",
    "Чего избегать: " + base.avoid.join("; ") + ".",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    structured: base,
    technicalBrief,
    avoid: base.avoid,
  };
}
