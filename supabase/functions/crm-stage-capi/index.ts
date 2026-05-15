// crm-stage-capi — отправка Meta CAPI на смене этапа в CRM.
//
// Вход: { lead_id, stage_key, ad_account_id?, access_token?, pixel_id?, user_data, event_value?, event_source_url?, event_id? }
// Маппинг stage_key → capi_event берётся из таблицы pipeline_stages нового Supabase
// (если найден) или из встроенного fallback'а (см. STAGE_MAP).
// Возвращает: { ok, sent: boolean, event_name, fb_response, score_delta }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_lib/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Fallback stage_key → CAPI event (если pipeline_stages пуста).
const STAGE_MAP: Record<
  string,
  { capi: string | null; score: number; isTarget?: boolean; isPaid?: boolean }
> = {
  new:           { capi: "Lead",                  score: 20 },
  called:        { capi: null,                    score: 10 },
  interested:    { capi: null,                    score: 15 },
  scheduled:     { capi: "Schedule",              score: 30, isTarget: true },
  diagnosed:     { capi: "CompleteRegistration",  score: 10 },
  paid:          { capi: "Purchase",              score: 20, isTarget: true, isPaid: true },
  completed:     { capi: "Subscribe",             score:  5 },
  rejected:      { capi: null,                    score: -10 },
};

const META_API_VERSION = "v22.0";

const sha256 = async (s: string) => {
  const data = new TextEncoder().encode(s.trim().toLowerCase());
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

interface UserData {
  phone?: string;
  email?: string;
  fbc?: string;
  fbp?: string;
  client_user_agent?: string;
  client_ip_address?: string;
  external_id?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const auth = await requireUser(req);
    if (!auth.ok) return auth.response;
    const body = await req.json();
    const {
      lead_id,
      stage_key,
      ad_account_id: adAccIn,
      access_token: tokIn,
      pixel_id: pxIn,
      user_data = {} as UserData,
      event_value,
      currency = "USD",
      event_source_url,
      event_id,
      cabinet_id, // если знаем — берём токен/pixel из client_configs
    } = body || {};

    if (!stage_key) {
      return new Response(
        JSON.stringify({ ok: false, error: "stage_key required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SVC = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supa = createClient(SUPABASE_URL, SVC);

    // Подтягиваем кабинет (токен, pixel, ad_account)
    let token = tokIn || "";
    let adAccount = String(adAccIn || "");
    let pixelId = String(pxIn || "");

    if (cabinet_id && (!token || !adAccount || !pixelId)) {
      // На main supabase данные кабинета лежат в ad_cabinets (там и access_token,
      // и ad_account_id, и pixel_id одной строкой — отдельной clients_secrets нет).
      const { data: cfg } = await supa
        .from("ad_cabinets")
        .select("ad_account_id, pixel_id, access_token")
        .eq("id", cabinet_id)
        .single();
      if (cfg) {
        adAccount = adAccount || String(cfg.ad_account_id || "");
        pixelId = pixelId || String(cfg.pixel_id || "");
        if (!token) token = String((cfg as any).access_token || "");
      }
    }

    if (adAccount && !adAccount.startsWith("act_")) adAccount = "act_" + adAccount;

    // 2. Определяем capi_event и score_delta
    // Сначала пытаемся в pipeline_stages по name (=stage_key) или по позиции
    let capiEvent: string | null = null;
    let scoreDelta = 0;
    let isPaid = false;

    const { data: stage } = await supa
      .from("pipeline_stages")
      .select("capi_event, score_delta, is_paid, name")
      .or(`name.eq.${stage_key}`)
      .limit(1)
      .maybeSingle();

    if (stage) {
      capiEvent = stage.capi_event;
      scoreDelta = stage.score_delta || 0;
      isPaid = !!stage.is_paid;
    } else {
      const m = STAGE_MAP[stage_key];
      if (m) {
        capiEvent = m.capi;
        scoreDelta = m.score;
        isPaid = !!m.isPaid;
      }
    }

    // 3. Отправляем в Meta только если есть событие + pixel + token
    let sent = false;
    let fb_response: unknown = null;

    if (capiEvent && pixelId && token) {
      const ud: Record<string, string | string[]> = {};
      if (user_data.phone) ud.ph = [await sha256(String(user_data.phone).replace(/\D/g, ""))];
      if (user_data.email) ud.em = [await sha256(String(user_data.email))];
      if (user_data.external_id) ud.external_id = [await sha256(String(user_data.external_id))];
      if (user_data.fbc) ud.fbc = String(user_data.fbc);
      if (user_data.fbp) ud.fbp = String(user_data.fbp);
      if (user_data.client_user_agent) ud.client_user_agent = String(user_data.client_user_agent);
      if (user_data.client_ip_address) ud.client_ip_address = String(user_data.client_ip_address);

      const ev: Record<string, unknown> = {
        event_name: capiEvent,
        event_time: Math.floor(Date.now() / 1000),
        action_source: "website",
        event_source_url: event_source_url || "",
        event_id: event_id || `${lead_id || "lead"}-${capiEvent}-${Date.now()}`,
        user_data: ud,
      };
      if ((capiEvent === "Purchase" || isPaid) && event_value != null) {
        ev.custom_data = { currency, value: Number(event_value) };
      }

      const fbResp = await fetch(
        `https://graph.facebook.com/${META_API_VERSION}/${pixelId}/events?access_token=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: [ev] }),
        },
      );
      const fbText = await fbResp.text();
      try { fb_response = JSON.parse(fbText); } catch { fb_response = fbText.slice(0, 500); }
      sent = fbResp.ok;
    }

    // 4. История + обновление leads_crm (опционально, если lead_id есть и привязан к таблице нового Supabase)
    if (lead_id) {
      try {
        await supa.from("lead_status_history").insert({
          lead_id,
          to_stage_id: null,
          changed_by: "crm-ui",
          capi_event: capiEvent,
          capi_sent: sent,
          notes: `stage_key=${stage_key}; score_delta=${scoreDelta}; event=${capiEvent ?? "-"}`,
        });
      } catch { /* lead может жить в old Supabase, ok */ }

      try {
        const patch: Record<string, unknown> = {
          stage_updated_at: new Date().toISOString(),
        };
        if (capiEvent === "Schedule") patch.capi_schedule_sent_at = new Date().toISOString();
        if (capiEvent === "Purchase") patch.capi_purchase_sent_at = new Date().toISOString();
        if (event_value != null && isPaid) patch.purchase_value = Number(event_value);
        await supa.from("leads_crm").update(patch).eq("id", lead_id);
      } catch { /* ok */ }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        sent,
        event_name: capiEvent,
        score_delta: scoreDelta,
        fb_response,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
