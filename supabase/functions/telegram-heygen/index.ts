// Telegram webhook → HeyGen Video Agent.
// Сценарий из чата → генерация видео с дефолтными аватаром/голосом пользователя.
// Привязка чата к аккаунту: пользователь шлёт «/link КОД» (код из приложения).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const HEYGEN_BASE = "https://api.heygen.com";

function ok() {
  // Telegram нужен быстрый 200, иначе он ретраит апдейт.
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function tg(method: string, body: Record<string, unknown>) {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {});
}

const send = (chatId: number | string, text: string) => tg("sendMessage", { chat_id: chatId, text });

Deno.serve(async (req) => {
  if (req.method !== "POST") return ok();

  // Защита вебхука секретом (устанавливается при setWebhook).
  const expected = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
  if (expected && req.headers.get("x-telegram-bot-api-secret-token") !== expected) {
    return new Response("forbidden", { status: 403 });
  }

  let update: Record<string, unknown>;
  try {
    update = await req.json();
  } catch {
    return ok();
  }

  const message = (update.message ?? update.edited_message) as Record<string, unknown> | undefined;
  const chat = message?.chat as { id: number } | undefined;
  const text = (message?.text as string | undefined)?.trim();
  const from = message?.from as { username?: string } | undefined;
  if (!chat || !text) return ok();

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const chatId = String(chat.id);

  // ── Привязка аккаунта: /start КОД или /link КОД ───────────────────────────
  if (text.startsWith("/start") || text.startsWith("/link")) {
    const code = text.split(/\s+/)[1]?.toUpperCase();
    if (!code) {
      await send(chat.id, "Привет! Чтобы привязать аккаунт, откройте раздел AI монтаж в приложении, получите код и пришлите: /link КОД");
      return ok();
    }
    const { data: row } = await admin
      .from("telegram_link_codes")
      .select("project_id, used, expires_at")
      .eq("code", code)
      .maybeSingle();
    if (!row || row.used || new Date(row.expires_at as string) < new Date()) {
      await send(chat.id, "Код неверный или истёк. Получите новый код в приложении.");
      return ok();
    }
    await admin.from("telegram_links").upsert({ chat_id: chatId, project_id: row.project_id, username: from?.username ?? null });
    await admin.from("telegram_link_codes").update({ used: true }).eq("code", code);
    await send(chat.id, "Готово! Этот чат привязан к проекту. Теперь пришлите сценарий текстом — соберу видео и отправлю сюда.");
    return ok();
  }

  // ── Сценарий → Video Agent ────────────────────────────────────────────────
  const { data: link } = await admin
    .from("telegram_links")
    .select("project_id")
    .eq("chat_id", chatId)
    .maybeSingle();
  if (!link) {
    await send(chat.id, "Сначала привяжите чат к проекту: получите код в приложении (AI монтаж) и пришлите /link КОД.");
    return ok();
  }

  const apiKey = Deno.env.get("HEYGEN_API_KEY");
  if (!apiKey) {
    await send(chat.id, "Сервис временно недоступен (нет ключа HeyGen). Напишите позже.");
    return ok();
  }

  // Дефолты проекта (аватар/голос).
  const { data: def } = await admin
    .from("heygen_defaults")
    .select("data")
    .eq("project_id", link.project_id)
    .maybeSingle();
  const d = (def?.data ?? {}) as {
    avatar?: { id: string; kind: string };
    voice?: { id: string };
  };

  const agent: Record<string, unknown> = { prompt: text };
  if (d.avatar && d.avatar.kind === "avatar") agent.avatar_id = d.avatar.id;
  if (d.voice) agent.voice_id = d.voice.id;

  try {
    const res = await fetch(`${HEYGEN_BASE}/v3/video-agents`, {
      method: "POST",
      headers: { "X-Api-Key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(agent),
    });
    const data = await res.json().catch(() => ({}));
    const sessionId = data?.data?.session_id;
    if (!res.ok || !sessionId) {
      await send(chat.id, `HeyGen не принял запрос${data?.message ? `: ${data.message}` : ""}. Попробуйте ещё раз.`);
      return ok();
    }
    await admin.from("heygen_jobs").insert({ project_id: link.project_id, chat_id: chatId, session_id: sessionId });
    await send(chat.id, "Принял сценарий — собираю видео. Пришлю MP4 сюда, как будет готово (обычно пара минут).");
  } catch (e) {
    await send(chat.id, `Не удалось запустить генерацию: ${(e as Error)?.message ?? "ошибка сети"}`);
  }
  return ok();
});
