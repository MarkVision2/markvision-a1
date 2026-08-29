// binotel-import-calls
// Подтягивает звонки из Binotel в CRM. Два режима:
//
//  • вручную — админ из карточки настроек: { projectId, days } под своим JWT;
//  • по расписанию — pg_cron с заголовком x-automation-key = cron_secret,
//    тогда обходятся все проекты с включённым подключением.
//
// Расписание закрывает работу webhook-ов, пока их не настроила поддержка Binotel:
// звонки попадают в ленты лидов сами, с задержкой в интервал крона.
//
// Записи разговоров тут не тянем: ссылка на каждую живёт 15 минут и запрашивается
// отдельным вызовом — сотни файлов не влезут в бюджет функции. Записи копятся
// с момента, когда заработают webhook-и.

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
import { credentialsOf, isMissingSchema, type ProjectBinotel } from "../_lib/binotelProject.ts";
import { requireProjectAccess, requireUser } from "../_lib/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-automation-key",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAX_DAYS = 31;
// «Нагружаемый» метод: 5 запросов в минуту без ограничений, дальше пауза.
const PAUSE_AFTER = 5;
const PAUSE_MS = 5_000;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Summary = {
  project_id: string;
  fetched: number;
  imported: number;
  skipped_no_lead: number;
  skipped_duplicate: number;
  errors: string[];
};

async function importProject(project: ProjectBinotel, days: number): Promise<Summary> {
  const out: Summary = {
    project_id: project.project_id,
    fetched: 0, imported: 0, skipped_no_lead: 0, skipped_duplicate: 0, errors: [],
  };
  const creds = credentialsOf(project);
  if (!creds) {
    out.errors.push("ключи не заданы");
    return out;
  }

  for (let i = 0; i < days; i++) {
    if (i > 0 && i % PAUSE_AFTER === 0) await sleep(PAUSE_MS);

    const day = new Date();
    day.setUTCHours(0, 0, 0, 0);
    day.setUTCDate(day.getUTCDate() - i);
    const dayInTimestamp = Math.floor(day.getTime() / 1000);

    const r = await binotelRequest("stats/list-of-calls-per-day", { dayInTimestamp }, creds);
    if (!r.ok) {
      out.errors.push(`${day.toISOString().slice(0, 10)}: ${r.error}`);
      continue;
    }

    const calls = Object.values(
      (r.data.callDetails ?? {}) as Record<string, Record<string, unknown>>,
    );
    out.fetched += calls.length;

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
      if (seen) { out.skipped_duplicate++; continue; }

      const { data: leadRows } = await admin.rpc("find_lead_by_phone_digits", {
        p_phone: externalNumber,
        p_project_id: project.project_id,
      });
      const lead = (Array.isArray(leadRows) ? leadRows[0] : leadRows) as
        { id: string; assigned_to: string | null } | null;
      if (!lead) { out.skipped_no_lead++; continue; }

      const disposition = String(call.disposition ?? "");
      const billsec = toInt(call.billsec);
      const answered = isAnswered(disposition);

      const { error } = await admin.from("communications").insert({
        lead_id: lead.id,
        type: "call",
        channel: "phone",
        direction: callDirection(call.callType),
        content: callContent({
          answered, disposition, durationSec: billsec, recordingArchived: false,
        }) || null,
        status: answered ? "answered" : "missed",
        duration_sec: billsec,
        external_id: generalCallID,
        created_at: callStartedAt(call.startTime),
        is_draft: false,
        is_auto: true,
        created_by: lead.assigned_to ?? null,
      });
      if (error) {
        if (out.errors.length < 10) out.errors.push(`${generalCallID}: ${error.message}`);
      } else {
        out.imported++;
      }
    }
  }
  return out;
}

async function handle(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { body = {}; }
  const days = Math.min(Math.max(toInt(body?.days) ?? 7, 1), MAX_DAYS);

  // Крон приходит без пользовательского JWT — авторизация по общему секрету.
  const automationKey = req.headers.get("x-automation-key") ?? "";
  let isCron = false;
  if (automationKey) {
    const { data: cfg } = await admin
      .from("automation_settings").select("cron_secret").eq("id", true).single();
    const secret = (cfg?.cron_secret as string | null) ?? "";
    if (!secret || automationKey !== secret) return json({ ok: false, error: "forbidden" }, 403);
    isCron = true;
  }

  let projects: ProjectBinotel[] = [];

  if (isCron) {
    const { data, error } = await admin
      .from("project_binotel_settings").select("*").eq("enabled", true);
    if (error) {
      return json({
        ok: false,
        error: isMissingSchema(error.message) ? "migration_missing" : "settings_unavailable",
        detail: error.message,
      }, 500);
    }
    projects = (data ?? []) as ProjectBinotel[];
  } else {
    const auth = await requireUser(req);
    if (!auth.ok) return auth.response;

    const { data: roleRow } = await admin
      .from("user_roles").select("role").eq("user_id", auth.userId)
      .eq("role", "admin").maybeSingle();
    if (!roleRow) return json({ ok: false, error: "admin_only" }, 403);

    const projectId = typeof body?.projectId === "string" ? body.projectId : "";
    if (!projectId) return json({ ok: false, error: "project_required" }, 400);

    const access = await requireProjectAccess(auth.authHeader, projectId);
    if (!access.ok) return access.response;

    const { data, error } = await admin
      .from("project_binotel_settings").select("*").eq("project_id", projectId).maybeSingle();
    if (error) {
      return json({
        ok: false,
        error: isMissingSchema(error.message) ? "migration_missing" : "settings_unavailable",
        detail: error.message,
      }, 500);
    }
    const row = data as ProjectBinotel | null;
    if (!row || !row.enabled) {
      return json({ ok: false, error: "binotel_disabled", detail: "В этом проекте Binotel не подключён" }, 400);
    }
    projects = [row];
  }

  const results: Summary[] = [];
  for (const project of projects) {
    results.push(await importProject(project, isCron ? Math.min(days, 2) : days));
  }

  const total = results.reduce(
    (acc, r) => ({
      fetched: acc.fetched + r.fetched,
      imported: acc.imported + r.imported,
      skipped_no_lead: acc.skipped_no_lead + r.skipped_no_lead,
      skipped_duplicate: acc.skipped_duplicate + r.skipped_duplicate,
    }),
    { fetched: 0, imported: 0, skipped_no_lead: 0, skipped_duplicate: 0 },
  );

  return json({
    ok: true,
    mode: isCron ? "cron" : "manual",
    days,
    projects: results.length,
    ...total,
    errors: results.flatMap((r) => r.errors).slice(0, 10),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    return await handle(req);
  } catch (e) {
    // См. комментарий в binotel-call: generic-500 без CORS прячет причину.
    console.error("[binotel-import-calls] unhandled", e);
    return json({
      ok: false, error: "internal_error",
      detail: e instanceof Error ? e.message : String(e),
    }, 500);
  }
});
