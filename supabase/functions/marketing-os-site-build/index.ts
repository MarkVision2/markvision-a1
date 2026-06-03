// Marketing OS / Site Build (Этап 5): собирает рабочий single-file HTML по ТЗ из site_brief.
import { requireUser } from "../_lib/auth.ts";

import {
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

interface SiteBuildArgs {
  html: string;
  notes: string;
}

const TOOL_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    html: {
      type: "string",
      description:
        "Полный single-file HTML5 документ с inline CSS (Tailwind play CDN допустим). Без внешних зависимостей кроме шрифтов Google и Tailwind play CDN.",
    },
    notes: {
      type: "string",
      description: "Краткая markdown-инструкция: какие блоки реализованы, что подключить (lead-form, аналитика).",
    },
  },
  required: ["html", "notes"],
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
    await upsertArtifact(supabase, body.projectId, "site_build", { status: "running" });

    const ctx = await getProjectContext(supabase, body.projectId);
    const siteBrief = ctx.artifacts.site_brief;
    if (!siteBrief?.payload) {
      await upsertArtifact(supabase, body.projectId, "site_build", {
        status: "error",
        error: "Сначала сгенерируйте ТЗ сайта (этап Site Brief).",
      });
      return errorResponse("site_brief artifact missing", 409);
    }

    const userPrompt = `Собери single-file HTML по ТЗ ниже.

Требования:
- Один файл index.html с inline CSS или Tailwind play CDN.
- Без внешних JS-библиотек (никаких jQuery, React и т.п.). Можно подключить Google Fonts.
- Адаптивная вёрстка (mobile-first), минимум до 320px.
- Все блоки из ТЗ должны быть реализованы по порядку.
- Lead-форма отправляется POST на placeholder /api/lead — добавь комментарий <!-- FORM ACTION --> где нужна интеграция.
- meta-теги SEO из ТЗ.
- Кнопки CTA крупные, контрастные, с тенью.

ТЗ (site_brief):
${JSON.stringify(siteBrief.payload, null, 2)}

${body.patchInstruction ? `Правка пользователя: ${body.patchInstruction}` : ""}

Верни через save_marketing_os_site_build.`;

    try {
      const { args } = await callLovableWithTool<SiteBuildArgs>(
        loadSkill("site_build"),
        userPrompt,
        "save_marketing_os_site_build",
        TOOL_SCHEMA,
        { timeoutMs: 120_000 },
      );
      await upsertArtifact(supabase, body.projectId, "site_build", {
        status: "done",
        markdown: args.notes,
        payload: { html: args.html, notes: args.notes },
        error: null,
        created_by: body.createdBy ?? null,
      });
      return jsonResponse({ ok: true, ...args });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await upsertArtifact(supabase, body.projectId, "site_build", { status: "error", error: msg });
      throw e;
    }
  } catch (e) {
    console.error("marketing-os-site-build error", e);
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Превышен лимит AI")) return errorResponse(msg, 429);
    if (msg.includes("кредиты Lovable")) return errorResponse(msg, 402);
    return errorResponse(msg);
  }
});
