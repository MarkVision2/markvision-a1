// ai-rop-generate-content
// Weekly cron + on-demand. Берёт топ-10 повторяющихся topics и objections
// из ai_rop_call_analyses + ai_rop_chat_analyses за 30 дней и просит LLM
// придумать идею контента (reels/post/story/article/video).
//
// Insert: ai_rop_content_ideas с source_lead_ids.

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

const FORMATS = ["reels", "post", "story", "article", "video"] as const;
const PRIORITIES = ["high", "mid", "low"] as const;

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
      temperature: 0.8,
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`LLM ${r.status}: ${t.slice(0, 200)}`);
  }
  const j = await r.json();
  return j?.choices?.[0]?.message?.content ?? "";
}

function parseIdea(raw: string): {
  format: (typeof FORMATS)[number];
  priority: (typeof PRIORITIES)[number];
  title: string;
  hook: string;
  body: string;
  audience: string;
  cta: string;
  based_on: string;
} {
  const pick = (key: string): string =>
    raw.match(new RegExp(`${key}:\\s*([^\\n]+)`, "i"))?.[1]?.trim() ?? "";

  const fmtRaw = pick("FORMAT").toLowerCase() as (typeof FORMATS)[number];
  const format = FORMATS.includes(fmtRaw) ? fmtRaw : "reels";

  const prRaw = pick("PRIORITY").toLowerCase() as (typeof PRIORITIES)[number];
  const priority = PRIORITIES.includes(prRaw) ? prRaw : "mid";

  const body = raw.match(/BODY:\s*([\s\S]+?)(?:\nAUDIENCE:|$)/i)?.[1]?.trim() ?? "";

  return {
    format,
    priority,
    title: pick("TITLE") || "Идея от ИИ",
    hook: pick("HOOK"),
    body,
    audience: pick("AUDIENCE"),
    cta: pick("CTA"),
    based_on: pick("BASED_ON") || "Анализ ИИ",
  };
}

async function getActiveProjectIds(): Promise<string[]> {
  const { data } = await admin.from("ai_rop_settings").select("project_id");
  return Array.from(new Set((data ?? []).map((r) => r.project_id).filter(Boolean) as string[]));
}

function tallyTop(arr: string[], n = 10): { name: string; count: number }[] {
  const map = new Map<string, number>();
  for (const x of arr) {
    const k = String(x ?? "").trim().toLowerCase();
    if (!k) continue;
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

async function generateForProject(projectId: string): Promise<{
  ok: boolean;
  idea_id?: string;
  reason?: string;
}> {
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();

  const [callsRes, chatsRes, settingsRes, existingRes] = await Promise.all([
    admin
      .from("ai_rop_call_analyses")
      .select("lead_id, topics, objections")
      .eq("project_id", projectId)
      .gte("call_at", since)
      .limit(500),
    admin
      .from("ai_rop_chat_analyses")
      .select("lead_id, topics, objections")
      .eq("project_id", projectId)
      .gte("processed_at", since)
      .limit(500),
    admin
      .from("ai_rop_settings")
      .select("system_prompt, tone, auto_generate_content")
      .eq("project_id", projectId)
      .maybeSingle(),
    admin
      .from("ai_rop_content_ideas")
      .select("title")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  const calls = callsRes.data ?? [];
  const chats = chatsRes.data ?? [];
  const total = calls.length + chats.length;
  if (total < 1) return { ok: false, reason: "no_analyses" };

  const topics: string[] = [];
  const objections: string[] = [];
  const leadIds = new Set<string>();
  for (const row of [...calls, ...chats] as any[]) {
    for (const t of row.topics ?? []) topics.push(t);
    for (const o of row.objections ?? []) objections.push(o);
    if (row.lead_id) leadIds.add(row.lead_id);
  }

  const topTopics = tallyTop(topics, 10);
  const topObjections = tallyTop(objections, 10);
  if (topTopics.length === 0 && topObjections.length === 0) {
    return { ok: false, reason: "no_signals" };
  }

  const existing = (existingRes.data ?? []).map((r) => r.title);
  const settings = (settingsRes.data ?? {}) as any;
  const tone = settings.tone ?? "neutral";
  const systemPrompt =
    settings.system_prompt ??
    "Ты — SMM-стратег для частной клиники. Придумываешь короткий, цепляющий контент.";

  const prompt =
    `Топ-10 тем разговоров за 30 дней (тема — сколько раз):\n` +
    topTopics.map((t) => `- ${t.name} (${t.count})`).join("\n") +
    `\n\nТоп-10 возражений клиентов:\n` +
    topObjections.map((o) => `- ${o.name} (${o.count})`).join("\n") +
    `\n\nУже есть идеи (не дублируй):\n${existing.slice(0, 15).join(" | ") || "нет"}\n\n` +
    `Тон: ${tone}.\n\n` +
    `Придумай ОДНУ идею контента, которая закрывает самое острое возражение или раскрывает горячую тему.\n` +
    `Ответ строго в формате:\n` +
    `FORMAT: <reels | post | story | article | video>\n` +
    `PRIORITY: <high | mid | low>\n` +
    `TITLE: <заголовок до 80 символов>\n` +
    `HOOK: <зацепляющая фраза в одну строку>\n` +
    `BODY: <тезисы и идея, 2-4 предложения>\n` +
    `AUDIENCE: <целевая аудитория>\n` +
    `CTA: <призыв к действию>\n` +
    `BASED_ON: <название темы или возражения из списка выше>`;

  const raw = await callLLM(prompt, systemPrompt);
  const parsed = parseIdea(raw);

  const { data: inserted, error: insertErr } = await admin
    .from("ai_rop_content_ideas")
    .insert({
      project_id: projectId,
      title: parsed.title,
      format: parsed.format,
      priority: parsed.priority,
      hook: parsed.hook,
      body: parsed.body,
      audience: parsed.audience,
      cta: parsed.cta,
      based_on: parsed.based_on,
      status: "idea",
      source_lead_ids: Array.from(leadIds).slice(0, 20),
    })
    .select("id, title, format, priority, hook, body, audience, cta, based_on, status, source_lead_ids, created_at, updated_at")
    .maybeSingle();

  if (insertErr) {
    console.error("[ai-rop-generate-content] insert error", insertErr);
    return { ok: false, reason: insertErr.message };
  }

  return { ok: true, idea_id: inserted?.id, ...(inserted as any) };
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
    const projects = await getActiveProjectIds();
    const results: Array<{ project_id: string; ok: boolean; reason?: string; idea_id?: string }> = [];
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
    console.error("[ai-rop-generate-content]", e);
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});
