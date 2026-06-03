// ai-rop-score-manager
// Считает интегральный балл менеджера: SLA, дозвон, конверсия, звонки, чаты.
// Складывает строку в ai_rop_manager_scores. По одному менеджеру (если указан manager_id)
// либо по всем менеджерам проекта.
//
// Вход: { project_id: string, manager_id?: string, period_days?: number, generate_report?: boolean }
// Auth: JWT юзера ИЛИ x-internal-key = SUPABASE_SERVICE_ROLE_KEY (для cron).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-internal-key",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function authorize(req: Request): Promise<{ ok: boolean; userId?: string }> {
  const internal = req.headers.get("x-internal-key");
  if (internal && internal === SERVICE_KEY) return { ok: true };
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return { ok: false };
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return { ok: false };
  return { ok: true, userId: data.user.id };
}

function clamp(n: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n));
}

type Lead = {
  id: string;
  paid: boolean | null;
  amount: number | null;
  created_at: string;
  first_response_at: string | null;
  last_outbound_at: string | null;
  stage_id: string | null;
};

async function scoreOne(params: {
  projectId: string;
  managerId: string;
  periodStart: string;
  periodEnd: string;
  generateReport: boolean;
}) {
  const { projectId, managerId, periodStart, periodEnd, generateReport } = params;

  // 1) Leads assigned in period
  const { data: leads = [] } = await admin
    .from("leads")
    .select("id, paid, amount, created_at, first_response_at, last_outbound_at, stage_id")
    .eq("project_id", projectId)
    .eq("assigned_to", managerId)
    .gte("created_at", periodStart)
    .lte("created_at", periodEnd)
    .limit(2000);

  const leadsArr = (leads ?? []) as Lead[];
  const assigned = leadsArr.length;
  const paid = leadsArr.filter((l) => l.paid).length;
  const revenue = leadsArr.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const conversion = assigned > 0 ? (paid / assigned) * 100 : 0;

  // SLA: первая исходящая в течение 5 минут после создания лида
  const responded = leadsArr.filter((l) => l.first_response_at);
  const under5 = responded.filter((l) => {
    const dt =
      (new Date(l.first_response_at as string).getTime() -
        new Date(l.created_at).getTime()) /
      60000;
    return dt >= 0 && dt <= 5;
  }).length;
  const slaPct = responded.length > 0 ? (under5 / responded.length) * 100 : 0;
  const dialPct = assigned > 0 ? (responded.length / assigned) * 100 : 0;

  // 2) Calls analyses
  const { data: calls = [] } = await admin
    .from("ai_rop_call_analyses")
    .select("overall_score, criteria")
    .eq("project_id", projectId)
    .eq("manager_id", managerId)
    .gte("call_at", periodStart)
    .lte("call_at", periodEnd)
    .limit(500);
  const callRows = (calls ?? []) as Array<{
    overall_score: number | null;
    criteria: unknown;
  }>;
  const callScores = callRows
    .map((r) => Number(r.overall_score))
    .filter((n) => Number.isFinite(n));
  const callsAvg = callScores.length
    ? Math.round(callScores.reduce((s, n) => s + n, 0) / callScores.length)
    : 0;

  // critery-based: scripts и empathy подтянем из criteria, если есть
  const critAvg = (key: string): number => {
    const vals: number[] = [];
    for (const c of callRows) {
      const arr = Array.isArray(c.criteria) ? (c.criteria as Array<Record<string, unknown>>) : [];
      for (const item of arr) {
        const name = String(item?.name ?? "").toLowerCase();
        const score = Number(item?.score);
        if (Number.isFinite(score) && name.includes(key)) vals.push(score);
      }
    }
    return vals.length ? Math.round(vals.reduce((s, n) => s + n, 0) / vals.length) : 0;
  };
  const scriptsScore = critAvg("скрипт");
  const empathyScore = critAvg("эмпат") || critAvg("тон");

  // 3) Chat analyses
  const { data: chats = [] } = await admin
    .from("ai_rop_chat_analyses")
    .select("overall_score")
    .eq("project_id", projectId)
    .eq("manager_id", managerId)
    .gte("processed_at", periodStart)
    .lte("processed_at", periodEnd)
    .limit(1000);
  const chatRows = (chats ?? []) as Array<{ overall_score: number | null }>;
  const chatScores = chatRows
    .map((r) => Number(r.overall_score))
    .filter((n) => Number.isFinite(n));
  const chatsAvg = chatScores.length
    ? Math.round(chatScores.reduce((s, n) => s + n, 0) / chatScores.length)
    : 0;

  // 4) Aggregate weights — SLA 20, Dial 15, Conversion×4 25, Calls 20, Chats 20
  const slaScore = clamp(slaPct);
  const dialScore = clamp(dialPct);
  const convScore = clamp(conversion * 4);
  const weights: Array<[number, number]> = [];
  weights.push([slaScore, 20]);
  weights.push([dialScore, 15]);
  weights.push([convScore, 25]);
  if (callsAvg > 0) weights.push([callsAvg, 20]);
  if (chatsAvg > 0) weights.push([chatsAvg, 20]);
  const totalW = weights.reduce((s, [, w]) => s + w, 0);
  const overallScore = Math.round(
    weights.reduce((s, [v, w]) => s + v * w, 0) / (totalW || 1),
  );

  // 5) AI report (optional)
  let aiReport: string | null = null;
  let aiRecommendations: string[] = [];
  if (generateReport && LOVABLE_API_KEY) {
    try {
      const { data: settings } = await admin
        .from("ai_rop_settings")
        .select("system_prompt, tone, kpi_min_dial_pct, kpi_min_conversion_pct, kpi_max_reject_pct")
        .eq("project_id", projectId)
        .maybeSingle();
      const sys = (settings?.system_prompt as string) ??
        "Ты — РОП клиники эстетической медицины.";
      const tone = (settings?.tone as string) ?? "наставник";
      const userPrompt =
        `Менеджер за период ${periodStart.slice(0, 10)} — ${periodEnd.slice(0, 10)}:\n` +
        `Назначено лидов: ${assigned}\nОплат: ${paid} (CR ${conversion.toFixed(1)}%)\n` +
        `Выручка: ${revenue}\nSLA <5 мин: ${slaPct.toFixed(0)}% (${under5}/${responded.length})\n` +
        `Дозвон/ответил: ${dialPct.toFixed(0)}%\n` +
        `Звонков разобрано: ${callRows.length}, ср. оценка: ${callsAvg}\n` +
        `Чатов разобрано: ${chatRows.length}, ср. оценка: ${chatsAvg}\n` +
        `Скрипты: ${scriptsScore}, Эмпатия: ${empathyScore}\n\n` +
        `Тон: ${tone}. Верни JSON {"report": "5-6 предложений", "recommendations": ["...","...","..."]}.`;
      const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: sys },
            { role: "user", content: userPrompt },
          ],
        }),
      });
      if (r.ok) {
        const j = await r.json();
        const content = j?.choices?.[0]?.message?.content ?? "{}";
        try {
          const parsed = JSON.parse(content);
          aiReport = typeof parsed.report === "string" ? parsed.report : null;
          aiRecommendations = Array.isArray(parsed.recommendations)
            ? parsed.recommendations.filter((x: unknown) => typeof x === "string").slice(0, 5)
            : [];
        } catch (_) {
          aiReport = content.slice(0, 1000);
        }
      }
    } catch (e) {
      console.error("[ai-rop-score-manager] AI report failed", e);
    }
  }

  // 6) Insert score row
  const { data: inserted, error } = await admin
    .from("ai_rop_manager_scores")
    .insert({
      project_id: projectId,
      manager_id: managerId,
      period_start: periodStart,
      period_end: periodEnd,
      leads_assigned: assigned,
      leads_paid: paid,
      sla_score: Math.round(slaScore),
      dial_score: Math.round(dialScore),
      conversion_score: Math.round(convScore),
      calls_total: callRows.length,
      calls_avg_score: callsAvg,
      chats_total: chatRows.length,
      chats_avg_score: chatsAvg,
      scripts_score: scriptsScore,
      empathy_score: empathyScore,
      overall_score: overallScore,
      ai_report: aiReport,
      ai_recommendations: aiRecommendations.length ? aiRecommendations : null,
    })
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return { manager_id: managerId, score_id: inserted?.id ?? null, overall_score: overallScore };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = await authorize(req);
    if (!auth.ok) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const projectIdParam = body.project_id ? String(body.project_id) : "";
    const isInternal = (req.headers.get("x-internal-key") ?? "") === SERVICE_KEY;
    if (!isInternal && projectIdParam) {
      const authHeader = req.headers.get("Authorization") ?? "";
      const access = await requireProjectAccess(authHeader, projectIdParam);
      if (!access.ok) return access.response;
    }
    const managerId = body.manager_id ? String(body.manager_id) : null;
    const periodDays = Math.max(1, Math.min(180, Number(body.period_days ?? 30)));
    const generateReport = body.generate_report !== false;

    // Resolve projects: либо один по project_id, либо все с включёнными настройками (cron)
    let projectIds: string[] = [];
    if (projectIdParam) {
      projectIds = [projectIdParam];
    } else {
      const { data: pr } = await admin
        .from("ai_rop_settings")
        .select("project_id")
        .not("project_id", "is", null);
      projectIds = Array.from(
        new Set(((pr ?? []) as Array<{ project_id: string }>).map((r) => r.project_id)),
      );
    }
    if (projectIds.length === 0) return json({ ok: true, results: [] });

    const periodEnd = new Date().toISOString();
    const periodStart = new Date(Date.now() - periodDays * 86400000).toISOString();

    // Resolve manager list
    let managerIds: string[] = [];
    if (managerId) {
      managerIds = [managerId];
    } else {
      const { data: roles } = await admin
        .from("user_roles")
        .select("user_id")
        .eq("role", "manager");
      managerIds = Array.from(new Set((roles ?? []).map((r: { user_id: string }) => r.user_id)));
    }
    if (managerIds.length === 0) return json({ ok: true, results: [] });

    const results: unknown[] = [];
    for (const pid of projectIds) {
      for (const mid of managerIds) {
        try {
          const r = await scoreOne({
            projectId: pid,
            managerId: mid,
            periodStart,
            periodEnd,
            generateReport,
          });
          results.push({ project_id: pid, ...r });
        } catch (e) {
          console.error("[ai-rop-score-manager] failed", pid, mid, e);
          results.push({
            project_id: pid,
            manager_id: mid,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }
    return json({ ok: true, results });
  } catch (e) {
    console.error("[ai-rop-score-manager] error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
