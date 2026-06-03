import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const META_API_VERSION = "v21.0";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeActId(id: string): string {
  const t = id.trim();
  if (/^act_\d+$/i.test(t)) return `act_${t.replace(/^act_/i, "")}`;
  if (/^\d+$/.test(t)) return `act_${t}`;
  return t;
}

type AdAccountRow = {
  id: string;
  account_id?: string;
  name?: string;
  currency?: string;
  account_status?: number;
  timezone_name?: string;
  business?: { name?: string };
};

async function fetchAllAdAccounts(token: string): Promise<AdAccountRow[]> {
  const out: AdAccountRow[] = [];
  let url =
    `https://graph.facebook.com/${META_API_VERSION}/me/adaccounts` +
    `?fields=id,account_id,name,currency,account_status,timezone_name,business{name}` +
    `&limit=100&access_token=${encodeURIComponent(token)}`;

  for (let guard = 0; guard < 20 && url; guard++) {
    const r = await fetch(url);
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j?.error) {
      throw new Error(j?.error?.message ?? `Meta API ${r.status}`);
    }
    if (Array.isArray(j.data)) out.push(...j.data);
    url = j.paging?.next ?? null;
  }
  return out;
}

const STATUS_LABEL: Record<number, string> = {
  1: "active",
  2: "disabled",
  3: "unsettled",
  7: "pending_risk_review",
  8: "pending_settlement",
  9: "in_grace_period",
  100: "pending_closure",
  101: "closed",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Unauthorized", accounts: [] }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
        Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: claims, error: claimsErr } = await supabase.auth.getClaims(
      authHeader.replace("Bearer ", ""),
    );
    if (claimsErr || !claims?.claims) {
      return jsonResponse({ error: "Unauthorized", accounts: [] }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const excludeRaw: string[] = Array.isArray(body.exclude_act_ids)
      ? body.exclude_act_ids
      : [];
    const exclude = new Set(excludeRaw.map((x) => normalizeActId(String(x))));

    let token: string | null =
      typeof body.access_token === "string" && body.access_token.trim()
        ? body.access_token.trim()
        : null;

    if (!token) {
      const admin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const { data: settings } = await admin
        .from("automation_settings")
        .select("meta_access_token")
        .eq("id", true)
        .maybeSingle();
      token = settings?.meta_access_token ?? null;
    }
    if (!token) token = Deno.env.get("META_ACCESS_TOKEN") ?? null;

    if (!token) {
      return jsonResponse({
        error: "Meta access token не настроен",
        accounts: [],
      }, 400);
    }

    const rows = await fetchAllAdAccounts(token);
    const accounts = rows
      .map((a) => {
        const id = normalizeActId(String(a.id ?? a.account_id ?? ""));
        return {
          id,
          account_id: a.account_id ?? id.replace(/^act_/, ""),
          name: a.name ?? id,
          currency: a.currency ?? "KZT",
          account_status: a.account_status ?? 0,
          status_label: STATUS_LABEL[a.account_status ?? 0] ?? "unknown",
          timezone_name: a.timezone_name ?? null,
          business_name: a.business?.name ?? null,
        };
      })
      .filter((a) => a.id && !exclude.has(a.id))
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));

    return jsonResponse({ ok: true, accounts });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return jsonResponse({ error: msg, accounts: [] }, 500);
  }
});
