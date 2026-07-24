// Broadcast AI variants — генерация пула непохожих формулировок сообщения,
// чтобы массовая рассылка не выглядела как спам. Каждому получателю воркер
// отдаёт свой вариант (broadcast_campaigns.message_variants).
//
// Варьируем приветствие («Добрый день», «Здравствуйте», «Иван, добрый день»,
// «Добрый день, Иван»…), порядок слов и позицию имени, сохраняя смысл, CTA и
// токены {имя}/{ссылка}. Auth: любой авторизованный пользователь.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { aiChatCompletion, hasAiProvider } from "../_lib/aiProvider.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function isAuthed(req: Request): Promise<boolean> {
  const auth = req.headers.get("Authorization") ?? "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt || !ANON_KEY) return false;
  try {
    const client = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data } = await client.auth.getUser();
    return !!data.user?.id;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  if (!(await isAuthed(req))) return json({ error: "Unauthorized" }, 401);
  if (!hasAiProvider()) return json({ error: "AI не настроен (LOVABLE_API_KEY / OPENAI_API_KEY)" }, 503);

  const body = (await req.json().catch(() => ({}))) as {
    message?: string;
    count?: number;
    tone?: string;
  };
  const message = String(body.message ?? "").trim();
  if (!message) return json({ error: "Пустое сообщение" }, 400);
  const count = Math.min(40, Math.max(5, Number(body.count) || 20));
  const tone = String(body.tone ?? "дружелюбный, деловой").slice(0, 80);

  const hasName = /\{имя\}|\{name\}/i.test(message);
  const hasLink = /\{ссылка\}|\{link\}/i.test(message);

  const system =
    "Ты — копирайтер WhatsApp-рассылок в Казахстане. Твоя задача — переписать одно " +
    "сообщение в НЕСКОЛЬКО естественных непохожих вариантов, чтобы массовая отправка " +
    "не выглядела как спам и не попала под антиспам-фильтры WhatsApp. " +
    "Меняй: форму приветствия (Добрый день / Здравствуйте / Приветствую / Доброго дня), " +
    "порядок слов, позицию имени (в начале или после приветствия), формулировку призыва — " +
    "но сохраняй СМЫСЛ, предложение и вежливый тон. " +
    "Пиши по-русски, живо, без канцелярита, без КАПСА, без обилия эмодзи, без слова «рассылка». " +
    (hasName ? "ОБЯЗАТЕЛЬНО сохраняй токен {имя} в каждом варианте (не заменяй на конкретное имя). " : "") +
    (hasLink ? "ОБЯЗАТЕЛЬНО сохраняй токен {ссылка} в каждом варианте без изменений. " : "") +
    `Тон: ${tone}. ` +
    `Верни СТРОГО JSON: {"variants": ["вариант 1", "вариант 2", ...]} — ровно ${count} уникальных вариантов, без нумерации и пояснений.`;

  let raw: string;
  try {
    const resp = await aiChatCompletion({
      messages: [
        { role: "system", content: system },
        { role: "user", content: message },
      ],
      responseFormat: { type: "json_object" },
      temperature: 1.0,
      timeoutMs: 60_000,
    });
    raw = resp?.choices?.[0]?.message?.content ?? "";
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }

  let parsed: { variants?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json({ error: "AI вернул не-JSON" }, 502);
  }

  const seen = new Set<string>();
  const variants = (Array.isArray(parsed.variants) ? parsed.variants : [])
    .map((v) => String(v ?? "").trim())
    .filter((v) => {
      if (!v || v.length < 3) return false;
      // Сохраняем обязательные токены.
      if (hasName && !/\{имя\}|\{name\}/i.test(v)) return false;
      if (hasLink && !/\{ссылка\}|\{link\}/i.test(v)) return false;
      const key = v.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, count);

  if (variants.length === 0) return json({ error: "Не удалось сгенерировать варианты" }, 502);
  return json({ variants });
});
