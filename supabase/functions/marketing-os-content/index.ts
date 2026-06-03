// Marketing OS / Content (Этап 3): контент-воронка для органики.
import { requireUser } from "../_lib/auth.ts";
// Лид-магнит + 5 рилсов на его выдачу + 10 контентных рилсов + 8 постов + календарь.

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

interface ContentArgs {
  markdown: string;
  lead_magnet: { name: string; format: string; promise: string; outline: string[] };
  hook_reels: { code: string; hook: string; script: string }[];
  content_reels: { code: string; topic: string; hook: string; script: string }[];
  posts: { code: string; format: string; topic: string; copy: string }[];
  calendar: { day: number; type: string; ref_code: string }[];
}

const TOOL_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    markdown: { type: "string" },
    lead_magnet: {
      type: "object",
      properties: {
        name: { type: "string" },
        format: { type: "string", description: "PDF/чеклист/гайд/таблица и т.д." },
        promise: { type: "string" },
        outline: { type: "array", items: { type: "string" } },
      },
      required: ["name", "format", "promise", "outline"],
      additionalProperties: false,
    },
    hook_reels: {
      type: "array",
      minItems: 5,
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          code: { type: "string", description: "HR1..HR5" },
          hook: { type: "string" },
          script: { type: "string" },
        },
        required: ["code", "hook", "script"],
        additionalProperties: false,
      },
    },
    content_reels: {
      type: "array",
      minItems: 10,
      maxItems: 10,
      items: {
        type: "object",
        properties: {
          code: { type: "string", description: "CR1..CR10" },
          topic: { type: "string" },
          hook: { type: "string" },
          script: { type: "string" },
        },
        required: ["code", "topic", "hook", "script"],
        additionalProperties: false,
      },
    },
    posts: {
      type: "array",
      minItems: 8,
      maxItems: 8,
      items: {
        type: "object",
        properties: {
          code: { type: "string", description: "CP1..CP8" },
          format: { type: "string", description: "карусель/пост/сторис" },
          topic: { type: "string" },
          copy: { type: "string" },
        },
        required: ["code", "format", "topic", "copy"],
        additionalProperties: false,
      },
    },
    calendar: {
      type: "array",
      minItems: 14,
      items: {
        type: "object",
        properties: {
          day: { type: "number", description: "Номер дня (1..30)" },
          type: { type: "string", description: "reel/post/story" },
          ref_code: { type: "string" },
        },
        required: ["day", "type", "ref_code"],
        additionalProperties: false,
      },
    },
  },
  required: ["markdown", "lead_magnet", "hook_reels", "content_reels", "posts", "calendar"],
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
    await upsertArtifact(supabase, body.projectId, "content", { status: "running" });

    const ctx = await getProjectContext(supabase, body.projectId);
    if (!ctx.brief?.segments) {
      await upsertArtifact(supabase, body.projectId, "content", {
        status: "error",
        error: "Сначала пройдите онбординг.",
      });
      return errorResponse("onboarding artifact missing", 409);
    }

    const userPrompt = `Контекст проекта (из 01-onboarding):

${briefToContext(ctx.brief)}

Сегменты:
${JSON.stringify(ctx.brief.segments, null, 2)}

Продуктовая матрица:
${JSON.stringify(ctx.brief.product_matrix, null, 2)}

Сделай контент-воронку (органика, Instagram СНГ/Казахстан):
- Лид-магнит (название, формат, обещание, оглавление 5-7 пунктов)
- 5 рилсов на выдачу лид-магнита (HR1..HR5): хук + скрипт 15-30 сек
- 10 контентных рилсов (CR1..CR10): тема + хук + скрипт
- 8 постов/каруселей (CP1..CP8): формат + тема + готовая копирка
- Календарь публикаций на 14-30 дней (день, тип, ref_code)

${body.patchInstruction ? `Правка: ${body.patchInstruction}` : ""}

Верни через save_marketing_os_content.`;

    try {
      const { args } = await callLovableWithTool<ContentArgs>(
        loadSkill("content"),
        userPrompt,
        "save_marketing_os_content",
        TOOL_SCHEMA,
      );
      await upsertArtifact(supabase, body.projectId, "content", {
        status: "done",
        markdown: args.markdown,
        payload: {
          lead_magnet: args.lead_magnet,
          hook_reels: args.hook_reels,
          content_reels: args.content_reels,
          posts: args.posts,
          calendar: args.calendar,
        },
        error: null,
        created_by: body.createdBy ?? null,
      });
      return jsonResponse({ ok: true, ...args });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await upsertArtifact(supabase, body.projectId, "content", { status: "error", error: msg });
      throw e;
    }
  } catch (e) {
    console.error("marketing-os-content error", e);
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Превышен лимит AI")) return errorResponse(msg, 429);
    if (msg.includes("кредиты Lovable")) return errorResponse(msg, 402);
    return errorResponse(msg);
  }
});
