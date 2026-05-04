import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface Body {
  projectId: string;
  niche?: string;
  audience?: string;
  product?: string;
  usp?: string;
  geo?: string;
  tone?: string;
  city?: string;
  websiteUrl?: string;
  monthlyBudget?: number;
}

const SYSTEM = `Ты опытный маркетолог-копирайтер для Meta Ads (Facebook/Instagram).
На основе данных проекта составь:
1) краткий бриф проекта в Markdown (до 1500 символов): ниша, ЦА, продукт, УТП, гео, тон коммуникации, ключевые офферы.
2) Три РАЗНЫХ варианта рекламного креатива на русском (или языке данных): primary_text (до 280 символов), headline (до 40 символов), cta (короткий призыв из 1-3 слов).

Пиши ёмко, без воды, фокусируясь на боли клиента и оффере.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json()) as Body;
    if (!body.projectId) {
      return new Response(JSON.stringify({ error: "projectId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");

    const userPrompt = `Данные проекта:
- Ниша: ${body.niche || "—"}
- Целевая аудитория: ${body.audience || "—"}
- Продукт/услуга: ${body.product || "—"}
- УТП: ${body.usp || "—"}
- География: ${body.geo || body.city || "—"}
- Тон: ${body.tone || "профессиональный, дружелюбный"}
- Сайт: ${body.websiteUrl || "—"}
- Месячный бюджет: ${body.monthlyBudget ? body.monthlyBudget + " (валюта проекта)" : "—"}`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "save_project_brief",
              description: "Сохранить бриф проекта и варианты рекламы",
              parameters: {
                type: "object",
                properties: {
                  brief_md: { type: "string" },
                  variants: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        primary_text: { type: "string" },
                        headline: { type: "string" },
                        cta: { type: "string" },
                      },
                      required: ["primary_text", "headline", "cta"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["brief_md", "variants"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "save_project_brief" } },
      }),
    });

    if (!aiResp.ok) {
      const t = await aiResp.text();
      console.error("AI gateway error:", aiResp.status, t);
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "Превышен лимит AI, попробуйте позже" }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResp.status === 402) {
        return new Response(JSON.stringify({ error: "Закончились кредиты Lovable AI" }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error("AI gateway " + aiResp.status);
    }

    const data = await aiResp.json();
    const call = data.choices?.[0]?.message?.tool_calls?.[0];
    const args = call?.function?.arguments ? JSON.parse(call.function.arguments) : null;
    if (!args) throw new Error("AI did not return structured output");

    const variants = Array.isArray(args.variants) ? args.variants.slice(0, 3) : [];
    const first = variants[0] || {};

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { error: upErr } = await supabase
      .from("project_briefs")
      .update({
        brief_md: args.brief_md,
        ai_variants: variants,
        ai_primary_text: first.primary_text || null,
        ai_headline: first.headline || null,
        ai_cta: first.cta || null,
      })
      .eq("project_id", body.projectId);

    if (upErr) console.error("update brief err", upErr);

    return new Response(
      JSON.stringify({ ok: true, brief_md: args.brief_md, variants }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("generate-project-brief error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});