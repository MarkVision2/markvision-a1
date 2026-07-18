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
    // Lovable gateway остался на старом проекте; после миграции на szfg
    // основной провайдер — OpenAI, Lovable используется только если ключ задан.
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!LOVABLE_API_KEY && !OPENAI_API_KEY) {
      throw new Error("Не настроен AI-ключ (LOVABLE_API_KEY или OPENAI_API_KEY)");
    }

    const body = await req.json();
    const {
      mode,
      question,
      rangeLabel,
      totals,
      prev,
      scoring,
      channels,
      creatives,
      daily,
    } = body ?? {};

    const ctx = `Период: ${rangeLabel}
Метрики: ${JSON.stringify(totals)}
Пред. период: ${JSON.stringify(prev)}
AI-скоринг: ${JSON.stringify(scoring)}
Каналы: ${JSON.stringify(channels)}
Креативы: ${JSON.stringify(creatives)}
Динамика по дням: ${JSON.stringify(daily)}`;

    const system = mode === "summary"
      ? "Ты — AI-аналитик маркетинга для владельца бизнеса. Дай по-русски короткий управленческий разбор: 1) итог периода, 2) главное узкое место, 3) лучший актив или канал, 4) одно конкретное следующее действие. Учитывай только переданные данные, не выдумывай причины и не называй ростом изменение без данных прошлого периода. Денежные значения указывай в тенге. Не используй markdown."
      : "Ты — AI-аналитик маркетинга для владельца бизнеса. Отвечай по-русски кратко и конкретно, опираясь только на переданные Meta, CRM, платёжные и атрибуционные данные. Если данных для вывода нет — прямо скажи, каких именно данных не хватает. Не выдумывай причины. Денежные значения указывай в тенге.";

    const userMsg = mode === "summary"
      ? `Дай краткое резюме отчёта.\n${ctx}`
      : `Вопрос: ${question}\n\nДанные отчёта:\n${ctx}`;

    const useLovable = Boolean(LOVABLE_API_KEY);
    const resp = await fetch(
      useLovable
        ? "https://ai.gateway.lovable.dev/v1/chat/completions"
        : "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${useLovable ? LOVABLE_API_KEY : OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: useLovable ? "google/gemini-2.5-flash" : "gpt-4o-mini",
          messages: [
            { role: "system", content: system },
            { role: "user", content: userMsg },
          ],
        }),
      },
    );

    if (resp.status === 429) {
      return new Response(JSON.stringify({ error: "Превышен лимит запросов, попробуйте позже." }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (resp.status === 402) {
      return new Response(JSON.stringify({ error: "Закончились кредиты AI-провайдера." }), {
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
