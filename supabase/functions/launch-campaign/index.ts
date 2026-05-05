// Прокси-эндпоинт для запуска кампании в n8n.
// 1. Принимает FormData от фронта (payload JSON + бинарные файлы).
// 2. Загружает медиафайлы напрямую в Facebook API ещё здесь:
//    - ФОТО  → /adimages (base64)     → image_hash
//    - ВИДЕО → /advideos (chunked)    → video_id  (async, FB обработает сам)
//    - КАРУСЕЛЬ → несколько фото       → imageHashes[]
// 3. Передаёт в n8n только JSON (никакого binary) — хэши/id уже готовы.
// 4. Отвечает фронту быстро (8-сек ACK), n8n работает в фоне.

const N8N_WEBHOOK = "https://n8n.zapoinov.com/webhook/ai-target-launch";
const META_API_VERSION = "v22.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const N8N_ACK_TIMEOUT_MS = 8_000;

function pickStr(...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/** Конвертирует ArrayBuffer → base64 строку (без Node.js Buffer) */
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/** Загружает одно изображение в Facebook /adimages, возвращает image_hash или null */
async function uploadPhotoToFB(
  file: File,
  adAccount: string,
  token: string,
): Promise<string | null> {
  try {
    const buf = await file.arrayBuffer();
    const base64 = arrayBufferToBase64(buf);

    const body = new URLSearchParams();
    body.append("bytes", base64);
    body.append("access_token", token);

    const resp = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/${adAccount}/adimages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      },
    );
    const data = await resp.json();
    // Ответ: { images: { bytes: { hash: "...", url: "..." } } }
    const hash = (data as any)
      ?.images
      ?.bytes
      ?.hash as string | undefined;
    if (hash) {
      console.log(`[FB upload] photo OK, hash=${hash}`);
      return hash;
    }
    console.error("[FB upload] photo error:", JSON.stringify(data));
    return null;
  } catch (e) {
    console.error("[FB upload] photo exception:", e);
    return null;
  }
}

/** Загружает видео в Facebook /advideos, возвращает video_id или null */
async function uploadVideoToFB(
  file: File,
  adAccount: string,
  token: string,
): Promise<string | null> {
  try {
    const buf = await file.arrayBuffer();
    const blob = new Blob([buf], { type: file.type || "video/mp4" });

    const fd = new FormData();
    fd.append("access_token", token);
    fd.append("title", `ad_video_${Date.now()}`);
    fd.append("source", blob, file.name || "video.mp4");

    const resp = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/${adAccount}/advideos`,
      { method: "POST", body: fd },
    );
    const data = await resp.json() as Record<string, unknown>;
    const videoId = data?.id as string | undefined;
    if (videoId) {
      console.log(`[FB upload] video OK, id=${videoId}`);
      return videoId;
    }
    console.error("[FB upload] video error:", JSON.stringify(data));
    return null;
  } catch (e) {
    console.error("[FB upload] video exception:", e);
    return null;
  }
}

/** Определяет тип файла по mime или имени */
function getMediaKind(file: File): "photo" | "video" | "unknown" {
  const mime = (file.type || "").toLowerCase();
  const name = (file.name || "").toLowerCase();
  if (mime.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp|bmp)$/.test(name)) return "photo";
  if (mime.startsWith("video/") || /\.(mp4|mov|avi|mkv|webm|m4v)$/.test(name)) return "video";
  return "unknown";
}

// @ts-ignore: Deno is available in Supabase Edge Functions
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // @ts-ignore: Deno is available in Supabase Edge Functions
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
          error: "AD_ACCOUNT пуст: у выбранного кабинета не указан ad_account_id.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    client.ad_account_id = adAccount;
    client.adaccountid = adAccount;
    payload.clientConfig = client;
    payload.adAccount = adAccount;
    payload.ad_account_id = adAccount;

    // ===== 3. Алиасы для n8n =====
    const pageId = pickStr(client.page_id, client.pageid);
    const pageName = pickStr(client.page_name, client.pagename);
    const instagramId = pickStr(client.instagram_actor_id, client.instagram_user_id, client.instagramid);
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

    const goalLabel = isWebsiteGoal ? "Лиды с сайта"
      : isMetaForm ? "Лид-форма Meta"
      : isWhatsApp ? "WhatsApp"
      : goal;

    payload.launchSummary = {
      goal, goalLabel,
      cabinetName: pickStr(client.client_name),
      adAccountId: adAccount, pageId, instagramId, pixelId,
      pixelEvent, websiteUrl, whatsappNumber, leadFormId,
      budget: payload.budget ?? null,
      currency: payload.currency ?? client.currency ?? "USD",
    };

    // ===== 5. Бюджет =====
    const dailyBudgetCents = (() => {
      const v = client.daily_budget;
      if (typeof v === "number" && v > 0) return Math.round(v);
      const b = Number(payload.budget);
      return Number.isFinite(b) && b > 0 ? Math.round(b * 100) : 500;
    })();

    // ===== 6. Загрузка медиафайлов в Facebook (здесь, а не в n8n) =====
    // Собираем все файлы из FormData
    const allFiles: Array<{ key: string; file: File }> = [];
    for (const [key, value] of incoming.entries()) {
      if (key !== "payload" && value instanceof File && value.size > 100) {
        allFiles.push({ key, file: value as File });
      }
    }

    console.log(`[media] found ${allFiles.length} files:`, allFiles.map(f => `${f.key}(${f.file.size}b,${f.file.type})`).join(", "));

    // Определяем mediaType из payload или по файлам
    let mediaType = pickStr(payload.mediaType, payload.media_type).toUpperCase() || "PHOTO";

    // Лента (feed) — основной креатив
    const feedEntry = allFiles.find(f =>
      f.key.includes("feed") || (!f.key.includes("storie") && !f.key.includes("9x16") && !f.key.match(/carousel_\d/))
    ) || allFiles[0];

    // Карусель — несколько файлов с ключами carousel_0, carousel_1 ...
    const carouselEntries = allFiles.filter(f => f.key.match(/carousel_\d+/) || f.key.includes("carousel"));

    // Stories/Reels
    const storiesEntry = allFiles.find(f =>
      f.key.includes("storie") || f.key.includes("9x16") || f.key.includes("reel")
    );

    // Если карусель — mediaType CAROUSEL
    if (carouselEntries.length >= 2 || mediaType === "CAROUSEL") {
      mediaType = "CAROUSEL";
    }

    // Загружаем файлы в FB
    let imageHash: string | null = null;
    let storiesImageHash: string | null = null;
    let videoId: string | null = null;
    const imageHashes: string[] = [];

    if (mediaType === "CAROUSEL") {
      // Карусельные фото
      const sources = carouselEntries.length >= 2 ? carouselEntries : allFiles;
      for (const { file } of sources) {
        const kind = getMediaKind(file);
        if (kind === "photo" || kind === "unknown") {
          const hash = await uploadPhotoToFB(file, adAccount, accessToken);
          if (hash) imageHashes.push(hash);
        }
      }
      if (imageHashes.length > 0) imageHash = imageHashes[0];
      console.log(`[media] carousel hashes: ${imageHashes.join(", ")}`);
    } else if (feedEntry) {
      const kind = getMediaKind(feedEntry.file);
      if (kind === "video") {
        mediaType = "VIDEO";
        videoId = await uploadVideoToFB(feedEntry.file, adAccount, accessToken);
      } else {
        mediaType = "PHOTO";
        imageHash = await uploadPhotoToFB(feedEntry.file, adAccount, accessToken);
      }
    }

    // Stories отдельно
    if (storiesEntry && storiesEntry !== feedEntry) {
      const kind = getMediaKind(storiesEntry.file);
      if (kind !== "video") {
        storiesImageHash = await uploadPhotoToFB(storiesEntry.file, adAccount, accessToken);
      }
    }

    // Вписываем результаты в payload
    payload.mediaType = mediaType;
    payload.mediaID = imageHash ?? videoId ?? null;
    payload.image_hash = imageHash;
    payload.stories_image_hash = storiesImageHash;
    payload.video_id = videoId;
    payload.imageHashes = imageHashes.length > 0 ? imageHashes : null;

    console.log(`[media] result: type=${mediaType}, imageHash=${imageHash}, videoId=${videoId}, carousel=${imageHashes.length}`);

    // ===== 7. Готовые Meta-объекты для n8n =====
    const campaignBody: Record<string, unknown> = {
      name: `${goalLabel} | ${new Date().toISOString().slice(0, 10)}`,
      objective: isWebsiteGoal ? "OUTCOME_SALES"
        : isMetaForm ? "OUTCOME_LEADS"
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
      adSetBody.promoted_object = { pixel_id: pixelId, custom_event_type: (pixelEvent || "Lead").toUpperCase() };
    } else if (isMetaForm) {
      adSetBody.optimization_goal = "LEAD_GENERATION";
      adSetBody.destination_type = "ON_AD";
      adSetBody.promoted_object = { page_id: pageId };
    } else if (isWhatsApp) {
      adSetBody.optimization_goal = "CONVERSATIONS";
      adSetBody.destination_type = "WHATSAPP";
      adSetBody.promoted_object = { page_id: pageId, whatsapp_phone_number: whatsappNumber };
    }

    const ctaType = isWebsiteGoal ? "LEARN_MORE" : isMetaForm ? "SIGN_UP" : "WHATSAPP_MESSAGE";
    const linkUrl = isWebsiteGoal
      ? (websiteUrl || pickStr(client.landing_url) || "https://facebook.com/")
      : "https://facebook.com/";

    // creativeBody — базовый, n8n Override добавит image_hash / video_data
    const linkData: Record<string, unknown> = {
      link: linkUrl,
      message: pickStr(payload.text),
      name: pickStr(payload.text).slice(0, 60) || goalLabel,
      call_to_action: {
        type: ctaType,
        value: isWebsiteGoal ? { link: linkUrl }
          : isWhatsApp ? { app_destination: "WHATSAPP" }
          : {},
      },
    };
    if (imageHash) linkData.image_hash = imageHash;

    const creativeBody: Record<string, unknown> = {
      access_token: accessToken,
      name: `creative_${Date.now()}`,
      object_story_spec: {
        page_id: pageId,
        ...(mediaType === "VIDEO" && videoId
          ? {
              video_data: {
                video_id: videoId,
                call_to_action: linkData.call_to_action,
                message: linkData.message,
                link_description: linkData.name,
              },
            }
          : { link_data: linkData }),
      },
    };

    payload.campaignBody = campaignBody;
    payload.adSetBody = adSetBody;
    payload.creativeBody = creativeBody;
    payload.adBody = {
      name: `${goalLabel} | ad`,
      status: "PAUSED",
      access_token: accessToken,
    };

    // ===== 8. launchId =====
    if (!payload.launchId) {
      payload.launchId = crypto.randomUUID();
    }

    // ===== 9. Шлём в n8n только JSON (без binary) =====
    const out = new FormData();
    out.append("payload", JSON.stringify(payload));
    // НЕ пробрасываем файлы — FB уже обработал их выше

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
      const msg = (e as Error)?.message ?? "";
      if (msg.includes("aborted") || msg.includes("timeout")) {
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
        mediaUploaded: {
          imageHash,
          storiesImageHash,
          videoId,
          carouselCount: imageHashes.length,
        },
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
