// Генерирует одноразовый код привязки Telegram к ПРОЕКТУ (клиенту).
// Пользователь отправляет боту «/link КОД» — и чат привязывается к этому проекту.
import { AUTH_CORS_HEADERS, requireProjectAccess, requireUser } from "../_lib/auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...AUTH_CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// Код без похожих символов (0/O/1/I), 6 знаков.
function makeCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return s;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: AUTH_CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  let body: { project_id?: string; action?: "status" | "create" | "unlink" };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const projectId = String(body.project_id ?? "").trim();
  if (!projectId) return json({ error: "project_id required" }, 400);

  const access = await requireProjectAccess(auth.authHeader, projectId);
  if (!access.ok) return access.response;

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const action = body.action ?? "create";
  if (!["status", "create", "unlink"].includes(action)) {
    return json({ error: "Unsupported action" }, 400);
  }
  const botUser = Deno.env.get("TELEGRAM_BOT_USERNAME") ?? "";

  if (action === "status") {
    const { data, error } = await admin
      .from("telegram_links")
      .select("chat_id, username, linked_at")
      .eq("project_id", projectId)
      .order("linked_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    return json({
      connected: !!data,
      destination: data
        ? {
            chat_id_last4: String(data.chat_id).slice(-4),
            username: data.username,
            linked_at: data.linked_at,
          }
        : null,
      bot_username: botUser || null,
      bot_url: botUser ? `https://t.me/${botUser}` : null,
    });
  }

  if (action === "unlink") {
    const { error } = await admin.from("telegram_links").delete().eq("project_id", projectId);
    if (error) return json({ error: error.message }, 500);
    return json({ connected: false });
  }

  const code = makeCode();
  const { error } = await admin
    .from("telegram_link_codes")
    .insert({
      code,
      project_id: projectId,
      created_by: auth.userId,
      expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    });
  if (error) return json({ error: error.message }, 500);

  return json({
    code,
    command: `/link ${code}`,
    deep_link: botUser ? `https://t.me/${botUser}?start=${code}` : null,
    expires_in_minutes: 15,
  });
});
