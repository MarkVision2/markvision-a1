// Shared auth helpers for edge functions.
// Verifies the caller's JWT using the Supabase anon client and returns
// claims (sub, email, role). Optionally checks for a specific app role
// via the user_roles table using the service role.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

export type AuthClaims = {
  sub: string;
  email?: string;
  role?: string;
  [k: string]: unknown;
};

export async function requireUser(req: Request): Promise<
  { ok: true; userId: string; token: string; claims: AuthClaims }
  | { ok: false; response: Response }
> {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-automation-key",
  };
  const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }),
    };
  }
  const token = authHeader.replace("Bearer ", "").trim();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  try {
    const { data, error } = await supabase.auth.getClaims(token);
    if (error || !data?.claims?.sub) {
      return {
        ok: false,
        response: new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }),
      };
    }
    return { ok: true, userId: data.claims.sub as string, token, claims: data.claims as AuthClaims };
  } catch {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }),
    };
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
