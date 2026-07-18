import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { AUTH_CORS_HEADERS, requireProjectAccess, requireUser } from "../_lib/auth.ts";
import {
  encryptProviderKey,
  testProviderKey,
  type ReelsProvider,
} from "../_lib/reelsCredentials.ts";

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...AUTH_CORS_HEADERS, "Content-Type": "application/json" },
  });

const isProvider = (value: string): value is ReelsProvider =>
  value === "pexels" || value === "kie";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: AUTH_CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Некорректный JSON" }, 400);
  }

  const projectId = String(body.project_id ?? "").trim();
  const action = String(body.action ?? "status");
  if (!projectId) return json({ error: "project_id required" }, 400);
  const access = await requireProjectAccess(auth.authHeader, projectId);
  if (!access.ok) return access.response;

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  if (action === "status") {
    const { data, error } = await admin
      .from("reels_provider_credentials")
      .select("provider,key_hint,enabled,updated_at")
      .eq("project_id", projectId);
    if (error) return json({ error: error.message }, 500);
    return json({
      providers: Object.fromEntries(
        (data ?? []).map((row) => [
          row.provider,
          {
            connected: true,
            key_hint: row.key_hint,
            enabled: row.enabled,
            updated_at: row.updated_at,
          },
        ]),
      ),
    });
  }

  const providerRaw = String(body.provider ?? "");
  if (!isProvider(providerRaw)) return json({ error: "provider must be pexels or kie" }, 400);

  if (action === "save") {
    const apiKey = String(body.api_key ?? "").trim();
    if (apiKey.length < 10 || apiKey.length > 500) return json({ error: "Некорректный API-ключ" }, 400);
    try {
      await testProviderKey(providerRaw, apiKey);
      const encryptedKey = await encryptProviderKey(apiKey);
      const { error } = await admin.from("reels_provider_credentials").upsert({
        project_id: projectId,
        provider: providerRaw,
        encrypted_key: encryptedKey,
        key_hint: `••••${apiKey.slice(-4)}`,
        enabled: true,
        updated_at: new Date().toISOString(),
        updated_by: auth.userId,
      }, { onConflict: "project_id,provider" });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, key_hint: `••••${apiKey.slice(-4)}` });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Ключ не прошёл проверку" }, 400);
    }
  }

  if (action === "remove") {
    const { error } = await admin
      .from("reels_provider_credentials")
      .delete()
      .eq("project_id", projectId)
      .eq("provider", providerRaw);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  return json({ error: "Unknown action" }, 400);
});
