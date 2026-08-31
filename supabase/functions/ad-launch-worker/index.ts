// ad-launch-worker — прямой запуск рекламы в Meta без n8n.
//
// Конечный автомат по заданию из ad_launch_jobs. Каждый шаг идемпотентен:
// как только объект создан в Meta, его id записывается в задание, и повторный
// проход шаг пропускает. Поэтому ретрай никогда не создаёт вторую кампанию.
//
// Запускается:
//   - сразу после постановки задания (fire-and-forget из launch-campaign);
//   - pg_cron раз в минуту — ретраи, зависшие задания, ожидание видео.
//
// Auth: x-automation-key == automation_settings.cron_secret (как
// capi-outbox-worker и binotel-import-calls). verify_jwt = false.
//
// Порядок шагов и классификация ошибок — docs/AD-LAUNCH-DIRECT-META.md.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { resolveMetaAccessToken } from "../_lib/metaToken.ts";
import {
  backoffMinutes,
  classifyMetaError,
  describeMetaError,
  graphGet,
  graphPost,
  type MetaError,
  normalizeAdAccount,
  pollVideoStatus,
  uploadAdImage,
  uploadAdVideoByUrl,
} from "../_lib/metaGraph.ts";
import {
  buildAdBody,
  buildAdSetBody,
  buildCampaignBody,
  buildCreativeBody,
  ctaTypeFor,
  goalLabel,
  type LaunchSpec,
  type MediaAssets,
  validateLaunchSpec,
} from "../_lib/adLaunchSpec.ts";
import {
  buildTargetingSpec,
  normalizeTargetingInput,
  resolveTargeting,
  type TargetingCacheStore,
} from "../_lib/metaTargeting.ts";
import { pickBestVideoThumb } from "../_lib/creativePoster.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-automation-key, x-cron-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_ATTEMPTS = 6;
const DEFAULT_BATCH = 5;
/** Задание, застрявшее в processing дольше этого — считаем брошенным. */
const STUCK_MINUTES = 10;
/** Кэш справочников таргетинга живёт месяц: ключи городов Meta не меняются. */
const TARGETING_CACHE_DAYS = 30;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface JobRow {
  id: string;
  launch_id: string;
  project_id: string | null;
  cabinet_id: string | null;
  source: string;
  spec: LaunchSpec & Record<string, unknown>;
  status: string;
  step: string | null;
  meta_image_hashes: string[];
  meta_video_id: string | null;
  meta_campaign_id: string | null;
  meta_adset_id: string | null;
  meta_creative_id: string | null;
  meta_ad_id: string | null;
  attempts: number;
}

/**
 * Кэш meta_targeting_cache поверх таблицы.
 * country приводим к пустой строке: в UNIQUE-индексе NULL-ы считаются
 * различными, и с NULL кэш интересов и языков дублировался бы бесконечно.
 */
function cacheStore(admin: SupabaseClient): TargetingCacheStore {
  return {
    async get(kind, query, country) {
      const { data } = await admin
        .from("meta_targeting_cache")
        .select("result, fetched_at")
        .eq("kind", kind)
        .eq("query", query)
        .eq("country", country ?? "")
        .maybeSingle();
      if (!data) return null;
      const age = Date.now() - new Date((data as { fetched_at: string }).fetched_at).getTime();
      if (age > TARGETING_CACHE_DAYS * 86_400_000) return null;
      return (data as { result: unknown }).result;
    },
    async put(kind, query, country, result) {
      await admin
        .from("meta_targeting_cache")
        .upsert(
          { kind, query, country: country ?? "", result, fetched_at: new Date().toISOString() },
          { onConflict: "kind,query,country" },
        );
    },
  };
}

/** Отражение прогресса в ad_campaigns — оттуда его читает UI по launch_id. */
async function mirrorToCampaign(
  admin: SupabaseClient,
  launchId: string,
  patch: Record<string, unknown>,
) {
  const { error } = await admin.from("ad_campaigns").update(patch).eq("launch_id", launchId);
  if (error) console.error("[ad-launch-worker] mirror ad_campaigns:", error.message);
}

async function setStep(
  admin: SupabaseClient,
  job: JobRow,
  step: string,
  message: string,
  extra: Record<string, unknown> = {},
) {
  await admin.from("ad_launch_jobs").update({ step, ...extra }).eq("id", job.id);
  await mirrorToCampaign(admin, job.launch_id, {
    status: "running",
    status_step: step,
    status_message: message,
    status_updated_at: new Date().toISOString(),
  });
}

async function failJob(
  admin: SupabaseClient,
  job: JobRow,
  reason: string,
  err: MetaError | null,
  retryable: boolean,
) {
  const attempts = job.attempts;
  const canRetry = retryable && attempts < MAX_ATTEMPTS;
  const nextAt = new Date(Date.now() + backoffMinutes(attempts) * 60_000).toISOString();

  await admin.from("ad_launch_jobs").update({
    status: canRetry ? "queued" : "error",
    last_error: reason,
    error_code: err?.code ?? null,
    next_attempt_at: canRetry ? nextAt : new Date().toISOString(),
    locked_at: null,
    ...(canRetry ? {} : { completed_at: new Date().toISOString() }),
  }).eq("id", job.id);

  await mirrorToCampaign(admin, job.launch_id, {
    status: canRetry ? "queued" : "error",
    status_message: canRetry
      ? `${reason} — повтор через ${backoffMinutes(attempts)} мин (попытка ${attempts}/${MAX_ATTEMPTS})`
      : reason,
    last_error: reason,
    status_updated_at: new Date().toISOString(),
    ...(canRetry ? {} : { completed_at: new Date().toISOString() }),
  });

  return { id: job.id, status: canRetry ? "retry" : "error", reason };
}

/** Скачивание креатива по публичному URL для отправки в /adimages. */
async function fetchMedia(url: string): Promise<Blob | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return null;
    return await res.blob();
  } catch {
    return null;
  }
}

async function processJob(admin: SupabaseClient, job: JobRow): Promise<Record<string, unknown>> {
  const spec = job.spec;
  spec.adAccount = normalizeAdAccount(spec.adAccount ?? "");

  // ===== Токен =====
  const token = await resolveMetaAccessToken({
    cabinetId: job.cabinet_id,
    projectId: job.project_id,
    admin,
  });
  if (!token) {
    return await failJob(admin, job, "Не найден access token Meta для кабинета", null, false);
  }

  // ===== Валидация до первого вызова Meta =====
  const problems = validateLaunchSpec(spec);
  if (problems.length) {
    return await failJob(admin, job, problems.join("; "), null, false);
  }

  const assets: MediaAssets = {
    imageHashes: [...(job.meta_image_hashes ?? [])],
    videoId: job.meta_video_id,
    videoThumbUrl: (spec as Record<string, unknown>).videoThumbUrl as string ?? null,
    storiesImageHash: null,
  };

  // ===== Шаг 1. Таргетинг =====
  let targetingSpec = (spec as Record<string, unknown>).targetingResolved as
    | Record<string, unknown>
    | undefined;
  if (!targetingSpec) {
    await setStep(admin, job, "resolving_targeting", "Подбираем аудиторию в Meta");
    const input = normalizeTargetingInput(spec.targeting, {
      fallbackCity: spec.cabinetCity,
      timezone: spec.timezone,
      currency: spec.currency,
    });
    const resolved = await resolveTargeting(input, token, cacheStore(admin));
    targetingSpec = buildTargetingSpec(resolved);
    (spec as Record<string, unknown>).targetingResolved = targetingSpec;
    (spec as Record<string, unknown>).targetingUnresolved = resolved.unresolved;
    await admin.from("ad_launch_jobs").update({ spec }).eq("id", job.id);
  }

  // ===== Шаг 2. Медиа =====
  if (spec.adSetupMode !== "existing") {
    // Мастер для карусели кладёт первую карточку и в creative_feed, и в
    // creative_carousel_0 — если грузить всё подряд, первая картинка уйдёт
    // в Meta дважды и в объявлении появится лишняя карточка. Поэтому для
    // карусели берём строго карусельные слоты, а иначе — только ленту.
    const stills = spec.media.filter((m) => !m.mime?.startsWith("video/"));
    const images = spec.creativeFormat === "carousel"
      ? stills.filter((m) => m.role === "carousel").sort((a, b) => a.index - b.index)
      : stills.filter((m) => m.role === "feed").slice(0, 1);
    // Ленты может не быть вовсе — тогда одиночный креатив собираем из сторис.
    if (!images.length && spec.creativeFormat !== "carousel") {
      const fallback = stills.find((m) => m.role === "stories");
      if (fallback) images.push(fallback);
    }
    const video = spec.media.find((m) => m.mime?.startsWith("video/"));

    if (!assets.imageHashes.length && images.length) {
      await setStep(admin, job, "uploading_media", "Загружаем изображения в Meta");
      for (const item of images) {
        const blob = await fetchMedia(item.url);
        if (!blob) {
          return await failJob(admin, job, `Не удалось скачать креатив: ${item.name}`, null, true);
        }
        const up = await uploadAdImage(spec.adAccount, token, blob, item.name || `creative_${item.index}.jpg`);
        if (!up.ok || !up.data) {
          const kind = classifyMetaError(up.error);
          return await failJob(admin, job, describeMetaError(up.error), up.error, kind !== "fatal");
        }
        assets.imageHashes.push(up.data.hash);
      }
      await admin.from("ad_launch_jobs")
        .update({ meta_image_hashes: assets.imageHashes })
        .eq("id", job.id);
    }

    if (video && !assets.videoId) {
      await setStep(admin, job, "uploading_media", "Отправляем видео в Meta");
      // file_url: Meta скачивает ролик сама — сотни мегабайт не проходят
      // через память edge-функции.
      const up = await uploadAdVideoByUrl(spec.adAccount, token, video.url, video.name || "creative.mp4");
      if (!up.ok || !up.data?.id) {
        const kind = classifyMetaError(up.error);
        return await failJob(admin, job, describeMetaError(up.error), up.error, kind !== "fatal");
      }
      assets.videoId = up.data.id;
      await admin.from("ad_launch_jobs")
        .update({ meta_video_id: assets.videoId, status: "waiting_media", step: "waiting_media" })
        .eq("id", job.id);
    }
  }

  // ===== Шаг 3. Ожидание готовности видео =====
  if (assets.videoId && !assets.videoThumbUrl) {
    await setStep(admin, job, "waiting_media", "Meta обрабатывает видео");
    const st = await pollVideoStatus(assets.videoId, token);
    if (st.status === "error") {
      return await failJob(
        admin, job,
        st.detail ?? describeMetaError(st.error),
        st.error,
        st.error ? classifyMetaError(st.error) !== "fatal" : false,
      );
    }
    if (st.status === "processing") {
      // Не держим функцию: возвращаем задание в очередь, следующий крон
      // проверит снова. Это и есть смысл состояния waiting_media.
      await admin.from("ad_launch_jobs").update({
        status: "waiting_media",
        step: "waiting_media",
        locked_at: null,
        next_attempt_at: new Date(Date.now() + 60_000).toISOString(),
      }).eq("id", job.id);
      await mirrorToCampaign(admin, job.launch_id, {
        status: "running",
        status_step: "waiting_media",
        status_message: `Meta обрабатывает видео${st.detail ? ` (${st.detail})` : ""}`,
        status_updated_at: new Date().toISOString(),
      });
      return { id: job.id, status: "waiting_media" };
    }

    // Готово — забираем постер: video_data без превью Meta не принимает.
    const thumbs = await graphGet<{ data?: Array<{ uri?: string; width?: number; height?: number; is_preferred?: boolean }> }>(
      `${assets.videoId}/thumbnails`, token, { limit: 20 },
    );
    const list = (thumbs.data?.data ?? [])
      .filter((t): t is { uri: string; width?: number; height?: number; is_preferred?: boolean } =>
        typeof t.uri === "string")
      .map((t) => ({ uri: t.uri, width: t.width, height: t.height, is_preferred: t.is_preferred }));
    assets.videoThumbUrl = pickBestVideoThumb(list, null);
    (spec as Record<string, unknown>).videoThumbUrl = assets.videoThumbUrl;
    await admin.from("ad_launch_jobs").update({ spec, status: "processing" }).eq("id", job.id);
  }

  // ===== Шаг 4. Кампания =====
  let campaignId = job.meta_campaign_id;
  if (!campaignId) {
    await setStep(admin, job, "creating_campaign", "Создаём кампанию");
    const res = await graphPost<{ id: string }>(
      `${spec.adAccount}/campaigns`, token, buildCampaignBody(spec),
    );
    if (!res.ok || !res.data?.id) {
      const kind = classifyMetaError(res.error);
      return await failJob(admin, job, describeMetaError(res.error), res.error, kind !== "fatal");
    }
    campaignId = res.data.id;
    await admin.from("ad_launch_jobs").update({ meta_campaign_id: campaignId }).eq("id", job.id);
    await mirrorToCampaign(admin, job.launch_id, { meta_campaign_id: campaignId });
  }

  // ===== Шаг 5. Ad set =====
  let adsetId = job.meta_adset_id;
  if (!adsetId) {
    await setStep(admin, job, "creating_adset", "Настраиваем аудиторию и бюджет");
    const body = buildAdSetBody(spec, campaignId, targetingSpec ?? {});
    if (spec.goal === "meta-form" && spec.leadFormId) {
      body.promoted_object = { page_id: spec.pageId, lead_form_id: spec.leadFormId };
    }
    const res = await graphPost<{ id: string }>(`${spec.adAccount}/adsets`, token, body);
    if (!res.ok || !res.data?.id) {
      const kind = classifyMetaError(res.error);
      return await failJob(admin, job, describeMetaError(res.error), res.error, kind !== "fatal");
    }
    adsetId = res.data.id;
    await admin.from("ad_launch_jobs").update({ meta_adset_id: adsetId }).eq("id", job.id);
    await mirrorToCampaign(admin, job.launch_id, { meta_adset_id: adsetId });
  }

  // ===== Шаг 6. Креатив =====
  let creativeId = job.meta_creative_id;
  if (!creativeId) {
    await setStep(admin, job, "creating_creative", "Собираем объявление");
    const res = await graphPost<{ id: string }>(
      `${spec.adAccount}/adcreatives`, token, buildCreativeBody(spec, assets),
    );
    if (!res.ok || !res.data?.id) {
      const kind = classifyMetaError(res.error);
      return await failJob(admin, job, describeMetaError(res.error), res.error, kind !== "fatal");
    }
    creativeId = res.data.id;
    await admin.from("ad_launch_jobs").update({ meta_creative_id: creativeId }).eq("id", job.id);
  }

  // ===== Шаг 7. Объявление =====
  let adId = job.meta_ad_id;
  if (!adId) {
    await setStep(admin, job, "creating_ad", "Публикуем объявление");
    const res = await graphPost<{ id: string }>(
      `${spec.adAccount}/ads`, token, buildAdBody(spec, adsetId, creativeId),
    );
    if (!res.ok || !res.data?.id) {
      const kind = classifyMetaError(res.error);
      return await failJob(admin, job, describeMetaError(res.error), res.error, kind !== "fatal");
    }
    adId = res.data.id;
    await admin.from("ad_launch_jobs").update({ meta_ad_id: adId }).eq("id", job.id);
    await mirrorToCampaign(admin, job.launch_id, { meta_ad_id: adId });
  }

  // ===== Шаг 8. Сохранение креатива в БД =====
  // Раньше это делал n8n постфактум; здесь — до ответа пользователю, чтобы
  // цепочка «креатив → CTWA → лид → CRM-этап → CAPI» не рвалась ни на секунду.
  // Зовём существующий meta-creative-upsert, а не пишем в таблицу напрямую:
  // там уже отлажен резолв cabinet/project по ad_account_id и маппинг полей.
  await setStep(admin, job, "saving", "Сохраняем креатив");
  try {
    const upsertRes = await fetch(
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/meta-creative-upsert`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          ...(Deno.env.get("CREATIVE_UPSERT_KEY")
            ? { "x-creative-key": Deno.env.get("CREATIVE_UPSERT_KEY")! }
            : {}),
        },
        body: JSON.stringify({
          ad_id: adId,
          adset_id: adsetId,
          campaign_id: campaignId,
          cabinet_id: job.cabinet_id,
          project_id: job.project_id,
          ad_account_id: spec.adAccount,
          name: `${goalLabel(spec.goal)} | ad`,
          landing_url: spec.websiteUrl || null,
          primary_text: spec.text || null,
          headline: spec.headline || null,
          description: spec.description || null,
          cta: ctaTypeFor(spec.goal),
          format: assets.videoId
            ? "Video"
            : (spec.creativeFormat === "carousel" ? "Carousel" : "Photo"),
          destination: spec.goal === "whatsapp"
            ? "WHATSAPP"
            : (spec.goal === "site-leads" ? "WEBSITE" : "ON_AD"),
          objective: buildCampaignBody(spec).objective,
          effective_status: "PAUSED",
        }),
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!upsertRes.ok) {
      console.error("[ad-launch-worker] meta-creative-upsert:", await upsertRes.text());
    }
  } catch (e) {
    // Объявление уже создано — из-за проблемы с записью в нашу БД задание
    // не роняем: строку подтянет ближайший meta-structure-sync.
    console.error("[ad-launch-worker] meta-creative-upsert:", (e as Error).message);
  }

  // ===== Шаг 9. Включение (только по явному флагу) =====
  let activated = false;
  if (spec.autoActivate) {
    await setStep(admin, job, "activating", "Включаем кампанию");
    const res = await graphPost(campaignId, token, { status: "ACTIVE" });
    if (res.ok) {
      activated = true;
      await graphPost(adsetId, token, { status: "ACTIVE" });
      await graphPost(adId, token, { status: "ACTIVE" });
    } else {
      // Всё создано — не роняем задание из-за включения, сообщаем и оставляем на паузе.
      console.error("[ad-launch-worker] activate:", describeMetaError(res.error));
    }
  }

  const unresolved = ((spec as Record<string, unknown>).targetingUnresolved as string[]) ?? [];
  const doneMessage = [
    activated ? "Кампания создана и включена" : "Кампания создана и стоит на паузе",
    unresolved.length ? `Meta не распознала: ${unresolved.join(", ")}` : "",
  ].filter(Boolean).join(". ");

  await admin.from("ad_launch_jobs").update({
    status: "done",
    step: "done",
    locked_at: null,
    completed_at: new Date().toISOString(),
    last_error: null,
  }).eq("id", job.id);

  await mirrorToCampaign(admin, job.launch_id, {
    status: "success",
    status_step: "done",
    status_message: doneMessage,
    meta_campaign_id: campaignId,
    meta_adset_id: adsetId,
    meta_ad_id: adId,
    status_updated_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
  });

  return { id: job.id, status: "done", campaignId, adsetId, adId, activated };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Авторизация: cron_secret (крон и внутренние вызовы) либо service-role JWT.
  const { data: settings } = await admin
    .from("automation_settings")
    .select("cron_secret")
    .eq("id", true)
    .maybeSingle();
  const expected = (settings as { cron_secret?: string } | null)?.cron_secret
    ?? Deno.env.get("AUTOMATION_CRON_KEY");
  const provided = req.headers.get("x-automation-key") ?? req.headers.get("x-cron-key");
  const isServiceRole = req.headers.get("Authorization")?.includes(
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "___",
  );
  if (!isServiceRole && (!expected || provided !== expected)) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: { batch_size?: number; job_id?: string } = {};
  try { body = await req.json(); } catch { /* пустое тело — это нормально */ }
  const batchSize = Math.min(Math.max(Number(body.batch_size) || DEFAULT_BATCH, 1), 20);

  // Реанимация зависших: воркер мог умереть посреди шага.
  const stuckBefore = new Date(Date.now() - STUCK_MINUTES * 60_000).toISOString();
  await admin.from("ad_launch_jobs")
    .update({ status: "queued", locked_at: null })
    .eq("status", "processing")
    .lt("locked_at", stuckBefore);

  // Взятие заданий. Точечный вызов по job_id — путь «сразу после постановки».
  const query = admin
    .from("ad_launch_jobs")
    .select("*")
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(batchSize);

  const { data: rows, error } = body.job_id
    ? await admin.from("ad_launch_jobs").select("*").eq("id", body.job_id).limit(1)
    : await query.in("status", ["queued", "waiting_media"]).lte("next_attempt_at", new Date().toISOString());

  if (error) return json({ error: error.message }, 500);

  const jobs = (rows ?? []) as JobRow[];
  const results: unknown[] = [];

  for (const job of jobs) {
    if (job.status === "done" || job.status === "error" || job.status === "cancelled") continue;
    // Лизинг: помечаем строку своей до начала работы. Условие по locked_at
    // отсекает гонку между кроном и точечным вызовом.
    //
    // Попытку считаем только за реальный проход по шагам. Ожидание видео —
    // это опрос раз в минуту, и если считать его попыткой, ролик длиннее
    // MAX_ATTEMPTS минут упрётся в лимит и навсегда выпадет из выборки.
    const countsAsAttempt = job.status !== "waiting_media";
    const { data: claimed } = await admin
      .from("ad_launch_jobs")
      .update({
        status: "processing",
        locked_at: new Date().toISOString(),
        ...(countsAsAttempt ? { attempts: job.attempts + 1 } : {}),
      })
      .eq("id", job.id)
      .is("locked_at", null)
      .select()
      .maybeSingle();
    if (!claimed) {
      results.push({ id: job.id, status: "skipped", reason: "locked" });
      continue;
    }

    try {
      results.push(await processJob(admin, { ...(claimed as JobRow) }));
    } catch (e) {
      results.push(await failJob(
        admin,
        { ...(claimed as JobRow) },
        `Внутренняя ошибка воркера: ${(e as Error).message}`,
        null,
        true,
      ));
    }
  }

  return json({ ok: true, processed: jobs.length, results });
});
