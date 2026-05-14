import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireUser } from "../_lib/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface Msg { fromMe: boolean; text: string }

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const __auth = await requireUser(req);
    if (!__auth.ok) return __auth.response;
  } catch { return new Response(JSON.stringify({error:"Unauthorized"}),{status:401,headers:{...corsHeaders,"Content-Type":"application/json"}}); }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY is not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const mode: "reply" | "improve" | "objection" =
      body.mode === "improve" || body.mode === "objection" ? body.mode : "reply";
    const messages: Msg[] = Array.isArray(body.messages) ? body.messages.slice(-8) : [];
    const stage: string = typeof body.stage === "string" ? body.stage : "";
    const leadName: string = typeof body.leadName === "string" ? body.leadName : "клиент";
    const channel: string = typeof body.channel === "string" ? body.channel : "WhatsApp";
    const draft: string = typeof body.draft === "string" ? body.draft : "";
    const rejectReason: string = typeof body.rejectReason === "string" ? body.rejectReason : "";
    const service: string = typeof body.service === "string" ? body.service : "";
    const amount: number = typeof body.amount === "number" ? body.amount : 0;
    const businessHint: string =
      typeof body.businessHint === "string" ? body.businessHint : "медицинская клиника";

    const transcript = messages
      .map((m) => `${m.fromMe ? "Менеджер" : leadName}: ${m.text}`)
      .join("\n") || "(пока нет сообщений)";

    const ctxLines = [
      `Бизнес: ${businessHint}.`,
      `Имя клиента: ${leadName}.`,
      service ? `Услуга: ${service}.` : "",
      amount > 0 ? `Сумма сделки: ${amount} ₸.` : "",
      `Этап воронки: ${stage || "не указан"}.`,
      `Канал: ${channel}.`,
    ].filter(Boolean).join("\n");

    const systemPrompt =
      `Ты — опытный администратор медицинской клиники в Казахстане. Помогаешь менеджеру общаться с клиентом в мессенджере. ` +
      `Пиши кратко (1–3 предложения), эмпатично, на «вы», без канцелярита и воды. ` +
      `Не выдумывай цены, услуги, даты — если фактов нет, задай уточняющий вопрос. ` +
      `Используй имя клиента в начале только если уместно.`;

    let userPrompt = "";
    let want = 3;
    if (mode === "improve") {
      want = 1;
      userPrompt =
        `${ctxLines}\n\nЧерновик менеджера:\n"""${draft}"""\n\n` +
        `Перепиши черновик: исправь тон, грамматику, сделай короче и теплее, СОХРАНИ исходный смысл и любые упомянутые цифры/даты. ` +
        `Верни 1 финальный вариант одной строкой, без кавычек и пояснений.`;
    } else if (mode === "objection") {
      want = 2;
      userPrompt =
        `${ctxLines}\nПричина возможного отказа: ${rejectReason || "не указана"}.\n` +
        `Последние сообщения:\n${transcript}\n\n` +
        `Предложи 2 коротких варианта ответа, чтобы мягко снять возражение и предложить следующий шаг (созвон, бесплатный осмотр, удобное время). ` +
        `Каждый вариант — отдельной строкой, без нумерации, без кавычек.`;
    } else {
      want = 3;
      userPrompt =
        `${ctxLines}\nПереписка:\n${transcript}\n\n` +
        `Предложи 3 коротких варианта ответа менеджера. Каждый — отдельной строкой, без нумерации, без кавычек.`;
    }

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!aiResp.ok) {
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "Слишком много запросов, повторите позже." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResp.status === 402) {
        return new Response(JSON.stringify({ error: "Закончились кредиты Lovable AI. Пополните в Settings → Workspace → Usage." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await aiResp.text();
      console.error("AI gateway error", aiResp.status, t);
      return new Response(JSON.stringify({ error: "AI недоступен" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await aiResp.json();
    const raw: string = data?.choices?.[0]?.message?.content ?? "";
    const suggestions = raw
      .split("\n")
      .map((s: string) => s.replace(/^[\s\d.\-•—)]+/, "").trim())
      .map((s: string) => s.replace(/^["«»']+|["«»']+$/g, "").trim())
      .filter((s: string) => s.length > 0)
      .slice(0, want);

    return new Response(JSON.stringify({ suggestions }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("crm-ai-suggest error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
