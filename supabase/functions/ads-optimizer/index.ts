/**
 * Ежедневная оптимизация рекламы: собирает метрики кабинета, принимает решения
 * по каждой кампании и отчитывается в Telegram. Заменяет вторую половину
 * воркфлоу n8n (`Schedule Trigger` → `Auto-Pause` → `Format Report`).
 *
 * Решения принимает чистый модуль _lib/adsOptimizer.ts — здесь только сбор
 * данных и применение действий в Meta.
 *
 * Запуски: два крона (утро — только отчёт, вечер — с изменениями) и ручной
 * вызов из интерфейса. `dry_run: true` считает, но ничего не меняет.
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { AUTH_CORS_HEADERS, requireUser, userHasAnyRole } from "../_lib/auth.ts";
import { resolveMetaAccessToken } from "../_lib/metaToken.ts";
import { graph, MetaApiError } from "../_lib/metaGraph.ts";
import { normalizeActId } from "../_lib/metaAds.ts";
import {
  buildReport,
  type CampaignOutcome,
  type CampaignSnapshot,
  countLeadsFromActions,
  decideCampaign,
  DEFAULT_THRESHOLDS,
  detectFatigue,
  isAccessProblem,
  type MetaAction,
  type OptimizerThresholds,
} from "../_lib/adsOptimizer.ts";

const corsHeaders = AUTH_CORS_HEADERS;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function admin(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

async function authorize(req: Request, db: SupabaseClient): Promise<boolean> {
  const key = req.headers.get("x-automation-key");
  if (key) {
    const { data } = await db
      .from("automation_settings")
      .select("cron_secret")
      .eq("id", true)
      .maybeSingle();
    const secret = (data as { cron_secret?: string | null } | null)?.cron_secret ?? null;
    if (secret && key === secret) return true;
  }
  const auth = await requireUser(req);
  if (!auth.ok) return false;
  return await userHasAnyRole(auth.userId, ["admin", "manager"]);
}

/** Утро или вечер по времени Алматы — как в ноде n8n `Detect Mode`. */
function detectMode(now: Date): "morning" | "night" {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Almaty",
      hour: "2-digit",
      hour12: false,
    }).format(now),
  );
  return hour >= 7 && hour < 15 ? "morning" : "night";
}

/* ────────────────────────────── пороги проекта ───────────────────────── */

function thresholdsFromRow(row: Record<string, unknown> | null): OptimizerThresholds {
  if (!row) return DEFAULT_THRESHOLDS;
  const num = (key: string, fallback: number) => {
    const v = Number(row[key]);
    return Number.isFinite(v) ? v : fallback;
  };
  return {
    maxCpl: num("max_cpl", DEFAULT_THRESHOLDS.maxCpl),
    maxSpendNoLead: num("max_spend_no_lead", DEFAULT_THRESHOLDS.maxSpendNoLead),
    emergencySpend: num("emergency_spend", DEFAULT_THRESHOLDS.emergencySpend),
    minQualityScore: num("min_quality_score", DEFAULT_THRESHOLDS.minQualityScore),
    qualityShield: num("quality_shield", DEFAULT_THRESHOLDS.qualityShield),
    gracePeriodDays: num("grace_period_days", DEFAULT_THRESHOLDS.gracePeriodDays),
    scaleMinScore: num("scale_min_score", DEFAULT_THRESHOLDS.scaleMinScore),
    scaleMaxCpl: num("scale_max_cpl", DEFAULT_THRESHOLDS.scaleMaxCpl),
    scaleStep: num("scale_step", DEFAULT_THRESHOLDS.scaleStep),
    scaleCapUsd: num("scale_cap_usd", DEFAULT_THRESHOLDS.scaleCapUsd),
    crmScaleCapUsd: num("crm_scale_cap_usd", DEFAULT_THRESHOLDS.crmScaleCapUsd),
    scaleMinDepth3Rate: num("scale_min_depth3_rate", DEFAULT_THRESHOLDS.scaleMinDepth3Rate),
    qualifiedAiScoreMin: num("qualified_ai_score_min", DEFAULT_THRESHOLDS.qualifiedAiScoreMin),
    qualifiedRateMinPause: num("qualified_rate_min_pause", DEFAULT_THRESHOLDS.qualifiedRateMinPause),
    qualifiedRateMinScale: num("qualified_rate_min_scale", DEFAULT_THRESHOLDS.qualifiedRateMinScale),
    qualifiedLeadsMinForPause: num(
      "qualified_leads_min_for_pause",
      DEFAULT_THRESHOLDS.qualifiedLeadsMinForPause,
    ),
    fatigueFrequency: num("fatigue_frequency", DEFAULT_THRESHOLDS.fatigueFrequency),
    fatigueFrequencySoft: num("fatigue_frequency_soft", DEFAULT_THRESHOLDS.fatigueFrequencySoft),
    fatigueCtrDrop: num("fatigue_ctr_drop", DEFAULT_THRESHOLDS.fatigueCtrDrop),
    fatigueMinImpressions: num("fatigue_min_impressions", DEFAULT_THRESHOLDS.fatigueMinImpressions),
  };
}

/* ────────────────────────────── сбор метрик ──────────────────────────── */

interface InsightRow {
  campaign_id?: string;
  campaign_name?: string;
  spend?: string;
  actions?: MetaAction[];
  ctr?: string;
  frequency?: string;
  impressions?: string;
}

interface PeriodMap {
  [campaignId: string]: {
    spend: number;
    leads: number;
    cpl: number;
    ctr: number;
    frequency: number;
    impressions: number;
    name: string;
  };
}

async function fetchInsights(
  actId: string,
  token: string,
  datePreset: string,
): Promise<PeriodMap> {
  const res = await graph<{ data?: InsightRow[] }>(`${actId}/insights`, {
    token,
    query: {
      fields: "campaign_id,campaign_name,spend,actions,ctr,frequency,impressions",
      date_preset: datePreset,
      level: "campaign",
      limit: 200,
    },
    timeoutMs: 45_000,
  });
  const map: PeriodMap = {};
  for (const row of res.data ?? []) {
    if (!row.campaign_id) continue;
    const spend = Number(row.spend ?? 0);
    const leads = countLeadsFromActions(row.actions);
    map[row.campaign_id] = {
      spend,
      leads,
      cpl: leads > 0 ? spend / leads : 0,
      ctr: Number(row.ctr ?? 0),
      frequency: Number(row.frequency ?? 0),
      impressions: Number(row.impressions ?? 0),
      name: row.campaign_name ?? row.campaign_id,
    };
  }
  return map;
}

interface CampaignMeta {
  name: string;
  createdTime: string | null;
  effectiveStatus: string;
}

async function fetchCampaigns(
  actId: string,
  token: string,
): Promise<Record<string, CampaignMeta>> {
  const res = await graph<{
    data?: Array<{ id?: string; name?: string; created_time?: string; effective_status?: string }>;
  }>(`${actId}/campaigns`, {
    token,
    query: { fields: "id,name,created_time,effective_status", limit: 200 },
    timeoutMs: 30_000,
  });
  const map: Record<string, CampaignMeta> = {};
  for (const c of res.data ?? []) {
    if (!c.id) continue;
    map[c.id] = {
      name: c.name ?? c.id,
      createdTime: c.created_time ?? null,
      effectiveStatus: c.effective_status ?? "",
    };
  }
  return map;
}

/** Бюджет живёт на группе (ABO), поэтому растим именно её. */
async function fetchAdSetBudgets(
  actId: string,
  token: string,
): Promise<Record<string, { adSetId: string; dailyBudgetCents: number }>> {
  const res = await graph<{
    data?: Array<{
      id?: string;
      daily_budget?: string;
      effective_status?: string;
      campaign_id?: string;
    }>;
  }>(`${actId}/adsets`, {
    token,
    query: { fields: "id,name,daily_budget,effective_status,campaign_id", limit: 200 },
    timeoutMs: 30_000,
  });

  const best: Record<string, { adSetId: string; dailyBudgetCents: number }> = {};
  for (const a of res.data ?? []) {
    if (!a.id || !a.campaign_id) continue;
    if (a.effective_status === "DELETED" || a.effective_status === "ARCHIVED") continue;
    const budget = Number.parseInt(a.daily_budget ?? "0", 10);
    if (!Number.isFinite(budget) || budget <= 0) continue;
    // Если групп несколько, растим самую крупную — она и везёт трафик.
    const current = best[a.campaign_id];
    if (!current || budget > current.dailyBudgetCents) {
      best[a.campaign_id] = { adSetId: a.id, dailyBudgetCents: budget };
    }
  }
  return best;
}

interface CrmSignal {
  total: number;
  qualified: number;
  paid: number;
  scheduled: number;
  arrived: number;
  depth3: number;
}

/**
 * Сигналы из CRM по кампаниям за 3 дня. Связь идёт по `leads.meta_campaign_id`,
 * а не по совпадению названия кампании, как это делалось в n8n: переименование
 * кампании больше не рвёт связь с лидами.
 */
async function fetchCrmSignals(
  db: SupabaseClient,
  projectId: string | null,
  qualifiedAiScoreMin: number,
): Promise<Record<string, CrmSignal>> {
  const since = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
  let query = db
    .from("leads")
    .select("meta_campaign_id, ai_score, paid, stage_id, created_at")
    .not("meta_campaign_id", "is", null)
    .gte("created_at", since);
  if (projectId) query = query.eq("project_id", projectId);

  const { data, error } = await query;
  if (error) {
    console.warn("[ads-optimizer] leads:", error.message);
    return {};
  }

  const { data: stages } = await db
    .from("pipeline_stages")
    .select("id, key, order_index");
  const stageBymeta = new Map<string, { key: string; order: number }>();
  for (const s of (stages ?? []) as Array<Record<string, unknown>>) {
    stageBymeta.set(String(s.id), {
      key: String(s.key ?? ""),
      order: Number(s.order_index ?? 0),
    });
  }

  const out: Record<string, CrmSignal> = {};
  for (const raw of (data ?? []) as Array<Record<string, unknown>>) {
    const campaignId = String(raw.meta_campaign_id ?? "");
    if (!campaignId) continue;
    const bucket = out[campaignId] ??= {
      total: 0, qualified: 0, paid: 0, scheduled: 0, arrived: 0, depth3: 0,
    };
    bucket.total++;
    if (Number(raw.ai_score ?? 0) >= qualifiedAiScoreMin) bucket.qualified++;

    const stage = stageBymeta.get(String(raw.stage_id ?? ""));
    const key = stage?.key ?? "";
    if (raw.paid === true || key === "paid") bucket.paid++;
    if (key === "scheduled") bucket.scheduled++;
    if (key === "visit") bucket.arrived++;
    // «Дошёл до третьего этапа» — запись, визит или оплата.
    if (key === "scheduled" || key === "visit" || key === "paid" || raw.paid === true) {
      bucket.depth3++;
    }
  }
  return out;
}

/* ────────────────────────────── обработка кабинета ───────────────────── */

interface CabinetResult {
  cabinet: string;
  ok: boolean;
  error?: string;
  paused?: number;
  scaled?: number;
  report?: string;
}

async function processCabinet(
  db: SupabaseClient,
  cabinet: Record<string, unknown>,
  mode: "morning" | "night",
  dryRun: boolean,
): Promise<CabinetResult> {
  const name = String(cabinet.name ?? cabinet.ad_account_id ?? "Кабинет");
  const actId = normalizeActId(String(cabinet.ad_account_id ?? cabinet.external_id ?? ""));
  const projectId = cabinet.project_id ? String(cabinet.project_id) : null;
  if (!actId) return { cabinet: name, ok: false, error: "Не заполнен рекламный аккаунт" };

  const { data: settingsRow } = projectId
    ? await db.from("ads_optimizer_settings").select("*").eq("project_id", projectId).maybeSingle()
    : { data: null };
  if (settingsRow && (settingsRow as { enabled?: boolean }).enabled === false) {
    return { cabinet: name, ok: true, error: undefined, paused: 0, scaled: 0 };
  }
  const thresholds = thresholdsFromRow(settingsRow as Record<string, unknown> | null);

  const token = await resolveMetaAccessToken({
    cabinetId: String(cabinet.id),
    projectId,
    admin: db,
  });
  if (!token) return { cabinet: name, ok: false, error: "Нет токена Meta" };

  let rolling: PeriodMap = {};
  let today: PeriodMap = {};
  let campaigns: Record<string, CampaignMeta> = {};
  let budgets: Record<string, { adSetId: string; dailyBudgetCents: number }> = {};
  let healthAlert: string | null = null;

  try {
    [rolling, today, campaigns, budgets] = await Promise.all([
      fetchInsights(actId, token, "last_3d"),
      fetchInsights(actId, token, "today"),
      fetchCampaigns(actId, token),
      fetchAdSetBudgets(actId, token),
    ]);
  } catch (e) {
    const message = (e as Error).message ?? String(e);
    if (isAccessProblem(message)) {
      healthAlert =
        `⚠️ Нет доступа к кабинету «${name}». Возможно, истёк токен или аккаунт ` +
        `заблокирован — оптимизация и открутка рекламы могут не работать.`;
      await notifyTelegram(cabinet, healthAlert);
      return { cabinet: name, ok: false, error: healthAlert };
    }
    return { cabinet: name, ok: false, error: message };
  }

  const crm = await fetchCrmSignals(db, projectId, thresholds.qualifiedAiScoreMin);

  const outcomes: CampaignOutcome[] = [];
  const fatigueWarnings: string[] = [];
  const now = Date.now();

  for (const [campaignId, meta] of Object.entries(campaigns)) {
    if (meta.effectiveStatus === "DELETED" || meta.effectiveStatus === "ARCHIVED") continue;
    if (meta.effectiveStatus === "PAUSED") continue;

    const r = rolling[campaignId];
    const t = today[campaignId];
    if (!r && !t) continue; // Кампания без показов — судить не о чем.

    const signal = crm[campaignId] ?? null;
    const created = meta.createdTime ? Date.parse(meta.createdTime) : NaN;
    const ageHours = Number.isFinite(created) ? (now - created) / 3.6e6 : 0;
    const budget = budgets[campaignId];

    // Качество и «score» считаем от CRM: без достаточного числа лидов данным
    // не доверяем и оставляем 0 — тогда рост бюджета невозможен, а остановка
    // за высокий CPL по-прежнему работает.
    const quality = signal && signal.total >= thresholds.qualifiedLeadsMinForPause
      ? {
        total: signal.total,
        qualified: signal.qualified,
        rate: Math.round((signal.qualified / signal.total) * 100),
      }
      : null;

    const snapshot: CampaignSnapshot = {
      campaignId,
      name: meta.name,
      adSetId: budget?.adSetId ?? null,
      rolling: {
        spend: r?.spend ?? 0,
        leads: r?.leads ?? 0,
        cpl: r?.cpl ?? 0,
        ctr: r?.ctr ?? 0,
        frequency: r?.frequency ?? 0,
        impressions: r?.impressions ?? 0,
      },
      today: {
        spend: t?.spend ?? 0,
        leads: t?.leads ?? 0,
        cpl: t?.cpl ?? 0,
        ctr: t?.ctr ?? 0,
      },
      score: quality?.rate ?? 0,
      daysActive: Math.max(1, Math.floor(ageHours / 24)),
      ageHours,
      scoreTrend: "stable",
      cplTrend: "stable",
      depth3Rate: signal && signal.total > 0
        ? Math.round((signal.depth3 / signal.total) * 100)
        : 0,
      quality,
      crm: {
        paid: signal?.paid ?? 0,
        scheduled: signal?.scheduled ?? 0,
        arrived: signal?.arrived ?? 0,
      },
      currentDailyBudgetCents: budget?.dailyBudgetCents ?? null,
    };

    const warning = detectFatigue(snapshot, thresholds);
    if (warning) fatigueWarnings.push(warning);

    const decision = decideCampaign(snapshot, thresholds);
    // Утренний прогон только отчитывается — так было и в n8n.
    const shouldApply = mode === "night" && !dryRun &&
      (decision.kind === "pause" || decision.kind === "scale");

    let applied = false;
    let error: string | null = null;
    if (shouldApply) {
      try {
        if (decision.kind === "pause") {
          await graph(campaignId, { token, method: "POST", body: { status: "PAUSED" } });
        } else if (decision.kind === "scale" && snapshot.adSetId) {
          await graph(snapshot.adSetId, {
            token,
            method: "POST",
            body: { daily_budget: String(decision.newBudgetCents) },
          });
        }
        applied = true;
      } catch (e) {
        error = e instanceof MetaApiError ? e.message : (e as Error).message;
      }
    }

    outcomes.push({ campaign: snapshot, decision, applied, error });
  }

  const report = buildReport({ cabinetName: name, mode, outcomes, fatigueWarnings, healthAlert });
  await notifyTelegram(cabinet, report);

  return {
    cabinet: name,
    ok: true,
    paused: outcomes.filter((o) => o.decision.kind === "pause" && o.applied).length,
    scaled: outcomes.filter((o) => o.decision.kind === "scale" && o.applied).length,
    report,
  };
}

async function notifyTelegram(cabinet: Record<string, unknown>, text: string): Promise<void> {
  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = String(cabinet.telegram_group_id ?? "").trim();
  if (!botToken || !chatId || !text) return;
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000) }),
    signal: AbortSignal.timeout(15_000),
  }).catch((e) => console.warn("[ads-optimizer] telegram:", (e as Error).message));
}

/* ────────────────────────────── точка входа ──────────────────────────── */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const db = admin();
  if (!(await authorize(req, db))) return json({ error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => ({})) as {
    mode?: "morning" | "night";
    cabinet_id?: string;
    dry_run?: boolean;
  };
  const mode = body.mode === "morning" || body.mode === "night"
    ? body.mode
    : detectMode(new Date());
  const dryRun = body.dry_run === true;

  let query = db.from("ad_cabinets").select("*");
  if (body.cabinet_id) query = query.eq("id", body.cabinet_id);
  const { data: cabinets, error } = await query;
  if (error) return json({ error: `Кабинеты недоступны: ${error.message}` }, 500);

  const results: CabinetResult[] = [];
  for (const row of (cabinets ?? []) as Array<Record<string, unknown>>) {
    // Google-кабинеты и органический Instagram этот оптимизатор не трогает.
    const provider = String(row.provider ?? "meta");
    if (provider !== "meta") continue;
    try {
      results.push(await processCabinet(db, row, mode, dryRun));
    } catch (e) {
      results.push({
        cabinet: String(row.name ?? row.id),
        ok: false,
        error: (e as Error).message,
      });
    }
  }

  return json({ ok: true, mode, dry_run: dryRun, results });
});
