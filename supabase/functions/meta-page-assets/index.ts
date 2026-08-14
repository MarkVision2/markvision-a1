import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import {
  requireUser,
  requireMetaAdAccountAccess,
  createUserClient,
} from "../_lib/auth.ts";
import { resolveMetaAccessToken } from "../_lib/metaToken.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const META_API_VERSION = "v21.0";

function normalizeActId(id: string): string {
  const t = id.trim();
  if (/^act_\d+$/i.test(t)) return `act_${t.replace(/^act_/i, "")}`;
  if (/^\d+$/.test(t)) return `act_${t}`;
  return t;
}

async function metaGet(path: string, token: string) {
  const sep = path.includes("?") ? "&" : "?";
  const url =
    `https://graph.facebook.com/${META_API_VERSION}${path}${sep}access_token=${encodeURIComponent(token)}`;
  const r = await fetch(url);
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body: j as any };
}

/** Human-readable Meta OAuth / token errors for the Ads UI. */
function formatMetaError(err: unknown): { error: string; details?: unknown; code?: number } {
  const e = (err ?? {}) as {
    message?: string;
    code?: number;
    error_subcode?: number;
    type?: string;
  };
  const msg = String(e.message ?? "Meta API error");
  const invalidated =
    e.code === 190 ||
    e.error_subcode === 460 ||
    /session has been invalidated|password|validating access token/i.test(msg);
  if (invalidated) {
    return {
      error:
        "Токен Meta истёк или сброшен (смена пароля / сессии Facebook). Откройте настройки кабинета и вставьте новый Access Token (EAA…). Также обновите META_ACCESS_TOKEN в секретах Supabase, если пиксели грузятся через общий токен.",
      details: e,
      code: 190,
    };
  }
  return { error: msg, details: e, code: e.code };
}

/**
 * Prefer per-cabinet / automation_settings token, then env META_ACCESS_TOKEN.
 * Resolves cabinet by ad account id when present.
 */
async function resolveGraphToken(
  authHeader: string,
  actId: string | null,
  envToken: string,
): Promise<string> {
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  let cabinetId: string | null = null;
  let projectId: string | null = null;
  if (actId) {
    try {
      const client = createUserClient(authHeader);
      const raw = actId.replace(/^act_/i, "");
      const { data } = await client
        .from("ad_cabinets")
        .select("id, project_id, access_token")
        .or(
          `ad_account_id.eq.${normalizeActId(actId)},ad_account_id.eq.${raw},ad_account_id.eq.act_${raw}`,
        )
        .limit(1)
        .maybeSingle();
      if (data?.id) cabinetId = String(data.id);
      if (data?.project_id) projectId = String(data.project_id);
    } catch {
      /* fall through */
    }
  }
  const tok = await resolveMetaAccessToken({
    admin,
    cabinetId,
    projectId,
  });
  return (tok && tok.trim()) || envToken;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const FALLBACK_PIXEL_EVENTS = [
  "Lead",
  "Purchase",
  "Contact",
  "CompleteRegistration",
  "Subscribe",
  "SubmitApplication",
  "AddToCart",
  "InitiateCheckout",
  "ViewContent",
  "Schedule",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const auth = await requireUser(req);
    if (!auth.ok) return auth.response;

    const envMetaToken = Deno.env.get("META_ACCESS_TOKEN");
    if (!envMetaToken) {
      return jsonResponse({ error: "META_ACCESS_TOKEN not configured" }, 500);
    }

    const url = new URL(req.url);
    const kind = url.searchParams.get("kind");
    const actId = url.searchParams.get("actId");
    const pageId = url.searchParams.get("pageId");
    const pixelId = url.searchParams.get("pixelId");
    const igUserIdParam = url.searchParams.get("igUserId");

    if (!kind) return jsonResponse({ error: "kind is required" }, 400);

    // Token: cabinet → project meta_tokens → automation_settings → env.
    const META_ACCESS_TOKEN = await resolveGraphToken(auth.authHeader, actId, envMetaToken);

    // Tenant authorization: caller must have RLS access to a cabinet that
    // matches the requested ad account or page.
    // Exception: 'pages' and 'pixels' are discovery endpoints used during
    // the "Quick add from Meta" flow BEFORE a cabinet row exists. They
    // only expose metadata for accounts the shared META token can already
    // see, so authenticated users may call them without an existing cabinet.
    //
    // 'pixel_events' is used in the campaign wizard right after picking a
    // pixel from the discovery list — that pixel is often NOT yet saved as
    // ad_cabinets.pixel_id. Authorize via the ad account instead of requiring
    // a matching pixel_id row (old check returned 403 → UI "non-2xx").
    //
    // 'lead_forms' — менеджер выбирает FB-страницу из promote_pages в мастере
    // запуска; она часто ≠ ad_cabinets.page_id. Достаточно доступа к actId.
    //
    // 'ig_media' lists organic IG posts for "use existing publication" —
    // authorize via actId (preferred) or pageId cabinet match.
    // 'instagram' — привязанный к FB-странице IG-аккаунт выбирается в мастере
    // добавления кабинета, ДО того как строка ad_cabinets создана. Авторизуем
    // по actId, если он передан; иначе это только метаданные общего токена.
    const isDiscovery = kind === "pages" || kind === "pixels";
    if (kind === "instagram") {
      if (actId) {
        const actAccess = await requireMetaAdAccountAccess(auth.authHeader, actId);
        if (!actAccess.ok) return actAccess.response;
      }
    } else if (kind === "pixel_events") {
      if (!actId) {
        return jsonResponse({ error: "actId is required for pixel_events" }, 400);
      }
      const actAccess = await requireMetaAdAccountAccess(auth.authHeader, actId);
      if (!actAccess.ok) return actAccess.response;
    } else if (kind === "lead_forms") {
      if (!pageId) {
        return jsonResponse({ error: "pageId is required for lead_forms" }, 400);
      }
      if (actId) {
        const actAccess = await requireMetaAdAccountAccess(auth.authHeader, actId);
        if (!actAccess.ok) return actAccess.response;
      } else {
        const client = createUserClient(auth.authHeader);
        const { data: cab } = await client
          .from("ad_cabinets")
          .select("id")
          .eq("page_id", pageId)
          .limit(1)
          .maybeSingle();
        if (!cab) return jsonResponse({ error: "Forbidden" }, 403);
      }
    } else if (kind === "ig_media") {
      if (actId) {
        const actAccess = await requireMetaAdAccountAccess(auth.authHeader, actId);
        if (!actAccess.ok) return actAccess.response;
      } else if (pageId) {
        const client = createUserClient(auth.authHeader);
        const { data: cab } = await client
          .from("ad_cabinets")
          .select("id")
          .eq("page_id", pageId)
          .limit(1)
          .maybeSingle();
        if (!cab) return jsonResponse({ error: "Forbidden" }, 403);
      } else {
        return jsonResponse({ error: "actId or pageId is required for ig_media" }, 400);
      }
    } else if (actId && !isDiscovery) {
      const actAccess = await requireMetaAdAccountAccess(auth.authHeader, actId);
      if (!actAccess.ok) return actAccess.response;
    } else if (pageId) {
      const client = createUserClient(auth.authHeader);
      const { data: cab } = await client
        .from("ad_cabinets")
        .select("id")
        .eq("page_id", pageId)
        .limit(1)
        .maybeSingle();
      if (!cab) return jsonResponse({ error: "Forbidden" }, 403);
    }

    // ============ WHATSAPP ============
    if (kind === "whatsapp") {
      if (!pageId && !actId) {
        return jsonResponse({ error: "pageId or actId is required" }, 400);
      }

      const debug = url.searchParams.get("debug") === "1";
      const sources: Record<string, unknown> = {};
      const phones: Array<{
        id: string;
        display_phone_number: string;
        verified_name?: string;
      }> = [];
      const seen = new Set<string>();
      const addPhone = (
        id: string,
        display: string,
        verified_name?: string,
      ) => {
        const key = String(display).replace(/\D/g, "");
        if (!key || seen.has(key)) return;
        seen.add(key);
        phones.push({
          id: String(id),
          display_phone_number: String(display),
          verified_name,
        });
      };

      // Try to get a Page Access Token (more permissions than user token).
      let pageToken: string | undefined;
      let pageName: string | undefined;
      if (pageId) {
        const pageTokenResp = await metaGet(
          `/${pageId}?fields=access_token,name`,
          META_ACCESS_TOKEN,
        );
        pageToken = pageTokenResp.body?.access_token;
        pageName = pageTokenResp.body?.name;
        if (debug) sources.page_token_resp = pageTokenResp.body;
      }

      const tryToken = pageToken ?? META_ACCESS_TOKEN;

      // Helper: extract phone digits from arbitrary URL/string
      const extractPhone = (raw: unknown): string | null => {
        if (!raw) return null;
        const c = String(raw);
        const m =
          c.match(/wa\.me\/(\+?\d{8,15})/i) ||
          c.match(/whatsapp\.com\/.*[?&]phone=(\+?\d{8,15})/i) ||
          c.match(/(\+?\d{10,15})/);
        if (!m) return null;
        const digits = (m[1] ?? m[0]).replace(/\D/g, "");
        return digits.length >= 10 ? "+" + digits : null;
      };

      if (pageId) {
        // 1) Connected WhatsApp Business Account -> phone_numbers
        const waba = await metaGet(
          `/${pageId}?fields=connected_whatsapp_business_account{phone_numbers{id,display_phone_number,verified_name}}`,
          tryToken,
        );
        if (debug) sources.connected_waba = waba.body;
        const wabaPhones =
          waba.body?.connected_whatsapp_business_account?.phone_numbers?.data;
        if (Array.isArray(wabaPhones)) {
          for (const p of wabaPhones) {
            addPhone(
              p.id ?? p.display_phone_number,
              p.display_phone_number,
              p.verified_name,
            );
          }
        }

        // 2) page_call_to_actions
        const ctas = await metaGet(
          `/${pageId}/call_to_actions?fields=type,web_destination,android_destination,iphone_destination,intl_number_with_plus`,
          tryToken,
        );
        if (debug) sources.call_to_actions = ctas.body;
        if (Array.isArray(ctas.body?.data)) {
          for (const cta of ctas.body.data) {
            for (
              const c of [
                cta.web_destination,
                cta.android_destination,
                cta.iphone_destination,
                cta.intl_number_with_plus,
              ]
            ) {
              const num = extractPhone(c);
              if (num) addPhone(num, num, pageName);
            }
          }
        }

        // 3) Direct page field whatsapp_number
        const pageWa = await metaGet(
          `/${pageId}?fields=whatsapp_number`,
          tryToken,
        );
        if (debug) sources.page_whatsapp_number = pageWa.body;
        const num = extractPhone(pageWa.body?.whatsapp_number);
        if (num) addPhone(num, num, pageName);
      }

      // 4) CTWA numbers actually used in ads of this ad account.
      if (actId) {
        const acct = normalizeActId(actId);

        // 4a) Ad sets with WhatsApp destination — promoted_object.page_id + whatsapp_phone_number
        const adsets = await metaGet(
          `/${acct}/adsets?fields=name,destination_type,promoted_object&limit=200`,
          META_ACCESS_TOKEN,
        );
        if (debug) sources.adsets = adsets.body;
        if (Array.isArray(adsets.body?.data)) {
          for (const a of adsets.body.data) {
            const po = a?.promoted_object ?? {};
            for (
              const v of [
                po.whatsapp_phone_number,
                po.phone_number,
                po.application_id,
              ]
            ) {
              const num = extractPhone(v);
              if (num) addPhone(num, num, a?.name ?? "CTWA Ad Set");
            }
          }
        }

        // 4b) Ads -> creative{...} with destination_set / link_data
        const ads = await metaGet(
          `/${acct}/ads?fields=name,creative{object_story_spec{link_data{link,call_to_action{value{link}}},video_data{call_to_action{value{link}}}},asset_feed_spec{link_urls{website_url},call_to_action_types}}&limit=200`,
          META_ACCESS_TOKEN,
        );
        if (debug) sources.ads = ads.body;
        if (Array.isArray(ads.body?.data)) {
          for (const ad of ads.body.data) {
            const cr = ad?.creative ?? {};
            const candidates: unknown[] = [];
            const oss = cr?.object_story_spec ?? {};
            if (oss?.link_data?.link) candidates.push(oss.link_data.link);
            if (oss?.link_data?.call_to_action?.value?.link) {
              candidates.push(oss.link_data.call_to_action.value.link);
            }
            if (oss?.video_data?.call_to_action?.value?.link) {
              candidates.push(oss.video_data.call_to_action.value.link);
            }
            if (Array.isArray(cr?.asset_feed_spec?.link_urls)) {
              for (const l of cr.asset_feed_spec.link_urls) {
                if (l?.website_url) candidates.push(l.website_url);
              }
            }
            for (const c of candidates) {
              const num = extractPhone(c);
              if (num) addPhone(num, num, ad?.name ?? "CTWA-объявление");
            }
          }
        }
      }

      if (debug) {
        return jsonResponse({ items: phones, debug: sources });
      }
      return jsonResponse({ items: phones });
    }

    // ============ PAGES ============
    // Returns Facebook Pages that can be used as the "from" page for ads on this ad account.
    if (kind === "pages") {
      if (!actId) return jsonResponse({ error: "actId is required" }, 400);
      const seen = new Set<string>();
      const items: Array<{
        id: string;
        name: string;
        category?: string;
        picture?: string;
        website?: string;
        instagram_id?: string;
        instagram_username?: string;
      }> = [];
      const push = (p: any) => {
        const id = String(p?.id ?? "");
        if (!id || seen.has(id)) return;
        seen.add(id);
        items.push({
          id,
          name: p?.name ?? id,
          category: p?.category ?? undefined,
          picture: p?.picture?.data?.url ?? undefined,
          website: p?.website ?? undefined,
          instagram_id: p?.instagram_business_account?.id ?? undefined,
          instagram_username: p?.instagram_business_account?.username ?? undefined,
        });
      };
      const pageFields =
        "id,name,category,picture{url},website,instagram_business_account{id,username}";
      // 1) Pages promotable from this ad account
      const r1 = await metaGet(
        `/${normalizeActId(actId)}/promote_pages?fields=${pageFields}&limit=200`,
        META_ACCESS_TOKEN,
      );
      if (r1.ok && Array.isArray(r1.body?.data)) r1.body.data.forEach(push);
      // 2) Fallback: pages owned by the business
      if (items.length === 0) {
        const r2 = await metaGet(
          `/${normalizeActId(actId)}?fields=business{owned_pages{${pageFields}},client_pages{${pageFields}}}`,
          META_ACCESS_TOKEN,
        );
        const owned = r2.body?.business?.owned_pages?.data ?? [];
        const client = r2.body?.business?.client_pages?.data ?? [];
        [...owned, ...client].forEach(push);
      }
      return jsonResponse({ items });
    }

    // ============ PIXELS ============
    if (kind === "pixels") {
      if (!actId) return jsonResponse({ error: "actId is required" }, 400);
      const r = await metaGet(
        `/${normalizeActId(actId)}/adspixels?fields=id,name,last_fired_time&limit=100`,
        META_ACCESS_TOKEN,
      );
      if (!r.ok) {
        return jsonResponse(
          { ...formatMetaError(r.body?.error), status: r.status },
          502,
        );
      }
      const items = (r.body?.data ?? []).map((p: any) => ({
        id: p.id,
        name: p.name,
        last_fired_time: p.last_fired_time ?? null,
      }));
      return jsonResponse({ items });
    }

    // ============ PIXEL EVENTS ============
    if (kind === "pixel_events") {
      if (!pixelId) return jsonResponse({ error: "pixelId is required" }, 400);
      const start = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
      const r = await metaGet(
        `/${pixelId}/stats?aggregation=event&start_time=${start}`,
        META_ACCESS_TOKEN,
      );
      const recent = new Map<string, number>();
      if (r.ok && Array.isArray(r.body?.data)) {
        for (const row of r.body.data) {
          if (Array.isArray(row?.data)) {
            for (const entry of row.data) {
              const evt = entry?.event ?? entry?.value;
              const cnt = Number(entry?.count ?? 0);
              if (evt) recent.set(evt, (recent.get(evt) ?? 0) + cnt);
            }
          }
        }
      }
      // Merge recent + fallback list (recent first, sorted by count desc)
      const sortedRecent = Array.from(recent.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, count }));
      const recentNames = new Set(sortedRecent.map((e) => e.name));
      const fallback = FALLBACK_PIXEL_EVENTS.filter((n) => !recentNames.has(n))
        .map((name) => ({ name, count: 0 }));
      return jsonResponse({ items: [...sortedRecent, ...fallback] });
    }

    // ============ LEAD FORMS ============
    if (kind === "lead_forms") {
      if (!pageId) return jsonResponse({ error: "pageId is required" }, 400);

      // Lead forms require a Page Access Token, not a User Token.
      // Fetch the page token first, then use it for the leadgen_forms call.
      const pageTokenResp = await metaGet(
        `/${pageId}?fields=access_token`,
        META_ACCESS_TOKEN,
      );
      const pageToken: string | undefined = pageTokenResp.body?.access_token;

      const tokenToUse = pageToken ?? META_ACCESS_TOKEN;
      const r = await metaGet(
        `/${pageId}/leadgen_forms?fields=id,name,status,leads_count&limit=200`,
        tokenToUse,
      );
      if (!r.ok) {
        // Soft-fail: return empty list with a warning instead of 502
        // (otherwise UI shows a blank-screen error). Common cause: token
        // lacks pages_manage_ads / leads_retrieval, or page has no forms.
        const warning = r.body?.error?.message ??
          "Не удалось получить лид-формы (проверьте права токена Meta: pages_show_list, pages_read_engagement, leads_retrieval).";
        return jsonResponse({ items: [], warning });
      }
      const items = (r.body?.data ?? []).map((f: any) => ({
        id: f.id,
        name: f.name,
        status: f.status,
        leads_count: Number(f.leads_count ?? 0),
      }));
      return jsonResponse({ items });
    }

    // ============ IG MEDIA (organic posts to boost) ============
    // Meta docs: Use Posts as Instagram Ads —
    // source_instagram_media_id + boost_eligibility_info on /{ig-user}/media
    if (kind === "ig_media") {
      let igId = (igUserIdParam || "").trim();
      if (!igId && pageId) {
        const pageResp = await metaGet(
          `/${pageId}?fields=instagram_business_account{id,username}`,
          META_ACCESS_TOKEN,
        );
        igId = String(pageResp.body?.instagram_business_account?.id || "");
      }
      if (!igId) {
        return jsonResponse(
          {
            error:
              "Instagram не привязан к странице. Подключите IG Business к Facebook Page.",
          },
          400,
        );
      }

      const fields = [
        "id",
        "caption",
        "media_type",
        "media_product_type",
        "permalink",
        "thumbnail_url",
        "media_url",
        "timestamp",
        "like_count",
        "comments_count",
        "boost_eligibility_info",
      ].join(",");

      const r = await metaGet(
        `/${igId}/media?fields=${fields}&limit=50`,
        META_ACCESS_TOKEN,
      );
      if (!r.ok) {
        const warning = r.body?.error?.message ??
          "Не удалось получить публикации Instagram (проверьте права токена: instagram_basic, pages_read_engagement).";
        return jsonResponse({ items: [], warning, ig_user_id: igId });
      }

      const items = (r.body?.data ?? []).map((m: any) => {
        const boost = m?.boost_eligibility_info;
        let eligible = true;
        let reason: string | null = null;
        if (boost && typeof boost === "object") {
          if (boost.eligible_to_boost === false || boost.is_eligible_for_boost === false) {
            eligible = false;
          }
          if (Array.isArray(boost.eligibility_errors) && boost.eligibility_errors.length > 0) {
            eligible = false;
            reason = String(boost.eligibility_errors[0]);
          }
          reason =
            reason ||
            (boost.reason ? String(boost.reason) : null) ||
            (boost.ineligibility_reason ? String(boost.ineligibility_reason) : null);
          if (boost.eligible_to_boost === true || boost.is_eligible_for_boost === true) {
            eligible = true;
          }
        }
        return {
          id: String(m.id),
          caption: m.caption ?? null,
          media_type: m.media_type ?? "IMAGE",
          media_product_type: m.media_product_type ?? null,
          permalink: m.permalink ?? null,
          thumbnail_url: m.thumbnail_url ?? m.media_url ?? null,
          media_url: m.media_url ?? null,
          timestamp: m.timestamp ?? null,
          like_count: Number(m.like_count ?? 0),
          comments_count: Number(m.comments_count ?? 0),
          eligible_to_boost: eligible,
          boost_reason: eligible ? null : reason,
        };
      });

      return jsonResponse({ items, ig_user_id: igId });
    }

    return jsonResponse({ error: `Unknown kind: ${kind}` }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("meta-page-assets error:", msg);
    return jsonResponse({ error: msg }, 500);
  }
});
