import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/** Одна строка воронки CRM по стадиям. */
export type LeadgenStage = { title: string; order_index: number; cnt: number };

/** Сводка по складу спарсенных компаний. */
export type LeadgenFunnel = {
  всего: number;
  ждут_скоринга: number;
  прошли_скоринг: number;
  ушли_в_воронку: number;
  отсеяно: number;
  горячих_70_плюс: number;
  средний_балл: number | null;
};

export type LeadgenQuality = {
  city: string | null;
  всего: number;
  с_телефоном: number;
  с_whatsapp: number;
  с_почтой: number;
  без_сайта: number;
  без_инстаграма: number;
  рейтинг_ниже_4_5: number;
  отзывов_меньше_50: number;
};

export type LeadgenSegment = {
  услуга: string;
  лидов: number;
  средний_балл: number | null;
  горячих: number;
};

export type LeadgenRun = {
  id: string;
  source: string;
  query: string | null;
  status: string;
  found: number;
  inserted: number;
  duplicates: number;
  error: string | null;
  started_at: string;
  seconds: number | null;
};

export type LeadgenQueueItem = {
  name: string;
  city: string | null;
  ai_score: number | null;
  ai_segment: string | null;
  ai_pain: string | null;
  phones: string[] | null;
  whatsapp: string | null;
  website: string | null;
  instagram: string | null;
  rating: number | null;
  review_count: number | null;
  source_url: string | null;
};

export type LeadgenCampaign = {
  id: string;
  name: string;
  channel: string;
  status: string;
  daily_limit: number;
  variants: number;
  created_at: string;
  всего: number;
  отправлено: number;
  прочитано: number;
  кликнули: number;
  ответили: number;
  ошибок: number;
};

export type LeadgenVariant = {
  campaign: string;
  variant: string;
  отправлено: number;
  кликнули: number;
  ответили: number;
  ответов_pct: number | null;
};

/** Реакция получателя на касание. «тишина» — отправлено, но ни клика, ни ответа. */
export type LeadgenAnswerKind = "ответил" | "кликнул" | "тишина";

export type LeadgenAnswer = {
  тип: LeadgenAnswerKind;
  когда: string | null;
  имя: string | null;
  phone: string | null;
  variant: string | null;
  кампания: string | null;
  lead_id: string | null;
  ai_score: number | null;
  услуга: string | null;
  temperature: string | null;
  стадия: string | null;
  последний_ответ: string | null;
};

export type LeadgenData = {
  funnel: LeadgenFunnel | null;
  quality: LeadgenQuality[];
  segments: LeadgenSegment[];
  runs: LeadgenRun[];
  queue: LeadgenQueueItem[];
  stages: LeadgenStage[];
  campaigns: LeadgenCampaign[];
  variants: LeadgenVariant[];
  answers: LeadgenAnswer[];
  answers_stat: { отправлено: number; кликнули: number; ответили: number; отписались: number } | null;
  generated_at: string | null;
};

const EMPTY: LeadgenData = {
  funnel: null,
  quality: [],
  segments: [],
  runs: [],
  queue: [],
  stages: [],
  campaigns: [],
  variants: [],
  answers: [],
  answers_stat: null,
  generated_at: null,
};

/**
 * Данные раздела «Лидген». Одним вызовом RPC lg_dashboard — чтобы не дёргать
 * восемь запросов и не ловить рассинхрон между блоками.
 */
export function useLeadgen(projectId: string | null) {
  const [data, setData] = useState<LeadgenData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) {
      setData(EMPTY);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    // RPC добавлена миграцией и может отсутствовать в сгенерённых типах — отсюда каст.
    const { data: raw, error: rpcError } = await (supabase.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>)("lg_dashboard", {
      p_project: projectId,
    });

    if (rpcError) {
      setError(rpcError.message);
      setData(EMPTY);
      setLoading(false);
      return;
    }

    const d = (raw ?? {}) as Partial<LeadgenData>;
    setData({
      funnel: d.funnel ?? null,
      quality: d.quality ?? [],
      segments: d.segments ?? [],
      runs: d.runs ?? [],
      queue: d.queue ?? [],
      stages: d.stages ?? [],
      campaigns: d.campaigns ?? [],
      variants: d.variants ?? [],
      answers: d.answers ?? [],
      answers_stat: d.answers_stat ?? null,
      generated_at: d.generated_at ?? null,
    });
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  return useMemo(() => ({ data, loading, error, refetch: load }), [data, loading, error, load]);
}
