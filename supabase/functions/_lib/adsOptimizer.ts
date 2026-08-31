/**
 * Ежедневная оптимизация рекламы: пауза убыточных кампаний и рост бюджета у
 * победителей. Порт ноды n8n `Auto-Pause`.
 *
 * Модуль чистый — никакой сети и БД, только решение по снимку метрик. Пороги
 * приходят аргументом: в n8n они были константами в коде, теперь это строка
 * `ads_optimizer_settings` со своими значениями у каждого проекта.
 */

/* ────────────────────────────── пороги ───────────────────────────────── */

export interface OptimizerThresholds {
  /** CPL за 3 дня, выше которого кампания считается убыточной, $. */
  maxCpl: number;
  /** Расход за 3 дня без единого лида, $. */
  maxSpendNoLead: number;
  /** Расход за сегодня без лидов — экстренная остановка, $. */
  emergencySpend: number;
  /** Ниже этого качества кампания останавливается. */
  minQualityScore: number;
  /** Выше этого качества высокий CPL прощается. */
  qualityShield: number;
  /** Сколько дней новая кампания защищена от паузы. */
  gracePeriodDays: number;
  scaleMinScore: number;
  scaleMaxCpl: number;
  /** Множитель роста дневного бюджета. */
  scaleStep: number;
  /** Потолок дневного бюджета при обычном скейле, $. */
  scaleCapUsd: number;
  /** Потолок при подтверждённых оплатах в CRM, $. */
  crmScaleCapUsd: number;
  /** ai_score, с которого лид считается качественным. */
  qualifiedAiScoreMin: number;
  /** Доля качественных лидов, ниже которой кампания останавливается, %. */
  qualifiedRateMinPause: number;
  /** Доля качественных лидов, нужная для роста бюджета, %. */
  qualifiedRateMinScale: number;
  /** Меньше этого числа лидов — данным о качестве не доверяем. */
  qualifiedLeadsMinForPause: number;
  /** Доля дошедших до третьего этапа, нужная для роста бюджета, %. */
  scaleMinDepth3Rate: number;
  fatigueFrequency: number;
  fatigueFrequencySoft: number;
  /** Доля от трёхдневного CTR, ниже которой считаем, что CTR падает. */
  fatigueCtrDrop: number;
  fatigueMinImpressions: number;
}

/** Значения, с которыми алгоритм работал в n8n — остаются как умолчания. */
export const DEFAULT_THRESHOLDS: OptimizerThresholds = {
  maxCpl: 4,
  maxSpendNoLead: 15,
  emergencySpend: 10,
  minQualityScore: 45,
  qualityShield: 70,
  gracePeriodDays: 5,
  scaleMinScore: 75,
  scaleMaxCpl: 2.5,
  scaleStep: 1.2,
  scaleCapUsd: 50,
  crmScaleCapUsd: 100,
  qualifiedAiScoreMin: 70,
  qualifiedRateMinPause: 20,
  qualifiedRateMinScale: 50,
  qualifiedLeadsMinForPause: 5,
  scaleMinDepth3Rate: 30,
  fatigueFrequency: 3.0,
  fatigueFrequencySoft: 2.0,
  fatigueCtrDrop: 0.7,
  fatigueMinImpressions: 1500,
};

/* ────────────────────────────── подсчёт лидов ────────────────────────── */

/**
 * Meta возвращает одну и ту же заявку сразу в нескольких `action_type`.
 * Внутри группы берём максимум, между группами суммируем — иначе один лид
 * с сайта посчитается трижды.
 */
const WEBSITE_LEAD_TYPES = new Set([
  "lead",
  "onsite_web_lead",
  "offsite_conversion.fb_pixel_lead",
  "offsite_conversion.fb_pixel_complete_registration",
  "offsite_conversion.fb_pixel_submit_application",
  "offsite_conversion.fb_pixel_contact",
  "offsite_conversion.fb_pixel_custom",
  "offsite_conversion.fb_pixel_initiate_checkout",
  "offsite_conversion.fb_pixel_add_to_cart",
  "offsite_conversion.fb_pixel_purchase",
  "submit_application_total",
  "complete_registration_total",
  "contact_total",
]);
const LEADFORM_LEAD_TYPES = new Set(["onsite_conversion.lead_grouped"]);
const MESSAGING_LEAD_TYPES = new Set([
  "onsite_conversion.messaging_conversation_started_7d",
  "onsite_conversion.total_messaging_connection",
]);

export interface MetaAction {
  action_type?: string;
  value?: string | number;
}

export function countLeadsFromActions(actions: MetaAction[] | undefined | null): number {
  if (!Array.isArray(actions)) return 0;
  let web = 0, form = 0, messaging = 0;
  for (const a of actions) {
    const v = Number.parseInt(String(a?.value ?? "0"), 10);
    if (!Number.isFinite(v)) continue;
    const type = String(a?.action_type ?? "");
    if (WEBSITE_LEAD_TYPES.has(type) && v > web) web = v;
    if (LEADFORM_LEAD_TYPES.has(type) && v > form) form = v;
    if (MESSAGING_LEAD_TYPES.has(type) && v > messaging) messaging = v;
  }
  return web + form + messaging;
}

/* ────────────────────────────── снимок кампании ──────────────────────── */

export interface PeriodMetrics {
  spend: number;
  leads: number;
  cpl: number;
  ctr?: number;
  frequency?: number;
  impressions?: number;
}

export interface QualitySignal {
  total: number;
  qualified: number;
  /** Доля качественных лидов, %. */
  rate: number;
}

export interface CampaignSnapshot {
  campaignId: string;
  name: string;
  adSetId?: string | null;
  /** Метрики за последние 3 дня. */
  rolling: PeriodMetrics;
  /** Метрики за сегодня. */
  today: PeriodMetrics;
  score: number;
  daysActive: number;
  /** Сколько часов кампания вообще работает — по ней решаем, есть ли данные. */
  ageHours: number;
  scoreTrend?: "improving" | "stable" | "degrading";
  cplTrend?: "improving" | "stable" | "degrading";
  /** Доля лидов, дошедших до третьего этапа воронки, %. */
  depth3Rate: number;
  /** null — данных об ai_score нет, качество не учитываем. */
  quality: QualitySignal | null;
  crm: { paid: number; scheduled: number; arrived: number };
  currentDailyBudgetCents?: number | null;
}

export type Decision =
  | { kind: "pause"; reason: string; scenario: "vampires" | "junk" | "degradation"; confidence: "medium" | "high" }
  | { kind: "scale"; reason: string; newBudgetCents: number; capUsd: number }
  | { kind: "protect"; reason: string }
  | { kind: "ok" };

const money = (n: number) => n.toFixed(2);

/** Новый бюджет при росте, с учётом потолка. Возвращает null, если расти некуда. */
export function nextBudgetCents(
  currentCents: number | null | undefined,
  step: number,
  capUsd: number,
): number | null {
  const current = Number(currentCents ?? 0);
  if (!Number.isFinite(current) || current <= 0) return null;
  const next = Math.min(Math.round(current * step), Math.round(capUsd * 100));
  return next > current ? next : null;
}

/**
 * Выгорание креатива: люди видят объявление слишком часто, а отклик падает.
 * Это предупреждение в отчёт, а не основание для паузы.
 */
export function detectFatigue(
  c: CampaignSnapshot,
  t: OptimizerThresholds,
): string | null {
  const impressions = c.rolling.impressions ?? 0;
  if (impressions < t.fatigueMinImpressions) return null;

  const freq = c.rolling.frequency ?? 0;
  const ctr3d = c.rolling.ctr ?? 0;
  const ctrToday = c.today.ctr ?? 0;
  const ctrFalling = ctr3d > 0 && ctrToday > 0 && ctrToday < ctr3d * t.fatigueCtrDrop;

  if (freq >= t.fatigueFrequency || (freq >= t.fatigueFrequencySoft && ctrFalling)) {
    return `${c.name}: частота ${freq.toFixed(1)}, CTR ${ctr3d.toFixed(2)}%` +
      (ctrFalling ? " (падает)" : "");
  }
  return null;
}

/**
 * Решение по кампании. Порядок проверок повторяет n8n: сначала защита того,
 * что приносит деньги, затем рост победителей, и только потом остановки.
 */
export function decideCampaign(
  c: CampaignSnapshot,
  t: OptimizerThresholds = DEFAULT_THRESHOLDS,
): Decision {
  const isNew = c.daysActive <= t.gracePeriodDays;
  const isImproving = c.scoreTrend === "improving" || c.cplTrend === "improving";
  const degrading = c.scoreTrend === "degrading";
  // Лид может прийти в течение суток — раньше не судим по нулю лидов.
  const ranEnough = c.ageHours >= 24 || c.daysActive >= 2;

  // 1. Есть оплаты в CRM — это победитель, паузу не рассматриваем вовсе.
  if (c.crm.paid > 0) {
    if (c.adSetId && !isNew && !degrading) {
      const next = nextBudgetCents(c.currentDailyBudgetCents, t.scaleStep, t.crmScaleCapUsd);
      if (next) {
        return {
          kind: "scale",
          newBudgetCents: next,
          capUsd: t.crmScaleCapUsd,
          reason: `${c.crm.paid} оплат в CRM, бюджет ` +
            `${money((c.currentDailyBudgetCents ?? 0) / 100)}$ → ${money(next / 100)}$`,
        };
      }
    }
    return { kind: "protect", reason: `${c.crm.paid} оплат в CRM` };
  }

  // 2. Записи и визиты защищают кампанию, пока она не жжёт бюджет прямо сейчас.
  if ((c.crm.arrived > 0 || c.crm.scheduled > 0) && c.today.spend < t.emergencySpend) {
    return {
      kind: "protect",
      reason: `${c.crm.arrived} пришли, ${c.crm.scheduled} записаны`,
    };
  }

  // 3. Победитель: качество, цена лида и глубина воронки одновременно.
  const qualityAllowsScale = c.quality === null || c.quality.rate >= t.qualifiedRateMinScale;
  if (
    qualityAllowsScale &&
    c.score >= t.scaleMinScore &&
    c.rolling.cpl > 0 && c.rolling.cpl <= t.scaleMaxCpl &&
    !isNew && !degrading &&
    c.depth3Rate >= t.scaleMinDepth3Rate
  ) {
    const next = nextBudgetCents(c.currentDailyBudgetCents, t.scaleStep, t.scaleCapUsd);
    if (next) {
      return {
        kind: "scale",
        newBudgetCents: next,
        capUsd: t.scaleCapUsd,
        reason: `score ${c.score}, CPL ${money(c.rolling.cpl)}$, ` +
          `глубина ${c.depth3Rate}% — бюджет ` +
          `${money((c.currentDailyBudgetCents ?? 0) / 100)}$ → ${money(next / 100)}$`,
      };
    }
    return { kind: "ok" };
  }

  // 4. Остановки, от самой очевидной к спорной.
  if (c.today.spend > t.emergencySpend && c.today.leads === 0 && ranEnough) {
    return {
      kind: "pause",
      scenario: "vampires",
      confidence: "high",
      reason: `ЭКСТРЕННО: сегодня ${money(c.today.spend)}$ и 0 лидов`,
    };
  }

  if (
    c.quality !== null &&
    c.quality.total >= t.qualifiedLeadsMinForPause &&
    c.quality.rate < t.qualifiedRateMinPause &&
    !isNew && !isImproving
  ) {
    return {
      kind: "pause",
      scenario: "junk",
      confidence: "high",
      reason: `Низкое качество лидов: ${c.quality.qualified}/${c.quality.total} ` +
        `(${c.quality.rate}% качественных, лимит ${t.qualifiedRateMinPause}%)`,
    };
  }

  if (c.rolling.spend > t.maxSpendNoLead && c.rolling.leads === 0 && ranEnough) {
    return {
      kind: "pause",
      scenario: "vampires",
      confidence: "high",
      reason: `${money(c.rolling.spend)}$ за 3 дня, 0 лидов`,
    };
  }

  if (c.rolling.leads > 0 && c.score > 0 && c.score < t.minQualityScore) {
    if (isImproving) {
      return { kind: "protect", reason: `score ${c.score}/100, но тренд улучшается` };
    }
    if (isNew) {
      return { kind: "protect", reason: `score ${c.score}/100, но кампании ${c.daysActive} дн.` };
    }
    return {
      kind: "pause",
      scenario: "junk",
      confidence: "medium",
      reason: `Низкое качество за 3 дня (score ${c.score}/100, глубина ${c.depth3Rate}%)`,
    };
  }

  if (c.rolling.leads > 0 && c.rolling.cpl > t.maxCpl && c.score < t.qualityShield) {
    if (isImproving) {
      return { kind: "protect", reason: `CPL ${money(c.rolling.cpl)}$, но тренд улучшается` };
    }
    if (isNew) {
      return {
        kind: "protect",
        reason: `CPL ${money(c.rolling.cpl)}$, но кампании ${c.daysActive} дн.`,
      };
    }
    return {
      kind: "pause",
      scenario: "degradation",
      confidence: "medium",
      reason: `CPL ${money(c.rolling.cpl)}$ за 3 дня (лимит ${t.maxCpl}$), score ${c.score}/100`,
    };
  }

  return { kind: "ok" };
}

/* ────────────────────────────── отчёт ────────────────────────────────── */

export interface CampaignOutcome {
  campaign: CampaignSnapshot;
  decision: Decision;
  /** Действие реально применено в Meta (в утреннем режиме — нет). */
  applied: boolean;
  /** Текст ошибки, если применить не удалось. */
  error?: string | null;
}

export interface ReportInput {
  cabinetName: string;
  mode: "morning" | "night";
  outcomes: CampaignOutcome[];
  fatigueWarnings: string[];
  /** Проблема с доступом к кабинету — показываем первой строкой. */
  healthAlert?: string | null;
}

/** Текст отчёта в Telegram: сначала деньги, потом действия, потом риски. */
export function buildReport(input: ReportInput): string {
  const lines: string[] = [];
  if (input.healthAlert) lines.push(input.healthAlert, "");

  const title = input.mode === "morning"
    ? `Доброе утро. Отчёт по кабинету «${input.cabinetName}»`
    : `Оптимизация кабинета «${input.cabinetName}»`;
  lines.push(title, "");

  const spend = input.outcomes.reduce((s, o) => s + o.campaign.rolling.spend, 0);
  const leads = input.outcomes.reduce((s, o) => s + o.campaign.rolling.leads, 0);
  lines.push(
    `За 3 дня: ${money(spend)}$, лидов ${leads}` +
      (leads > 0 ? `, CPL ${money(spend / leads)}$` : ""),
  );

  const paused = input.outcomes.filter((o) => o.decision.kind === "pause" && o.applied);
  const scaled = input.outcomes.filter((o) => o.decision.kind === "scale" && o.applied);
  const protectedOnes = input.outcomes.filter((o) => o.decision.kind === "protect");
  const failed = input.outcomes.filter((o) => o.error);

  if (input.mode === "morning") {
    lines.push("", "Утренний режим — только отчёт, изменений не вносим.");
  }

  if (scaled.length > 0) {
    lines.push("", "Подняли бюджет:");
    for (const o of scaled) lines.push(`  ↑ ${o.campaign.name} — ${o.decision.kind === "scale" ? o.decision.reason : ""}`);
  }
  if (paused.length > 0) {
    lines.push("", "Остановили:");
    for (const o of paused) lines.push(`  ✕ ${o.campaign.name} — ${o.decision.kind === "pause" ? o.decision.reason : ""}`);
  }
  if (protectedOnes.length > 0) {
    lines.push("", "Не трогали:");
    for (const o of protectedOnes) {
      lines.push(`  • ${o.campaign.name} — ${o.decision.kind === "protect" ? o.decision.reason : ""}`);
    }
  }
  if (input.fatigueWarnings.length > 0) {
    lines.push("", "Выгорание креатива:");
    for (const w of input.fatigueWarnings) lines.push(`  ⚠ ${w}`);
  }
  if (failed.length > 0) {
    lines.push("", "Не удалось применить:");
    for (const o of failed) lines.push(`  ! ${o.campaign.name} — ${o.error}`);
  }
  if (
    scaled.length === 0 && paused.length === 0 &&
    protectedOnes.length === 0 && input.fatigueWarnings.length === 0
  ) {
    lines.push("", "Все кампании в норме — вмешательство не требуется.");
  }

  return lines.join("\n");
}

/** Токен или доступ к кабинету отвалился — оптимизация фактически не работает. */
export function isAccessProblem(message: string): boolean {
  return /oauth|access token|session has expired|#190|"code":\s*190|#100|"code":\s*100|account.*(disab|restrict|block)|temporarily blocked|cannot be loaded/i
    .test(message);
}
