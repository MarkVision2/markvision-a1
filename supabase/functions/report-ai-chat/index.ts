import { requireUser } from "../_lib/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const __auth = await requireUser(req);
    if (!__auth.ok) return __auth.response;
  } catch { return new Response(JSON.stringify({error:"Unauthorized"}),{status:401,headers:{...corsHeaders,"Content-Type":"application/json"}}); }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const body = await req.json();
    const { mode, question, rangeLabel, totals, prev, scoring, channels } = body ?? {};

    const ctx = `Период: ${rangeLabel}
Метрики: ${JSON.stringify(totals)}
Пред. период: ${JSON.stringify(prev)}
AI-скоринг: ${JSON.stringify(scoring)}
Каналы: ${JSON.stringify(channels)}`;

    const system = mode === "summary"
      ? "Ты — AI-аналитик маркетинга. На основе данных дай краткий вывод в 3-4 предложения по-русски: что выросло, что упало, на что обратить внимание. Не используй markdown."
      : "Ты — AI-аналитик маркетинга. Отвечай по-русски кратко и по существу, опираясь только на переданные данные.";

    const userMsg = mode === "summary"
      ? `Дай краткое резюме отчёта.\n${ctx}`
      : `Вопрос: ${question}\n\nДанные отчёта:\n${ctx}`;

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: system },
          { role: "user", content: userMsg },
        ],
      }),
    });

    if (resp.status === 429) {
      return new Response(JSON.stringify({ error: "Превышен лимит запросов, попробуйте позже." }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (resp.status === 402) {
      return new Response(JSON.stringify({ error: "Закончились кредиты Lovable AI." }), {
        status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!resp.ok) {
      const t = await resp.text();
      return new Response(JSON.stringify({ error: "AI gateway error", details: t }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const json = await resp.json();
    const text = json?.choices?.[0]?.message?.content ?? "";
    return new Response(JSON.stringify({ text }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
