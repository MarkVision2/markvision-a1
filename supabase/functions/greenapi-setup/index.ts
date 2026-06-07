// Автоматическая настройка webhook в GreenAPI.
// Вызывает /setSettings с нашим webhook URL и включает incoming/outgoing/state webhooks.
//
// POST body: { idInstance: string, apiToken: string, apiUrl?: string, webhookUrl: string }
// Auth: Bearer JWT обычного пользователя (через verify_jwt в config.toml не включаем —
//       внутри сами валидируем через getClaims).
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { validateGreenApiBaseUrl } from "../_lib/green_api_url.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const BodySchema = z.object({
  idInstance: z.string().trim().min(1),
  apiToken: z.string().trim().min(1),
  apiUrl: z.string().trim().url().optional(),
  webhookUrl: z.string().trim().url(),
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) return json({ error: "Unauthorized" }, 401);

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (e) {
    return json({ error: "Invalid body", details: (e as Error).message }, 400);
  }

  let baseUrl: string;
  try {
    baseUrl = validateGreenApiBaseUrl(body.apiUrl);
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
  const url = `${baseUrl}/waInstance${body.idInstance}/setSettings/${body.apiToken}`;

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        webhookUrl: body.webhookUrl,
        webhookUrlToken: "",
        outgoingWebhook: "yes",
        outgoingAPIMessageWebhook: "yes",
        outgoingMessageWebhook: "yes",
        incomingWebhook: "yes",
        stateWebhook: "yes",
        deviceWebhook: "no",
        statusInstanceWebhook: "no",
      }),
    });
    const txt = await resp.text();
    let parsed: unknown = txt;
    try { parsed = JSON.parse(txt); } catch { /* keep raw */ }

    if (!resp.ok) {
      return json({ ok: false, status: resp.status, response: parsed }, 200);
    }
    return json({ ok: true, response: parsed, webhookUrl: body.webhookUrl });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 200);
  }
});
