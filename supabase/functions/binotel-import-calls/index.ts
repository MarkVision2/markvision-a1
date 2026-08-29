// binotel-import-calls
// Разовый импорт истории звонков из Binotel в CRM: после подключения раздел
// «Звонки» и ленты лидов не пустые, а сразу с историей.
//
// Вход: { days?: number }  (1..31, по умолчанию 7)
// Auth: JWT администратора.
//
// Записи разговоров не тянем: ссылка на каждую живёт 15 минут и запрашивается
// отдельным вызовом — сотни файлов не влезут в бюджет функции. Записи копятся
// с текущего момента через binotel-webhook.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  binotelRequest,
  callContent,
  callDirection,
  callStartedAt,
  isAnswered,
  phoneTail,
  toInt,
} from "../_lib/binotel.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const MAX_DAYS = 31;
// «Нагружаемый» метод: 5 запросов в минуту без ограничений, дальше пауза.
const PAUSE_AFTER = 5;
const PAUSE_MS = 5_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ ok: false, error: "unauthorized" }, 401);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: claims, error: claimErr } = await userClient.auth.getClaims(
    authHeader.replace("Bearer ", ""),
  );
  if (claimErr || !claims?.claims?.sub) return json({ ok: false, error: "unauthorized" }, 401);
  const userId = claims.claims.sub as string;

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: roleRow } = await admin
    .from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
  if (!roleRow) return json({ ok: false, error: "admin_only" }, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { body = {}; }
  const days = Math.min(Math.max(toInt(body?.days) ?? 7, 1), MAX_DAYS);

  const { data: settings } = await admin
    .from("automation_settings")
    .select("binotel_enabled, binotel_key, binotel_secret")
    .eq("id", true).single();
  if (!settings?.binotel_enabled) return json({ ok: false, error: "binotel_disabled" }, 400);
  if (!settings.binotel_key || !settings.binotel_secret) {
    return json({ ok: false, error: "binotel_not_configured" }, 400);
  }
  const creds = { key: settings.binotel_key as string, secret: settings.binotel_secret as string };

  let fetched = 0;
  let imported = 0;
  let skippedNoLead = 0;
  let skippedDuplicate = 0;
  const errors: string[] = [];

  for (let i = 0; i < days; i++) {
    if (i > 0 && i % PAUSE_AFTER === 0) await sleep(PAUSE_MS);

    const day = new Date();
    day.setUTCHours(0, 0, 0, 0);
    day.setUTCDate(day.getUTCDate() - i);
    const dayInTimestamp = Math.floor(day.getTime() / 1000);

    const r = await binotelRequest("stats/list-of-calls-per-day", { dayInTimestamp }, creds);
    if (!r.ok) {
      errors.push(`${day.toISOString().slice(0, 10)}: ${r.error}`);
      continue;
    }

    const calls = Object.values((r.data.callDetails ?? {}) as Record<string, Record<string, unknown>>);
    fetched += calls.length;

    for (const call of calls) {
      const generalCallID = call.generalCallID != null ? String(call.generalCallID) : null;
      if (!generalCallID) continue;

      const externalNumber = String(call.externalNumber ?? "");
      if (phoneTail(externalNumber).length < 9) continue;

      // Дубль: звонок уже импортирован или пришёл через webhook.
      const { data: seen } = await admin
        .from("communications").select("id")
        .eq("type", "call").eq("external_id", generalCallID)
        .limit(1).maybeSingle();
      if (seen) { skippedDuplicate++; continue; }

      const { data: leadRows } = await admin
        .rpc("find_lead_by_phone_digits", { p_phone: externalNumber });
      const lead = (Array.isArray(leadRows) ? leadRows[0] : leadRows) as
        { id: string; assigned_to: string | null } | null;
      if (!lead) { skippedNoLead++; continue; }

      const disposition = String(call.disposition ?? "");
      const billsec = toInt(call.billsec);
      const answered = isAnswered(disposition);

      const { error } = await admin.from("communications").insert({
        lead_id: lead.id,
        type: "call",
        channel: "phone",
        direction: callDirection(call.callType),
        content: callContent({ answered, disposition, durationSec: billsec, recordingArchived: false }) || null,
        status: answered ? "answered" : "missed",
        duration_sec: billsec,
        external_id: generalCallID,
        created_at: callStartedAt(call.startTime),
        is_draft: false,
        is_auto: true,
        created_by: lead.assigned_to ?? null,
      });
      if (error) {
        if (errors.length < 10) errors.push(`${generalCallID}: ${error.message}`);
      } else {
        imported++;
      }
    }
  }

  return json({
    ok: true,
    days,
    fetched,
    imported,
    skipped_no_lead: skippedNoLead,
    skipped_duplicate: skippedDuplicate,
    errors: errors.slice(0, 10),
  });
});
