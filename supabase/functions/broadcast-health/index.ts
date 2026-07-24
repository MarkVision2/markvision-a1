// Broadcast health — «ban-aware» статус рассылок по проекту.
//
// Тянет у Green API реальное состояние аккаунта (getStateInstance — в т.ч.
// yellowCard/blocked), номер (getWaSettings), складывает с нашей статистикой
// (отправлено сегодня, прогрев, доля ошибок) и выдаёт уровень риска блокировки
// + сколько ещё можно безопасно отправить сегодня + рекомендации.
//
// Auth: авторизованный участник проекта (владелец или админ).
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import {
  DEFAULT_GREEN_API_BASE_URL,
  validateGreenApiBaseUrl,
} from "../_lib/green_api_url.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const WARMUP_DAY1 = 20;
const WARMUP_GROWTH = 1.3;
const DEFAULT_DAILY_CAP = 120;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getUserId(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization") ?? "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt || !ANON_KEY) return null;
  try {
    const c = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data } = await c.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

async function callGreen(baseUrl: string, idInstance: string, path: string, apiToken: string) {
  const url = `${baseUrl}/waInstance${idInstance}/${path}/${apiToken}`;
  const res = await fetch(url, { method: "GET" });
  const text = await res.text();
  let data: unknown = text;
  try { data = JSON.parse(text); } catch { /* keep raw */ }
  return { ok: res.ok, status: res.status, data };
}

function warmupCap(startedOn: string | null): { day: number; cap: number } {
  if (!startedOn) return { day: 1, cap: WARMUP_DAY1 };
  const days = Math.max(
    0,
    Math.floor((Date.now() - new Date(startedOn + "T00:00:00Z").getTime()) / 86400000),
  );
  const cap = Math.min(DEFAULT_DAILY_CAP, Math.max(WARMUP_DAY1, Math.round(WARMUP_DAY1 * Math.pow(WARMUP_GROWTH, days))));
  return { day: days + 1, cap };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const userId = await getUserId(req);
  if (!userId) return json({ error: "Unauthorized" }, 401);

  const body = (await req.json().catch(() => ({}))) as { project_id?: string };
  const projectId = typeof body.project_id === "string" ? body.project_id : null;
  if (!projectId) return json({ error: "project_id required" }, 400);

  // Доступ: владелец проекта или админ.
  const { data: proj } = await admin
    .from("projects").select("id, created_by").eq("id", projectId).maybeSingle();
  const { data: isAdmin } = await admin.rpc("has_role" as never, { _user_id: userId, _role: "admin" });
  const allowed = !!proj && ((proj as { created_by?: string }).created_by === userId || isAdmin === true);
  if (!allowed) return json({ error: "Forbidden" }, 403);

  // Креды Green API проекта.
  const { data: cfg } = await admin
    .from("whatsapp_config")
    .select("id_instance, api_token, api_url")
    .eq("project_id", projectId)
    .maybeSingle();
  const wc = cfg as { id_instance?: string; api_token?: string; api_url?: string } | null;

  // Наша статистика (не зависит от Green).
  const today = new Date().toISOString().slice(0, 10);
  const [dailyRes, stateRes, failRes] = await Promise.all([
    admin.from("broadcast_sender_daily").select("sent").eq("project_id", projectId).eq("day", today).maybeSingle(),
    admin.from("broadcast_sender_state").select("warmup_started_on, paused, pause_reason").eq("project_id", projectId).maybeSingle(),
    admin.from("broadcast_recipients").select("status")
      .eq("project_id", projectId)
      .gte("sent_at", new Date(Date.now() - 24 * 3600_000).toISOString())
      .limit(1000),
  ]);
  const sentToday = ((dailyRes.data as { sent?: number } | null)?.sent) ?? 0;
  const st = (stateRes.data ?? {}) as { warmup_started_on?: string | null; paused?: boolean; pause_reason?: string | null };
  const { day: warmupDay, cap: dailyCap } = warmupCap(st.warmup_started_on ?? null);

  const failRows = (failRes.data ?? []) as { status: string }[];
  const failed = failRows.filter((r) => r.status === "failed").length;
  const failRatePct = failRows.length ? Math.round((failed / failRows.length) * 100) : 0;

  // Состояние аккаунта у Green API.
  let accountState = "unknown";
  let phone: string | null = null;
  let credsOk = false;
  if (wc?.id_instance && wc.api_token) {
    let baseUrl = DEFAULT_GREEN_API_BASE_URL;
    try { baseUrl = validateGreenApiBaseUrl(wc.api_url ?? ""); } catch { /* default */ }
    credsOk = true;
    const state = await callGreen(baseUrl, wc.id_instance, "getStateInstance", wc.api_token).catch(() => null);
    accountState = (state?.data as { stateInstance?: string } | null)?.stateInstance ?? "unknown";
    if (accountState === "authorized") {
      const wa = await callGreen(baseUrl, wc.id_instance, "getWaSettings", wc.api_token).catch(() => null);
      const wid = (wa?.data as { wid?: string; phone?: string } | null)?.wid
        ?? (wa?.data as { phone?: string } | null)?.phone ?? null;
      const d = String(wid ?? "").replace(/\D/g, "");
      if (d.length >= 8) phone = `+${d}`;
    }
  }

  // Оценка риска блокировки.
  let riskLevel: "ok" | "warning" | "danger" = "ok";
  let riskReason = "Аккаунт в норме, можно отправлять в безопасном темпе.";
  const recommendations: string[] = [];

  if (!credsOk) {
    riskLevel = "danger";
    riskReason = "WhatsApp не подключён к проекту.";
    recommendations.push("Подключите номер в «Настройки → Подключение WhatsApp».");
  } else if (accountState === "blocked") {
    riskLevel = "danger";
    riskReason = "Аккаунт заблокирован WhatsApp. Рассылки невозможны.";
    recommendations.push("Восстановите/смените номер. Не шлите рассылки с заблокированного номера.");
  } else if (accountState === "yellowCard") {
    riskLevel = "danger";
    riskReason = "WhatsApp выдал предупреждение (жёлтая карточка) — номер под риском бана.";
    recommendations.push("Остановите рассылки на 1–2 дня, общайтесь только вручную.");
    recommendations.push("Затем возобновляйте с минимального темпа и малых объёмов.");
  } else if (["notAuthorized", "starting", "sleepMode"].includes(accountState)) {
    riskLevel = "warning";
    riskReason = "Номер не в сети / не авторизован — отправка сейчас не пойдёт.";
    recommendations.push("Откройте WhatsApp на телефоне и убедитесь, что интернет есть.");
  } else if (accountState === "authorized") {
    if (st.paused) {
      riskLevel = "warning";
      riskReason = `Отправка на паузе: ${st.pause_reason || "сработала защита"}.`;
      recommendations.push("Снимите паузу в панели, когда убедитесь, что всё в порядке.");
    } else if (failRatePct >= 30) {
      riskLevel = "warning";
      riskReason = `Высокая доля ошибок (${failRatePct}%) — много номеров не в WhatsApp или проблемы с доставкой.`;
      recommendations.push("Почистите базу от нерабочих номеров — частые ошибки повышают риск бана.");
    } else if (sentToday >= dailyCap) {
      riskLevel = "warning";
      riskReason = "Дневной безопасный лимит достигнут.";
      recommendations.push("Продолжите завтра — за ночь лимит вырастет по прогреву.");
    }
  } else {
    riskLevel = "warning";
    riskReason = `Состояние аккаунта: ${accountState}.`;
  }

  // Базовые рекомендации по антиспаму (всегда полезны).
  if (riskLevel === "ok") {
    recommendations.push("Включайте ИИ-варианты текста — одинаковые сообщения WhatsApp считает спамом.");
    if (warmupDay <= 5) recommendations.push(`Идёт прогрев номера (день ${warmupDay}). Не поднимайте объёмы резко.`);
  }

  const remainingToday = Math.max(0, dailyCap - sentToday);

  return json({
    connected: accountState === "authorized",
    accountState,
    phone,
    riskLevel,
    riskReason,
    warmupDay,
    dailyCap,
    sentToday,
    remainingToday,
    failRatePct,
    recommendations,
    checkedAt: new Date().toISOString(),
  });
});
