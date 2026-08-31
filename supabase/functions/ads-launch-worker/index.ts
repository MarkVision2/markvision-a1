/**
 * Разбор очереди запусков рекламы: `ad_launch_jobs` → кампания в Meta.
 *
 * Заменяет воркфлоу n8n `AI-targetolog1` на пути «запуск с сайта».
 * Задание проходит по шагам, и результат каждого шага записывается ДО
 * перехода к следующему, поэтому повтор после сбоя не создаёт дублей.
 *
 * Вызывается двумя способами:
 *   - крон `ads-launch-worker-minutely` (заголовок x-automation-key);
 *   - мгновенный пинок из launch-campaign сразу после постановки в очередь.
 *
 * Логика сборки тел — _lib/metaAds.ts, гео — _lib/metaGeo.ts, сеть — _lib/metaGraph.ts.
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { AUTH_CORS_HEADERS, requireUser, userHasAnyRole } from "../_lib/auth.ts";
import { resolveMetaAccessToken } from "../_lib/metaToken.ts";
import {
  buildAdBody,
  buildAdSetBody,
  buildCampaignBody,
  buildCampaignObjective,
  buildCreativeBody,
  buildLinkContext,
  buildNames,
  buildTargeting,
  campaignGroupKey,
  cleanUrl,
  deriveHeadline,
  normalizeActId,
  resolveStartTime,
  validateLaunch,
  type CabinetConfig,
  type CreativeFormat,
  type LaunchGoal,
  type LaunchInput,
} from "../_lib/metaAds.ts";
import { buildGeoLocations } from "../_lib/metaGeo.ts";
import {
  campaignIsLive,
  countLiveAdSets,
  createAd,
  createAdCreative,
  createAdSet,
  createCampaign,
  getAdAccountMoney,
  getVideoState,
  makeGeoSearch,
  MetaApiError,
  resolveActiveLeadForm,
  uploadVideoByUrl,
} from "../_lib/metaGraph.ts";

const corsHeaders = AUTH_CORS_HEADERS;

/** Сколько работаем за один вызов: остаток задач доберёт следующий тик крона. */
const WALL_CLOCK_BUDGET_MS = 45_000;
/** Повторов на одном шаге до окончательной ошибки. */
const MAX_ATTEMPTS = 5;
/** Сколько всего ждём обработку видео на стороне Meta. */
const VIDEO_WAIT_LIMIT_MS = 30 * 60_000;

type Step =
  | "resolve"
  | "collect"
  | "media"
  | "awaiting_video"
  | "creative"
  | "campaign"
  | "adset"
  | "ad"
  | "sync";

interface JobRow {
  id: string;
  launch_id: string;
  project_id: string | null;
  cabinet_id: string;
  status: string;
  step: Step;
  attempts: number;
  request: Record<string, unknown>;
  meta_image_hash: string | null;
  meta_video_id: string | null;
  meta_creative_id: string | null;
  meta_campaign_id: string | null;
  meta_adset_id: string | null;
  meta_ad_id: string | null;
  telegram_media_group_id: string | null;
  created_at: string;
}

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

/** Пауза перед следующей попыткой: 1, 4, 16, 64 минуты. */
function backoffSeconds(attempts: number): number {
  return Math.min(60 * 4 ** Math.max(0, attempts - 1), 3600);
}

/* ────────────────────────────── авторизация ──────────────────────────── */

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
  // Ручной запуск из интерфейса — по роли пользователя.
  const auth = await requireUser(req);
  if (!auth.ok) return false;
  return await userHasAnyRole(auth.userId, ["admin", "manager"]);
}

/* ────────────────────────── зеркало статуса в UI ─────────────────────── */

/**
 * Интерфейс читает ad_campaigns реалтаймом, поэтому каждый шаг отражаем туда.
 * Это и есть замена статус-колбэку n8n, который приходил только при успехе.
 */
async function mirrorStatus(
  db: SupabaseClient,
  launchId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await db
    .from("ad_campaigns")
    .update({ ...patch, status_updated_at: new Date().toISOString() })
    .eq("launch_id", launchId);
  if (error) console.error("[ads-launch-worker] mirror:", error.message);
}

const STEP_MESSAGES: Record<Step, string> = {
  resolve: "Проверяем настройки кабинета",
  collect: "Собираем кадры альбома",
  media: "Загружаем креатив в Meta",
  awaiting_video: "Meta обрабатывает видео",
  creative: "Собираем объявление",
  campaign: "Создаём кампанию",
  adset: "Создаём группу объявлений",
  ad: "Публикуем объявление",
  sync: "Сохраняем результат",
};

/* ──────────────────────────── конфиг кабинета ────────────────────────── */

interface Loaded {
  cabinet: CabinetConfig;
  cabinetRow: Record<string, unknown>;
  input: LaunchInput;
  token: string;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v);
}

/**
 * Кабинет плюс переопределения из мастера: менеджер мог выбрать другую
 * страницу, свой сайт или другую лид-форму — они важнее настроек кабинета.
 */
async function loadJobContext(db: SupabaseClient, job: JobRow): Promise<Loaded> {
  const { data: row, error } = await db
    .from("ad_cabinets")
    .select("*")
    .eq("id", job.cabinet_id)
    .maybeSingle();
  if (error) throw new Error(`Кабинет не прочитался: ${error.message}`);
  if (!row) throw new Error("Кабинет удалён — запускать нечего.");

  const cab = row as Record<string, unknown>;
  const req = job.request;

  const cabinet: CabinetConfig = {
    clientName: str(cab.name),
    adAccountId: normalizeActId(str(req.adAccountId) || str(cab.ad_account_id) || str(cab.external_id)),
    pageId: str(req.pageId) || str(cab.page_id),
    instagramUserId: str(req.instagramUserId) || str(cab.instagram_id),
    pixelId: str(req.pixelId) || str(cab.pixel_id),
    pixelEvent: str(req.pixelEvent) || str(cab.pixel_event) || "Lead",
    websiteUrl: str(req.websiteUrl) || str(cab.website_url) || str(cab.landing_url),
    whatsappNumber: str(req.whatsappNumber) || str(cab.whatsapp_number),
    leadFormId: str(req.leadFormId) || str(cab.lead_form_id),
    wabaPhoneNumberId: str(cab.waba_phone_number_id),
    timezone: str(cab.timezone) || "Asia/Almaty",
  };

  // Заголовок и услугу мастер не собирает — выводим из текста объявления,
  // иначе все кампании клиента назывались бы одинаково.
  const text = str(req.text);
  const derived = deriveHeadline(text);

  const input: LaunchInput = {
    goal: (str(req.goal) || "whatsapp") as LaunchGoal,
    budgetUsd: Number(req.budgetUsd ?? 0),
    text,
    headline: str(req.headline) || derived || null,
    codeWord: str(req.codeWord) || null,
    service: str(req.service) || derived || deriveHeadline(str(cab.brief)) || null,
    creative: {
      format: (str(req.format) || "single") as CreativeFormat,
      imageHash: job.meta_image_hash ?? (str(req.imageHash) || null),
      imageHashes: Array.isArray(req.imageHashes) ? (req.imageHashes as string[]) : [],
      videoId: job.meta_video_id ?? (str(req.videoId) || null),
      videoThumbUrl: str(req.videoThumbUrl) || null,
      sourceInstagramMediaId: str(req.sourceInstagramMediaId) || null,
    },
  };

  const token = await resolveMetaAccessToken({
    cabinetId: job.cabinet_id,
    projectId: job.project_id,
    admin: db,
  });
  if (!token) {
    throw new Error("Нет токена Meta: подключите Facebook в настройках кабинета.");
  }

  return { cabinet, cabinetRow: cab, input, token };
}

/* ───────────────────────────── шаги задания ──────────────────────────── */

/** Ошибка, которую повторять бессмысленно: настройка неверна или медиа битое. */
class PermanentError extends Error {}

async function stepResolve(db: SupabaseClient, job: JobRow, ctx: Loaded): Promise<Step> {
  // Лид-форма могла быть не выбрана — подставляем первую активную у страницы.
  if (job.request.goal === "meta-form" && !cleanUrl(ctx.cabinet.leadFormId)) {
    const pageId = cleanUrl(ctx.cabinet.pageId);
    if (pageId) {
      const formId = await resolveActiveLeadForm(pageId, ctx.token).catch(() => null);
      if (formId) {
        ctx.cabinet.leadFormId = formId;
        await db.from("ad_launch_jobs")
          .update({ request: { ...job.request, leadFormId: formId } })
          .eq("id", job.id);
        job.request = { ...job.request, leadFormId: formId };
      }
    }
  }

  const problems = validateLaunch(ctx.input, ctx.cabinet);
  // Часть претензий на этом шаге преждевременна: видео ещё не отправлено в
  // Meta, а кадры альбома Telegram ещё долетают. Их проверит шаг creative.
  const pending = new Set(["Видео не загрузилось в Meta."]);
  if (job.telegram_media_group_id) {
    pending.add("Для карусели нужно минимум два изображения.");
  }
  const blocking = problems.filter((p) => !pending.has(p));
  if (blocking.length > 0) throw new PermanentError(blocking.join(" "));

  // Альбом из Telegram прилетает несколькими апдейтами — кадры собираем отдельно.
  if (job.telegram_media_group_id && ctx.input.creative.format === "carousel") {
    return "collect";
  }
  if (ctx.input.creative.format !== "video") return "creative";
  // Видео чаще всего уже отправлено в Meta мастером запуска — остаётся дождаться
  // обработки. Ссылку на файл обрабатывает шаг media.
  return ctx.input.creative.videoId ? "awaiting_video" : "media";
}

/**
 * Кадры альбома Telegram. Порядок задаёт message_id: Telegram не гарантирует
 * очерёдность апдейтов, а в карусели порядок картинок виден пользователю.
 */
async function stepCollect(db: SupabaseClient, job: JobRow, ctx: Loaded): Promise<Step> {
  const groupId = job.telegram_media_group_id;
  if (!groupId) return "creative";

  const { data, error } = await db
    .from("ad_telegram_media")
    .select("message_id, meta_image_hash")
    .eq("media_group_id", groupId)
    .order("message_id", { ascending: true });
  if (error) throw new Error(`Кадры альбома не прочитались: ${error.message}`);

  const hashes = (data ?? [])
    .map((r) => String((r as Record<string, unknown>).meta_image_hash ?? ""))
    .filter(Boolean);

  if (hashes.length === 0) {
    throw new PermanentError("Ни один кадр альбома не загрузился в Meta.");
  }

  // Пользователь прислал «альбом» из одного снимка — это обычное объявление.
  if (hashes.length === 1) {
    ctx.input.creative.format = "single";
    ctx.input.creative.imageHash = hashes[0];
    await db.from("ad_launch_jobs")
      .update({
        meta_image_hash: hashes[0],
        request: { ...job.request, format: "single", imageHash: hashes[0] },
      })
      .eq("id", job.id);
    job.request = { ...job.request, format: "single", imageHash: hashes[0] };
    job.meta_image_hash = hashes[0];
    return "creative";
  }

  ctx.input.creative.imageHashes = hashes;
  await db.from("ad_launch_jobs")
    .update({ request: { ...job.request, imageHashes: hashes } })
    .eq("id", job.id);
  job.request = { ...job.request, imageHashes: hashes };
  return "creative";
}

async function stepMedia(db: SupabaseClient, job: JobRow, ctx: Loaded): Promise<Step> {
  const videoUrl = str(job.request.videoUrl);
  if (!videoUrl) {
    throw new PermanentError("Для видео-объявления не передана ссылка на файл.");
  }
  const videoId = await uploadVideoByUrl(
    ctx.cabinet.adAccountId,
    ctx.token,
    videoUrl,
    str(job.request.videoFileName) || undefined,
  );
  await db.from("ad_launch_jobs").update({ meta_video_id: videoId }).eq("id", job.id);
  job.meta_video_id = videoId;
  ctx.input.creative.videoId = videoId;
  return "awaiting_video";
}

/** Возвращает null, если видео ещё обрабатывается — задание уснёт до тика крона. */
async function stepAwaitingVideo(
  db: SupabaseClient,
  job: JobRow,
  ctx: Loaded,
): Promise<Step | null> {
  const videoId = job.meta_video_id;
  if (!videoId) return "media";

  const state = await getVideoState(videoId, ctx.token);
  if (state.failed) {
    throw new PermanentError(
      `Meta не смогла обработать видео${state.message ? `: ${state.message}` : "."}`,
    );
  }
  if (!state.ready) {
    const waitedMs = Date.now() - Date.parse(job.created_at);
    if (waitedMs > VIDEO_WAIT_LIMIT_MS) {
      throw new PermanentError("Meta не обработала видео за 30 минут.");
    }
    return null;
  }
  if (state.thumbnailUrl && !ctx.input.creative.videoThumbUrl) {
    ctx.input.creative.videoThumbUrl = state.thumbnailUrl;
    await db.from("ad_launch_jobs")
      .update({ request: { ...job.request, videoThumbUrl: state.thumbnailUrl } })
      .eq("id", job.id);
    job.request = { ...job.request, videoThumbUrl: state.thumbnailUrl };
  }
  return "creative";
}

async function stepCreative(db: SupabaseClient, job: JobRow, ctx: Loaded): Promise<Step> {
  const problems = validateLaunch(ctx.input, ctx.cabinet);
  if (problems.length > 0) throw new PermanentError(problems.join(" "));

  const linkCtx = buildLinkContext(ctx.input, ctx.cabinet);
  const names = buildNames({
    clientName: ctx.cabinet.clientName,
    service: ctx.input.service,
    format: ctx.input.creative.format,
    destination: linkCtx.destination,
    now: new Date(),
    timeZone: ctx.cabinet.timezone,
    groupIndex: 1,
  });

  const creativeId = await createAdCreative(
    ctx.cabinet.adAccountId,
    ctx.token,
    buildCreativeBody({
      name: `${names.ad} | creative`,
      input: ctx.input,
      cabinet: ctx.cabinet,
      ctx: linkCtx,
    }),
  );
  await db.from("ad_launch_jobs").update({ meta_creative_id: creativeId }).eq("id", job.id);
  job.meta_creative_id = creativeId;
  return "campaign";
}

/**
 * Кампания дня. Право её создать разыгрывается в БД: первый вставивший строку
 * в ad_campaign_groups создаёт кампанию, остальные ждут её id. Это заменяет
 * джиттер и четыре повтора, которыми гонку лечили в n8n.
 */
async function stepCampaign(
  db: SupabaseClient,
  job: JobRow,
  ctx: Loaded,
): Promise<Step | null> {
  const linkCtx = buildLinkContext(ctx.input, ctx.cabinet);
  const objective = buildCampaignObjective(linkCtx.destination, ctx.cabinet);
  const key = campaignGroupKey({
    adAccountId: ctx.cabinet.adAccountId,
    now: new Date(),
    timeZone: ctx.cabinet.timezone,
    destination: linkCtx.destination,
    objective,
  });

  const { data, error } = await db.rpc("claim_ad_campaign_group", {
    p_ad_account_id: key.adAccountId,
    p_date_key: key.dateKey,
    p_goal: key.goal,
    p_objective: key.objective,
    p_job_id: job.id,
  });
  if (error) throw new Error(`Консолидация кампаний недоступна: ${error.message}`);

  const claim = (Array.isArray(data) ? data[0] : data) as
    | { campaign_id: string | null; is_owner: boolean }
    | null;

  let isOwner = claim?.is_owner === true;

  // Кампания уже есть — но её могли удалить в кабинете вручную.
  if (claim?.campaign_id) {
    if (await campaignIsLive(claim.campaign_id, ctx.token)) {
      await db.from("ad_launch_jobs")
        .update({ meta_campaign_id: claim.campaign_id })
        .eq("id", job.id);
      job.meta_campaign_id = claim.campaign_id;
      return "adset";
    }
    // Кампании больше нет. Освобождаем ключ и сразу забираем право создать
    // новую: иначе задание ждало бы истечения десятиминутной аренды владельца,
    // которого уже нет.
    await db.from("ad_campaign_groups")
      .update({ meta_campaign_id: null, claimed_by: job.id })
      .eq("ad_account_id", key.adAccountId)
      .eq("date_key", key.dateKey)
      .eq("goal", key.goal)
      .eq("objective", key.objective);
    isOwner = true;
  }

  if (!isOwner) {
    // Кампанию создаёт соседнее задание — подождём его следующим тиком.
    return null;
  }

  const names = buildNames({
    clientName: ctx.cabinet.clientName,
    service: ctx.input.service,
    format: ctx.input.creative.format,
    destination: linkCtx.destination,
    now: new Date(),
    timeZone: ctx.cabinet.timezone,
    groupIndex: 1,
  });
  const campaignId = await createCampaign(
    ctx.cabinet.adAccountId,
    ctx.token,
    buildCampaignBody({
      name: names.campaign,
      destination: linkCtx.destination,
      cabinet: ctx.cabinet,
    }),
  );

  await db.rpc("set_ad_campaign_group_campaign", {
    p_ad_account_id: key.adAccountId,
    p_date_key: key.dateKey,
    p_goal: key.goal,
    p_objective: key.objective,
    p_campaign_id: campaignId,
  });
  await db.from("ad_launch_jobs")
    .update({ meta_campaign_id: campaignId })
    .eq("id", job.id);
  job.meta_campaign_id = campaignId;
  return "adset";
}

async function stepAdSet(db: SupabaseClient, job: JobRow, ctx: Loaded): Promise<Step> {
  if (!job.meta_campaign_id) return "campaign";

  const linkCtx = buildLinkContext(ctx.input, ctx.cabinet);
  // Индекс группы внутри кампании: g1, g2, g3 — как в именах n8n.
  const liveAdSets = await countLiveAdSets(job.meta_campaign_id, ctx.token).catch(() => 0);
  const names = buildNames({
    clientName: ctx.cabinet.clientName,
    service: ctx.input.service,
    format: ctx.input.creative.format,
    destination: linkCtx.destination,
    now: new Date(),
    timeZone: ctx.cabinet.timezone,
    groupIndex: liveAdSets + 1,
  });

  const geo = await buildGeoLocations(
    {
      city: str(ctx.cabinetRow.city),
      latitude: ctx.cabinetRow.clinic_lat as number | undefined,
      longitude: ctx.cabinetRow.clinic_lng as number | undefined,
      radiusKm: ctx.cabinetRow.default_radius_km as number | undefined,
      addressLabel: str(ctx.cabinetRow.clinic_address) || null,
    },
    makeGeoSearch(ctx.token),
  );

  // Валюта кабинета: Meta принимает daily_budget в её минорных единицах, и для
  // счёта в тенге «50» без этого превратилось бы в 50 тиын.
  const money = await getAdAccountMoney(ctx.cabinet.adAccountId, ctx.token)
    .catch(() => ({ currency: "USD", minorUnits: 100, minDailyBudget: null }));

  const adSetId = await createAdSet(
    ctx.cabinet.adAccountId,
    ctx.token,
    buildAdSetBody({
      name: names.adSet,
      campaignId: job.meta_campaign_id,
      destination: linkCtx.destination,
      cabinet: ctx.cabinet,
      budgetUsd: ctx.input.budgetUsd,
      minorUnits: money.minorUnits,
      targeting: buildTargeting(geo),
      startTime: resolveStartTime(new Date(), ctx.cabinet.timezone ?? "Asia/Almaty"),
    }),
  );

  await db.from("ad_launch_jobs")
    .update({ meta_adset_id: adSetId, request: { ...job.request, adName: names.ad } })
    .eq("id", job.id);
  job.meta_adset_id = adSetId;
  job.request = { ...job.request, adName: names.ad };
  return "ad";
}

async function stepAd(db: SupabaseClient, job: JobRow, ctx: Loaded): Promise<Step> {
  if (!job.meta_adset_id || !job.meta_creative_id) return "adset";
  const adId = await createAd(
    ctx.cabinet.adAccountId,
    ctx.token,
    buildAdBody({
      name: str(job.request.adName) || "Объявление",
      adSetId: job.meta_adset_id,
      creativeId: job.meta_creative_id,
      cabinet: ctx.cabinet,
    }),
  );
  await db.from("ad_launch_jobs").update({ meta_ad_id: adId }).eq("id", job.id);
  job.meta_ad_id = adId;
  return "sync";
}

/**
 * Финал: объявление видно в разделе «Креативы» сразу, не дожидаясь ночного
 * meta-structure-sync, и уходит уведомление в Telegram проекта.
 */
async function stepSync(db: SupabaseClient, job: JobRow, ctx: Loaded): Promise<void> {
  const linkCtx = buildLinkContext(ctx.input, ctx.cabinet);
  const creativeType = ctx.input.creative.format === "carousel"
    ? "carousel"
    : ctx.input.creative.format === "video"
    ? "video"
    : "image";

  const { error } = await db.from("meta_creatives").upsert({
    ad_id: job.meta_ad_id,
    adset_id: job.meta_adset_id,
    campaign_id: job.meta_campaign_id,
    cabinet_id: job.cabinet_id,
    project_id: job.project_id,
    name: str(job.request.adName) || "Объявление",
    status: "ACTIVE",
    effective_status: "ACTIVE",
    creative_type: creativeType,
    video_id: job.meta_video_id,
    primary_text: ctx.input.text || null,
    headline: ctx.input.headline || null,
    cta: linkCtx.destination === "whatsapp" ? "WHATSAPP_MESSAGE" : "LEARN_MORE",
    destination_url: linkCtx.finalLink || null,
    last_synced_at: new Date().toISOString(),
  }, { onConflict: "ad_id" });
  if (error) console.error("[ads-launch-worker] meta_creatives:", error.message);

  // Таблицу campaign_learnings ведёт ежедневный оптимизатор (пока в n8n) и она
  // не описана миграциями — пишем строку, но не считаем ошибку критичной.
  try {
    await db.from("campaign_learnings").upsert({
      project_id: job.project_id,
      client_config_id: job.cabinet_id,
      fb_campaign_id: job.meta_campaign_id,
      fb_adset_id: job.meta_adset_id,
      fb_ad_id: job.meta_ad_id,
      campaign_name: str(job.request.adName),
      ad_text: ctx.input.text || "",
      headline: ctx.input.headline || "",
      media_type: creativeType.toUpperCase(),
      quality_score: 0,
      score_label: "NEW",
      is_winner: false,
      is_paused: false,
      updated_at: new Date().toISOString(),
    }, { onConflict: "fb_campaign_id" });
  } catch (e) {
    console.warn("[ads-launch-worker] campaign_learnings:", (e as Error).message);
  }

  await notifyTelegram(ctx, job);
}

async function notifyTelegram(ctx: Loaded, job: JobRow): Promise<void> {
  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = str(ctx.cabinetRow.telegram_group_id);
  if (!botToken || !chatId) return;

  const text = [
    "✅ Реклама запущена",
    `Клиент: ${ctx.cabinet.clientName}`,
    `Бюджет: $${ctx.input.budgetUsd}/сутки`,
    `Кампания: ${job.meta_campaign_id}`,
    `Объявление: ${job.meta_ad_id}`,
  ].join("\n");

  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
    signal: AbortSignal.timeout(15_000),
  }).catch((e) => console.warn("[ads-launch-worker] telegram:", (e as Error).message));
}

/* ──────────────────────────── прогон задания ─────────────────────────── */

async function runJob(db: SupabaseClient, job: JobRow, deadline: number): Promise<string> {
  let ctx: Loaded;
  try {
    ctx = await loadJobContext(db, job);
  } catch (e) {
    return await failJob(db, job, e as Error, true);
  }

  let step: Step = job.step;
  while (Date.now() < deadline) {
    try {
      await mirrorStatus(db, job.launch_id, {
        status: "running",
        status_step: step,
        status_message: STEP_MESSAGES[step] ?? step,
      });

      let next: Step | null;
      switch (step) {
        case "resolve":
          next = await stepResolve(db, job, ctx);
          break;
        case "collect":
          next = await stepCollect(db, job, ctx);
          break;
        case "media":
          next = await stepMedia(db, job, ctx);
          break;
        case "awaiting_video":
          next = await stepAwaitingVideo(db, job, ctx);
          break;
        case "creative":
          next = await stepCreative(db, job, ctx);
          break;
        case "campaign":
          next = await stepCampaign(db, job, ctx);
          break;
        case "adset":
          next = await stepAdSet(db, job, ctx);
          break;
        case "ad":
          next = await stepAd(db, job, ctx);
          break;
        case "sync":
          await stepSync(db, job, ctx);
          return await completeJob(db, job);
        default:
          throw new PermanentError(`Неизвестный шаг «${step}»`);
      }

      if (next === null) {
        // Ждём внешнее событие (обработку видео или соседнее задание).
        const waiting = step === "awaiting_video" ? "awaiting_video" : "queued";
        await db.from("ad_launch_jobs").update({
          status: waiting,
          step,
          attempts: 0,
          locked_at: null,
          next_attempt_at: new Date(Date.now() + 30_000).toISOString(),
        }).eq("id", job.id);
        await mirrorStatus(db, job.launch_id, {
          status: "running",
          status_step: step,
          status_message: STEP_MESSAGES[step] ?? step,
        });
        return "waiting";
      }

      // Шаг прошёл — сбрасываем счётчик попыток: он считает застревание, не работу.
      step = next;
      await db.from("ad_launch_jobs")
        .update({ step, status: "running", attempts: 0 })
        .eq("id", job.id);
      job.step = step;
    } catch (e) {
      return await failJob(db, job, e as Error, e instanceof PermanentError);
    }
  }

  // Бюджет времени вышел — продолжим на следующем тике, состояние сохранено.
  await db.from("ad_launch_jobs").update({
    status: "queued",
    step,
    locked_at: null,
    attempts: 0,
    next_attempt_at: new Date().toISOString(),
  }).eq("id", job.id);
  return "deferred";
}

async function completeJob(db: SupabaseClient, job: JobRow): Promise<string> {
  const now = new Date().toISOString();
  await db.from("ad_launch_jobs").update({
    status: "success",
    step: "sync",
    locked_at: null,
    completed_at: now,
    last_error: null,
  }).eq("id", job.id);
  await mirrorStatus(db, job.launch_id, {
    status: "success",
    status_step: "done",
    status_message: "Реклама запущена",
    meta_campaign_id: job.meta_campaign_id,
    meta_adset_id: job.meta_adset_id,
    meta_ad_id: job.meta_ad_id,
    last_error: null,
    completed_at: now,
  });
  return "success";
}

/**
 * Временные сбои Meta повторяем с нарастающей паузой; неверную настройку —
 * сразу в ошибку с текстом, который увидит менеджер. Раньше любая ошибка
 * оставляла запуск в вечном queued без объяснения.
 */
async function failJob(
  db: SupabaseClient,
  job: JobRow,
  error: Error,
  permanent: boolean,
): Promise<string> {
  const message = error.message || "Неизвестная ошибка";
  const metaTransient = error instanceof MetaApiError ? error.transient : false;
  const retryable = !permanent && (metaTransient || !(error instanceof MetaApiError));
  const exhausted = job.attempts >= MAX_ATTEMPTS;

  if (retryable && !exhausted) {
    const delay = backoffSeconds(job.attempts);
    await db.from("ad_launch_jobs").update({
      status: "queued",
      locked_at: null,
      last_error: message.slice(0, 1000),
      next_attempt_at: new Date(Date.now() + delay * 1000).toISOString(),
    }).eq("id", job.id);
    await mirrorStatus(db, job.launch_id, {
      status: "running",
      status_step: job.step,
      status_message: `Повтор через ${Math.round(delay / 60)} мин: ${message}`.slice(0, 500),
      last_error: message.slice(0, 1000),
    });
    return "retry";
  }

  const now = new Date().toISOString();
  await db.from("ad_launch_jobs").update({
    status: "error",
    locked_at: null,
    last_error: message.slice(0, 1000),
    completed_at: now,
  }).eq("id", job.id);
  await mirrorStatus(db, job.launch_id, {
    status: "error",
    status_step: job.step,
    status_message: message.slice(0, 500),
    last_error: message.slice(0, 1000),
    completed_at: now,
  });
  return "error";
}

/* ────────────────────────────── точка входа ──────────────────────────── */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const db = admin();
  if (!(await authorize(req, db))) {
    return json({ error: "Unauthorized" }, 401);
  }

  const body = await req.json().catch(() => ({})) as {
    batch_size?: number;
    /** Прогнать конкретный запуск: его прямо сейчас ждёт человек в мастере. */
    launch_id?: string;
  };
  const launchId = typeof body.launch_id === "string" && body.launch_id
    ? body.launch_id
    : null;
  const batchSize = launchId
    ? 1
    : Math.min(Math.max(1, Number(body.batch_size ?? 5)), 20);

  const { data, error } = await db.rpc("claim_ad_launch_jobs", {
    p_limit: batchSize,
    p_launch_id: launchId,
  });
  if (error) return json({ error: `Очередь недоступна: ${error.message}` }, 500);

  const jobs = (data ?? []) as JobRow[];
  const deadline = Date.now() + WALL_CLOCK_BUDGET_MS;

  const results: Array<{ launch_id: string; outcome: string }> = [];

  for (const job of jobs) {
    if (Date.now() >= deadline) {
      // Не начинаем то, что не успеем: снимаем аренду, задание возьмёт следующий тик.
      await db.from("ad_launch_jobs")
        .update({ locked_at: null, attempts: 0 })
        .eq("id", job.id);
      results.push({ launch_id: job.launch_id, outcome: "deferred" });
      continue;
    }
    try {
      results.push({ launch_id: job.launch_id, outcome: await runJob(db, job, deadline) });
    } catch (e) {
      console.error("[ads-launch-worker] job crashed:", (e as Error).message);
      results.push({
        launch_id: job.launch_id,
        outcome: await failJob(db, job, e as Error, false),
      });
    }
  }

  return json({ ok: true, claimed: jobs.length, results });
});
