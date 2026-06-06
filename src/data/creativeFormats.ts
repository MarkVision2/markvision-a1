import type { LucideIcon } from "lucide-react";
import {
  Wand2,
  Star,
  Smartphone,
  GitCompareArrows,
  Package,
  Type,
  Mic,
} from "lucide-react";

/** Канонические ID форматов креатива (не нейрофотосессия). */
export type CreativeFormatId =
  | "auto"
  | "testimonial"
  | "ugc"
  | "before_after"
  | "product_focus"
  | "bold_offer"
  | "expert";

export type CreativeFormatCategory = "recommended" | "social" | "product" | "text";

export interface CreativeFormat {
  id: CreativeFormatId;
  label: string;
  tag: string;
  subtitle: string;
  description: string;
  /** Что реально получит пользователь — показываем в UI при выборе. */
  outputHint: string;
  category: CreativeFormatCategory;
  icon: LucideIcon;
  /** Tailwind gradient для превью-карточки. */
  gradient: string;
  accent: string;
  isAuto?: boolean;
  /** Ключ ветки в n8n Switch (см. docs/n8n-content-factory-creative-formats.md). */
  n8nPipeline: string;
  previewSeed: string;
}

export const CREATIVE_FORMAT_CATEGORIES: {
  id: CreativeFormatCategory;
  label: string;
}[] = [
  { id: "recommended", label: "Рекомендуем" },
  { id: "social", label: "Социальные" },
  { id: "product", label: "Продукт" },
  { id: "text", label: "Текст и эксперт" },
];

export const CREATIVE_FORMATS: CreativeFormat[] = [
  {
    id: "auto",
    label: "Авто",
    tag: "AI",
    subtitle: "ИИ подберёт лучший формат",
    description: "Система анализирует ТЗ, нишу и цель — и выбирает оптимальный визуальный формат без ручного выбора.",
    outputHint: "1 креатив в наиболее подходящем формате под вашу задачу",
    category: "recommended",
    icon: Wand2,
    gradient: "from-violet-600/80 via-fuchsia-500/60 to-cyan-400/50",
    accent: "text-violet-300",
    isAuto: true,
    n8nPipeline: "format_auto",
    previewSeed: "format-auto",
  },
  {
    id: "testimonial",
    label: "Отзыв",
    tag: "Trust",
    subtitle: "Цитата клиента + доверие",
    description: "Формат social proof: лицо или аватар, цитата от первого лица, звёзды/рейтинг, акцент на результат.",
    outputHint: "Креатив-отзыв с цитатой, именем и визуальным доверием (как в карусели отзывов)",
    category: "recommended",
    icon: Star,
    gradient: "from-amber-500/70 via-orange-400/50 to-rose-400/40",
    accent: "text-amber-300",
    n8nPipeline: "format_testimonial",
    previewSeed: "format-testimonial",
  },
  {
    id: "ugc",
    label: "UGC",
    tag: "Native",
    subtitle: "Селфи, от первого лица",
    description: "Нативная рекомендация: человек снимает на телефон, держит продукт, говорит в камеру — без рекламного глянца.",
    outputHint: "Вертикальный UGC-кадр: лицо + продукт, домашний свет, искренняя подача",
    category: "social",
    icon: Smartphone,
    gradient: "from-emerald-600/60 via-teal-500/40 to-sky-400/30",
    accent: "text-emerald-300",
    n8nPipeline: "format_ugc",
    previewSeed: "format-ugc",
  },
  {
    id: "before_after",
    label: "До / После",
    tag: "Compare",
    subtitle: "Современное сравнение",
    description: "Split-screen с чёткой трансформацией: проблема слева, результат справа. Минималистичные подписи, стрелка прогресса.",
    outputHint: "Современный сплит 50/50 с контрастом «до» (приглушённо) и «после» (ярко)",
    category: "social",
    icon: GitCompareArrows,
    gradient: "from-slate-600/70 via-indigo-500/50 to-emerald-400/40",
    accent: "text-indigo-300",
    n8nPipeline: "format_before_after",
    previewSeed: "format-before-after",
  },
  {
    id: "product_focus",
    label: "Продукт",
    tag: "Hero",
    subtitle: "Крупный план без людей",
    description: "Продукт — герой кадра: flat-lay или 45°, бытовой контекст, мягкий свет. Идеально для e-com и beauty.",
    outputHint: "Продукт крупно в лайфстайл-обстановке, без моделей",
    category: "product",
    icon: Package,
    gradient: "from-stone-500/60 via-amber-200/30 to-orange-300/40",
    accent: "text-amber-200",
    n8nPipeline: "format_product",
    previewSeed: "format-product",
  },
  {
    id: "bold_offer",
    label: "Оффер",
    tag: "Text",
    subtitle: "Крупная типографика",
    description: "Текст-оффер занимает 70–90% кадра: скидка, цифра, провокация. Плоская графика, 1–2 акцентных цвета.",
    outputHint: "Графический креатив с жирным оффером и минимумом фото",
    category: "text",
    icon: Type,
    gradient: "from-rose-600/80 via-purple-600/60 to-blue-500/50",
    accent: "text-rose-300",
    n8nPipeline: "format_bold_offer",
    previewSeed: "format-offer",
  },
  {
    id: "expert",
    label: "Эксперт",
    tag: "Talk",
    subtitle: "Спикер в камеру",
    description: "Talking head: эксперт по плечи, прямой взгляд, нейтральный фон. Подпись с именем/ролью, субтитры.",
    outputHint: "Портрет эксперта, говорящего в камеру — доверие и авторитет",
    category: "text",
    icon: Mic,
    gradient: "from-zinc-600/70 via-slate-500/50 to-blue-400/30",
    accent: "text-blue-300",
    n8nPipeline: "format_expert",
    previewSeed: "format-expert",
  },
];

export const CREATIVE_FORMAT_BY_ID = Object.fromEntries(
  CREATIVE_FORMATS.map((f) => [f.id, f]),
) as Record<CreativeFormatId, CreativeFormat>;

export const AUTO_FORMAT_ID: CreativeFormatId = "auto";
