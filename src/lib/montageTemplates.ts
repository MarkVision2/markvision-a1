/**
 * Стили монтажа для очереди «Монтаж съёмки».
 * Выбранный шаблон уходит в brief как [STYLE=<id>] и управляет
 * плотностью вставок / титрами / cover-сценами на воркере.
 */
export type MontageStyleId = "expert-explainer" | "dense-motion" | "classic";

export interface MontageStyleTemplate {
  id: MontageStyleId;
  title: string;
  subtitle: string;
  description: string;
  /** Превью в /public */
  thumb: string;
  /** Remotion captionStyle */
  captionStyle: "pill" | "left-stack" | "mixed" | "karaoke-box";
  /** Целевая плотность: 1 insert на N секунд */
  insertEverySec: number;
  /** Доля cover-сцен (0..1) */
  coverRatio: number;
  /** Акцент каждые N секунд */
  accentEverySec: number;
  accentColor: string;
  /** Титры остаются видимы на cover-сценах */
  keepCaptionsOnCover?: boolean;
  /** Без punch/ken-burns зума (по умолчанию true) */
  disableZoom?: boolean;
  /** Короткие правила для montage-ai */
  aiRules: string;
  recommended?: boolean;
}

export const MONTAGE_STYLE_TEMPLATES: MontageStyleTemplate[] = [
  {
    id: "expert-explainer",
    title: "Кейс-эксперт",
    subtitle: "Каждая мысль = сцена",
    description:
      "Мысль → визуал (%, схема, раньше/сейчас, чеклист). Cover-сцены с графикой по центру, караоке всегда снизу.",
    thumb: "/montage-templates/expert-explainer.jpg",
    captionStyle: "karaoke-box",
    insertEverySec: 3.5,
    coverRatio: 0.6,
    accentEverySec: 3.5,
    accentColor: "#F5E14B",
    keepCaptionsOnCover: true,
    disableZoom: true,
    recommended: true,
    aiRules: [
      "СТИЛЬ «Кейс-эксперт» — ГЛАВНОЕ ПРАВИЛО:",
      "Каждая мысль = отдельная ВИЗУАЛЬНАЯ СЦЕНА, которая иллюстрирует ИМЕННО сказанное в этом окне слов.",
      "ЗАПРЕЩЕНО: оффтоп-оверлеи, выдуманные цифры/тезисы, декор не по смыслу фразы, зум/приближение лица.",
      "",
      "GROUNDING (обязательно):",
      "- Перед выбором template прочитай слова anchorWord..endWord.",
      "- data.text / data.label / data.lines / data.items / data.value — только из этой фразы (дословно или минимальная нормализация).",
      "- Цифры/% в data обязаны совпадать с речью. Нет цифры в речи → не ставь number-counter/metric-callout.",
      "- note = краткая цитата фразы (spokenText).",
      "",
      "ДВА РЕЖИМА:",
      "A) cover:true (~60%): тёмный фон, спикер PiP, ЦЕНТР = мысль из фразы, тег контекста слева-сверху, титры снизу.",
      "B) cover:false (~40%): спикер полный кадр + big-statement/metric из той же фразы сверху.",
      "",
      "МАППИНГ (только если фраза реально про это):",
      "- боль/% → metric-callout + checklist-reveal",
      "- успех → gauge + checklist-reveal",
      "- раньше/сейчас → fake-dashboard-bars / vs-compare",
      "- процесс → timeline-steps / arrow-flow",
      "- тезис → big-statement #EF4444",
      "- выручка/деньги → number-counter",
      "",
      "ТИТРЫ karaoke-box. Плотность 1 сцена / 3–5 сек. Без зума.",
    ].join("\n"),
  },
  {
    id: "dense-motion",
    title: "Плотный motion",
    subtitle: "Анимации сверху",
    description:
      "Спикер почти всегда в кадре, в верхней трети — плотные motion-оверлеи по смыслу фраз.",
    thumb: "/montage-templates/dense-motion.jpg",
    captionStyle: "pill",
    insertEverySec: 4.5,
    coverRatio: 0.15,
    accentEverySec: 5,
    accentColor: "#FF7A18",
    keepCaptionsOnCover: false,
    disableZoom: true,
    aiRules: [
      "СТИЛЬ «Плотный motion»:",
      "- layout:third, cover:false ≥85%, оверлей СТРОГО по словам окна (не оффтоп).",
      "- data из речи. Плотность ~1 на 4–6 сек. Без зума.",
    ].join("\n"),
  },
  {
    id: "classic",
    title: "Классика",
    subtitle: "Реже и спокойнее",
    description:
      "Умеренные акценты и вставки: больше «говорящей головы», меньше графики.",
    thumb: "/montage-templates/classic.jpg",
    captionStyle: "pill",
    insertEverySec: 10,
    coverRatio: 0.2,
    accentEverySec: 10,
    accentColor: "#FF7A18",
    keepCaptionsOnCover: false,
    disableZoom: true,
    aiRules: [
      "СТИЛЬ «Классика»:",
      "- Вставки реже (~1 на 10–12 сек), только по смыслу фразы, без зума.",
      "- Акценты только на цифрах и панчах из речи.",
    ].join("\n"),
  },
];

export function getMontageStyle(id: string | null | undefined): MontageStyleTemplate {
  return (
    MONTAGE_STYLE_TEMPLATES.find((t) => t.id === id) ??
    MONTAGE_STYLE_TEMPLATES.find((t) => t.recommended) ??
    MONTAGE_STYLE_TEMPLATES[0]
  );
}

export function parseMontageStyleFromBrief(brief: string | null | undefined): MontageStyleId {
  const m = String(brief || "").match(/\[STYLE=(expert-explainer|dense-motion|classic)\]/i);
  if (m) return m[1].toLowerCase() as MontageStyleId;
  return "expert-explainer";
}
