// ai-rop-analyze-call
// Анализирует звонок: скачивает запись, делает транскрипт (whisper-1),
// проводит эвристическую диаризацию, прогоняет через LLM (gemini-2.5-flash),
// сохраняет разбор в ai_rop_call_analyses (insert, не upsert — каждый звонок отдельной строкой).
// Если оценка по критерию «отработка возражений» < 50 и settings.auto_suggest_scripts —
// создаёт черновик скрипта в ai_rop_scripts с source='ai'.
//
// Вход: { lead_id, recording_url, duration_sec?, manager_id?, call_at? }
// Auth: JWT пользователя ИЛИ x-internal-key = SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireLeadAccess, validateRecordingUrl } from "../_lib/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-internal-key",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const LLM_MODEL = "google/gemini-2.5-flash";
const STT_MODEL = "openai/whisper-1";
const LOVABLE_BASE = "https://ai.gateway.lovable.dev/v1";
const MAX_AUDIO_BYTES = 50 * 1024 * 1024; // 50 МБ

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Lead = {
  id: string;
  project_id: string | null;
  assigned_to: string | null;
};

type WhisperSegment = {
  id?: number;
  start?: number;
  end?: number;
  text?: string;
  speaker?: string;
};

// Хелпер: fetch с таймаутом. Edge-функции Supabase убиваются по wall-clock
// лимиту (~60-150с в зависимости от плана) — без явного timeout висящий
// upstream-запрос съест весь бюджет функции.
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(tid);
  }
}

async function downloadAudio(url: string): Promise<{ blob: Blob; filename: string }> {
  // Sipuni обычно отдаёт запись быстро. 30с с запасом на лёгкую перегрузку.
  const r = await fetchWithTimeout(url, { redirect: "follow" }, 30_000);
  if (!r.ok) throw new Error(`download ${r.status}`);
  const len = Number(r.headers.get("content-length") ?? 0);
  if (len && len > MAX_AUDIO_BYTES) throw new Error(`audio too large: ${len}`);
  const ct = r.headers.get("content-type") ?? "audio/mpeg";
  const buf = await r.arrayBuffer();
  if (buf.byteLength > MAX_AUDIO_BYTES) throw new Error("audio too large");
  // Имя файла важно для whisper, чтобы определить формат
  const ext =
    ct.includes("wav") ? "wav" :
    ct.includes("ogg") ? "ogg" :
    ct.includes("mp4") || ct.includes("m4a") ? "m4a" :
    "mp3";
  return { blob: new Blob([buf], { type: ct }), filename: `call.${ext}` };
}

async function transcribe(audio: Blob, filename: string) {
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");
  const fd = new FormData();
  fd.append("file", audio, filename);
  fd.append("model", STT_MODEL);
  fd.append("response_format", "verbose_json");
  fd.append("language", "ru");

  // Whisper для 5-минутного звонка ~10с, для 30-минутного — до минуты. 90с с запасом.
  const resp = await fetchWithTimeout(
    `${LOVABLE_BASE}/audio/transcriptions`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}` },
      body: fd,
    },
    90_000,
  );
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`whisper HTTP ${resp.status}: ${t.slice(0, 400)}`);
  }
  const j = await resp.json();
  const text: string = j?.text ?? "";
  const segments: WhisperSegment[] = Array.isArray(j?.segments) ? j.segments : [];
  return { text, segments };
}

// Эвристическая диаризация:
// если у whisper нет speaker labels — чередуем «МЕНЕДЖЕР»/«КЛИЕНТ» по сегментам,
// первое сообщение считаем за менеджера (он принимает/делает звонок в клинике).
function diarize(segments: WhisperSegment[], fallbackText: string) {
  if (!segments.length) {
    return [
      { speaker: "МЕНЕДЖЕР" as const, start: 0, end: 0, text: fallbackText },
    ];
  }
  const hasSpeakers = segments.some((s) => s.speaker);
  return segments.map((s, i) => {
    let speaker: "МЕНЕДЖЕР" | "КЛИЕНТ";
    if (hasSpeakers && s.speaker) {
      // Маппим первый встреченный label на менеджера
      speaker = s.speaker.toString().toLowerCase().includes("1") ? "МЕНЕДЖЕР" : "КЛИЕНТ";
    } else {
      speaker = i % 2 === 0 ? "МЕНЕДЖЕР" : "КЛИЕНТ";
    }
    return {
      speaker,
      start: Number(s.start ?? 0),
      end: Number(s.end ?? 0),
      text: (s.text ?? "").trim(),
    };
  });
}

function formatTranscript(diar: ReturnType<typeof diarize>) {
  return diar
    .filter((d) => d.text)
    .map((d) => {
      const t = Math.round(d.start);
      const mm = String(Math.floor(t / 60)).padStart(2, "0");
      const ss = String(t % 60).padStart(2, "0");
      return `[${mm}:${ss}] ${d.speaker}: ${d.text}`;
    })
    .join("\n");
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
  transcript: string;
  durationSec: number | null;
}) {
  const { systemPrompt, watchList, tone, transcript, durationSec } = opts;
  const checklist = watchList.length
    ? watchList.map((w, i) => `${i + 1}. ${w}`).join("\n")
    : "1. Скорость и уверенность ответа\n2. Отработка возражений\n3. Назначение визита\n4. Использование скриптов\n5. Эмпатия и тон";

  const system = `${systemPrompt}

Тон обратной связи: ${tone}.
Ты анализируешь телефонный звонок администратора клиники с лидом.
Верни СТРОГО JSON без markdown, без комментариев, по схеме:
{
  "overall_score": 0-100,
  "criteria": [{"name": str, "score": 0-100, "note": str}],
  "strengths": [str],
  "weaknesses": [str],
  "main_mistake": str,
  "topics": [str],
  "objections": [str]
}
Критерии оценки — это ровно те пункты watch_list, что ниже. Их и используй в "criteria".
Обязательно включи в criteria пункт с name "отработка возражений" (lower-case).`;

  const user = `Чек-лист (watch_list):
${checklist}

Длительность звонка: ${durationSec ? `${durationSec} сек` : "—"}

Транскрипт (с эвристической диаризацией):
${transcript}`;

  return { system, user };
}

async function callLLM(system: string, user: string) {
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");
  // Gemini обычно укладывается в 5-15с. 60с с запасом на лёгкие лаги/ретраи
  // на стороне gateway. Без timeout висящий запрос убьёт весь бюджет функции.
  const resp = await fetchWithTimeout(
    `${LOVABLE_BASE}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      }),
    },
    60_000,
  );
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`LLM HTTP ${resp.status}: ${t.slice(0, 400)}`);
  }
  const j = await resp.json();
  const text = j?.choices?.[0]?.message?.content ?? "{}";
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("LLM returned non-JSON");
  }
}

function objectionScore(criteria: Array<{ name?: string; score?: number }>): number | null {
  for (const c of criteria ?? []) {
    const name = (c?.name ?? "").toLowerCase();
    if (name.includes("возраж")) {
      const s = Number(c?.score);
      if (Number.isFinite(s)) return s;
    }
  }
  return null;
}

async function maybeCreateScriptDraft(opts: {
  projectId: string;
  managerId: string | null;
  parsed: any;
  leadId: string;
}) {
  const { projectId, managerId, parsed, leadId } = opts;
  const objections: string[] = Array.isArray(parsed?.objections) ? parsed.objections : [];
  const mainMistake: string = String(parsed?.main_mistake ?? "").trim();
  const topObjection = objections.find((o) => typeof o === "string" && o.trim()) ?? "Возражение клиента";

  // Маппинг текста возражения в подвид из enum ai_script_category.
  // Значения "objection" в enum нет — только objection_price / objection_no_time / objection_thinking.
  const lower = topObjection.toLowerCase();
  const category: "objection_price" | "objection_no_time" | "objection_thinking" | "custom" =
    /дорог|цен|стоит|стоим|деньг|бюджет/.test(lower)
      ? "objection_price"
      : /врем|занят|некогда|потом|поздн/.test(lower)
        ? "objection_no_time"
        : /подум|думаю|посовет|реш|сомнев/.test(lower)
          ? "objection_thinking"
          : "custom";
  const categoryTag = category.startsWith("objection_") ? category.slice("objection_".length) : "objection";

  const body = [
    `Сценарий отработки возражения: "${topObjection}".`,
    mainMistake ? `Главная ошибка в звонке: ${mainMistake}` : "",
    "",
    "1. Подтверди, что слышишь клиента и понимаешь его опасение.",
    "2. Уточни контекст вопросом: «Что для вас важнее — цена или результат лечения?»",
    "3. Покажи ценность через факт (опыт врача, гарантия, материалы).",
    "4. Закрой на следующий шаг: запись на бесплатную диагностику в удобное время.",
  ]
    .filter(Boolean)
    .join("\n");

  const row = {
    project_id: projectId,
    title: `AI: отработка возражения «${topObjection.slice(0, 60)}»`,
    body,
    category,
    source: "ai",
    tags: ["ai-draft", categoryTag],
    created_by: managerId,
  };

  const { data, error } = await admin
    .from("ai_rop_scripts")
    .insert(row)
    .select("id")
    .maybeSingle();
  if (error) {
    console.warn("[analyze-call] script draft insert failed", error);
    return null;
  }
  console.log("[analyze-call] created script draft", data?.id, "for lead", leadId);
  return data?.id ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const leadId = String(body?.lead_id ?? "").trim();
    const recordingUrlRaw = String(body?.recording_url ?? "").trim();
    const durationSec = body?.duration_sec != null ? Number(body.duration_sec) : null;
    const managerIdInput = body?.manager_id ? String(body.manager_id) : null;
    const callAtInput = body?.call_at ? String(body.call_at) : null;

    if (!leadId) return json({ error: "lead_id required" }, 400);
    if (!recordingUrlRaw) return json({ error: "recording_url required" }, 400);

    // SSRF protection: only https + allowlisted hosts.
    const recordingUrl = validateRecordingUrl(recordingUrlRaw);
    if (!recordingUrl) return json({ error: "invalid recording_url" }, 400);

    // Auth
    const internalKey = req.headers.get("x-internal-key");
    const isInternal = internalKey && internalKey === SERVICE_KEY;
    if (!isInternal) {
      const auth = req.headers.get("Authorization") ?? "";
      if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
      const { data: u } = await admin.auth.getUser(auth.slice(7));
      if (!u?.user) return json({ error: "unauthorized" }, 401);
      // Tenant authorization: caller must have RLS access to this lead's project.
      const access = await requireLeadAccess(auth, leadId);
      if (!access.ok) return access.response;
    }

    // Lead
    const { data: lead, error: leadErr } = await admin
      .from("leads")
      .select("id, project_id, assigned_to")
      .eq("id", leadId)
      .maybeSingle();
    if (leadErr || !lead) return json({ error: "lead not found" }, 404);
    const projectId = (lead as Lead).project_id;
    if (!projectId) return json({ error: "lead has no project" }, 400);
    const managerId = managerIdInput ?? (lead as Lead).assigned_to ?? null;
    const callAt = callAtInput ?? new Date().toISOString();

    // 1+2. Download + transcribe
    const { blob, filename } = await downloadAudio(recordingUrl);
    const { text: rawText, segments } = await transcribe(blob, filename);
    if (!rawText.trim()) {
      return json({ ok: false, error: "empty transcript" }, 422);
    }

    // 3. Диаризация
    const diar = diarize(segments, rawText);
    const transcriptStr = formatTranscript(diar);

    // 4. Settings + LLM
    const settings = await loadSettings(projectId);
    const watchList = (settings?.watch_list as string[] | null) ?? [
      "Скорость и уверенность ответа",
      "Отработка возражений",
      "Назначение визита",
      "Использование скриптов",
      "Эмпатия и тон",
    ];
    const systemPrompt =
      (settings?.system_prompt as string | null) ??
      "Ты — AI-РОП клиники. Оценивай качество звонка администратора по фактам, без воды.";
    const tone = (settings?.tone as string | null) ?? "neutral";

    const { system, user } = buildPrompt({
      systemPrompt,
      watchList,
      tone,
      transcript: transcriptStr,
      durationSec,
    });

    const parsed = await callLLM(system, user);
    const overall = Math.max(0, Math.min(100, Number(parsed.overall_score ?? 0)));

    // 5+6. Insert (каждый звонок — отдельная запись)
    const row = {
      project_id: projectId,
      lead_id: leadId,
      manager_id: managerId,
      call_at: callAt,
      call_recording_url: recordingUrl,
      duration_sec: Number.isFinite(durationSec) ? durationSec : null,
      transcript: rawText,
      transcript_segments: diar,
      overall_score: overall,
      criteria: parsed.criteria ?? [],
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
      weaknesses: Array.isArray(parsed.weaknesses) ? parsed.weaknesses : [],
      main_mistake: parsed.main_mistake ? String(parsed.main_mistake) : null,
      topics: Array.isArray(parsed.topics) ? parsed.topics : [],
      objections: Array.isArray(parsed.objections) ? parsed.objections : [],
      ai_model: LLM_MODEL,
      processed_at: new Date().toISOString(),
    };

    const { data: inserted, error: insErr } = await admin
      .from("ai_rop_call_analyses")
      .insert(row)
      .select("id")
      .maybeSingle();
    if (insErr) throw insErr;

    // 7. Авто-скрипт при слабой отработке возражений
    let scriptId: string | null = null;
    const objScore = objectionScore(parsed.criteria ?? []);
    if (
      objScore != null &&
      objScore < 50 &&
      (settings?.auto_suggest_scripts ?? true)
    ) {
      scriptId = await maybeCreateScriptDraft({
        projectId,
        managerId,
        parsed,
        leadId,
      });
      if (scriptId) {
        await admin
          .from("ai_rop_call_analyses")
          .update({ recommended_script_id: scriptId })
          .eq("id", inserted?.id);
      }
    }

    return json({
      ok: true,
      analysis_id: inserted?.id ?? null,
      overall_score: overall,
      objection_score: objScore,
      script_draft_id: scriptId,
    });
  } catch (e) {
    console.error("ai-rop-analyze-call error", e);
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});
