import type { ContentType } from "@/data/contentTypes";

export type SourceMode = "link" | "photo" | "description";
export type AspectId = "1:1" | "4:5" | "9:16" | "16:9" | "3:4" | "21:9";

export interface Step1Flow {
  label: string;
  subtitle: string;
  showModeSelector: boolean;
  allowedModes: SourceMode[];
  defaultMode: SourceMode;
  showLogo: boolean;
  showPeoplePhoto: boolean;
  peoplePhotoRequired: boolean;
  peoplePhotoTitle: string;
  showProductPhoto: boolean;
  showBrandTemplate: boolean;
  showCopyMode: boolean;
  showDescription: boolean;
}

export interface Step2Flow {
  label: string;
  subtitle: string;
  showAspect: boolean;
  aspects: AspectId[];
  defaultAspect: AspectId;
  showLang: boolean;
  showVariants: boolean;
  variantsLabel: string;
  variantCounts: number[];
  defaultVariants: number;
}

export interface Step3Flow {
  label: string;
  subtitle: string;
  showCreativeFormats: boolean;
  showNeuroStyles: boolean;
  showAngles: boolean;
  showGoal: boolean;
  showTone: boolean;
  showCta: boolean;
  showColor: boolean;
}

export interface ContentTypeFlow {
  typeId: string;
  /** single = одна страница (нейрофото); standard = шаги 1→2→3 */
  wizardMode: "single" | "standard";
  singleRoute?: string;
  totalSteps: number;
  step1: Step1Flow;
  step2: Step2Flow;
  step3: Step3Flow;
}

const ADS_STEP1: Step1Flow = {
  label: "Источник и бриф",
  subtitle: "Фото или описание — что продвигаем",
  showModeSelector: true,
  allowedModes: ["photo", "description"],
  defaultMode: "photo",
  showLogo: true,
  showPeoplePhoto: true,
  peoplePhotoRequired: false,
  peoplePhotoTitle: "Фото людей",
  showProductPhoto: true,
  showBrandTemplate: true,
  showCopyMode: true,
  showDescription: true,
};

/** Единый набор форматов для всех типов контента в мастере */
export const STANDARD_ASPECTS: AspectId[] = ["1:1", "4:5", "9:16", "16:9"];

const ADS_STEP2: Step2Flow = {
  label: "Формат креатива",
  subtitle: "Соотношение сторон и число вариантов",
  showAspect: true,
  aspects: STANDARD_ASPECTS,
  defaultAspect: "1:1",
  showLang: false,
  showVariants: true,
  variantsLabel: "Количество вариантов",
  variantCounts: [3, 5, 7, 10],
  defaultVariants: 3,
};

const ADS_STEP3: Step3Flow = {
  label: "Стиль и маркетинг",
  subtitle: "Формат креатива, цель, тон и CTA",
  showCreativeFormats: true,
  showNeuroStyles: false,
  showAngles: false,
  showGoal: true,
  showTone: true,
  showCta: true,
  showColor: true,
};

const FLOWS: Record<string, ContentTypeFlow> = {
  "neuro-photo": {
    typeId: "neuro-photo",
    wizardMode: "single",
    singleRoute: "/create/neuro-photo",
    totalSteps: 1,
    step1: {
      label: "Нейрофотосессия",
      subtitle: "Селфи → стиль → формат → количество фото",
      showModeSelector: false,
      allowedModes: ["photo"],
      defaultMode: "photo",
      showLogo: false,
      showPeoplePhoto: true,
      peoplePhotoRequired: true,
      peoplePhotoTitle: "Селфи / фото человека",
      showProductPhoto: false,
      showBrandTemplate: false,
      showCopyMode: false,
      showDescription: false,
    },
    step2: {
      label: "Формат",
      subtitle: "",
      showAspect: true,
      aspects: STANDARD_ASPECTS,
      defaultAspect: "4:5",
      showLang: false,
      showVariants: true,
      variantsLabel: "Количество фото",
      variantCounts: [3, 5, 7, 10],
      defaultVariants: 3,
    },
    step3: {
      label: "Стиль съёмки",
      subtitle: "Выберите стили и ракурсы",
      showCreativeFormats: false,
      showNeuroStyles: true,
      showAngles: true,
      showGoal: false,
      showTone: false,
      showCta: false,
      showColor: false,
    },
  },

  "facebook-ads": {
    typeId: "facebook-ads",
    wizardMode: "standard",
    totalSteps: 3,
    step1: ADS_STEP1,
    step2: { ...ADS_STEP2, defaultAspect: "1:1" },
    step3: ADS_STEP3,
  },
  "google-ads": {
    typeId: "google-ads",
    wizardMode: "standard",
    totalSteps: 3,
    step1: ADS_STEP1,
    step2: { ...ADS_STEP2, defaultAspect: "1:1" },
    step3: ADS_STEP3,
  },
  marketplace: {
    typeId: "marketplace",
    wizardMode: "standard",
    totalSteps: 3,
    step1: { ...ADS_STEP1, defaultMode: "photo", showLogo: false },
    step2: { ...ADS_STEP2, defaultAspect: "1:1", variantsLabel: "Слайдов карточки", variantCounts: [3, 5, 7, 10], defaultVariants: 5 },
    step3: { ...ADS_STEP3, showCta: false },
  },

  "insta-carousel": {
    typeId: "insta-carousel",
    wizardMode: "standard",
    totalSteps: 3,
    step1: { ...ADS_STEP1, defaultMode: "description" },
    step2: {
      ...ADS_STEP2,
      defaultAspect: "4:5",
      variantsLabel: "Количество слайдов",
      variantCounts: [3, 5, 7, 10],
      defaultVariants: 5,
    },
    step3: ADS_STEP3,
  },

  "reels-cover": {
    typeId: "reels-cover",
    wizardMode: "standard",
    totalSteps: 3,
    step1: {
      ...ADS_STEP1,
      allowedModes: ["photo", "description"],
      defaultMode: "photo",
    },
    step2: {
      ...ADS_STEP2,
      defaultAspect: "9:16",
      showLang: false,
      variantCounts: [3, 5, 7, 10],
      defaultVariants: 3,
      variantsLabel: "Вариантов обложки",
    },
    step3: ADS_STEP3,
  },

  stories: {
    typeId: "stories",
    wizardMode: "standard",
    totalSteps: 3,
    step1: { ...ADS_STEP1, defaultMode: "description" },
    step2: {
      ...ADS_STEP2,
      defaultAspect: "9:16",
      variantsLabel: "Кадров в серии",
      variantCounts: [3, 5, 7, 10],
      defaultVariants: 3,
    },
    step3: ADS_STEP3,
  },

  "youtube-thumb": {
    typeId: "youtube-thumb",
    wizardMode: "standard",
    totalSteps: 3,
    step1: {
      ...ADS_STEP1,
      allowedModes: ["photo", "description"],
      defaultMode: "photo",
    },
    step2: {
      ...ADS_STEP2,
      defaultAspect: "16:9",
      variantCounts: [3, 5, 7, 10],
      defaultVariants: 3,
      variantsLabel: "Вариантов превью",
    },
    step3: ADS_STEP3,
  },

  "web-banner": {
    typeId: "web-banner",
    wizardMode: "standard",
    totalSteps: 3,
    step1: { ...ADS_STEP1, defaultMode: "photo", showLogo: true },
    step2: {
      ...ADS_STEP2,
      defaultAspect: "16:9",
      variantCounts: [3, 5, 7, 10],
      defaultVariants: 3,
    },
    step3: ADS_STEP3,
  },
};

export function getContentTypeFlow(typeId: string | undefined): ContentTypeFlow {
  if (typeId && FLOWS[typeId]) return FLOWS[typeId];
  return FLOWS["facebook-ads"];
}

export function getCreateRoute(type: ContentType | undefined): string {
  if (!type) return "/create/step-1";
  const flow = getContentTypeFlow(type.id);
  if (flow.wizardMode === "single" && flow.singleRoute) return flow.singleRoute;
  return "/create/step-1";
}
