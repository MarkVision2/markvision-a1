// Marketing OS / Creatives (Этап 2): рекламные крео под алгоритм Meta Andromeda.
import { requireUser } from "../_lib/auth.ts";
// Читает project_briefs.* и возвращает 9 креативов (3 формата × 3 угла) на каждый топ-сегмент.

import {
  briefToContext,
  callLovableWithTool,
  corsHeaders,
  errorResponse,
  getProjectContext,
  getServiceClient,
  jsonResponse,
  loadSkill,
  upsertArtifact,
} from "../_lib/marketing_os.ts";

interface Body {
  projectId: string;
  patchInstruction?: string;
  createdBy?: string;
}

interface Creative {
  code: string;
  segment_code: string;
  angle: "боль" | "желание" | "контекст";
  format: "video" | "banner" | "carousel";
  said_shown: string;
  visual_prompt: string;
  ad_text: string;
  ad_headline?: string;
  ad_cta?: string;
}

interface CreativesArgs {
  markdown: string;
  campaign_setup: { placements: string; budget_strategy: string; learning_period: string };
  creatives: Creative[];
}

const TOOL_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    markdown: {
      type: "string",
      description:
        "Полный документ 03-creatives.md в Markdown: краткий разбор техники углов, инструкция по запуску для таргетолога, и таблица креативов по сегментам.",
    },
    campaign_setup: {
      type: "object",
      properties: {
        placements: { type: "string" },
        budget_strategy: { type: "string" },
        learning_period: { type: "string" },
      },
      required: ["placements", "budget_strategy", "learning_period"],
      additionalProperties: false,
    },
    creatives: {
      type: "array",
      minItems: 9,
      items: {
        type: "object",
        properties: {
          code: { type: "string", description: "V1, B2, CR3 и т.п." },
          segment_code: { type: "string", description: "S1/S2/..." },
          angle: { type: "string", enum: ["боль", "желание", "контекст"] },
          format: { type: "string", enum: ["video", "banner", "carousel"] },
          said_shown: { type: "string", description: "Сказал = показал. Как зритель видит крео." },
          visual_prompt: {
            type: "string",
            description:
              "Готовый промт для Gemini: aspect, style, subject, action, setting, lighting, mood, camera, text overlay, negative.",
          },
          ad_text: { type: "string", description: "Текст объявления для платформы (primary text)." },
          ad_headline: { type: "string" },
          ad_cta: { type: "string" },
        },
        required: ["code", "segment_code", "angle", "format", "said_shown", "visual_prompt", "ad_text"],
        additionalProperties: false,
      },
    },
  },
  required: ["markdown", "campaign_setup", "creatives"],
  additionalProperties: false,
};

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
    const body = (await req.json()) as Body;
    if (!body.projectId) return errorResponse("projectId required", 400);
    const access = await requireProjectAccess(__auth.authHeader, body.projectId);
    if (!access.ok) return access.response;
    const supabase = getServiceClient();
    await upsertArtifact(supabase, body.projectId, "creatives", { status: "running" });

    const ctx = await getProjectContext(supabase, body.projectId);
    if (!ctx.brief?.segments) {
      await upsertArtifact(supabase, body.projectId, "creatives", {
        status: "error",
        error: "Сначала пройдите онбординг — нужны сегменты.",
      });
      return errorResponse("onboarding artifact missing", 409);
    }

    const userPrompt = `Контекст проекта (из 01-onboarding):

${briefToContext(ctx.brief)}

Сегменты (полный JSON):
${JSON.stringify(ctx.brief.segments, null, 2)}

Продуктовая матрица:
${JSON.stringify(ctx.brief.product_matrix, null, 2)}

Сделай рекламные крео под Meta Andromeda по фреймворку:
- 1 кампания / 1 группа / широкий таргетинг без интересов / Advantage+ placements / обучение 2-3 недели
- Только Instagram-форматы: video 9:16, banner 4:5, carousel 4:5 (без stories!)
- На каждый топ-сегмент (A и лучший B) сделай 3 угла × 3 формата = 9 креативов
- Каждое крео: сказал = показал во всех форматах. visual_prompt — готовый промт для Gemini (aspect, style, subject, action, setting, lighting, mood, camera, text overlay, negative).
- Каждое крео: ad_text (до 280), ad_headline (до 40), ad_cta (1-3 слова).

${body.patchInstruction ? `Дополнительная правка от пользователя: ${body.patchInstruction}` : ""}

Верни через function-tool save_marketing_os_creatives.`;

    try {
      const { args } = await callLovableWithTool<CreativesArgs>(
        loadSkill("creatives"),
        userPrompt,
        "save_marketing_os_creatives",
        TOOL_SCHEMA,
      );
      await upsertArtifact(supabase, body.projectId, "creatives", {
        status: "done",
        markdown: args.markdown,
        payload: {
          campaign_setup: args.campaign_setup,
          creatives: args.creatives,
        },
        error: null,
        created_by: body.createdBy ?? null,
      });
      return jsonResponse({ ok: true, ...args });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await upsertArtifact(supabase, body.projectId, "creatives", { status: "error", error: msg });
      throw e;
    }
  } catch (e) {
    console.error("marketing-os-creatives error", e);
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Превышен лимит AI")) return errorResponse(msg, 429);
    if (msg.includes("кредиты Lovable")) return errorResponse(msg, 402);
    return errorResponse(msg);
  }
});
