// meta-token-health — ежедневная проверка токенов Meta.
//
// Зачем: протухший токен даёт Graph code 190, и без этой проверки он ловится
// только по факту упавшего запуска — обычно молча и в самый неподходящий момент.
// Крон раз в сутки прогоняет debug_token по всем кабинетам, пишет срок жизни
// в ad_cabinets и предупреждает в Telegram за WARN_DAYS до истечения.
//
// Auth: x-automation-key == automation_settings.cron_secret.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { graphGet } from "../_lib/metaGraph.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-automation-key, x-cron-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** За сколько дней до истечения начинаем предупреждать. */
const WARN_DAYS = 7;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export interface TokenHealth {
  valid: boolean;
  /** null — токен бессрочный (system user token). */
  expiresAt: string | null;
  daysLeft: number | null;
  scopes: string[];
  reason: string | null;
}

/** Разбор ответа /debug_token в понятный статус. */
export function readDebugToken(
  data: Record<string, unknown> | null,
  now = Date.now(),
): TokenHealth {
  const d = (data?.data ?? {}) as Record<string, unknown>;
  const valid = d.is_valid === true;
  const expiresRaw = Number(d.expires_at ?? 0);
  // Meta отдаёт 0 для бессрочных токенов (system user).
  const expiresAt = expiresRaw > 0 ? new Date(expiresRaw * 1000).toISOString() : null;
  const daysLeft = expiresRaw > 0
    ? Math.floor((expiresRaw * 1000 - now) / 86_400_000)
    : null;
  return {
    valid,
    expiresAt,
    daysLeft,
    scopes: Array.isArray(d.scopes) ? (d.scopes as string[]) : [],
    reason: valid
      ? null
      : String((d.error as { message?: string } | undefined)?.message ?? "Токен недействителен"),
  };
}

/** Нужно ли беспокоить человека. */
export function needsAlert(health: TokenHealth): boolean {
  if (!health.valid) return true;
  return health.daysLeft !== null && health.daysLeft <= WARN_DAYS;
}

async function notifyTelegram(chatId: string | null, text: string) {
  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!botToken || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    console.error("[meta-token-health] telegram:", (e as Error).message);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: settings } = await admin
    .from("automation_settings")
    .select("cron_secret")
    .eq("id", true)
    .maybeSingle();
  const expected = (settings as { cron_secret?: string } | null)?.cron_secret
    ?? Deno.env.get("AUTOMATION_CRON_KEY");
  const provided = req.headers.get("x-automation-key") ?? req.headers.get("x-cron-key");
  const isServiceRole = req.headers.get("Authorization")?.includes(
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "___",
  );
  if (!isServiceRole && (!expected || provided !== expected)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const { data: cabinets, error } = await admin
    .from("ad_cabinets")
    .select("id, name, access_token, telegram_group_id, provider")
    .not("access_token", "is", null);
  if (error) return json({ error: error.message }, 500);

  const results: unknown[] = [];
  for (const raw of (cabinets ?? []) as Array<Record<string, unknown>>) {
    const token = String(raw.access_token ?? "").trim();
    if (!token) continue;
    if (raw.provider && raw.provider !== "meta") continue;

    // Проверяем токен им же самим — так не нужен отдельный app token.
    const res = await graphGet<Record<string, unknown>>("debug_token", token, {
      input_token: token,
    });
    const health = res.ok
      ? readDebugToken(res.data)
      : {
        valid: false,
        expiresAt: null,
        daysLeft: null,
        scopes: [],
        reason: res.error?.message ?? "Graph не ответил",
      } as TokenHealth;

    await admin.from("ad_cabinets").update({
      token_checked_at: new Date().toISOString(),
      token_expires_at: health.expiresAt,
      token_valid: health.valid,
    }).eq("id", raw.id as string);

    if (needsAlert(health)) {
      const name = String(raw.name ?? raw.id);
      const text = health.valid
        ? `⚠️ Токен Meta кабинета «${name}» истекает через ${health.daysLeft} дн.\n` +
          `Продлите доступ в разделе «Реклама → Кабинеты», иначе запуски начнут падать.`
        : `🔴 Токен Meta кабинета «${name}» недействителен: ${health.reason}\n` +
          `Запуск рекламы и синхронизация статистики по этому кабинету не работают.`;
      await notifyTelegram((raw.telegram_group_id as string | null) ?? null, text);
    }

    results.push({ cabinet: raw.id, name: raw.name, ...health });
  }

  const bad = results.filter((r) => !(r as TokenHealth).valid).length;
  const expiring = results.filter((r) => {
    const h = r as TokenHealth;
    return h.valid && h.daysLeft !== null && h.daysLeft <= WARN_DAYS;
  }).length;

  return json({ ok: true, checked: results.length, invalid: bad, expiring, results });
});
