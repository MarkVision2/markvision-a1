// ai-rop-backfill-chats
// Догоняет ai_rop_chat_analyses для лидов с ≥2 сообщениями, у которых ещё
// нет анализа. Идёт пачками с ограничением параллелизма.
//
// Вход:  { project_id: string }
// Auth:  пользовательский JWT (через user JWT) ЛИБО внутренний вызов с
//        x-internal-key = SUPABASE_SERVICE_ROLE_KEY (cron/системные хуки).
// Ответ: { ok, eligible, queued }
//
// Внутри — fan-out к ai-rop-analyze-chat (service-role).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireProjectAccess } from "../_lib/auth.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-internal-key",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CONCURRENCY = 3;
const THROTTLE_MS = 500;
const PAGE_SIZE = 1000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function isAuthorized(req: Request): Promise<boolean> {
  // Внутренний вызов (другие edge-функции).
  if (req.headers.get("x-internal-key") === SERVICE_KEY) return true;
  // Cron-вызов: сравниваем заголовок с automation_settings.cron_secret.
  const cronSecret = req.headers.get("x-cron-secret");
  if (cronSecret) {
    const { data } = await admin
      .from("automation_settings")
      .select("cron_secret")
      .maybeSingle();
    if (data?.cron_secret && data.cron_secret === cronSecret) return true;
  }
  // Пользовательский JWT — должен быть валиден.
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : auth;
  if (!token) return false;
  const { data, error } = await admin.auth.getUser(token);
  return !error && !!data.user;
}

async function listEligibleLeadIds(projectId: string): Promise<string[]> {
  // 1) Лиды проекта (постранично).
  const leadIds = new Set<string>();
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await admin
      .from("leads")
      .select("id")
      .eq("project_id", projectId)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data?.length) break;
    for (const r of data) leadIds.add(r.id as string);
    if (data.length < PAGE_SIZE) break;
  }
  if (!leadIds.size) return [];

  // 2) Лиды, у которых уже есть анализ — исключаем.
  const analyzed = new Set<string>();
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await admin
      .from("ai_rop_chat_analyses")
      .select("lead_id")
      .eq("project_id", projectId)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data?.length) break;
    for (const r of data) if (r.lead_id) analyzed.add(r.lead_id as string);
    if (data.length < PAGE_SIZE) break;
  }

  // 3) Считаем communications по каждому лиду — берём те, где ≥2 и без анализа.
  // RPC на больших объёмах был бы лучше, но обходимся client-side агрегацией:
  // тянем все строки communications для известных лидов и считаем в памяти.
  const counts = new Map<string, number>();
  const idsArr = Array.from(leadIds).filter((id) => !analyzed.has(id));
  const CHUNK = 500;
  for (let i = 0; i < idsArr.length; i += CHUNK) {
    const slice = idsArr.slice(i, i + CHUNK);
    const { data, error } = await admin
      .from("communications")
      .select("lead_id", { count: "exact", head: false })
      .in("lead_id", slice)
      .eq("is_draft", false);
    if (error) throw error;
    for (const r of data ?? []) {
      const k = r.lead_id as string;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }

  const eligible: string[] = [];
  for (const [id, n] of counts.entries()) if (n >= 2) eligible.push(id);
  return eligible;
}

async function triggerAnalyze(leadId: string, projectId: string) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/ai-rop-analyze-chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-key": SERVICE_KEY,
    },
    body: JSON.stringify({ lead_id: leadId, project_id: projectId }),
  });
  // Consume body to avoid resource leaks in Deno.
  try { await res.text(); } catch { /* noop */ }
  return res.ok;
}

async function runPool<T>(items: T[], worker: (it: T) => Promise<void>) {
  let cursor = 0;
  const runners: Promise<void>[] = [];
  for (let i = 0; i < Math.min(CONCURRENCY, items.length); i++) {
    runners.push((async () => {
      while (cursor < items.length) {
        const idx = cursor++;
        try { await worker(items[idx]); } catch (e) { console.warn("worker err:", e); }
        await new Promise((r) => setTimeout(r, THROTTLE_MS));
      }
    })());
  }
  await Promise.all(runners);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  if (!(await isAuthorized(req))) return json({ error: "Unauthorized" }, 401);

  let body: { project_id?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const projectId = body.project_id;
  if (!projectId || typeof projectId !== "string") {
    return json({ error: "project_id is required" }, 400);
  }

  const isPrivileged =
    req.headers.get("x-internal-key") === SERVICE_KEY || !!req.headers.get("x-cron-secret");
  if (!isPrivileged) {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const access = await requireProjectAccess(authHeader, projectId);
    if (!access.ok) return access.response;
  }

  try {
    const eligible = await listEligibleLeadIds(projectId);
    if (!eligible.length) return json({ ok: true, eligible: 0, queued: 0 });

    let queued = 0;
    await runPool(eligible, async (leadId) => {
      const ok = await triggerAnalyze(leadId, projectId);
      if (ok) queued++;
    });

    return json({ ok: true, eligible: eligible.length, queued });
  } catch (e) {
    console.error("backfill failed:", e);
    return json({ ok: false, error: String((e as Error).message ?? e) }, 500);
  }
});
