export type CabinetProvider = "meta" | "google" | "instagram_organic";

export interface AdCabinetConfig {
  // Основное
  city?: string;
  dailyBudget?: number;
  currency?: string;
  provider?: CabinetProvider;

  // Интеграция Meta
  adAccountId?: string;
  pageId?: string;
  pageName?: string;
  instagramId?: string;

  // Трекинг и связь
  telegramGroupId?: string;
  whatsappNumber?: string;
  pixelId?: string;
  pixelEvent?: string;
  websiteUrl?: string;

  // Заметки
  brief?: string;

  // Унаследованные (хранятся в БД, не показываются в форме)
  accessToken?: string;
  appId?: string;
  businessId?: string;
  campaignObjective?: string;
  optimizationGoal?: string;
  leadFormId?: string;
  startTime?: string;
  endTime?: string;
  daysOfWeek?: number[];
  timezone?: string;
  autoLaunchEnabled?: boolean;
  launchHour?: number;
  targetGeo?: string[];
  targetAgeMin?: number;
  targetAgeMax?: number;
  targetGender?: "all" | "male" | "female";
  targetLanguages?: string[];
  targetInterests?: unknown[];
  targetExclusions?: unknown[];
  creativeHeadline?: string;
  creativePrimaryText?: string;
  creativeDescription?: string;
  creativeCta?: string;
  creativeMediaUrls?: string[];
  landingUrl?: string;
  utmTemplate?: string;
}

export interface AdCabinet extends AdCabinetConfig {
  id: string;
  name: string;
  externalId: string;
  online: boolean;
  type: "Личный" | "Агентский";
  spend: number;
  leads: number;
  leadCost: number;
  sales: number;
  revenue: number;
}

export const SAMPLE_CABINETS: AdCabinet[] = [];
