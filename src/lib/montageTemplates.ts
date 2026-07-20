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
    recommended: true,
    aiRules: [
      "СТИЛЬ «Кейс-эксперт» — ГЛАВНОЕ ПРАВИЛО:",
      "Каждая мысль = отдельная ВИЗУАЛЬНАЯ СЦЕНА, которая иллюстрирует сказанное (не декоративный оверлей на лице).",
      "",
      "ДВА РЕЖИМА:",
      "A) cover:true (~60%): тёмный фон, спикер в PiP, по центру мысль (цифра/схема/сравнение/чеклист/flowchart/карточка), слева-сверху цветной тег контекста, титры снизу остаются.",
      "B) cover:false (~40%): спикер полный кадр + крупный заголовок/метрика (big-statement красным на тезис; metric-callout жёлтым на цифру).",
      "",
      "МАППИНГ:",
      "- боль → number-counter/metric-callout + checklist-reveal (красные теги)",
      "- успех «после нас» → gauge + checklist-reveal (зелёный ✓)",
      "- раньше/сейчас → fake-dashboard-bars / vs-compare",
      "- процесс → timeline-steps / arrow-flow",
      "- углы креативов → checklist-reveal / pill-row",
      "- цель/тезис → big-statement accent #EF4444",
      "- выручка → number-counter крупно",
      "",
      "ТИТРЫ karaoke-box (#F5E14B на текущем слове). Плотность 1 сцена / 3–5 сек. Чередуй cover↔speaker.",
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
    aiRules: [
      "СТИЛЬ «Плотный motion»:",
      "- layout:third, cover:false ≥85%, анимации сверху на каждую мысль.",
      "- Плотность ~1 на 4–6 сек. cover:true только 1–2 ключевых момента.",
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
    aiRules: [
      "СТИЛЬ «Классика»:",
      "- Вставки реже (~1 на 10–12 сек), спокойный темп.",
      "- Акценты только на цифрах и панчах.",
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
