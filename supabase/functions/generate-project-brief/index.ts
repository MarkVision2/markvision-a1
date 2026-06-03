// Marketing OS / Onboarding (Этап 1).
import { requireUser } from "../_lib/auth.ts";
// System prompt = SKILL.md из supabase/functions/_marketing_os/onboarding/.
// Возвращает полный документ 01-onboarding.md + структурированные сегменты, конкурентов, продуктовую матрицу,
// сценарии запуска и 3 рекламных варианта (для шага 4 диалога).

import {
  briefToContext,
  callLovableWithTool,
  corsHeaders,
  errorResponse,
  getServiceClient,
  jsonResponse,
  loadSkill,
} from "../_lib/marketing_os.ts";

interface OnboardingBody {
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
  productType?: string;
  researchDepth?: string;
  priceModel?: string;
  currentClients?: string;
  channels?: string[];
  directCompetitors?: string;
  indirectCompetitors?: string;
  differentiator?: string;
  painsRaw?: string;
}

interface Segment {
  code: string;
  name: string;
  radical_psychotype: string;
  size_score: number;
  affordability_score: number;
  pain_score: number;
  speed_score: number;
  competition_score: number;
  fit_score: number;
  index_score: number;
  class: "A" | "B" | "C" | "D";
  pains: string[];
  offer: string;
  notes?: string;
}

interface OnboardingArgs {
  brief_md: string;
  product_type: string;
  segments: Segment[];
  competitors: {
    direct: { name: string; offer?: string; price?: string; strengths?: string; weaknesses?: string }[];
    indirect: { name: string; how?: string; why?: string }[];
    alternatives: string[];
  };
  product_matrix: {
    lead_magnet: string;
    entry: string;
    main: string;
    vip: string;
    mini?: string;
    warmup?: string;
  };
  launch_scenarios: { name: string; description: string; budget_hint?: string }[];
  recommended_scenario: string;
  variants: { primary_text: string; headline: string; cta: string }[];
}

const TOOL_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    brief_md: {
      type: "string",
      description:
        "Полный документ 01-onboarding.md в Markdown. Включает: тип продукта и веса, сегменты с индексом 0-100 и классом A/B/C/D, продуктовую матрицу, 3 сценария запуска и рекомендацию.",
    },
    product_type: {
      type: "string",
      enum: [
        "B2C импульс",
        "B2C обдуманная",
        "B2C luxury",
        "B2B",
        "Подписка",
      ],
    },
    segments: {
      type: "array",
      minItems: 3,
      items: {
        type: "object",
        properties: {
          code: { type: "string", description: "Короткий код, например S1, S2." },
          name: { type: "string" },
          radical_psychotype: { type: "string", description: "Один из 7 радикалов." },
          size_score: { type: "number" },
          affordability_score: { type: "number" },
          pain_score: { type: "number" },
          speed_score: { type: "number" },
          competition_score: { type: "number" },
          fit_score: { type: "number" },
          index_score: { type: "number", description: "Итог 0-100." },
          class: { type: "string", enum: ["A", "B", "C", "D"] },
          pains: { type: "array", items: { type: "string" } },
          offer: { type: "string" },
          notes: { type: "string" },
        },
        required: [
          "code",
          "name",
          "radical_psychotype",
          "size_score",
          "affordability_score",
          "pain_score",
          "speed_score",
          "competition_score",
          "fit_score",
          "index_score",
          "class",
          "pains",
          "offer",
        ],
        additionalProperties: false,
      },
    },
    competitors: {
      type: "object",
      properties: {
        direct: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              offer: { type: "string" },
              price: { type: "string" },
              strengths: { type: "string" },
              weaknesses: { type: "string" },
            },
            required: ["name"],
            additionalProperties: false,
          },
        },
        indirect: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              how: { type: "string" },
              why: { type: "string" },
            },
            required: ["name"],
            additionalProperties: false,
          },
        },
        alternatives: { type: "array", items: { type: "string" } },
      },
      required: ["direct", "indirect", "alternatives"],
      additionalProperties: false,
    },
    product_matrix: {
      type: "object",
      properties: {
        lead_magnet: { type: "string" },
        entry: { type: "string" },
        main: { type: "string" },
        vip: { type: "string" },
        mini: { type: "string" },
        warmup: { type: "string" },
      },
      required: ["lead_magnet", "entry", "main", "vip"],
      additionalProperties: false,
    },
    launch_scenarios: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          name: {
            type: "string",
            enum: ["Быстрые деньги", "Голубой океан", "Безопасный объём"],
          },
          description: { type: "string" },
          budget_hint: { type: "string" },
        },
        required: ["name", "description"],
        additionalProperties: false,
      },
    },
    recommended_scenario: {
      type: "string",
      enum: ["Быстрые деньги", "Голубой океан", "Безопасный объём"],
    },
    variants: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          primary_text: { type: "string", maxLength: 320 },
          headline: { type: "string", maxLength: 60 },
          cta: { type: "string", maxLength: 32 },
        },
        required: ["primary_text", "headline", "cta"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "brief_md",
    "product_type",
    "segments",
    "competitors",
    "product_matrix",
    "launch_scenarios",
    "recommended_scenario",
    "variants",
  ],
  additionalProperties: false,
};

function classifySegments(segments: Segment[]): Segment[] {
  return segments.map((s) => {
    const idx = s.index_score;
    const cls = idx >= 80 ? "A" : idx >= 60 ? "B" : idx >= 40 ? "C" : "D";
    return { ...s, class: cls };
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let __auth: Awaited<ReturnType<typeof requireUser>>;
  try {
    __auth = await requireUser(req);
    if (!__auth.ok) return __auth.response;
  } catch {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = (await req.json()) as OnboardingBody;
    if (!body.projectId) return errorResponse("projectId required", 400);
    const access = await requireProjectAccess(__auth.authHeader, body.projectId);
    if (!access.ok) return access.response;

    // Merge with what is already saved in project_briefs so перегенерация со страницы
    // «Стратегия» работала даже когда клиент не присылает поля в body.
    const supabase = getServiceClient();
    const { data: storedBrief } = await supabase
      .from("project_briefs")
      .select("*")
      .eq("project_id", body.projectId)
      .maybeSingle();
    const stored = (storedBrief ?? {}) as Record<string, unknown>;
    const pick = <T>(bodyVal: T | undefined, dbKey: string): T | undefined => {
      if (bodyVal !== undefined && bodyVal !== null && bodyVal !== "") return bodyVal;
      const v = stored[dbKey];
      return (v as T | undefined) ?? undefined;
    };

    const niche = pick(body.niche, "niche");
    const audience = pick(body.audience, "audience");
    const product = pick(body.product, "product");
    const usp = pick(body.usp, "usp");
    const geo = pick(body.geo, "geo");
    const tone = pick(body.tone, "tone");
    const monthlyBudget = pick(body.monthlyBudget, "monthly_budget");
    const productType = pick(body.productType, "product_type") ?? "B2C обдуманная";
    const researchDepth = pick(body.researchDepth, "research_depth") ?? "быстрый";
    const priceModel = pick(body.priceModel, "price_model");
    const currentClients = pick(body.currentClients, "current_clients");
    const channels = (body.channels ?? (stored.channels as string[] | undefined) ?? []) as string[];
    const directCompetitors = pick(body.directCompetitors, "direct_competitors");
    const indirectCompetitors = pick(body.indirectCompetitors, "indirect_competitors");
    const differentiator = pick(body.differentiator, "differentiator");
    const painsRaw = pick(body.painsRaw, "pains_raw");
    const websiteUrl = body.websiteUrl ?? null;
    const city = body.city ?? null;

    if (!niche && !product && !audience) {
      return errorResponse(
        "Заполните бриф: укажите хотя бы нишу, продукт или ЦА перед запуском онбординга.",
        400,
      );
    }

    const userPrompt = `Данные проекта от пользователя (это всё что у тебя есть, веб-поиска нет):

- ID проекта: ${body.projectId}
- Ниша: ${niche ?? "—"}
- Продукт/услуга: ${product ?? "—"}
- Целевая аудитория: ${audience ?? "—"}
- УТП / отстройка: ${usp ?? differentiator ?? "—"}
- География: ${geo ?? city ?? "—"}
- Тон коммуникации: ${tone ?? "—"}
- Сайт: ${websiteUrl ?? "—"}
- Месячный бюджет (KZT): ${monthlyBudget ?? "—"}
- Тип продукта (для весов индекса): ${productType}
- Глубина ресёрча, заявленная пользователем: ${researchDepth}
- Модель оплаты: ${priceModel ?? "—"}
- Текущие клиенты (2-3 описания): ${currentClients ?? "—"}
- Каналы размещения: ${channels.join(", ") || "—"}
- Прямые конкуренты от пользователя: ${directCompetitors ?? "—"}
- Косвенные конкуренты: ${indirectCompetitors ?? "—"}
- Боли клиентов (сырьё): ${painsRaw ?? "—"}

Сделай полный онбординг по фреймворку Marketing OS. ВАЖНО:
- НЕ задавай уточняющих вопросов. Сразу финал.
- 8-12 гипотез сегментов → индексируй 0-100 по фактическим весам выбранного типа продукта → возьми 3-4 топовых (A + лучший B).
- Если данных мало — делай обоснованные предположения и помечай их.
- Верни результат строго через function-tool save_marketing_os_onboarding.
- В brief_md помести готовый документ 01-onboarding.md (тип продукта + веса, таблица сегментов с индексом и классом, продуктовая матрица, 3 сценария + рекомендация, 3 рекламных варианта).
- variants — 3 разных рекламных креатива на русском под рекомендованный сценарий: primary_text (до 280), headline (до 40), cta (1-3 слова).`;

    const { args } = await callLovableWithTool<OnboardingArgs>(
      loadSkill("onboarding"),
      userPrompt,
      "save_marketing_os_onboarding",
      TOOL_SCHEMA,
      { model: "google/gemini-2.5-pro", timeoutMs: 90_000 },
    );

    const segments = classifySegments(args.segments ?? []);
    const variants = (args.variants ?? []).slice(0, 3);
    const first = variants[0] ?? { primary_text: "", headline: "", cta: "" };

    // upsert так как при онбординге со страницы Strategy строки project_briefs может ещё не быть
    const { error: upErr } = await supabase
      .from("project_briefs")
      .upsert({
        project_id: body.projectId,
        niche: niche ?? null,
        audience: audience ?? null,
        product: product ?? null,
        usp: usp ?? null,
        geo: geo ?? city ?? null,
        tone: tone ?? null,
        monthly_budget: typeof monthlyBudget === "number" ? monthlyBudget : 0,
        brief_md: args.brief_md,
        product_type: args.product_type,
        research_depth: researchDepth,
        price_model: priceModel ?? null,
        current_clients: currentClients ?? null,
        channels,
        direct_competitors: directCompetitors ?? null,
        indirect_competitors: indirectCompetitors ?? null,
        differentiator: differentiator ?? null,
        pains_raw: painsRaw ?? null,
        segments,
        competitors: args.competitors,
        product_matrix: args.product_matrix,
        launch_scenarios: args.launch_scenarios,
        recommended_scenario: args.recommended_scenario,
        ai_variants: variants,
        ai_primary_text: first.primary_text || null,
        ai_headline: first.headline || null,
        ai_cta: first.cta || null,
      }, { onConflict: "project_id" });

    if (upErr) {
      console.error("upsert brief err", upErr);
      return errorResponse(`DB update failed: ${upErr.message}`);
    }

    return jsonResponse({
      ok: true,
      brief_md: args.brief_md,
      product_type: args.product_type,
      segments,
      competitors: args.competitors,
      product_matrix: args.product_matrix,
      launch_scenarios: args.launch_scenarios,
      recommended_scenario: args.recommended_scenario,
      variants,
      // ctx is unused by the client — kept for debugging
      _debug_brief_context_len: briefToContext(null).length,
    });
  } catch (e) {
    console.error("generate-project-brief error", e);
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Превышен лимит AI")) return errorResponse(msg, 429);
    if (msg.includes("кредиты Lovable")) return errorResponse(msg, 402);
    return errorResponse(msg);
  }
});
