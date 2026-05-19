// CAPI outbox worker — обрабатывает очередь capi_outbox и шлёт события в Meta.
//
// Запускается:
//   - cron (recommended): pg_cron job вызывает этот endpoint каждую минуту
//   - вручную: POST с body { batch_size?: number } для разовой обработки
//
// Идемпотентность: event_id детерминированный, Meta дедупит дубли с pixel-событиями.
// Retry: при failure инкрементируется attempts. Когда attempts > 5 — статус 'failed'.
//
// Источники конфигурации (в порядке приоритета):
//   1. ad_cabinets (id = capi_outbox.cabinet_id): access_token, pixel_id
//   2. clients_config (project_id = capi_outbox.project_id): fb_token, fb_pixel_id
//   3. ENV META_ACCESS_TOKEN + ENV META_PIXEL_ID (последний fallback)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const META_API_VERSION = "v21.0";
const MAX_ATTEMPTS = 5;
const DEFAULT_BATCH_SIZE = 50;

interface OutboxRow {
  id: string;
  lead_id: string | null;
  project_id: string | null;
  cabinet_id: string | null;
  event_name: string;
  event_id: string;
  event_time: string;
  meta_ad_id: string | null;
  meta_adset_id: string | null;
  meta_campaign_id: string | null;
  value: number | null;
  currency: string | null;
  raw_user_data: Record<string, unknown>;
  attempts: number;
}

async function sha256Lower(s: string): Promise<string> {
  const data = new TextEncoder().encode(s.toLowerCase().trim());
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function normalizePhone(phone: string | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  // Минимум 8 цифр — отсекаем мусор. Возвращаем без +, как требует Meta.
  return digits.length >= 8 ? digits : null;
}

async function hashUserData(raw: Record<string, unknown>): Promise<Record<string, string | string[]>> {
  const out: Record<string, string | string[]> = {};
  const phone = normalizePhone(raw.phone as string);
  if (phone) out.ph = [await sha256Lower(phone)];
  if (raw.email) out.em = [await sha256Lower(String(raw.email))];
  if (raw.name) {
    const parts = String(raw.name).trim().split(/\s+/);
    if (parts[0]) out.fn = [await sha256Lower(parts[0])];
    if (parts[1]) out.ln = [await sha256Lower(parts[1])];
  }
  // fbc/fbp передаём как есть, без хеширования — Meta так требует.
  if (raw.fbc) out.fbc = String(raw.fbc);
  if (raw.fbp) out.fbp = String(raw.fbp);
  // external_id хешируем для лучшего matching без раскрытия PII.
  if (raw.external_id) out.external_id = [await sha256Lower(String(raw.external_id))];
  return out;
}

interface PixelCreds {
  pixel_id: string;
  access_token: string;
  test_event_code?: string | null;
}

async function resolvePixelCreds(
  admin: ReturnType<typeof createClient>,
  row: OutboxRow,
): Promise<PixelCreds | null> {
  // 1) Через кабинет (приоритетно — у каждого кабинета свой токен/pixel)
  if (row.cabinet_id) {
    const { data } = await admin.from("ad_cabinets")
      .select("access_token, pixel_id, capi_test_event_code")
      .eq("id", row.cabinet_id).maybeSingle();
    const token = (data as { access_token?: string } | null)?.access_token;
    const pixel = (data as { pixel_id?: string } | null)?.pixel_id;
    if (token && pixel) {
      return {
        pixel_id: pixel,
        access_token: token,
        test_event_code: (data as { capi_test_event_code?: string } | null)?.capi_test_event_code ?? null,
      };
    }
  }
  // 2) Через проект (clients_config — legacy)
  if (row.project_id) {
    const { data } = await admin.from("clients_config")
      .select("fb_token, fb_pixel_id")
      .eq("project_id", row.project_id).maybeSingle();
    const token = (data as { fb_token?: string } | null)?.fb_token;
    const pixel = (data as { fb_pixel_id?: string } | null)?.fb_pixel_id;
    if (token && pixel) return { pixel_id: pixel, access_token: token };
  }
  // 3) Global ENV — последний fallback (полезно для тестов / migration)
  const envToken = Deno.env.get("META_ACCESS_TOKEN");
  const envPixel = Deno.env.get("META_DEFAULT_PIXEL_ID");
  if (envToken && envPixel) return { pixel_id: envPixel, access_token: envToken };
  return null;
}

async function sendToMeta(creds: PixelCreds, row: OutboxRow): Promise<{ ok: boolean; response: unknown; error?: string }> {
  const userData = await hashUserData(row.raw_user_data || {});
  const eventTime = Math.floor(new Date(row.event_time).getTime() / 1000);

  // custom_data: для Purchase важно передать value/currency, для Schedule/Diagnostic — content_ids
  // с ad_id, чтобы Meta могла связать с креативом.
  const customData: Record<string, unknown> = {};
  if (row.value != null && row.value > 0) {
    customData.value = Number(row.value);
    customData.currency = row.currency || "KZT";
  }
  if (row.meta_ad_id) customData.content_ids = [row.meta_ad_id];

  const event: Record<string, unknown> = {
    event_name: row.event_name,
    event_time: eventTime,
    event_id: row.event_id,
    action_source: "website",
    user_data: userData,
    custom_data: customData,
  };

  const body: Record<string, unknown> = { data: [event] };
  if (creds.test_event_code) body.test_event_code = creds.test_event_code;

  try {
    const resp = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/${creds.pixel_id}/events?access_token=${encodeURIComponent(creds.access_token)}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    );
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return { ok: false, response: json, error: (json as { error?: { message?: string } })?.error?.message ?? `HTTP ${resp.status}` };
    }
    return { ok: true, response: json };
  } catch (e) {
    return { ok: false, response: null, error: (e as Error).message };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Auth: либо service-role JWT (вызов из pg_cron / других edge functions),
  // либо shared secret в заголовке для ручного запуска извне.
  const cronKey = Deno.env.get("CAPI_WORKER_KEY");
  const provided = req.headers.get("x-cron-key");
  const isAuthorized = (cronKey && provided === cronKey) ||
    req.headers.get("Authorization")?.includes(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "___");

  if (!isAuthorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let batchSize = DEFAULT_BATCH_SIZE;
  try {
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (body.batch_size && typeof body.batch_size === "number") batchSize = Math.min(200, body.batch_size);
    }
  } catch { /* ignore */ }

  // Берём pending, упорядочиваем по created_at чтобы FIFO. Старые события идут первыми.
  const { data: rows, error: selErr } = await admin
    .from("capi_outbox")
    .select("id, lead_id, project_id, cabinet_id, event_name, event_id, event_time, meta_ad_id, meta_adset_id, meta_campaign_id, value, currency, raw_user_data, attempts")
    .eq("status", "pending")
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(batchSize);

  if (selErr) {
    return new Response(JSON.stringify({ error: selErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results: Array<Record<string, unknown>> = [];
  for (const row of (rows ?? []) as OutboxRow[]) {
    const creds = await resolvePixelCreds(admin, row);
    if (!creds) {
      // Нет токена/pixel — помечаем skipped (не failed, потому что не наш баг).
      await admin.from("capi_outbox").update({
        status: "skipped",
        last_error: "No pixel_id/access_token configured for cabinet/project",
        attempts: row.attempts + 1,
      }).eq("id", row.id);
      results.push({ id: row.id, status: "skipped", reason: "no_pixel" });
      continue;
    }

    const result = await sendToMeta(creds, row);
    if (result.ok) {
      await admin.from("capi_outbox").update({
        status: "sent",
        attempts: row.attempts + 1,
        fb_response: result.response,
        sent_at: new Date().toISOString(),
      }).eq("id", row.id);
      // Кросс-обновление leads: ставим capi_lead_sent_at когда Lead/Schedule/Purchase ушли,
      // чтобы UI мог показывать "CAPI отправлен" в карточке лида.
      if (row.lead_id) {
        await admin.from("leads")
          .update({ capi_lead_sent_at: new Date().toISOString() })
          .eq("id", row.lead_id)
          .is("capi_lead_sent_at", null);
      }
      results.push({ id: row.id, status: "sent", event: row.event_name });
    } else {
      const nextAttempts = row.attempts + 1;
      const finalStatus = nextAttempts >= MAX_ATTEMPTS ? "failed" : "pending";
      await admin.from("capi_outbox").update({
        status: finalStatus,
        attempts: nextAttempts,
        last_error: result.error,
        fb_response: result.response,
      }).eq("id", row.id);
      results.push({ id: row.id, status: finalStatus, error: result.error, attempts: nextAttempts });
    }
  }

  const ok = results.filter((r) => r.status === "sent").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const pending = results.filter((r) => r.status === "pending").length;
  console.log(`[capi-outbox-worker] processed=${results.length} ok=${ok} failed=${failed} retry=${pending}`);

  return new Response(JSON.stringify({ processed: results.length, sent: ok, failed, retry: pending, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
