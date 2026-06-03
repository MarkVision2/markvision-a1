// Marketing OS / Site Brief (Этап 4): ТЗ на посадочную страницу с готовыми текстами всех блоков.
import { requireUser } from "../_lib/auth.ts";

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

interface Block {
  code: string;
  type: string;
  goal: string;
  copy: { heading: string; subheading?: string; body?: string; bullets?: string[]; cta?: string };
  visual_prompt?: string;
}

interface SiteBriefArgs {
  markdown: string;
  blocks: Block[];
  meta: { title: string; description: string; keywords: string[] };
  conversion_goals: string[];
}

const TOOL_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    markdown: { type: "string" },
    blocks: {
      type: "array",
      minItems: 8,
      items: {
        type: "object",
        properties: {
          code: { type: "string", description: "BL1, BL2..." },
          type: {
            type: "string",
            description: "hero/problem/solution/benefits/features/social_proof/offer/faq/cta/footer и т.д.",
          },
          goal: { type: "string" },
          copy: {
            type: "object",
            properties: {
              heading: { type: "string" },
              subheading: { type: "string" },
              body: { type: "string" },
              bullets: { type: "array", items: { type: "string" } },
              cta: { type: "string" },
            },
            required: ["heading"],
            additionalProperties: false,
          },
          visual_prompt: { type: "string" },
        },
        required: ["code", "type", "goal", "copy"],
        additionalProperties: false,
      },
    },
    meta: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        keywords: { type: "array", items: { type: "string" } },
      },
      required: ["title", "description", "keywords"],
      additionalProperties: false,
    },
    conversion_goals: { type: "array", items: { type: "string" } },
  },
  required: ["markdown", "blocks", "meta", "conversion_goals"],
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
    await upsertArtifact(supabase, body.projectId, "site_brief", { status: "running" });

    const ctx = await getProjectContext(supabase, body.projectId);
    if (!ctx.brief?.segments) {
      await upsertArtifact(supabase, body.projectId, "site_brief", {
        status: "error",
        error: "Сначала пройдите онбординг.",
      });
      return errorResponse("onboarding artifact missing", 409);
    }

    const creativesArt = ctx.artifacts.creatives;
    const userPrompt = `Контекст проекта:

${briefToContext(ctx.brief)}

Сегменты:
${JSON.stringify(ctx.brief.segments, null, 2)}

Продуктовая матрица:
${JSON.stringify(ctx.brief.product_matrix, null, 2)}

${creativesArt?.payload ? `Креативы (для согласованности тонa и офферов):\n${JSON.stringify((creativesArt.payload as Record<string, unknown>).creatives ?? [], null, 2)}` : "(Креативы ещё не сгенерированы — действуй автономно.)"}

Сделай ТЗ на посадочную с готовыми текстами всех блоков:
- Минимум 8-10 блоков (BL1..BL10): hero, проблема, решение, выгоды, фичи, соцдоказательства, оффер, FAQ, CTA, footer.
- Каждый блок: type, goal (что должен сделать пользователь), готовая копирка (heading, subheading, body, bullets, cta), и visual_prompt при необходимости.
- meta: SEO title (до 60), description (до 160), keywords.
- conversion_goals: что считаем конверсией (заявка, звонок, WhatsApp, оплата).

${body.patchInstruction ? `Правка: ${body.patchInstruction}` : ""}

Верни через save_marketing_os_site_brief.`;

    try {
      const { args } = await callLovableWithTool<SiteBriefArgs>(
        loadSkill("site_brief"),
        userPrompt,
        "save_marketing_os_site_brief",
        TOOL_SCHEMA,
      );
      await upsertArtifact(supabase, body.projectId, "site_brief", {
        status: "done",
        markdown: args.markdown,
        payload: { blocks: args.blocks, meta: args.meta, conversion_goals: args.conversion_goals },
        error: null,
        created_by: body.createdBy ?? null,
      });
      return jsonResponse({ ok: true, ...args });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await upsertArtifact(supabase, body.projectId, "site_brief", { status: "error", error: msg });
      throw e;
    }
  } catch (e) {
    console.error("marketing-os-site-brief error", e);
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Превышен лимит AI")) return errorResponse(msg, 429);
    if (msg.includes("кредиты Lovable")) return errorResponse(msg, 402);
    return errorResponse(msg);
  }
});
