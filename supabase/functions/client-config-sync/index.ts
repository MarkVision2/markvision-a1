// Синхронизация кабинета в client_configs внешнего клиентского проекта.
// Фронт не может писать туда напрямую (другой проект + RLS), поэтому шлёт
// cabinet_id сюда: функция проверяет доступ пользователя к проекту кабинета
// и зеркалит строку сервисным ключом внешнего проекта.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { AUTH_CORS_HEADERS, requireProjectAccess, requireUser } from "../_lib/auth.ts";
import {
  deleteClientConfig,
  getClientConfigDb,
  toClientConfigRow,
  upsertClientConfig,
} from "../_lib/clientConfig.ts";

const corsHeaders = AUTH_CORS_HEADERS;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = await requireUser(req);
    if (!auth.ok) return auth.response;

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const cabinetId = String(body.cabinet_id ?? "").trim();
    const action = String(body.action ?? "upsert");
    if (!cabinetId) return json({ error: "cabinet_id обязателен" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: cab } = await admin
      .from("ad_cabinets")
      .select("*")
      .eq("id", cabinetId)
      .maybeSingle();

    // Для удаления кабинет уже мог быть удалён — тогда проверяем project_id из тела.
    const projectId = String(
      (cab as { project_id?: string } | null)?.project_id ?? body.project_id ?? "",
    ).trim();
    if (!projectId) return json({ error: "project_id обязателен" }, 400);

    const access = await requireProjectAccess(auth.authHeader, projectId);
    if (!access.ok) return access.response;

    if (action === "delete") {
      const res = await deleteClientConfig(cabinetId);
      return json({ ok: res.ok, error: res.error }, res.ok ? 200 : 502);
    }

    if (!cab) return json({ error: "Кабинет не найден" }, 404);

    const row = cab as Record<string, unknown>;
    const token = typeof row.access_token === "string" && row.access_token.trim()
      ? row.access_token.trim()
      : null;
    const res = await upsertClientConfig(toClientConfigRow(cabinetId, row, token));
    if (!res.ok) return json({ ok: false, error: res.error }, 502);

    // Читаем обратно — чтобы фронт/лог видел, что строка реально легла.
    const db = getClientConfigDb();
    const { data: mirrored } = db
      ? await db
        .from("client_configs")
        .select("cabinet_id, name, ad_account_id, page_id, instagram_id, pixel_id")
        .eq("cabinet_id", cabinetId)
        .maybeSingle()
      : { data: null };
    return json({ ok: true, client_config: mirrored ?? null });

  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});
