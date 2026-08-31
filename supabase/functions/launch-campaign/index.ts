// launch-campaign — приём запуска рекламной кампании из мастера.
//
// Два режима, переключаются переменной окружения AD_LAUNCH_MODE:
//
//   direct (по умолчанию) — прямой контур без n8n:
//     файлы → bucket ad-launch-media, задание → ad_launch_jobs,
//     сразу дёргается ad-launch-worker (fire-and-forget), дальше очередь
//     и pg_cron доводят запуск до конца с ретраями.
//     Ответ фронту приходит за доли секунды, статус течёт в UI через
//     realtime по ad_campaigns.launch_id.
//
//   n8n — прежний путь: картинки грузятся в Meta прямо здесь, готовые тела
//     Graph API уходят вебхуком в n8n. Оставлен как аварийный откат.
//
// Проектное решение и порядок шагов — docs/AD-LAUNCH-DIRECT-META.md.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { requireUser, userHasRole } from "../_lib/auth.ts";
import { normalizeAdAccount, uploadAdImage } from "../_lib/metaGraph.ts";
import {
  buildAdBody,
  buildAdSetBody,
  buildCampaignBody,
  buildCreativeBody,
  goalLabel,
  type LaunchMedia,
  normalizeLaunchPayload,
  validateLaunchSpec,
} from "../_lib/adLaunchSpec.ts";
import { resolveMetaAccessToken } from "../_lib/metaToken.ts";

const N8N_WEBHOOK = "https://n8n.zapoinov.com/webhook/ai-target-launch";
const MEDIA_BUCKET = "ad-launch-media";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Сколько ждём первичный ACK от n8n (только в режиме n8n). */
const N8N_ACK_TIMEOUT_MS = 8_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function pickStr(...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function extFor(file: File): string {
  const fromName = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
  if (fromName) return fromName;
  if (file.type.startsWith("video/")) return "mp4";
  return "jpg";
}

/** Файлы из FormData → упорядоченный список медиа задания. */
function collectMediaFiles(incoming: FormData): Array<{ role: LaunchMedia["role"]; index: number; file: File }> {
  const out: Array<{ role: LaunchMedia["role"]; index: number; file: File }> = [];

  const feed = incoming.get("creative_feed");
  if (feed instanceof File && feed.size > 0) out.push({ role: "feed", index: 0, file: feed });

  const stories = incoming.get("creative_stories");
  if (stories instanceof File && stories.size > 0) out.push({ role: "stories", index: 0, file: stories });

  const carousel: Array<{ index: number; file: File }> = [];
  for (const [key, value] of incoming.entries()) {
    const m = /^creative_carousel_(\d+)$/.exec(key);
    if (!m || !(value instanceof File) || value.size === 0) continue;
    if (!value.type.startsWith("image/")) continue;
    carousel.push({ index: Number(m[1]), file: value });
  }
  carousel.sort((a, b) => a.index - b.index);
  for (const c of carousel) out.push({ role: "carousel", index: c.index, file: c.file });

  return out;
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
    if (!isManager) return json({ error: "Forbidden" }, 403);

    const incoming = await req.formData();
    const payloadStr = incoming.get("payload");
    if (typeof payloadStr !== "string") {
      return json({ error: "Missing 'payload' field" }, 400);
    }
    const payload = JSON.parse(payloadStr) as Record<string, unknown>;
    const client = (payload.clientConfig ?? {}) as Record<string, unknown>;
    const cabinet = (payload.cabinet ?? {}) as Record<string, unknown>;

    const adAccount = normalizeAdAccount(pickStr(
      client.ad_account_id, client.adaccountid, payload.ad_account_id, payload.AD_ACCOUNT,
      cabinet.adAccountId,
    ));
    if (!adAccount) {
      return json({
        ok: false,
        error: "AD_ACCOUNT пуст: у выбранного кабинета не указан ad_account_id. Заполните его в настройках кабинета.",
      }, 400);
    }

    const launchId = pickStr(payload.launchId) || crypto.randomUUID();
    const cabinetId = pickStr(cabinet.id, payload.cabinet_id, payload.cabinetId) || null;
    const projectId = pickStr(payload.projectId, payload.project_id) || null;
    const mode = (Deno.env.get("AD_LAUNCH_MODE") ?? "direct").toLowerCase();

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const files = collectMediaFiles(incoming);

    // ================================================================
    // Режим direct: очередь + воркер
    // ================================================================
    if (mode !== "n8n") {
      const media: LaunchMedia[] = [];
      for (const { role, index, file } of files) {
        const path = `${launchId}/${role}-${index}.${extFor(file)}`;
        const { error: upErr } = await admin.storage
          .from(MEDIA_BUCKET)
          .upload(path, file, { contentType: file.type, upsert: true });
        if (upErr) {
          return json({ ok: false, error: `Не удалось сохранить креатив: ${upErr.message}` }, 500);
        }
        const { data: pub } = admin.storage.from(MEDIA_BUCKET).getPublicUrl(path);
        media.push({
          role,
          index,
          url: pub.publicUrl,
          mime: file.type,
          name: file.name || `${role}-${index}.${extFor(file)}`,
        });
      }

      // Креатив может прийти ссылкой (галерея Контент-завода) — файлов тогда нет.
      const galleryUrls = Array.isArray(payload.creativeUrls) ? payload.creativeUrls : [];
      galleryUrls.forEach((raw, i) => {
        if (typeof raw !== "string" || !raw.trim()) return;
        media.push({
          role: galleryUrls.length > 1 ? "carousel" : "feed",
          index: i,
          url: raw.trim(),
          mime: /\.(mp4|mov)(\?|$)/i.test(raw) ? "video/mp4" : "image/jpeg",
          name: `gallery-${i}.${/\.(mp4|mov)(\?|$)/i.test(raw) ? "mp4" : "jpg"}`,
        });
      });

      const spec = normalizeLaunchPayload(payload, media);
      spec.adAccount = adAccount;

      const problems = validateLaunchSpec(spec);
      if (problems.length) {
        return json({ ok: false, error: problems.join("; ") }, 400);
      }

      // Строку кампании создаём здесь, а не на фронте: воркер стартует
      // немедленно и должен найти её, чтобы писать статус по launch_id.
      const { error: campErr } = await admin.from("ad_campaigns").insert({
        cabinet_id: cabinetId,
        project_id: projectId,
        goal: spec.goal,
        budget: String(payload.budget ?? ""),
        text: spec.text,
        whatsapp_id: spec.goal === "whatsapp" ? spec.whatsappNumber : null,
        pixel_id: spec.goal === "site-leads" ? spec.pixelId : null,
        pixel_event: spec.goal === "site-leads" ? spec.pixelEvent : null,
        lead_form_id: spec.goal === "meta-form" ? spec.leadFormId : null,
        launch_id: launchId,
        status: "queued",
        status_step: "queued",
        status_message: "Запуск поставлен в очередь",
        status_updated_at: new Date().toISOString(),
        created_by: auth.userId,
      });
      if (campErr) console.error("[launch-campaign] ad_campaigns insert:", campErr.message);

      const { data: job, error: jobErr } = await admin
        .from("ad_launch_jobs")
        .insert({
          launch_id: launchId,
          project_id: projectId,
          cabinet_id: cabinetId,
          created_by: auth.userId,
          source: pickStr(payload.source) === "content_factory" ? "content_factory" : "manual",
          spec,
          status: "queued",
          step: "queued",
        })
        .select("id")
        .single();

      if (jobErr || !job) {
        return json({ ok: false, error: `Не удалось поставить задание: ${jobErr?.message}` }, 500);
      }

      // Fire-and-forget: не ждём воркер, иначе пользователь снова смотрит
      // в спиннер. Крон раз в минуту всё равно подберёт задание, если этот
      // вызов не дойдёт.
      const kick = fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/ad-launch-worker`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({ job_id: (job as { id: string }).id, source: "enqueue" }),
        signal: AbortSignal.timeout(120_000),
      }).catch((e) => console.error("[launch-campaign] kick worker:", (e as Error).message));

      const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
      if (typeof rt?.waitUntil === "function") rt.waitUntil(kick);

      return json({
        ok: true,
        accepted: true,
        mode: "direct",
        launchId,
        jobId: (job as { id: string }).id,
        // Фронту не нужно повторно писать ad_campaigns — строка уже создана.
        campaignSaved: true,
        summary: {
          goal: spec.goal,
          goalLabel: goalLabel(spec.goal),
          cabinetName: spec.cabinetName,
          adAccountId: adAccount,
          pageId: spec.pageId,
          instagramId: spec.instagramUserId,
          pixelId: spec.pixelId,
          pixelEvent: spec.pixelEvent,
          websiteUrl: spec.websiteUrl,
          whatsappNumber: spec.whatsappNumber,
          leadFormId: spec.leadFormId,
          budget: payload.budget ?? null,
          currency: spec.currency,
        },
        creativeFormat: spec.creativeFormat,
        adSetupMode: spec.adSetupMode,
        mediaCount: media.length,
      });
    }

    // ================================================================
    // Режим n8n: прежний путь (аварийный откат)
    // ================================================================
    const accessToken = await resolveMetaAccessToken({
      cabinetId,
      projectId,
      bodyToken: pickStr(client.fb_token, client.access_token, client.fbtoken, client.accesstoken),
      admin,
    });
    if (!accessToken) {
      return json({ error: "META_ACCESS_TOKEN is not configured" }, 500);
    }

    const spec = normalizeLaunchPayload(payload, []);
    spec.adAccount = adAccount;

    const imageHashes: string[] = [];
    let storiesImageHash: string | null = null;
    for (const { role, file } of files) {
      if (!file.type.startsWith("image/")) continue;
      const up = await uploadAdImage(adAccount, accessToken, file, file.name);
      if (!up.ok || !up.data) continue;
      if (role === "stories") storiesImageHash = up.data.hash;
      else imageHashes.push(up.data.hash);
    }

    // Алиасы полей — ноды n8n читают их вразнобой, менять нельзя.
    client.fb_token = accessToken;
    client.fbtoken = accessToken;
    client.access_token = accessToken;
    client.accesstoken = accessToken;
    client.ad_account_id = adAccount;
    client.adaccountid = adAccount;
    payload.clientConfig = client;
    payload.ACCESS_TOKEN = accessToken;
    payload.accesstoken = accessToken;
    payload.AD_ACCOUNT = adAccount;
    payload.adAccount = adAccount;
    payload.ad_account_id = adAccount;
    payload.PAGE_ID = spec.pageId;
    payload.PAGE_NAME = pickStr(client.page_name, client.pagename);
    payload.INSTAGRAM_ID = spec.instagramUserId;
    payload.PIXEL_ID = spec.pixelId;
    payload.PIXEL_EVENT = spec.pixelEvent;
    payload.WEBSITE_URL = spec.websiteUrl;
    payload.WHATSAPP_NUMBER = spec.whatsappNumber;
    payload.BUSINESS_ID = pickStr(client.business_id);
    payload.APP_ID = pickStr(client.app_id);
    payload.LEAD_FORM_ID = spec.leadFormId;
    payload.isWebsiteGoal = spec.goal === "site-leads";
    payload.isMetaForm = spec.goal === "meta-form";
    payload.isWhatsApp = spec.goal === "whatsapp";
    payload.launchId = launchId;
    payload.feedImageHash = imageHashes[0] ?? null;
    payload.storiesImageHash = storiesImageHash;
    payload.carouselImageHashes = spec.creativeFormat === "carousel" ? imageHashes : [];
    payload.creativeFormat = spec.creativeFormat;
    payload.adSetupMode = spec.adSetupMode;

    // Тела Graph собираются тем же кодом, что и в прямом контуре, — чтобы
    // два режима не разъезжались по логике целей и креативов.
    const assets = {
      imageHashes,
      videoId: null,
      videoThumbUrl: null,
      storiesImageHash,
    };
    payload.campaignBody = { ...buildCampaignBody(spec), access_token: accessToken };
    payload.adSetBody = { ...buildAdSetBody(spec, "", {}), access_token: accessToken };
    payload.creativeBody = { ...buildCreativeBody(spec, assets), access_token: accessToken };
    payload.adBody = { ...buildAdBody(spec, "", ""), access_token: accessToken };
    payload.launchSummary = {
      goal: spec.goal,
      goalLabel: goalLabel(spec.goal),
      cabinetName: spec.cabinetName,
      adAccountId: adAccount,
      pageId: spec.pageId,
      instagramId: spec.instagramUserId,
      pixelId: spec.pixelId,
      pixelEvent: spec.pixelEvent,
      websiteUrl: spec.websiteUrl,
      whatsappNumber: spec.whatsappNumber,
      leadFormId: spec.leadFormId,
      budget: payload.budget ?? null,
      currency: spec.currency,
    };

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
      const err = e as { name?: string; message?: string };
      const msg = (err?.message ?? "").toLowerCase();
      if (
        err?.name === "TimeoutError" || err?.name === "AbortError" ||
        msg.includes("aborted") || msg.includes("timeout") || msg.includes("timed out")
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

    return json({
      ok: ackOk,
      status: ackStatus,
      accepted: ackOk,
      mode: "n8n",
      launchId,
      campaignSaved: false,
      summary: payload.launchSummary,
      feedImageHash: imageHashes[0] ?? null,
      storiesImageHash,
      carouselImageHashes: payload.carouselImageHashes,
      creativeFormat: spec.creativeFormat,
      adSetupMode: spec.adSetupMode,
      sourceInstagramMediaId: spec.sourceInstagramMediaId || null,
      response: ackBody,
    }, ackOk ? 200 : 502);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
