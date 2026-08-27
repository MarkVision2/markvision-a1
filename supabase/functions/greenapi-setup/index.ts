// Автоматическая настройка webhook в GreenAPI.
// Вызывает /setSettings с нашим webhook URL и включает incoming/outgoing/state webhooks.
// WARNING: do not use on a Green API instance shared with an n8n bot watcher —
// reclaiming webhookUrl away from the bot causes setSettings thrash and kills greetings.
// Prefer bot-owned webhook; CRM copies via n8n forward.
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
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** Секрет вебхука: Green API вернёт его нам, и greenapi-webhook сверит. */
function newWebhookToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

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

  // Без токена эндпоинт greenapi-webhook принимал любой POST: кто угодно мог
  // залить в CRM фейковые входящие сообщения и лиды. Выдаём инстансу секрет,
  // кладём его в whatsapp_config.webhook_token и дублируем в query вебхука —
  // так проверка не зависит от того, шлёт ли Green API заголовок Authorization.
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: cfgRows } = await admin
    .from("whatsapp_config")
    .select("id, webhook_token")
    .eq("id_instance", String(body.idInstance));
  const configured = (cfgRows ?? []) as Array<{ id: string; webhook_token: string | null }>;

  const token = newWebhookToken();
  const hookUrl = new URL(body.webhookUrl);
  hookUrl.searchParams.set("token", token);
  const webhookUrl = hookUrl.toString();

  // Сначала БД, потом Green API: если setSettings упадёт, откатим токен и
  // инстанс останется на прежней (рабочей) конфигурации.
  if (configured.length) {
    const { error: tokErr } = await admin
      .from("whatsapp_config")
      // В webhook_url кладём чистый адрес: колонка читается с клиента, а
      // webhook_token — нет (REVOKE SELECT). Токен не должен утечь через URL.
      .update({ webhook_token: token, webhook_url: body.webhookUrl })
      .eq("id_instance", String(body.idInstance));
    if (tokErr) return json({ ok: false, error: `Не удалось сохранить токен вебхука: ${tokErr.message}` }, 200);
  }

  const rollbackToken = async () => {
    for (const row of configured) {
      await admin
        .from("whatsapp_config")
        .update({ webhook_token: row.webhook_token })
        .eq("id", row.id);
    }
  };

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        webhookUrl,
        webhookUrlToken: token,
        outgoingWebhook: "yes",
        outgoingAPIMessageWebhook: "yes",
        outgoingMessageWebhook: "yes",
        incomingWebhook: "yes",
        incomingCallWebhook: "yes",
        stateWebhook: "yes",
        deviceWebhook: "no",
        statusInstanceWebhook: "no",
      }),
    });
    const txt = await resp.text();
    let parsed: unknown = txt;
    try { parsed = JSON.parse(txt); } catch { /* keep raw */ }

    if (!resp.ok) {
      await rollbackToken();
      return json({ ok: false, status: resp.status, response: parsed }, 200);
    }
    return json({ ok: true, response: parsed, webhookUrl: body.webhookUrl });
  } catch (e) {
    await rollbackToken();
    return json({ ok: false, error: (e as Error).message }, 200);
  }
});
