// Прокси-эндпоинт для запуска кампании в n8n.
// 1. Принимает FormData от фронта.
// 2. Загружает creative_feed / creative_stories / creative_carousel_* в Meta → image_hash.
// 3. Вставляет hash в creativeBody (одиночный image_hash или child_attachments для карусели).
// 4. Обогащает payload секретным META_ACCESS_TOKEN и всеми алиасами полей.
// 5. Отвечает фронту быстро (короткий таймаут на ACK от n8n, дальше n8n работает в фоне).

import { requireUser, userHasRole } from "../_lib/auth.ts";

const N8N_WEBHOOK = "https://n8n.zapoinov.com/webhook/ai-target-launch";
const META_GRAPH = "https://graph.facebook.com/v19.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Сколько ждём первичный ACK от n8n. */
const N8N_ACK_TIMEOUT_MS = 8_000;

function pickStr(...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/**
 * Загружает изображение в Meta adimages API.
 * Возвращает { hash, url } или null при ошибке.
 */
async function uploadImageToMeta(
  adAccount: string,
  accessToken: string,
  file: File,
): Promise<{ hash: string; url: string } | null> {
  try {
    const fd = new FormData();
    fd.append(file.name, file, file.name);
    fd.append("access_token", accessToken);

    const res = await fetch(`${META_GRAPH}/${adAccount}/adimages`, {
      method: "POST",
      body: fd,
      signal: AbortSignal.timeout(30_000),
    });

    const data = (await res.json()) as {
      images?: Record<string, { hash?: string; url?: string }>;
      error?: { message?: string };
    };

    if (!res.ok || data.error) {
      console.error("[uploadImage] Meta error:", data.error?.message ?? JSON.stringify(data));
      return null;
    }

    const entry = data.images ? Object.values(data.images)[0] : null;
    if (entry?.hash) {
      return { hash: entry.hash, url: entry.url ?? "" };
    }
    return null;
  } catch (e) {
    console.error("[uploadImage] exception:", (e as Error).message);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const auth = await requireUser(req);
    if (!auth.ok) return auth.response;
    const isAdmin = await userHasRole(auth.userId, "admin");
    const isManager = isAdmin || (await userHasRole(auth.userId, "manager"));
    if (!isManager) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN");
    if (!META_ACCESS_TOKEN) {
      return new Response(
        JSON.stringify({ error: "META_ACCESS_TOKEN is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const incoming = await req.formData();
    const payloadStr = incoming.get("payload");
    if (typeof payloadStr !== "string") {
      return new Response(JSON.stringify({ error: "Missing 'payload' field" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = JSON.parse(payloadStr) as Record<string, unknown>;
    const client = (payload.clientConfig ?? {}) as Record<string, unknown>;

    // ===== 1. ACCESS_TOKEN =====
    const accessToken = pickStr(
      client.fb_token,
      client.access_token,
      client.fbtoken,
      client.accesstoken,
      payload.ACCESS_TOKEN,
      META_ACCESS_TOKEN,
    );

    client.fb_token = accessToken;
    client.fbtoken = accessToken;
    client.access_token = accessToken;
    client.accesstoken = accessToken;
    payload.clientConfig = client;

    // ===== 2. AD_ACCOUNT =====
    const adAccountRaw = pickStr(
      client.ad_account_id,
      client.adaccountid,
      payload.ad_account_id,
      payload.AD_ACCOUNT,
    );
    const adAccount = adAccountRaw
      ? (adAccountRaw.startsWith("act_")
          ? adAccountRaw
          : `act_${adAccountRaw.replace(/^act_/, "").replace(/\D/g, "")}`)
      : "";

    if (!adAccount) {
      return new Response(
        JSON.stringify({
          ok: false,
          error:
            "AD_ACCOUNT пуст: у выбранного кабинета не указан ad_account_id. Заполните его в настройках кабинета.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    client.ad_account_id = adAccount;
    client.adaccountid = adAccount;
    payload.clientConfig = client;
    payload.adAccount = adAccount;
    payload.ad_account_id = adAccount;

    // ===== 3. UPPER_CASE aliases =====
    const pageId = pickStr(client.page_id, client.pageid);
    const pageName = pickStr(client.page_name, client.pagename);
    const instagramId = pickStr(
      client.instagram_actor_id,
      client.instagram_user_id,
      client.instagramid,
    );
    const pixelId = pickStr(client.fb_pixel_id, client.pixel_id, client.pixelid);
    const pixelEvent = pickStr(client.pixel_event, client.pixelevent) || "Lead";
    const websiteUrl = pickStr(client.website_url, client.landing_url);
    const whatsappNumber = pickStr(client.whatsapp_number, client.whatsappnumber);
    const leadFormId = pickStr(client.lead_form_id, client.leadformid);

    payload.ACCESS_TOKEN = accessToken;
    payload.accesstoken = accessToken;
    payload.AD_ACCOUNT = adAccount;
    payload.PAGE_ID = pageId;
    payload.PAGE_NAME = pageName;
    payload.INSTAGRAM_ID = instagramId;
    payload.PIXEL_ID = pixelId;
    payload.PIXEL_EVENT = pixelEvent;
    payload.WEBSITE_URL = websiteUrl;
    payload.WHATSAPP_NUMBER = whatsappNumber;
    payload.BUSINESS_ID = pickStr(client.business_id);
    payload.APP_ID = pickStr(client.app_id);
    payload.LEAD_FORM_ID = leadFormId;

    // ===== 4. Цель кампании =====
    const goal = pickStr(payload.goal);
    const isWebsiteGoal = goal === "site-leads";
    const isMetaForm = goal === "meta-form";
    const isWhatsApp = goal === "whatsapp";
    payload.isWebsiteGoal = isWebsiteGoal;
    payload.isMetaForm = isMetaForm;
    payload.isWhatsApp = isWhatsApp;

    const goalLabel = isWebsiteGoal
      ? "Лиды с сайта"
      : isMetaForm
        ? "Лид-форма Meta"
        : isWhatsApp
          ? "WhatsApp"
          : goal;

    payload.launchSummary = {
      goal,
      goalLabel,
      cabinetName: pickStr(client.client_name),
      adAccountId: adAccount,
      pageId,
      instagramId,
      pixelId,
      pixelEvent,
      websiteUrl,
      whatsappNumber,
      leadFormId,
      budget: payload.budget ?? null,
      currency: payload.currency ?? client.currency ?? "USD",
    };

    // ===== 5. Meta campaign / adSet / ad bodies =====
    const dailyBudgetCents = (() => {
      const v = client.daily_budget;
      if (typeof v === "number" && v > 0) return Math.round(v);
      const b = Number(payload.budget);
      return Number.isFinite(b) && b > 0 ? Math.round(b * 100) : 500;
    })();

    const campaignBody: Record<string, unknown> = {
      name: `${goalLabel} | ${new Date().toISOString().slice(0, 10)}`,
      objective: isWebsiteGoal
        ? "OUTCOME_SALES"
        : isMetaForm
          ? "OUTCOME_LEADS"
          : "OUTCOME_ENGAGEMENT",
      special_ad_categories: [],
      status: "PAUSED",
      access_token: accessToken,
    };

    const adSetBody: Record<string, unknown> = {
      name: `${goalLabel} | adset`,
      daily_budget: String(dailyBudgetCents),
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      billing_event: "IMPRESSIONS",
      status: "PAUSED",
      access_token: accessToken,
    };

    if (isWebsiteGoal) {
      adSetBody.optimization_goal = "OFFSITE_CONVERSIONS";
      adSetBody.destination_type = "WEBSITE";
      adSetBody.promoted_object = {
        pixel_id: pixelId,
        custom_event_type: (pixelEvent || "Lead").toUpperCase(),
      };
    } else if (isMetaForm) {
      adSetBody.optimization_goal = "LEAD_GENERATION";
      adSetBody.destination_type = "ON_AD";
      adSetBody.promoted_object = { page_id: pageId };
    } else if (isWhatsApp) {
      adSetBody.optimization_goal = "CONVERSATIONS";
      adSetBody.destination_type = "WHATSAPP";
      adSetBody.promoted_object = {
        page_id: pageId,
        whatsapp_phone_number: whatsappNumber,
      };
    }

    const ctaType = isWebsiteGoal
      ? "LEARN_MORE"
      : isMetaForm
        ? "SIGN_UP"
        : "WHATSAPP_MESSAGE";
    const linkUrl = isWebsiteGoal
      ? (websiteUrl || pickStr(client.landing_url) || "https://facebook.com/")
      : "https://facebook.com/";

    // ===== 6. ЗАГРУЖАЕМ КРЕАТИВЫ В META → получаем image_hash =====
    const creativeFeedFile = incoming.get("creative_feed");
    const creativeStoriesFile = incoming.get("creative_stories");

    // Карусель: creative_carousel_0 … creative_carousel_N
    const carouselEntries: { idx: number; file: File }[] = [];
    for (const [key, value] of incoming.entries()) {
      const m = /^creative_carousel_(\d+)$/.exec(key);
      if (!m || !(value instanceof File)) continue;
      if (!value.type.startsWith("image/")) continue;
      carouselEntries.push({ idx: Number(m[1]), file: value });
    }
    carouselEntries.sort((a, b) => a.idx - b.idx);
    const isCarousel =
      payload.creativeFormat === "carousel" || carouselEntries.length >= 2;

    let feedImageHash: string | null = null;
    let feedImageUrl: string | null = null;
    let storiesImageHash: string | null = null;
    let storiesImageUrl: string | null = null;
    const orderedCarouselHashes: { hash: string; url: string }[] = [];

    if (isCarousel && carouselEntries.length >= 2) {
      // По порядку, чтобы child_attachments совпали со слайдами в UI
      for (const { file } of carouselEntries) {
        const r = await uploadImageToMeta(adAccount, accessToken, file);
        if (r) orderedCarouselHashes.push(r);
      }
      if (orderedCarouselHashes[0]) {
        feedImageHash = orderedCarouselHashes[0].hash;
        feedImageUrl = orderedCarouselHashes[0].url;
      }
    } else {
      const uploadTasks: Promise<void>[] = [];
      if (creativeFeedFile instanceof File && creativeFeedFile.type.startsWith("image/")) {
        uploadTasks.push(
          uploadImageToMeta(adAccount, accessToken, creativeFeedFile).then((r) => {
            if (r) { feedImageHash = r.hash; feedImageUrl = r.url; }
          }),
        );
      }
      if (creativeStoriesFile instanceof File && creativeStoriesFile.type.startsWith("image/")) {
        uploadTasks.push(
          uploadImageToMeta(adAccount, accessToken, creativeStoriesFile).then((r) => {
            if (r) { storiesImageHash = r.hash; storiesImageUrl = r.url; }
          }),
        );
      }
      if (uploadTasks.length > 0) await Promise.all(uploadTasks);
    }

    // Добавляем image_hash в payload для n8n и в creativeBody
    payload.feedImageHash = feedImageHash;
    payload.feedImageUrl = feedImageUrl;
    payload.storiesImageHash = storiesImageHash;
    payload.storiesImageUrl = storiesImageUrl;
    payload.creativeFormat = isCarousel && orderedCarouselHashes.length >= 2
      ? "carousel"
      : (payload.creativeFormat ?? "single");
    payload.carouselImageHashes = orderedCarouselHashes.map((h) => h.hash);
    payload.carouselImageUrls = orderedCarouselHashes.map((h) => h.url);

    // ===== 7. Строим creativeBody с image_hash =====
    const linkData: Record<string, unknown> = {
      link: linkUrl,
      message: pickStr(payload.text),
      name: pickStr(payload.text).slice(0, 60) || goalLabel,
      call_to_action: {
        type: ctaType,
        value: isWebsiteGoal
          ? { link: linkUrl }
          : isWhatsApp
            ? { app_destination: "WHATSAPP" }
            : {},
      },
    };

    if (isCarousel && orderedCarouselHashes.length >= 2) {
      // Meta carousel: child_attachments, без top-level image_hash
      const ctaValue = isWebsiteGoal
        ? { link: linkUrl }
        : isWhatsApp
          ? { app_destination: "WHATSAPP" }
          : {};
      linkData.child_attachments = orderedCarouselHashes.map((h) => ({
        link: linkUrl,
        image_hash: h.hash,
        name: pickStr(payload.text).slice(0, 40) || goalLabel,
        call_to_action: { type: ctaType, value: ctaValue },
      }));
      payload.creativeFormat = "carousel";
    } else if (feedImageHash) {
      // Одиночный креатив ленты (feed 4:5)
      linkData.image_hash = feedImageHash;
    }

    const creativeBody: Record<string, unknown> = {
      access_token: accessToken,
      name: `creative_${Date.now()}`,
      object_story_spec: {
        page_id: pageId,
        link_data: linkData,
      },
    };

    // Для видео — n8n получит файл и сам загрузит через video upload API
    // Флаги помогают n8n понять, что нужно сделать
    if (
      creativeFeedFile instanceof File &&
      creativeFeedFile.type.startsWith("video/")
    ) {
      payload.feedIsVideo = true;
      payload.feedVideoFileName = creativeFeedFile.name;
    }
    if (
      creativeStoriesFile instanceof File &&
      creativeStoriesFile.type.startsWith("video/")
    ) {
      payload.storiesIsVideo = true;
      payload.storiesVideoFileName = creativeStoriesFile.name;
    }

    // Stories creativeBody (9:16) — отдельный объект для n8n
    // Для карусели stories не используем: убираем child_attachments, оставляем
    // одиночный image_hash первого слайда как fallback для n8n.
    const storiesLinkData: Record<string, unknown> = {
      link: linkUrl,
      message: pickStr(payload.text),
      name: pickStr(payload.text).slice(0, 60) || goalLabel,
      call_to_action: linkData.call_to_action,
    };
    if (storiesImageHash) {
      storiesLinkData.image_hash = storiesImageHash;
    } else if (feedImageHash) {
      storiesLinkData.image_hash = feedImageHash;
    }

    const storiesCreativeBody: Record<string, unknown> = {
      access_token: accessToken,
      name: `creative_stories_${Date.now()}`,
      object_story_spec: {
        page_id: pageId,
        link_data: storiesLinkData,
      },
    };

    payload.campaignBody = campaignBody;
    payload.adSetBody = adSetBody;
    payload.creativeBody = creativeBody;
    payload.storiesCreativeBody = storiesCreativeBody;
    payload.adBody = {
      name: `${goalLabel} | ad`,
      status: "PAUSED",
      access_token: accessToken,
    };

    // ===== 8. launchId =====
    if (!payload.launchId) {
      payload.launchId = crypto.randomUUID();
    }

    // ===== 9. Шлём в n8n с коротким таймаутом ACK =====
    const out = new FormData();
    out.append("payload", JSON.stringify(payload));
    // Пересылаем оригинальные файлы — n8n обработает видео самостоятельно
    for (const [key, value] of incoming.entries()) {
      if (key === "payload") continue;
      out.append(key, value);
    }

    let ackOk = true;
    let ackStatus = 202;
    let ackBody = "";
    try {
      const res = await fetch(N8N_WEBHOOK, {
        method: "POST",
        body: out,
        signal: AbortSignal.timeout(N8N_ACK_TIMEOUT_MS),
      });
      ackOk = res.ok;
      ackStatus = res.status;
      ackBody = (await res.text()).slice(0, 500);
    } catch (e) {
      const err = e as { name?: string; message?: string };
      const msg = (err?.message ?? "").toLowerCase();
      const name = err?.name ?? "";
      if (
        name === "TimeoutError" ||
        name === "AbortError" ||
        msg.includes("aborted") ||
        msg.includes("timeout") ||
        msg.includes("timed out")
      ) {
        ackOk = true;
        ackStatus = 202;
        ackBody = "queued (ack timeout — n8n продолжает в фоне)";
      } else {
        ackOk = false;
        ackStatus = 502;
        ackBody = msg || "network error";
      }
    }

    return new Response(
      JSON.stringify({
        ok: ackOk,
        status: ackStatus,
        accepted: ackOk,
        launchId: payload.launchId,
        summary: payload.launchSummary,
        feedImageHash,
        storiesImageHash,
        carouselImageHashes: orderedCarouselHashes.map((h) => h.hash),
        creativeFormat: payload.creativeFormat,
        response: ackBody,
      }),
      {
        status: ackOk ? 200 : 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
