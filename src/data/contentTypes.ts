import {
  Facebook,
  Search,
  ShoppingBag,
  Images,
  Film,
  CircleDot,
  Youtube,
  MonitorSmartphone,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

export type ContentCategory = "ads" | "content" | "ai";

export interface ContentType {
  id: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  category: ContentCategory;
  popular?: boolean;
  tooltip: string;
}

// Порядок: сначала Ads → потом контент → потом AI-фото
export const CONTENT_TYPES: ContentType[] = [
  // Ads
  {
    id: "facebook-ads",
    title: "Facebook Ads",
    subtitle: "Реклама в Meta",
    icon: Facebook,
    category: "ads",
    popular: true,
    tooltip:
      "Логика конверсии: останавливаем скролл первым кадром → бьём в боль → показываем оффер → CTA. Цель — клик и низкий CPC.",
  },
  {
    id: "google-ads",
    title: "Google Ads",
    subtitle: "Поисковая реклама",
    icon: Search,
    category: "ads",
    popular: true,
    tooltip:
      "Логика конверсии: ключ в заголовке + выгода + триггер срочности → клик из выдачи. Оптимизируем CTR и Quality Score.",
  },
  {
    id: "marketplace",
    title: "Маркетплейс",
    subtitle: "Wildberries",
    icon: ShoppingBag,
    category: "ads",
    popular: true,
    tooltip:
      "Логика конверсии: первый слайд продаёт клик в выдаче, следующие снимают возражения и ведут в корзину. Растёт CTR и CR карточки.",
  },
  // Контент
  {
    id: "insta-carousel",
    title: "Карусель Instagram",
    subtitle: "Инстаграм",
    icon: Images,
    category: "content",
    tooltip:
      "Логика конверсии: крючок на 1-м слайде → польза по слайдам → удержание свайпа → CTA в финале. Цель — сохранения и заявки в Direct.",
  },
  {
    id: "reels-cover",
    title: "Обложка Reels",
    subtitle: "Обложки Reels",
    icon: Film,
    category: "content",
    tooltip:
      "Логика конверсии: цепляющий визуал + короткий текст-крючок → клик из сетки профиля. Растёт досматриваемость и охват.",
  },
  {
    id: "stories",
    title: "Stories / Прогрев",
    subtitle: "Инстаграм",
    icon: CircleDot,
    category: "content",
    tooltip:
      "Логика конверсии: серия сторис прогревает — боль → решение → кейс → оффер → CTA-стикер. Цель — заявки и переходы по ссылке.",
  },
  {
    id: "youtube-thumb",
    title: "YouTube превью",
    subtitle: "Превью роликов",
    icon: Youtube,
    category: "content",
    tooltip:
      "Логика конверсии: эмоция на лице + контраст + интрига в 3 словах → клик по превью. Оптимизируем CTR и удержание.",
  },
  {
    id: "web-banner",
    title: "Баннер сайт/реклама",
    subtitle: "Сайт",
    icon: MonitorSmartphone,
    category: "content",
    tooltip:
      "Логика конверсии: оффер + выгода + явный CTA-кнопка → клик и заявка. Цель — высокий CR на лендинге.",
  },
  // AI-фото
  {
    id: "neuro-photo",
    title: "Нейрофотосессия",
    subtitle: "Нейрофото",
    icon: Sparkles,
    category: "ai",
    tooltip:
      "Логика конверсии: студийное качество фото без съёмки → доверие к бренду/эксперту → выше CTR аватара и кликабельность профиля.",
  },
];