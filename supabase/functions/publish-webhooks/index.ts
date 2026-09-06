/**
 * Доставка исходящих вебхуков (docs/JOBS.md, раздел «Вебхуки»).
 *
 * События ставят триггеры БД (publish_emit_event → publish_webhook_deliveries);
 * этот воркер по крону ежеминутно (x-automation-key) забирает due-доставки
 * (claim_webhook_deliveries, аренда 5 минут), подписывает тело HMAC-SHA256
 * секретом вебхука и POST'ит с таймаутом 10 с. 2xx — delivered; 5xx/сеть/429 —
 * retry по лестнице 1 → 5 → 15 → 60 → 180 минут, после 5 попыток — failed;
 * прочие 4xx — failed сразу (адрес не примет то же тело второй раз).
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { requireUser, userHasAnyRole } from "../_lib/auth.ts";
import { automationKeyValid, CORS_HEADERS, decryptSecret, json } from "../_lib/publishing.ts";
import { classifyDeliveryStatus, signWebhook, WEBHOOK_MAX_ATTEMPTS, webhookRetryDelayMinutes } from "../_lib/webhooks.ts";

const WALL_CLOCK_BUDGET_MS = 45_000;
const DELIVERY_TIMEOUT_MS = 10_000;

interface Delivery {
  id: number;
  webhook_id: string;
  project_id: string;
  event: string;
  payload: Record<string, unknown>;
  attempts: number;
}

interface Hook {
  id: string;
  url: string;
  secret_encrypted: string;
  enabled: boolean;
}

async function deliver(admin: SupabaseClient, d: Delivery, hooks: Map<string, Hook>): Promise<"delivered" | "retry" | "failed"> {
  const hook = hooks.get(d.webhook_id);
  if (!hook || !hook.enabled) {
    await admin.from("publish_webhook_deliveries").update({ status: "failed", locked_at: null, last_error: "вебхук выключен или удалён" }).eq("id", d.id);
    return "failed";
  }
  let secret: string | null = null;
  try { secret = await decryptSecret(hook.secret_encrypted); } catch { secret = null; }
  if (!secret) {
    await admin.from("publish_webhook_deliveries").update({ status: "failed", locked_at: null, last_error: "секрет вебхука не читается (PUBLISH_TOKEN_KEY)" }).eq("id", d.id);
    return "failed";
  }
  const body = JSON.stringify({ ...d.payload, delivery_id: d.id, attempt: d.attempts });
  const ts = Math.floor(Date.now() / 1000);
  const signature = await signWebhook(secret, body, ts);

  let status = 0;
  let error: string | null = null;
  try {
    const res = await fetch(hook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "MarkVision-Webhooks/1.0",
        "X-MarkVision-Event": d.event,
        "X-MarkVision-Delivery": String(d.id),
        "X-MarkVision-Timestamp": String(ts),
        "X-MarkVision-Signature": signature,
      },
      body,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    status = res.status;
    if (!res.ok) error = `HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  let outcome = classifyDeliveryStatus(status);
  if (outcome === "retry" && d.attempts >= WEBHOOK_MAX_ATTEMPTS) outcome = "failed";
  const now = new Date().toISOString();
  await admin.from("publish_webhook_deliveries").update({
    status: outcome,
    locked_at: null,
    response_status: status || null,
    last_error: error?.slice(0, 500) ?? null,
    ...(outcome === "delivered" ? { delivered_at: now } : {}),
    ...(outcome === "retry" ? { next_attempt_at: new Date(Date.now() + webhookRetryDelayMinutes(d.attempts) * 60_000).toISOString() } : {}),
  }).eq("id", d.id);
  await admin.from("publish_webhooks").update({ last_delivery_at: now, last_status: status || null }).eq("id", hook.id);
  return outcome;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  if (!(await automationKeyValid(req, admin))) {
    const auth = await requireUser(req);
    if (!auth.ok) return json({ error: "unauthorized" }, 401);
    if (!(await userHasAnyRole(auth.userId, ["admin", "manager"]))) return json({ error: "forbidden" }, 403);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const batch = Math.min(Math.max(Number(body?.batch_size ?? 20), 1), 100);
    const { data, error } = await admin.rpc("claim_webhook_deliveries", { p_batch: batch, p_lock_timeout: "5 minutes" });
    if (error) return json({ error: error.message }, 500);
    const deliveries = (data ?? []) as Delivery[];
    const out = { claimed: deliveries.length, delivered: 0, retry: 0, failed: 0, skipped: 0 };
    if (!deliveries.length) return json({ ok: true, ...out });

    const { data: hookRows } = await admin.from("publish_webhooks")
      .select("id, url, secret_encrypted, enabled").in("id", [...new Set(deliveries.map((d) => d.webhook_id))]);
    const hooks = new Map(((hookRows ?? []) as Hook[]).map((h) => [h.id, h]));

    const deadline = Date.now() + WALL_CLOCK_BUDGET_MS;
    for (const d of deliveries) {
      if (Date.now() > deadline) {
        await admin.from("publish_webhook_deliveries").update({ locked_at: null, attempts: Math.max(d.attempts - 1, 0) }).eq("id", d.id);
        out.skipped++;
        continue;
      }
      const r = await deliver(admin, d, hooks);
      out[r]++;
    }
    return json({ ok: true, ...out });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
