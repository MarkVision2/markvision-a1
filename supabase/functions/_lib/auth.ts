// Shared auth helpers for edge functions.
// Verifies JWT, optional app roles, and tenant-scoped resource access via RLS.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

export const AUTH_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-automation-key, x-internal-key, x-cron-secret",
};

export type AuthClaims = {
  sub: string;
  email?: string;
  role?: string;
  [k: string]: unknown;
};

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...AUTH_CORS_HEADERS, "Content-Type": "application/json" },
  });
}

export function createUserClient(authHeader: string) {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
}

export async function requireUser(req: Request): Promise<
  | { ok: true; userId: string; token: string; authHeader: string; claims: AuthClaims }
  | { ok: false; response: Response }
> {
  const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, response: jsonError("Unauthorized", 401) };
  }
  const token = authHeader.replace("Bearer ", "").trim();
  const supabase = createUserClient(authHeader);
  try {
    const { data, error } = await supabase.auth.getClaims(token);
    if (error || !data?.claims?.sub) {
      return { ok: false, response: jsonError("Unauthorized", 401) };
    }
    return {
      ok: true,
      userId: data.claims.sub as string,
      token,
      authHeader,
      claims: data.claims as AuthClaims,
    };
  } catch {
    return { ok: false, response: jsonError("Unauthorized", 401) };
  }
}

export async function userHasRole(userId: string, role: string): Promise<boolean> {
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", role)
    .maybeSingle();
  return !!data;
}

export async function requireProjectAccess(
  authHeader: string,
  projectId: string,
): Promise<{ ok: true } | { ok: false; response: Response }> {
  if (!projectId) {
    return { ok: false, response: jsonError("projectId required", 400) };
  }
  const client = createUserClient(authHeader);
  const { data, error } = await client.from("projects").select("id").eq("id", projectId).maybeSingle();
  if (error || !data) {
    return { ok: false, response: jsonError("Forbidden", 403) };
  }
  return { ok: true };
}

export async function requireCabinetAccess(
  authHeader: string,
  cabinetId: string,
): Promise<{ ok: true } | { ok: false; response: Response }> {
  if (!cabinetId) {
    return { ok: false, response: jsonError("cabinetId required", 400) };
  }
  const client = createUserClient(authHeader);
  const { data, error } = await client.from("ad_cabinets").select("id").eq("id", cabinetId).maybeSingle();
  if (error || !data) {
    return { ok: false, response: jsonError("Forbidden", 403) };
  }
  return { ok: true };
}

export async function requireLeadAccess(
  authHeader: string,
  leadId: string,
): Promise<{ ok: true; projectId: string | null } | { ok: false; response: Response }> {
  if (!leadId) {
    return { ok: false, response: jsonError("lead_id required", 400) };
  }
  const client = createUserClient(authHeader);
  const { data, error } = await client
    .from("leads")
    .select("id, project_id")
    .eq("id", leadId)
    .maybeSingle();
  if (error || !data) {
    return { ok: false, response: jsonError("Forbidden", 403) };
  }
  return { ok: true, projectId: (data as { project_id: string | null }).project_id };
}

function normalizeActId(id: string) {
  const t = id.trim();
  if (!t) return "";
  if (/^act_\d+$/i.test(t)) return `act_${t.replace(/^act_/i, "")}`;
  if (/^\d+$/.test(t)) return `act_${t}`;
  return t;
}

/** User must have RLS access to a cabinet matching this Meta ad account id. */
export async function requireMetaAdAccountAccess(
  authHeader: string,
  rawActId: string,
): Promise<{ ok: true } | { ok: false; response: Response }> {
  const act = normalizeActId(rawActId);
  const bare = act.replace(/^act_/i, "");
  if (!act) {
    return { ok: false, response: jsonError("actId required", 400) };
  }
  const client = createUserClient(authHeader);
  const { data, error } = await client
    .from("ad_cabinets")
    .select("id")
    .or(`external_id.eq.${act},ad_account_id.eq.${act},external_id.eq.${bare},ad_account_id.eq.${bare}`)
    .limit(1)
    .maybeSingle();
  if (error || !data) {
    return { ok: false, response: jsonError("Forbidden", 403) };
  }
  return { ok: true };
}

export async function requireMetaCreativeAdAccess(
  authHeader: string,
  adId: string,
): Promise<{ ok: true } | { ok: false; response: Response }> {
  if (!/^\d+$/.test(adId)) {
    return { ok: false, response: jsonError("ad_id required", 400) };
  }
  const client = createUserClient(authHeader);
  const { data, error } = await client.from("meta_creatives").select("id").eq("ad_id", adId).maybeSingle();
  if (error || !data) {
    return { ok: false, response: jsonError("Forbidden", 403) };
  }
  return { ok: true };
}

const RECORDING_HOST_ALLOW = [
  /\.sipuni\.com$/i,
  /\.sipuni\.ru$/i,
  /\.sipuni\.kz$/i,
  /\.supabase\.co$/i,
  /^storage\.googleapis\.com$/i,
];

function isPrivateOrLocalHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h === "0.0.0.0") return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  const m = /^172\.(\d+)\./.exec(h);
  if (m) {
    const n = Number(m[1]);
    if (n >= 16 && n <= 31) return true;
  }
  return false;
}

/** Blocks SSRF: only https URLs on known telephony/storage hosts. */
export function validateRecordingUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2048) return null;
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  const host = u.hostname;
  if (isPrivateOrLocalHost(host)) return null;
  if (!RECORDING_HOST_ALLOW.some((re) => re.test(host))) return null;
  return u.toString();
}
