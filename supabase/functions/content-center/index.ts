// API раздела «Контент-центр» (аналитика Instagram-автоворонки cf_*).
// Один эндпоинт: посты с метриками + KPI + воронка за период — строго по
// одному проекту.
//
// Изоляция по проекту (ВАЖНО): cf_* и служебные метрики закрыты RLS и читаются
// только под service role, поэтому функция ОБЯЗАНА сама проверить, что
// вызывающий пользователь имеет доступ к project_id (requireProjectAccess по
// его JWT), и передать p_project_id в RPC. Без этого раздел показывал бы посты
// и воронку чужих аккаунтов (других проектов).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { requireUser, requireProjectAccess } from "../_lib/auth.ts";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
function ymd(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  // 1) Аутентификация пользователя.
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  // 2) Параметры запроса.
  const url = new URL(req.url);
  let from = url.searchParams.get("from");
  let to = url.searchParams.get("to");
  let projectId = url.searchParams.get("project_id");
  if (req.method === "POST") {
    const b = await req.json().catch(() => ({} as Record<string, unknown>));
    from = (b.from as string) ?? from;
    to = (b.to as string) ?? to;
    projectId = (b.project_id as string) ?? projectId;
  }

  // 3) Проект обязателен и должен быть доступен пользователю (RLS по его JWT).
  if (!projectId) return json({ error: "project_id required" }, 400);
  const access = await requireProjectAccess(auth.authHeader, projectId);
  if (!access.ok) return access.response;

  // По умолчанию — текущий месяц (UTC).
  const now = new Date();
  if (!from) from = ymd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
  if (!to) to = ymd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)));

  // Валидация формата YYYY-MM-DD.
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(from) || !re.test(to)) return json({ error: "bad_period", from, to }, 400);

  // 4) Данные считает RPC под service role, но строго по p_project_id.
  const admin = createClient(SB_URL, SB_KEY);
  const { data, error } = await admin.rpc("cf_content_center", {
    p_from: from,
    p_to: to,
    p_project_id: projectId,
  });
  if (error) return json({ error: "rpc_failed", detail: error.message }, 500);
  return json(data ?? { from, to, posts: [], totals: {}, funnel: {} });
});
