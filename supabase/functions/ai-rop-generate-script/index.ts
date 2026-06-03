// ai-rop-generate-script
// Анализирует разборы звонков и чатов за 7 дней, находит частое возражение
// с низким баллом по «отработка возражения» и просит LLM скомпилировать новый
// скрипт продаж на основе реальных удачных фрагментов (high-score примеров).
//
// Триггер:
//   - Cron daily (через pg_cron, без project_id → пройтись по всем активным проектам)
//   - On-demand с фронта: { project_id, force?: boolean }
//
// Auth: JWT юзера ИЛИ x-internal-key = SERVICE_ROLE_KEY (для cron/internal).
//
// Insert: ai_rop_scripts (source='ai').

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireProjectAccess } from "../_lib/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-internal-key",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const MODEL = "google/gemini-2.5-flash";

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const SCRIPT_CATEGORIES = [
  "greeting",
  "objection_price",
  "objection_no_time",
  "objection_thinking",
  "closing",
  "follow_up",
  "missed_call",
  "custom",
] as const;
type ScriptCategory = (typeof SCRIPT_CATEGORIES)[number];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function authorize(req: Request): Promise<{ ok: true } | { ok: false; resp: Response }> {
  const internal = req.headers.get("x-internal-key") ?? "";
  if (internal && internal === SERVICE_KEY) return { ok: true };
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return { ok: false, resp: json({ error: "Unauthorized" }, 401) };
  }
  const supa = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const token = authHeader.replace("Bearer ", "");
  const { data, error } = await supa.auth.getClaims(token);
  if (error || !data?.claims) {
    return { ok: false, resp: json({ error: "Unauthorized" }, 401) };
  }
  return { ok: true };
}

async function callLLM(prompt: string, systemPrompt: string): Promise<string> {
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`LLM ${r.status}: ${t.slice(0, 200)}`);
  }
  const j = await r.json();
  return j?.choices?.[0]?.message?.content ?? "";
}

// Достаём category, title, body, tags из текстового ответа LLM
function parseScript(raw: string): {
  category: ScriptCategory;
  title: string;
  body: string;
  tags: string[];
} {
  const cat = (raw.match(/CATEGORY:\s*(\w+)/i)?.[1] ?? "").toLowerCase() as ScriptCategory;
  const title = raw.match(/TITLE:\s*(.+)/i)?.[1]?.trim() ?? "Новый скрипт от ИИ";
  const body = raw.match(/BODY:\s*([\s\S]+?)(?:\nTAGS:|$)/i)?.[1]?.trim() ?? raw;
  const tags =
    raw
      .match(/TAGS:\s*(.+)/i)?.[1]
      ?.split(",")
      .map((t) => t.trim().replace(/^#/, ""))
      .filter(Boolean) ?? [];
  return {
    category: SCRIPT_CATEGORIES.includes(cat) ? cat : "custom",
    title,
    body,
    tags,
  };
}

async function getActiveProjectIds(): Promise<string[]> {
  // Проекты с настройками ИИ-РОПа считаем активными
  const { data } = await admin.from("ai_rop_settings").select("project_id");
  return Array.from(new Set((data ?? []).map((r) => r.project_id).filter(Boolean) as string[]));
}

async function generateForProject(projectId: string): Promise<{
  ok: boolean;
  script_id?: string;
  reason?: string;
}> {
  const since = new Date(Date.now() - 7 * 86400_000).toISOString();

  const [callsRes, chatsRes, settingsRes, existingRes] = await Promise.all([
    admin
      .from("ai_rop_call_analyses")
      .select("overall_score, criteria, objections, weaknesses, transcript")
      .eq("project_id", projectId)
      .gte("call_at", since)
      .limit(200),
    admin
      .from("ai_rop_chat_analyses")
      .select("overall_score, criteria, objections, weaknesses")
      .eq("project_id", projectId)
      .gte("processed_at", since)
      .limit(200),
    admin
      .from("ai_rop_settings")
      .select("system_prompt, tone, auto_suggest_scripts")
      .eq("project_id", projectId)
      .maybeSingle(),
    admin
      .from("ai_rop_scripts")
      .select("title, category")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(40),
  ]);

  const calls = callsRes.data ?? [];
  const chats = chatsRes.data ?? [];
  const totalAnalyses = calls.length + chats.length;
  if (totalAnalyses < 1) {
    return { ok: false, reason: "no_analyses" };
  }

  // Группируем возражения и берём те, где средний балл по «отработка возражения» < 60
  const objectionStats = new Map<string, { count: number; scores: number[] }>();
  const pushObjection = (obj: string, score: number | null) => {
    const key = String(obj ?? "").trim().toLowerCase();
    if (!key) return;
    const cur = objectionStats.get(key) ?? { count: 0, scores: [] };
    cur.count += 1;
    if (typeof score === "number") cur.scores.push(score);
    objectionStats.set(key, cur);
  };

  const scoreObjectionFromCriteria = (criteria: unknown): number | null => {
    if (!criteria || typeof criteria !== "object") return null;
    // criteria может быть массивом {name, score} или объектом {name: score}
    if (Array.isArray(criteria)) {
      const row = criteria.find((c: any) =>
        String(c?.name ?? "").toLowerCase().includes("возраж"),
      );
      return typeof row?.score === "number" ? row.score : null;
    }
    const obj = criteria as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      if (k.toLowerCase().includes("возраж") && typeof v === "number") return v;
    }
    return null;
  };

  for (const c of [...calls, ...chats]) {
    const score = scoreObjectionFromCriteria((c as any).criteria);
    for (const o of (c as any).objections ?? []) pushObjection(o, score);
  }

  const ranked = Array.from(objectionStats.entries())
    .filter(([, v]) => v.count >= 2)
    .map(([name, v]) => ({
      name,
      count: v.count,
      avgScore: v.scores.length ? v.scores.reduce((a, b) => a + b, 0) / v.scores.length : null,
    }))
    .sort((a, b) => b.count - a.count);

  const target = ranked.find((r) => r.avgScore === null || r.avgScore < 60) ?? ranked[0];
  if (!target) return { ok: false, reason: "no_objections" };

  // High-score примеры (для cross-pollination) из звонков
  const highScoreExamples = calls
    .filter((c: any) => typeof c.overall_score === "number" && c.overall_score >= 75 && c.transcript)
    .slice(0, 3)
    .map((c: any) => String(c.transcript).slice(0, 600));

  const existing = existingRes.data ?? [];
  const settings = settingsRes.data ?? {};
  const tone = (settings as any).tone ?? "neutral";
  const systemPrompt =
    (settings as any).system_prompt ??
    "Ты — эксперт по продажам для частной клиники. Пишешь короткие, конкретные скрипты для администраторов.";

  const prompt =
    `Самое частое возражение клиентов за 7 дней: "${target.name}" ` +
    `(${target.count} раз, средняя оценка отработки: ${target.avgScore?.toFixed(0) ?? "—"}/100).\n\n` +
    `Уже существующие скрипты:\n${existing.map((s) => `- [${s.category}] ${s.title}`).join("\n") || "нет"}\n\n` +
    (highScoreExamples.length
      ? `Примеры успешных разговоров (high-score):\n${highScoreExamples
          .map((t, i) => `\n--- Пример ${i + 1} ---\n${t}`)
          .join("")}\n\n`
      : "") +
    `Тон: ${tone}.\n\n` +
    `Создай НОВЫЙ скрипт, который поможет менеджерам отрабатывать это возражение лучше. ` +
    `Не дублируй существующие. Используй удачные приёмы из примеров.\n\n` +
    `Ответ строго в формате:\n` +
    `CATEGORY: <одна из: greeting, objection_price, objection_no_time, objection_thinking, closing, follow_up, missed_call, custom>\n` +
    `TITLE: <короткое название, до 60 символов>\n` +
    `BODY: <текст скрипта, 3-5 предложений, переменные {имя}, {клиника}, {слот_1}>\n` +
    `TAGS: <через запятую, 2-3 тега>`;

  const raw = await callLLM(prompt, systemPrompt);
  const parsed = parseScript(raw);

  const { data: inserted, error: insertErr } = await admin
    .from("ai_rop_scripts")
    .insert({
      project_id: projectId,
      category: parsed.category,
      title: parsed.title,
      body: parsed.body,
      tags: parsed.tags,
      source: "ai",
    })
    .select("id, category, title, body, tags, source, created_at, updated_at")
    .maybeSingle();

  if (insertErr) {
    console.error("[ai-rop-generate-script] insert error", insertErr);
    return { ok: false, reason: insertErr.message };
  }

  return { ok: true, script_id: inserted?.id, ...(inserted as any) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const auth = await authorize(req);
  if (!auth.ok) return auth.resp;

  let payload: { project_id?: string } = {};
  try {
    payload = await req.json();
  } catch {
    payload = {};
  }

  try {
    if (payload.project_id) {
      const res = await generateForProject(payload.project_id);
      return json({ ok: true, ...res });
    }
    // Cron / без project_id → все проекты
    const projects = await getActiveProjectIds();
    const results: Array<{ project_id: string; ok: boolean; reason?: string; script_id?: string }> = [];
    for (const pid of projects) {
      try {
        const r = await generateForProject(pid);
        results.push({ project_id: pid, ...r });
      } catch (e) {
        results.push({
          project_id: pid,
          ok: false,
          reason: e instanceof Error ? e.message : "unknown",
        });
      }
    }
    return json({ ok: true, processed: results.length, results });
  } catch (e) {
    console.error("[ai-rop-generate-script]", e);
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});
