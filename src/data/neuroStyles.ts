import {
  Wand2,
  Briefcase,
  User,
  Camera,
  Trees,
  Shirt,
  Dumbbell,
  Sun,
  type LucideIcon,
} from "lucide-react";

export type NeuroStyleId =
  | "auto"
  | "neuro_business"
  | "neuro_lifestyle"
  | "neuro_studio"
  | "neuro_outdoor"
  | "neuro_fashion"
  | "neuro_sport"
  | "neuro_casual";

export type AngleId =
  | "front"
  | "three_quarter"
  | "side"
  | "back"
  | "close_up"
  | "half_body"
  | "full_body";

export interface NeuroStyleDef {
  id: NeuroStyleId;
  label: string;
  description: string;
  icon: LucideIcon;
  preview: string;
  fallbackSeed: string;
  isAuto?: boolean;
}

export const NEURO_STYLES: NeuroStyleDef[] = [
  {
    id: "auto",
    label: "Авто",
    description: "ИИ подберёт лучшие сеттинги под ваше ТЗ",
    icon: Wand2,
    preview: "/style-previews/auto.png",
    fallbackSeed: "auto-pick",
    isAuto: true,
  },
  {
    id: "neuro_business",
    label: "Деловой портрет",
    description: "Костюм, нейтральный фон — LinkedIn / сайт",
    icon: Briefcase,
    preview: "/style-previews/neuro-business.jpg",
    fallbackSeed: "neuro-business",
  },
  {
    id: "neuro_lifestyle",
    label: "Лайфстайл",
    description: "Естественный свет, кафе/дом/город",
    icon: User,
    preview: "/style-previews/neuro-lifestyle.jpg",
    fallbackSeed: "neuro-lifestyle",
  },
  {
    id: "neuro_studio",
    label: "Студия",
    description: "Постановочный свет, цветной фон",
    icon: Camera,
    preview: "/style-previews/neuro-studio.jpg",
    fallbackSeed: "neuro-studio",
  },
  {
    id: "neuro_outdoor",
    label: "На улице",
    description: "Природа, город, золотой час",
    icon: Trees,
    preview: "/style-previews/neuro-outdoor.jpg",
    fallbackSeed: "neuro-outdoor",
  },
  {
    id: "neuro_fashion",
    label: "Фэшн",
    description: "Модный лук, журнальная съёмка",
    icon: Shirt,
    preview: "/style-previews/neuro-fashion.jpg",
    fallbackSeed: "neuro-fashion",
  },
  {
    id: "neuro_sport",
    label: "Спорт",
    description: "Активный образ, динамика",
    icon: Dumbbell,
    preview: "/style-previews/neuro-sport.jpg",
    fallbackSeed: "neuro-sport",
  },
  {
    id: "neuro_casual",
    label: "Casual",
    description: "Повседневный образ, дневной свет",
    icon: Sun,
    preview: "/style-previews/neuro-casual.jpg",
    fallbackSeed: "neuro-casual",
  },
];

export const NEURO_ANGLES: { id: AngleId; label: string; description: string }[] = [
  { id: "front", label: "Анфас", description: "Лицо строго в камеру" },
  { id: "three_quarter", label: "3/4", description: "Полупрофиль" },
  { id: "side", label: "Профиль", description: "Боком к камеру" },
  { id: "back", label: "Со спины", description: "Спиной к камере" },
  { id: "close_up", label: "Крупный план", description: "Только лицо/плечи" },
  { id: "half_body", label: "По пояс", description: "Поясной портрет" },
  { id: "full_body", label: "В полный рост", description: "Полный рост" },
];

export const MAX_NEURO_STYLES = 4;
