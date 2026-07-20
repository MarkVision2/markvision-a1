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
  /** Короткие правила для montage-ai */
  aiRules: string;
  recommended?: boolean;
}

export const MONTAGE_STYLE_TEMPLATES: MontageStyleTemplate[] = [
  {
    id: "expert-explainer",
    title: "Кейс-эксперт",
    subtitle: "Как в референсе",
    description:
      "Жёлтые метрики сверху, караоке-титры, частые cover-сцены с карточками/схемами/графиками. Каждая мысль — визуал.",
    thumb: "/montage-templates/expert-explainer.jpg",
    captionStyle: "karaoke-box",
    insertEverySec: 4,
    coverRatio: 0.45,
    accentEverySec: 4,
    accentColor: "#F5E14B",
    recommended: true,
    aiRules: [
      "СТИЛЬ «Кейс-эксперт» (референс expert-explainer):",
      "- Титры: karaoke-box — тёмная плашка снизу, текущее слово жёлтым (#F5E14B) на чёрном.",
      "- Поверх спикера (cover:false, layout:third): жёлтый бейдж метрики + чёрная pill-подпись (metric-callout / number-counter / kinetic-type).",
      "- ~45% мыслей — cover:true на тёмном фоне: карточка, схема arrow-flow, график fake-dashboard-bars, чеклист проблем, phone-mockup/квиз.",
      "- Плотность ~1 вставка на 3–5 сек, без дыр >5 сек. Чередуй full-speaker и cover.",
      "- Акцент-цвет #F5E14B; теги контекста (год/клиент) — pill-row или notification-toast.",
      "- Каждая мысль/цифра/вопрос сопровождается визуалом (не только титры).",
    ].join("\n"),
  },
  {
    id: "dense-motion",
    title: "Плотный motion",
    subtitle: "Анимации сверху",
    description:
      "Спикер почти всегда в кадре, в верхней трети — плотные motion-оверлеи по смыслу фраз.",
    thumb: "/montage-templates/expert-explainer-cover.jpg",
    captionStyle: "pill",
    insertEverySec: 4.5,
    coverRatio: 0.15,
    accentEverySec: 5,
    accentColor: "#FF7A18",
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
    thumb: "/montage-templates/expert-explainer-chart.jpg",
    captionStyle: "pill",
    insertEverySec: 10,
    coverRatio: 0.2,
    accentEverySec: 10,
    accentColor: "#FF7A18",
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
