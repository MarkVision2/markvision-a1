// Broadcast group sync — детект реального вступления в WhatsApp-группу.
//
// Для кампаний с привязанной группой (broadcast_campaigns.group_id = …@g.us)
// опрашивает у Green состав группы (getGroupData), матчит участников с
// получателями по телефону и проставляет joined_at. Так мы видим, сколько
// человек из рассылки РЕАЛЬНО вступили в группу (а не просто перешли).
//
// Запускается pg_cron раз в 5 минут. Auth: x-automation-key == cron_secret.
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import {
  DEFAULT_GREEN_API_BASE_URL,
  validateGreenApiBaseUrl,
} from "../_lib/green_api_url.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-automation-key",
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

function digits(s: string | null | undefined): string {
  return String(s ?? "").replace(/\D/g, "");
}

type Creds = { idInstance: string; apiToken: string; baseUrl: string };

async function resolveCreds(projectId: string): Promise<Creds | null> {
  const { data } = await admin
    .from("whatsapp_config")
    .select("id_instance, api_token, api_url")
    .eq("project_id", projectId)
    .maybeSingle();
  const row = data as { id_instance?: string; api_token?: string; api_url?: string } | null;
  if (!row?.id_instance || !row.api_token) return null;
  let baseUrl = DEFAULT_GREEN_API_BASE_URL;
  try { baseUrl = validateGreenApiBaseUrl(row.api_url ?? ""); } catch { return null; }
  return { idInstance: row.id_instance, apiToken: (row.api_token ?? "").trim(), baseUrl };
}

/** Состав группы у Green → множество телефонов-цифр участников. */
async function groupParticipants(creds: Creds, groupId: string): Promise<Set<string> | null> {
  try {
    const url = `${creds.baseUrl}/waInstance${creds.idInstance}/getGroupData/${creds.apiToken}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId }),
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null) as
      | { participants?: { id?: string }[] }
      | null;
    const parts = data?.participants;
    if (!Array.isArray(parts)) return null;
    const set = new Set<string>();
    for (const p of parts) {
      const d = digits(p?.id);
      if (d.length >= 8) set.add(d);
    }
    return set;
  } catch {
    return null;
  }
}

async function authorize(req: Request): Promise<boolean> {
  const { data } = await admin.from("automation_settings").select("cron_secret").eq("id", true).maybeSingle();
  const secret = (data as { cron_secret?: string } | null)?.cron_secret ?? null;
  const provided = req.headers.get("x-automation-key");
  if (secret && provided && provided === secret) return true;
  const auth = req.headers.get("Authorization") ?? "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (jwt && ANON_KEY) {
    const uc = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user } } = await uc.auth.getUser();
    if (user?.id) {
      const { data: role } = await admin.from("user_roles").select("role")
        .eq("user_id", user.id).eq("role", "admin").maybeSingle();
      if (role) return true;
    }
  }
  return false;
}

type Campaign = { id: string; project_id: string; group_id: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!(await authorize(req))) return json({ error: "unauthorized" }, 401);

  // Кампании с группой, активные/недавние.
  const since = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
  const { data: camps } = await admin
    .from("broadcast_campaigns")
    .select("id, project_id, group_id")
    .not("group_id", "is", null)
    .in("status", ["sending", "sent", "partial"])
    .gte("updated_at", since);

  const campaigns = (camps ?? []) as Campaign[];
  if (campaigns.length === 0) return json({ ok: true, note: "no group campaigns" });

  // Группируем: project → group → [campaignIds].
  const byProject = new Map<string, Map<string, string[]>>();
  for (const c of campaigns) {
    if (!byProject.has(c.project_id)) byProject.set(c.project_id, new Map());
    const g = byProject.get(c.project_id)!;
    if (!g.has(c.group_id)) g.set(c.group_id, []);
    g.get(c.group_id)!.push(c.id);
  }

  let marked = 0;
  const credsCache = new Map<string, Creds | null>();

  for (const [projectId, groups] of byProject) {
    if (!credsCache.has(projectId)) credsCache.set(projectId, await resolveCreds(projectId));
    const creds = credsCache.get(projectId) ?? null;
    if (!creds) continue;

    for (const [groupId, campaignIds] of groups) {
      const members = await groupParticipants(creds, groupId);
      if (!members || members.size === 0) continue;

      // Кандидаты: получатели этих кампаний без joined_at.
      const { data: recs } = await admin
        .from("broadcast_recipients")
        .select("id, phone")
        .in("campaign_id", campaignIds)
        .is("joined_at", null)
        .limit(20000);
      const toMark = (recs ?? [])
        .filter((r) => members.has(digits((r as { phone: string }).phone)))
        .map((r) => (r as { id: string }).id);

      for (let i = 0; i < toMark.length; i += 500) {
        const chunk = toMark.slice(i, i + 500);
        await admin.from("broadcast_recipients")
          .update({ joined_at: new Date().toISOString() })
          .in("id", chunk);
        marked += chunk.length;
      }
    }
  }

  return json({ ok: true, marked, ran_at: new Date().toISOString() });
});
