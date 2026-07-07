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

  let body: { project_id?: string };
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

  const botUser = Deno.env.get("TELEGRAM_BOT_USERNAME") ?? "";
  return json({
    code,
    command: `/link ${code}`,
    deep_link: botUser ? `https://t.me/${botUser}?start=${code}` : null,
    expires_in_minutes: 15,
  });
});
