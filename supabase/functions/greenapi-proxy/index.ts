// Green API proxy edge function — per-project routing.
//
// Each project has its own Green API instance bound via whatsapp_config
// (id_instance, api_token, api_url). Calls resolve credentials from that
// row and only fall back to GREENAPI_* env vars when the project has no
// binding (legacy single-tenant behaviour).
//
// Actions: status, qr, getCode, logout, settings, setWebhook, sendMessage.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import {
  DEFAULT_GREEN_API_BASE_URL,
  validateGreenApiBaseUrl,
} from "../_lib/green_api_url.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const ENV_ID = Deno.env.get("GREENAPI_ID_INSTANCE") ?? "";
const ENV_TOKEN = Deno.env.get("GREENAPI_API_TOKEN") ?? "";
const ENV_URL = Deno.env.get("GREENAPI_API_URL") ?? DEFAULT_GREEN_API_BASE_URL;

const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Creds = {
  source: "db" | "env";
  rowId: string | null;
  projectId: string | null;
  idInstance: string;
  apiToken: string;
  baseUrl: string;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function resolveGreenApiBaseUrl(
  u: string | null | undefined,
): string | { error: string; status: number } {
  try {
    return validateGreenApiBaseUrl(u?.trim() ? u : ENV_URL);
  } catch (e) {
    return { error: (e as Error).message, status: 400 };
  }
}

async function getUserId(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!auth || !ANON_KEY) return null;
  try {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data } = await userClient.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

/** Resolve credentials. Requires authenticated user; verifies project membership. */
async function resolveCreds(
  req: Request,
  bodyProjectId: string | null,
): Promise<Creds | { error: string; status: number }> {
  // SECURITY: always require a valid JWT — no anonymous access regardless of body.
  const userId = await getUserId(req);
  if (!userId) {
    return { error: "Unauthorized", status: 401 };
  }

  let projectId = bodyProjectId;
  if (!projectId) {
    const { data } = await admin
      .from("user_active_project")
      .select("project_id")
      .eq("user_id", userId)
      .maybeSingle();
    projectId = data?.project_id ?? null;
  }

  if (projectId) {
    // Verify ownership/membership of the project before exposing credentials.
    const { data: proj } = await admin
      .from("projects")
      .select("id, created_by")
      .eq("id", projectId)
      .maybeSingle();
    const { data: isAdmin } = await admin.rpc("has_role" as any, {
      _user_id: userId, _role: "admin",
    });
    const allowed = !!proj && (proj.created_by === userId || isAdmin === true);
    if (!allowed) {
      return { error: "Forbidden", status: 403 };
    }

    const { data: row } = await admin
      .from("whatsapp_config")
      .select("id, project_id, id_instance, api_token, api_url")
      .eq("project_id", projectId)
      .maybeSingle();

    if (row?.id_instance) {
      const baseUrlOrErr = resolveGreenApiBaseUrl(row.api_url);
      if (typeof baseUrlOrErr !== "string") {
        return baseUrlOrErr;
      }
      const apiToken = (row.api_token ?? "").trim();
      if (!apiToken) {
        if (ENV_TOKEN && row.id_instance === ENV_ID) {
          return {
            source: "db",
            rowId: row.id,
            projectId: row.project_id,
            idInstance: row.id_instance,
            apiToken: ENV_TOKEN,
            baseUrl: baseUrlOrErr,
          };
        }
        return {
          error:
            "API-токен Green API для этого проекта не задан. Откройте «Настройки → Подключение WhatsApp» и введите apiTokenInstance из Green API console.",
          status: 400,
        };
      }
      return {
        source: "db",
        rowId: row.id,
        projectId: row.project_id,
        idInstance: row.id_instance,
        apiToken,
        baseUrl: baseUrlOrErr,
      };
    }
  }

  // ENV fallback only for admins (legacy single-tenant ops).
  const { data: isAdmin } = await admin.rpc("has_role" as any, {
    _user_id: userId, _role: "admin",
  });
  if (isAdmin === true && ENV_ID && ENV_TOKEN) {
    const baseUrlOrErr = resolveGreenApiBaseUrl(ENV_URL);
    if (typeof baseUrlOrErr !== "string") {
      return baseUrlOrErr;
    }
    return {
      source: "env",
      rowId: null,
      projectId,
      idInstance: ENV_ID,
      apiToken: ENV_TOKEN,
      baseUrl: baseUrlOrErr,
    };
  }

  return {
    error:
      "Green API не настроен: привяжите инстанс к проекту в «Настройках → Подключение WhatsApp» (idInstance + apiTokenInstance из Green API console).",
    status: 400,
  };
}

async function callGreen(
  creds: Creds,
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const url =
    `${creds.baseUrl}/waInstance${creds.idInstance}/${path}/${creds.apiToken}`;
  const res = await fetch(url, init);
  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* keep raw text */
  }
  return { ok: res.ok, status: res.status, data };
}

/** After a successful state poll, push the live state back into the bound row
 * so the UI doesn't show a stale "подключён" badge. Best-effort. */
async function syncState(
  creds: Creds,
  stateInstance: string | null,
  phoneFromSettings?: string | null,
) {
  if (!creds.rowId) return;
  const isAuth = stateInstance === "authorized";
  const patch: Record<string, unknown> = {
    connected: isAuth,
    updated_at: new Date().toISOString(),
  };
  if (isAuth) patch.connected_at = new Date().toISOString();
  if (phoneFromSettings) patch.phone = phoneFromSettings;
  await admin.from("whatsapp_config").update(patch).eq("id", creds.rowId);
}

/** Green API getWaSettings returns `{ wid: "77051234567@c.us", ... }`. */
function widToPhone(wid: unknown): string | null {
  const s = String(wid ?? "").replace(/\D/g, "");
  if (s.length < 8) return null;
  return `+${s}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Read action + body once. The same JSON body carries action + payload
    // for POST calls; GET fallback uses ?action=… query string.
    const url = new URL(req.url);
    let body: Record<string, unknown> = {};
    if (req.method === "POST") {
      body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    }
    const action =
      (body.action as string | undefined) ??
      url.searchParams.get("action") ??
      "";

    const projectId =
      typeof body.project_id === "string" && body.project_id
        ? body.project_id
        : null;

    const credsOrErr = await resolveCreds(req, projectId);
    if ("error" in credsOrErr) {
      return json({ error: credsOrErr.error, code: "NO_CREDENTIALS" }, credsOrErr.status);
    }
    const creds = credsOrErr;

    switch (action) {
      case "status": {
        const r = await callGreen(creds, "getStateInstance");
        const stateInstance =
          (r.data as { stateInstance?: string } | null)?.stateInstance ?? null;
        let phone: string | null = null;
        if (stateInstance === "authorized") {
          // Pull phone (wid) once we know the instance is logged in.
          const ws = await callGreen(creds, "getWaSettings").catch(() => null);
          phone =
            widToPhone(
              (ws?.data as { wid?: string } | null | undefined)?.wid,
            ) ?? null;
        }
        await syncState(creds, stateInstance, phone);
        return json({
          ok: r.ok,
          status: r.status,
          data: r.data,
          meta: {
            source: creds.source,
            id_instance: creds.idInstance,
            project_id: creds.projectId,
            phone,
          },
        });
      }

      case "qr": {
        const r = await callGreen(creds, "qr");
        return json({ ok: r.ok, status: r.status, data: r.data });
      }

      case "getCode": {
        const phoneRaw = String(body.phoneNumber ?? "").replace(/\D/g, "");
        if (!phoneRaw || phoneRaw.length < 8 || phoneRaw.length > 15) {
          return json({ error: "Invalid phone number" }, 400);
        }
        const r = await callGreen(creds, "getAuthorizationCode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phoneNumber: Number(phoneRaw) }),
        });
        return json({ ok: r.ok, status: r.status, data: r.data });
      }

      case "logout": {
        const r = await callGreen(creds, "logout");
        // Logout reliably means the device is no longer authorized.
        await syncState(creds, "notAuthorized", null);
        return json({ ok: r.ok, status: r.status, data: r.data });
      }

      case "settings": {
        const r = await callGreen(creds, "getSettings");
        return json({ ok: r.ok, status: r.status, data: r.data });
      }

      case "setWebhook": {
        const defaultUrl = SUPABASE_URL
          ? `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/greenapi-webhook`
          : "";
        const webhookUrl = String(body.webhookUrl || defaultUrl).trim();
        if (!webhookUrl.startsWith("http")) {
          return json({ error: "Invalid webhook URL" }, 400);
        }
        const r = await callGreen(creds, "setSettings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            webhookUrl,
            webhookUrlToken: "",
            outgoingWebhook: "yes",
            outgoingMessageWebhook: "yes",
            outgoingAPIMessageWebhook: "yes",
            incomingWebhook: "yes",
            stateWebhook: "yes",
          }),
        });
        if (r.ok && creds.rowId) {
          await admin.from("whatsapp_config").update({
            webhook_url: webhookUrl,
            updated_at: new Date().toISOString(),
          }).eq("id", creds.rowId);
        }
        return json({ ok: r.ok, status: r.status, data: r.data, webhookUrl });
      }

      case "sendMessage": {
        const phoneRaw = String(body.phone ?? "").replace(/\D/g, "");
        const message = String(body.message ?? "").trim();
        if (!phoneRaw || phoneRaw.length < 8 || phoneRaw.length > 15) {
          return json({ error: "Invalid phone number" }, 400);
        }
        if (!message) return json({ error: "Empty message" }, 400);
        const r = await callGreen(creds, "sendMessage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chatId: `${phoneRaw}@c.us`,
            message,
          }),
        });
        return json({ ok: r.ok, status: r.status, data: r.data });
      }

      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
