import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import {
  fetchAllMetaAdAccounts,
  mapAdAccounts,
  normalizeActId as normalizeActIdList,
} from "../_lib/meta_list_ad_accounts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const META_API_VERSION = "v21.0";

function normalizeActId(id: string) {
  const t = id.trim();
  if (!t) return "";
  if (/^act_\d+$/i.test(t)) return `act_${t.replace(/^act_/i, "")}`;
  if (/^\d+$/.test(t)) return `act_${t}`;
  return t;
}

interface CheckResult {
  ok: boolean;
  label: string;
  detail?: string;
}

async function checkAdAccount(actId: string, token: string): Promise<CheckResult> {
  if (!actId) return { ok: false, label: "Ad Account", detail: "не указан" };
  const url =
    `https://graph.facebook.com/${META_API_VERSION}/${actId}` +
    `?fields=name,currency,account_status,timezone_name` +
    `&access_token=${encodeURIComponent(token)}`;
  try {
    const r = await fetch(url);
    const j = await r.json();
    if (!r.ok) return { ok: false, label: "Ad Account", detail: j?.error?.message || "ошибка Meta" };
    return {
      ok: true,
      label: "Ad Account",
      detail: `${j.name || actId} • ${j.currency || ""} • ${j.account_status === 1 ? "active" : "status " + j.account_status}`,
    };
  } catch (e) {
    return { ok: false, label: "Ad Account", detail: (e as Error).message };
  }
}

async function checkPage(pageId: string, token: string): Promise<CheckResult | null> {
  if (!pageId?.trim()) return null;
  const url = `https://graph.facebook.com/${META_API_VERSION}/${pageId.trim()}` +
    `?fields=name,verification_status&access_token=${encodeURIComponent(token)}`;
  try {
    const r = await fetch(url);
    const j = await r.json();
    if (!r.ok) return { ok: false, label: "Page", detail: j?.error?.message || "ошибка" };
    return { ok: true, label: "Page", detail: j.name || pageId };
  } catch (e) {
    return { ok: false, label: "Page", detail: (e as Error).message };
  }
}

async function checkPixel(actId: string, pixelId: string, token: string): Promise<CheckResult | null> {
  if (!pixelId?.trim() || !actId) return null;
  const url = `https://graph.facebook.com/${META_API_VERSION}/${actId}/adspixels` +
    `?fields=id,name,last_fired_time&access_token=${encodeURIComponent(token)}`;
  try {
    const r = await fetch(url);
    const j = await r.json();
    if (!r.ok) return { ok: false, label: "Pixel", detail: j?.error?.message || "ошибка" };
    const found = (j.data || []).find((p: { id: string }) => p.id === pixelId.trim());
    if (!found) return { ok: false, label: "Pixel", detail: "не найден в этом Ad Account" };
    return { ok: true, label: "Pixel", detail: found.name || pixelId };
  } catch (e) {
    return { ok: false, label: "Pixel", detail: (e as Error).message };
  }
}

async function checkInstagram(igId: string, token: string): Promise<CheckResult | null> {
  if (!igId?.trim()) return null;
  const url = `https://graph.facebook.com/${META_API_VERSION}/${igId.trim()}` +
    `?fields=username&access_token=${encodeURIComponent(token)}`;
  try {
    const r = await fetch(url);
    const j = await r.json();
    if (!r.ok) return { ok: false, label: "Instagram", detail: j?.error?.message || "ошибка" };
    return { ok: true, label: "Instagram", detail: j.username ? `@${j.username}` : igId };
  } catch (e) {
    return { ok: false, label: "Instagram", detail: (e as Error).message };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsErr } = await supabase.auth.getClaims(token);
    if (claimsErr || !claims?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));

    if (body.list_ad_accounts === true) {
      const excludeRaw: string[] = Array.isArray(body.exclude_act_ids)
        ? body.exclude_act_ids
        : [];
      const exclude = excludeRaw.map((x) => normalizeActIdList(String(x)));

      const admin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      let listToken: string | null =
        typeof body.access_token === "string" ? body.access_token.trim() : null;
      if (!listToken) {
        const { data: settings } = await admin
          .from("automation_settings")
          .select("meta_access_token")
          .eq("id", true)
          .maybeSingle();
        listToken = settings?.meta_access_token ?? Deno.env.get("META_ACCESS_TOKEN") ?? null;
      }
      if (!listToken) {
        return new Response(JSON.stringify({
          error: "Meta access token не настроен. Укажите токен в Настройках → Автоматизация.",
          accounts: [],
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const fetched = await fetchAllMetaAdAccounts(listToken);
      const accounts = mapAdAccounts(fetched.rows, exclude);
      return new Response(JSON.stringify({
        ok: true,
        accounts,
        meta_hint: fetched.meta_hint,
        token_identity: fetched.token_identity,
        sources: fetched.sources,
        raw_count: fetched.rows.length,
      }, {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cabinetId: string | undefined = body.cabinetId;
    let adAccountId: string = body.adAccountId || "";
    let pageId: string = body.pageId || "";
    let pixelId: string = body.pixelId || "";
    let instagramId: string = body.instagramId || "";
    let cabinetToken: string | null = body.accessToken || null;

    if (cabinetId) {
      const admin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const { data: cab } = await admin
        .from("ad_cabinets")
        .select("ad_account_id, external_id, page_id, pixel_id, instagram_id, access_token")
        .eq("id", cabinetId)
        .maybeSingle();
      if (cab) {
        adAccountId = adAccountId || cab.ad_account_id || cab.external_id || "";
        pageId = pageId || cab.page_id || "";
        pixelId = pixelId || cab.pixel_id || "";
        instagramId = instagramId || cab.instagram_id || "";
        cabinetToken = cabinetToken || cab.access_token || null;
      }
    }

    const accessToken = cabinetToken || Deno.env.get("META_ACCESS_TOKEN") || "";
    if (!accessToken) {
      return new Response(JSON.stringify({ error: "Нет access token" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const actId = normalizeActId(adAccountId);
    const checks = await Promise.all([
      checkAdAccount(actId, accessToken),
      checkPage(pageId, accessToken),
      checkPixel(actId, pixelId, accessToken),
      checkInstagram(instagramId, accessToken),
    ]);
    const filtered = checks.filter((c): c is CheckResult => c !== null);
    const ok = filtered.every((c) => c.ok);

    return new Response(JSON.stringify({ ok, checks: filtered }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});