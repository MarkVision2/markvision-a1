// ai-rop-analyze-chat
// Анализирует переписку лида: считает метрики, прогоняет диалог через LLM,
// апсёртит результат в ai_rop_chat_analyses (PK по lead_id).
//
// Вход: { lead_id: string, project_id?: string }
// Авторизация: либо JWT пользователя (через auth flow), либо вызов из других
// edge-функций с x-internal-key = SUPABASE_SERVICE_ROLE_KEY.
//
// Идемпотентность: апсёрт по lead_id, всегда переписывает свежим разбором.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireLeadAccess } from "../_lib/auth.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-internal-key",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const MODEL = "google/gemini-2.5-flash";
const MAX_MESSAGES = 60;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Comm = {
  id: string;
  lead_id: string;
  direction: "in" | "out";
  text: string | null;
  channel: string | null;
  is_draft: boolean | null;
  is_auto: boolean | null;
  created_at: string;
  created_by: string | null;
};

type Lead = {
  id: string;
  project_id: string | null;
  assigned_to: string | null;
  pipeline_id: string | null;
  stage_id: string | null;
};

function computeMetrics(comms: Comm[]) {
  const real = comms.filter((c) => !c.is_draft);
  const ins = real.filter((c) => c.direction === "in");
  const outs = real.filter((c) => c.direction === "out");

  // first response: первый OUT после первого IN
  let firstResponseMin: number | null = null;
  if (ins.length && outs.length) {
    const firstIn = new Date(ins[0].created_at).getTime();
    const firstOut = outs.find((o) => new Date(o.created_at).getTime() >= firstIn);
    if (firstOut) {
      firstResponseMin = Math.max(
        0,
        Math.round((new Date(firstOut.created_at).getTime() - firstIn) / 60000),
      );
    }
  }

  // avg response time: для каждого IN-сообщения, на которое менеджер ответил
  const gaps: number[] = [];
  for (let i = 0; i < real.length; i++) {
    if (real[i].direction !== "in") continue;
    const next = real.slice(i + 1).find((c) => c.direction === "out");
    if (!next) continue;
    const gap =
      (new Date(next.created_at).getTime() - new Date(real[i].created_at).getTime()) /
      60000;
    if (gap >= 0 && gap < 60 * 24 * 7) gaps.push(gap);
  }
  const avgResponseMin = gaps.length
    ? Math.round((gaps.reduce((s, x) => s + x, 0) / gaps.length) * 10) / 10
    : null;

  // ghosted: последнее IN не получило ответа > 4ч
  let ghosted = false;
  const lastReal = real[real.length - 1];
  if (lastReal && lastReal.direction === "in") {
    const ageMin =
      (Date.now() - new Date(lastReal.created_at).getTime()) / 60000;
    if (ageMin > 4 * 60) ghosted = true;
  }

  return {
    message_count: real.length,
    first_response_min: firstResponseMin,
    avg_response_min: avgResponseMin,
    ghosted,
  };
}

async function loadSettings(projectId: string) {
  const { data } = await admin
    .from("ai_rop_settings")
    .select("*")
    .eq("project_id", projectId)
    .maybeSingle();
  return data;
}

function buildPrompt(opts: {
  systemPrompt: string;
  watchList: string[];
  tone: string;
  dialog: string;
  metrics: ReturnType<typeof computeMetrics>;
}) {
  const { systemPrompt, watchList, tone, dialog, metrics } = opts;
  const checklist = watchList.length
    ? watchList.map((w, i) => `${i + 1}. ${w}`).join("\n")
    : "1. Скорость ответа\n2. Отработка возражений\n3. Назначение визита";

  const system = `${systemPrompt}

Тон обратной связи: ${tone}.
Ты анализируешь переписку администратора клиники с лидом в WhatsApp.
Верни СТРОГО JSON без markdown, без комментариев, по схеме:
{
  "overall_score": 0-100,
  "criteria": [{"name": str, "score": 0-100, "note": str}],
  "strengths": [str],
  "weaknesses": [str],
  "topics": [str],
  "objections": [str],
  "flag_price_without_qualification": bool,
  "flag_no_closing": bool,
  "flag_ghosted_by_manager": bool
}
Критерии оценки — это ровно те пункты watch_list, что ниже. Их и используй в "criteria".`;

  const user = `Чек-лист (watch_list):
${checklist}

Метрики переписки:
- сообщений: ${metrics.message_count}
- первое время ответа менеджера: ${metrics.first_response_min ?? "—"} мин
- среднее время ответа: ${metrics.avg_response_min ?? "—"} мин
- последнее сообщение от клиента без ответа >4ч: ${metrics.ghosted ? "да" : "нет"}

Диалог (старые → новые):
${dialog}`;

  return { system, user };
}

async function callLLM(system: string, user: string) {
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`LLM HTTP ${resp.status}: ${t.slice(0, 400)}`);
  }
  const j = await resp.json();
  const text = j?.choices?.[0]?.message?.content ?? "{}";
  try {
    return JSON.parse(text);
  } catch {
    // Иногда модель оборачивает в ```json — выдернем содержимое
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("LLM returned non-JSON");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const leadId = String(body?.lead_id ?? "").trim();
    if (!leadId) return json({ error: "lead_id required" }, 400);

    // Auth: либо internal key, либо валидный JWT (verify_jwt=false, проверяем вручную)
    const internalKey = req.headers.get("x-internal-key");
    const isInternal = internalKey && internalKey === SERVICE_KEY;
    if (!isInternal) {
      const auth = req.headers.get("Authorization") ?? "";
      if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
      const leadAccess = await requireLeadAccess(auth, leadId);
      if (!leadAccess.ok) return leadAccess.response;
    }

    // Lead
    const { data: lead, error: leadErr } = await admin
      .from("leads")
      .select("id, project_id, assigned_to, pipeline_id, stage_id")
      .eq("id", leadId)
      .maybeSingle();
    if (leadErr || !lead) return json({ error: "lead not found" }, 404);
    const projectId = (lead as Lead).project_id;
    if (!projectId) return json({ error: "lead has no project" }, 400);

    // Communications
    const { data: commsData } = await admin
      .from("communications")
      .select("id, lead_id, direction, text, channel, is_draft, is_auto, created_at, created_by")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: true })
      .limit(MAX_MESSAGES);
    const comms = (commsData ?? []) as Comm[];
    if (comms.length < 2) {
      return json({ ok: true, skipped: "not enough messages", count: comms.length });
    }

    // Settings (опционально — fallback на дефолты)
    const settings = await loadSettings(projectId);
    const watchList = (settings?.watch_list as string[] | null) ?? [
      "Скорость первого ответа",
      "Отработка возражений",
      "Назначение визита",
      "Использование скриптов",
      "Эмпатия и тон администратора",
    ];
    const systemPrompt =
      (settings?.system_prompt as string | null) ??
      "Ты — AI-РОП клиники. Оценивай качество переписки администратора с лидом по фактам, без воды.";
    const tone = (settings?.tone as string | null) ?? "neutral";

    // Metrics
    const metrics = computeMetrics(comms);

    // Dialog text
    const dialog = comms
      .filter((c) => !c.is_draft && c.text)
      .map((c) => {
        const who = c.direction === "in" ? "КЛИЕНТ" : c.is_auto ? "БОТ" : "МЕНЕДЖЕР";
        return `[${c.created_at.slice(0, 16).replace("T", " ")}] ${who}: ${c.text}`;
      })
      .join("\n");

    const { system, user } = buildPrompt({
      systemPrompt,
      watchList,
      tone,
      dialog,
      metrics,
    });

    const parsed = await callLLM(system, user);

    const overall = Math.max(0, Math.min(100, Number(parsed.overall_score ?? 0)));
    const channel = comms[comms.length - 1]?.channel ?? "whatsapp";

    const row = {
      project_id: projectId,
      lead_id: leadId,
      manager_id: (lead as Lead).assigned_to,
      channel,
      message_count: metrics.message_count,
      first_response_min: metrics.first_response_min,
      avg_response_min: metrics.avg_response_min,
      overall_score: overall,
      criteria: parsed.criteria ?? [],
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
      weaknesses: Array.isArray(parsed.weaknesses) ? parsed.weaknesses : [],
      topics: Array.isArray(parsed.topics) ? parsed.topics : [],
      objections: Array.isArray(parsed.objections) ? parsed.objections : [],
      flag_price_without_qualification: Boolean(parsed.flag_price_without_qualification),
      flag_no_closing: Boolean(parsed.flag_no_closing),
      flag_ghosted_by_manager:
        Boolean(parsed.flag_ghosted_by_manager) || metrics.ghosted,
      ai_model: MODEL,
      processed_at: new Date().toISOString(),
    };

    const { error: upErr } = await admin
      .from("ai_rop_chat_analyses")
      .upsert(row, { onConflict: "lead_id" });
    if (upErr) throw upErr;

    return json({ ok: true, lead_id: leadId, overall_score: overall });
  } catch (e) {
    console.error("ai-rop-analyze-chat error", e);
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});
