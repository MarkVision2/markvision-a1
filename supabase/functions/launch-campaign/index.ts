// Прокси-эндпоинт для запуска кампании в n8n.
// 1. Принимает FormData от фронта.
// 2. Обогащает payload секретным META_ACCESS_TOKEN и кладёт ВСЕ возможные
//    варианты названий полей, которые исторически использует n8n-workflow
//    (camel/snake/UPPER, fbtoken/fb_token/access_token, adAccount/ad_account_id/...).
// 3. Если цель — "Лиды с сайта", жёстко переписывает campaignBody/adSetBody
//    чтобы workflow не ушёл в ветку WhatsApp.
// 4. Отвечает фронту максимально быстро (короткий таймаут на ACK от n8n,
//    дальше n8n продолжает в фоне).

const N8N_WEBHOOK = "https://n8n.zapoinov.com/webhook/ai-target-launch";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Сколько ждём первичный ACK от n8n. Дальше отвечаем «принято» фронту,
 *  а n8n продолжает работу в фоне. */
const N8N_ACK_TIMEOUT_MS = 8_000;

function pickStr(...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
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

    // ===== 1. ACCESS_TOKEN: дублируем во всех вариантах имени =====
    const accessToken = pickStr(
      client.fb_token,
      client.access_token,
      client.fbtoken,
      client.accesstoken,
      payload.ACCESS_TOKEN,
      META_ACCESS_TOKEN,
    );

    client.fb_token = accessToken;
    client.fbtoken = accessToken;            // legacy n8n key
    client.access_token = accessToken;
    client.accesstoken = accessToken;        // legacy n8n key
    payload.clientConfig = client;

    // ===== 2. AD_ACCOUNT: нормализуем + дублируем =====
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
    client.adaccountid = adAccount;          // legacy n8n key
    payload.clientConfig = client;
    payload.adAccount = adAccount;           // legacy
    payload.ad_account_id = adAccount;

    // ===== 3. UPPER_CASE-алиасы для готовых нод n8n =====
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

    // ===== 4. Цель кампании: site-leads / whatsapp / meta-form =====
    const goal = pickStr(payload.goal);
    const isWebsiteGoal = goal === "site-leads";
    const isMetaForm = goal === "meta-form";
    const isWhatsApp = goal === "whatsapp";
    payload.isWebsiteGoal = isWebsiteGoal;
    payload.isMetaForm = isMetaForm;
    payload.isWhatsApp = isWhatsApp;

    // Сводка для отображения пользователю и для логов n8n
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

    // ===== 5. Готовые Meta-объекты в формате, который ждёт n8n =====
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

    const creativeBody: Record<string, unknown> = {
      access_token: accessToken,
      name: `creative_${Date.now()}`,
      object_story_spec: {
        page_id: pageId,
        link_data: {
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
        },
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

    // ===== 6. launchId для трекинга =====
    if (!payload.launchId) {
      payload.launchId = crypto.randomUUID();
    }

    // ===== 7. Шлём в n8n с коротким таймаутом ACK =====
    const out = new FormData();
    out.append("payload", JSON.stringify(payload));
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
      // Таймаут на ACK — это ок: n8n принял запрос и продолжает работу.
      // Считаем "принято" и не блокируем UI пользователя.
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
