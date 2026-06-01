import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useProjectsStore } from "./useProjectsStore";
import { useRealtimeTable } from "./useRealtimeTable";
import { useMetaDashboard } from "./useMetaDashboard";

interface Range { from: Date; to: Date }

export interface MetaCreativeRow {
  id: string;
  adId: string;
  campaignId: string | null;
  cabinetId: string | null;
  name: string;
  creativeType: "image" | "video" | "carousel" | "dynamic" | string;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  posterUrl: string | null;
  videoUrl: string | null;
  videoId: string | null;
  primaryText: string | null;
  headline: string | null;
  cta: string | null;
  destinationUrl: string | null;
  effectiveStatus: string | null;
  /** Метрики Meta за выбранный период. */
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  messages: number;
  purchases: number;
  revenue: number;
  ctr: number;
  cpl: number;
  cpc: number;
  cpm: number;
  romi: number;
  /** Сквозные CRM-метрики за выбранный период. */
  crmLeads: number;
  crmQualified: number;
  crmSales: number;
  crmRevenue: number;
  /** Расчётные сквозные показатели. */
  crmCpl: number;
  crmCps: number;
  crmAvgCheck: number;
  crmRomi: number;
  crmProfit: number;
}

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface RawCreative {
  id: string;
  ad_id: string;
  campaign_id: string | null;
  cabinet_id: string | null;
  name: string | null;
  creative_type: string | null;
  thumbnail_url: string | null;
  image_url: string | null;
  poster_url: string | null;
  video_url: string | null;
  video_id: string | null;
  primary_text: string | null;
  headline: string | null;
  cta: string | null;
  destination_url: string | null;
  effective_status: string | null;
}

interface RawDailyAgg {
  ad_id: string;
  spend: number | string;
  impressions: number | string;
  clicks: number | string;
  leads: number | string;
  messages: number | string;
  purchases: number | string;
  revenue: number | string;
}

export function useMetaCreatives(range: Range) {
  const { creatives, loading } = useMetaDashboard(range);
  return { rows: creatives, loading };
}

// ---------------- Campaigns ----------------

export interface MetaCampaignRow {
  id: string;
  campaignId: string;
  cabinetId: string | null;
  name: string;
  objective: string | null;
  destinationType: string | null;
  effectiveStatus: string | null;
  dailyBudget: number | null;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  messages: number;
  purchases: number;
  revenue: number;
  ctr: number;
  cpl: number;
  romi: number;
  /** Сквозные CRM-метрики, посчитанные по объявлениям этой кампании. */
  crmLeads: number;
  crmQualified: number;
  crmSales: number;
  crmRevenue: number;
  crmRomi: number;
  crmProfit: number;
  crmAvgCheck: number;
  crmCps: number;
}

interface RawCampaign {
  id: string;
  campaign_id: string;
  cabinet_id: string | null;
  name: string | null;
  objective: string | null;
  destination_type: string | null;
  effective_status: string | null;
  daily_budget: number | string | null;
}

interface RawCampaignDaily {
  campaign_id: string;
  spend: number | string;
  impressions: number | string;
  clicks: number | string;
  leads: number | string;
  messages: number | string;
  purchases: number | string;
  revenue: number | string;
}

export function useMetaCampaigns(range: Range) {
  const { campaigns, loading } = useMetaDashboard(range);
  return { rows: campaigns, loading };
}

// ---------------- Goal labeling helpers ----------------

export type GoalKey =
  | "leads_pixel"
  | "leads_form"
  | "leads"
  | "whatsapp"
  | "messages"
  | "engagement"
  | "traffic"
  | "purchase"
  | "video"
  | "awareness"
  | "other";

export interface GoalMeta {
  key: GoalKey;
  label: string;
  /** Какую метрику считаем «успехом» для этой цели. */
  successMetric: "leads" | "messages" | "purchases" | "clicks" | "impressions";
}

const GOAL_TABLE: Array<{ match: (obj: string, dest: string | null) => boolean; meta: GoalMeta }> = [
  // === Лиды — приоритет, чтобы не перекрылись destination'ом ===
  // OUTCOME_LEADS + WEBSITE → лиды через пиксель на сайте (типичный «Conversion Lead»)
  {
    match: (obj, dest) => /LEAD/.test(obj) && dest === "WEBSITE",
    meta: { key: "leads_pixel", label: "Лиды с сайта (пиксель)", successMetric: "leads" },
  },
  // OUTCOME_LEADS + ON_AD / INSTANT_FORM / LEAD_FORM → instant-форма Meta внутри объявления
  {
    match: (obj, dest) => /LEAD/.test(obj) && !!dest && /(ON_AD|INSTANT_FORM|LEAD_FORM|LEADS_FORM)/.test(dest),
    meta: { key: "leads_form", label: "Лиды через форму Meta", successMetric: "leads" },
  },
  // === Мессенджеры ===
  // WhatsApp — любой destination, содержащий WHATSAPP
  // (чистый WHATSAPP или мультимессенджер MESSAGING_*_WHATSAPP).
  {
    match: (_o, dest) => !!dest && /WHATSAPP/.test(dest),
    meta: { key: "whatsapp", label: "WhatsApp", successMetric: "messages" },
  },
  // Direct / Messenger без WhatsApp
  {
    match: (_o, dest) => dest === "MESSENGER" || dest === "INSTAGRAM_DIRECT",
    meta: { key: "messages", label: "Direct / Messenger", successMetric: "messages" },
  },
  // Лиды без указанного destination — фоллбэк
  {
    match: (obj) => /LEAD/.test(obj),
    meta: { key: "leads", label: "Лиды (форма / сайт)", successMetric: "leads" },
  },
  // === Остальные цели по objective ===
  {
    match: (obj) => /MESSAGE/.test(obj),
    meta: { key: "messages", label: "Сообщения", successMetric: "messages" },
  },
  {
    match: (obj) => /TRAFFIC|LINK_CLICK/.test(obj),
    meta: { key: "traffic", label: "Трафик на сайт", successMetric: "clicks" },
  },
  {
    match: (obj) => /PURCHASE|SALES|CONVERSION/.test(obj),
    meta: { key: "purchase", label: "Продажи / покупки", successMetric: "purchases" },
  },
  // Engagement без destination — взаимодействие с контентом
  {
    match: (obj) => /ENGAGEMENT/.test(obj),
    meta: { key: "engagement", label: "Вовлечённость", successMetric: "messages" },
  },
  {
    match: (obj) => /VIDEO/.test(obj),
    meta: { key: "video", label: "Просмотры видео", successMetric: "impressions" },
  },
  {
    match: (obj) => /AWARENESS|REACH|BRAND/.test(obj),
    meta: { key: "awareness", label: "Охват / узнаваемость", successMetric: "impressions" },
  },
];

export function classifyGoal(objective: string | null, destinationType: string | null): GoalMeta {
  const obj = (objective ?? "").toUpperCase();
  for (const r of GOAL_TABLE) {
    if (r.match(obj, destinationType)) return r.meta;
  }
  return { key: "other", label: objective ?? "Без цели", successMetric: "clicks" };
}
