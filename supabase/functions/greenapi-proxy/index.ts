// Green API proxy edge function
// Actions: status, qr, getCode, logout
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const ID = Deno.env.get("GREENAPI_ID_INSTANCE") ?? "";
const TOKEN = Deno.env.get("GREENAPI_API_TOKEN") ?? "";
const RAW_URL = Deno.env.get("GREENAPI_API_URL") ?? "https://api.green-api.com";
const BASE = RAW_URL.replace(/\/+$/, "");

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function callGreen(path: string, init?: RequestInit) {
  const url = `${BASE}/waInstance${ID}/${path}/${TOKEN}`;
  const res = await fetch(url, init);
  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { ok: res.ok, status: res.status, data };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!ID || !TOKEN) {
    return json(
      { error: "Green API credentials are not configured on the server" },
      500,
    );
  }

  try {
    const url = new URL(req.url);
    const action =
      url.searchParams.get("action") ??
      (req.method === "POST"
        ? ((await req.clone().json().catch(() => ({}))) as { action?: string })
            .action
        : null);

    switch (action) {
      case "status": {
        const r = await callGreen("getStateInstance");
        return json({ ok: r.ok, status: r.status, data: r.data });
      }
      case "qr": {
        const r = await callGreen("qr");
        return json({ ok: r.ok, status: r.status, data: r.data });
      }
      case "getCode": {
        const body = (await req.json().catch(() => ({}))) as {
          phoneNumber?: string | number;
          action?: string;
        };
        const phoneRaw = String(body.phoneNumber ?? "").replace(/\D/g, "");
        if (!phoneRaw || phoneRaw.length < 8 || phoneRaw.length > 15) {
          return json({ error: "Invalid phone number" }, 400);
        }
        const r = await callGreen("getAuthorizationCode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phoneNumber: Number(phoneRaw) }),
        });
        return json({ ok: r.ok, status: r.status, data: r.data });
      }
      case "logout": {
        const r = await callGreen("logout");
        return json({ ok: r.ok, status: r.status, data: r.data });
      }
      case "settings": {
        const r = await callGreen("getSettings");
        return json({ ok: r.ok, status: r.status, data: r.data });
      }
      case "setWebhook": {
        const body = (await req.json().catch(() => ({}))) as {
          webhookUrl?: string;
          action?: string;
        };
        const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
        const defaultUrl = SUPABASE_URL
          ? `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/greenapi-webhook`
          : "";
        const webhookUrl = String(body.webhookUrl || defaultUrl).trim();
        if (!webhookUrl.startsWith("http")) {
          return json({ error: "Invalid webhook URL" }, 400);
        }
        const r = await callGreen("setSettings", {
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
        return json({ ok: r.ok, status: r.status, data: r.data });
      }
      case "sendMessage": {
        const body = (await req.json().catch(() => ({}))) as {
          phone?: string;
          message?: string;
          action?: string;
        };
        const phoneRaw = String(body.phone ?? "").replace(/\D/g, "");
        const message = String(body.message ?? "").trim();
        if (!phoneRaw || phoneRaw.length < 8 || phoneRaw.length > 15) {
          return json({ error: "Invalid phone number" }, 400);
        }
        if (!message) return json({ error: "Empty message" }, 400);
        const r = await callGreen("sendMessage", {
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
