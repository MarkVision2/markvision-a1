// Broadcast groups — помощник для рассылок со вступлением в WhatsApp-группу.
//   action "list"   → список групп, где состоит номер (для выбора цели);
//   action "invite" → пригласительная ссылка группы (для {ссылка} в тексте).
// Возвращает chatId группы (…@g.us) — по нему broadcast-group-sync считает
// реальные вступления. Auth: авторизованный участник проекта.
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import {
  DEFAULT_GREEN_API_BASE_URL,
  validateGreenApiBaseUrl,
} from "../_lib/green_api_url.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getUserId(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization") ?? "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt || !ANON_KEY) return null;
  try {
    const c = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data } = await c.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const userId = await getUserId(req);
  if (!userId) return json({ error: "Unauthorized" }, 401);

  const body = (await req.json().catch(() => ({}))) as { project_id?: string; action?: string; groupId?: string };
  const projectId = typeof body.project_id === "string" ? body.project_id : null;
  const action = body.action === "invite" ? "invite" : "list";
  if (!projectId) return json({ error: "project_id required" }, 400);

  const { data: proj } = await admin.from("projects").select("id, created_by").eq("id", projectId).maybeSingle();
  const { data: isAdmin } = await admin.rpc("has_role" as never, { _user_id: userId, _role: "admin" });
  const allowed = !!proj && ((proj as { created_by?: string }).created_by === userId || isAdmin === true);
  if (!allowed) return json({ error: "Forbidden" }, 403);

  const { data: cfg } = await admin
    .from("whatsapp_config").select("id_instance, api_token, api_url").eq("project_id", projectId).maybeSingle();
  const wc = cfg as { id_instance?: string; api_token?: string; api_url?: string } | null;
  if (!wc?.id_instance || !wc.api_token) return json({ error: "WhatsApp не подключён" }, 400);

  let baseUrl = DEFAULT_GREEN_API_BASE_URL;
  try { baseUrl = validateGreenApiBaseUrl(wc.api_url ?? ""); } catch { /* default */ }
  const base = `${baseUrl}/waInstance${wc.id_instance}`;

  if (action === "invite") {
    const groupId = typeof body.groupId === "string" ? body.groupId : "";
    if (!groupId) return json({ error: "groupId required" }, 400);
    const res = await fetch(`${base}/getGroupInviteLink/${wc.api_token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId }),
    });
    const data = await res.json().catch(() => null) as { inviteLink?: string } | null;
    if (!res.ok || !data?.inviteLink) return json({ error: "Не удалось получить ссылку группы" }, 502);
    return json({ inviteLink: data.inviteLink });
  }

  // list: контакты номера → только группы.
  const res = await fetch(`${base}/getContacts/${wc.api_token}`, { method: "GET" });
  if (!res.ok) return json({ error: "Не удалось получить группы" }, 502);
  const contacts = await res.json().catch(() => []) as { id?: string; name?: string; type?: string }[];
  const groups = (Array.isArray(contacts) ? contacts : [])
    .filter((c) => c.type === "group" || String(c.id ?? "").endsWith("@g.us"))
    .map((c) => ({ id: String(c.id ?? ""), name: (c.name ?? "").trim() || String(c.id ?? "") }))
    .filter((g) => g.id.endsWith("@g.us"));

  return json({ groups });
});
