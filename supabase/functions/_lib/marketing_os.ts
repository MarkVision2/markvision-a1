// Shared helpers for Marketing OS edge functions.
// All 5 commands (onboarding/creatives/content/site-brief/site-build) reuse:
//   - loadSkill: returns the system prompt with web-research sections stripped
//   - callLovable: structured-output call to Lovable AI Gateway
//   - getProjectContext: pulls project + brief + prior artifacts from Supabase

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  onboardingSkill,
  onboarding_frameworksRef,
  creativesSkill,
  creatives_creative_formulasRef,
  contentSkill,
  site_briefSkill,
  site_brief_site_blocksRef,
  site_buildSkill,
  site_build_html_templateRef,
} from "../_marketing_os/skills.gen.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

export type SkillName =
  | "onboarding"
  | "creatives"
  | "content"
  | "site_brief"
  | "site_build";

const SKILL_MAP: Record<SkillName, { skill: string; refs: string[] }> = {
  onboarding: { skill: onboardingSkill, refs: [onboarding_frameworksRef] },
  creatives: { skill: creativesSkill, refs: [creatives_creative_formulasRef] },
  content: { skill: contentSkill, refs: [] },
  site_brief: { skill: site_briefSkill, refs: [site_brief_site_blocksRef] },
  site_build: { skill: site_buildSkill, refs: [site_build_html_templateRef] },
};

const NO_WEB_RESEARCH_NOTE = `
---

## Адаптация под MarkVision (важно)

Ты работаешь внутри MarkVision — у тебя НЕТ доступа в интернет. Поэтому:
- НЕ ищи в Google, Instagram, TikTok, 2GIS, отзовиках. Используй ТОЛЬКО то, что дал пользователь и что можешь обоснованно предположить из своих знаний о рынке.
- Если данных мало — обозначай предположения явно фразой "Предположение:" и помечай уверенность (низкая/средняя/высокая).
- НЕ задавай уточняющих вопросов и НЕ жди подтверждений — сразу выдавай финальный результат за один проход.
- НЕ создавай папок и файлов на диске. Возвращай результат строго через function-tool, который тебе даст система.
- Валюта по умолчанию — тенге (₸ / KZT).
- Язык вывода — русский.
`;

/** Returns the SKILL.md system prompt with references appended and web-research caveats injected. */
export function loadSkill(name: SkillName): string {
  const entry = SKILL_MAP[name];
  if (!entry) throw new Error(`Unknown skill: ${name}`);
  const refs = entry.refs.length
    ? `\n\n---\n\n## References\n\n${entry.refs.join("\n\n---\n\n")}`
    : "";
  return entry.skill + refs + NO_WEB_RESEARCH_NOTE;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function errorResponse(message: string, status = 500): Response {
  return jsonResponse({ error: message }, status);
}

export function getServiceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Supabase env not configured");
  return createClient(url, key);
}

export interface LovableToolCall<T> {
  args: T;
  raw: unknown;
}

interface LovableOptions {
  model?: string;
  timeoutMs?: number;
}

export async function callLovableWithTool<T>(
  systemPrompt: string,
  userPrompt: string,
  toolName: string,
  toolSchema: Record<string, unknown>,
  opts: LovableOptions = {},
): Promise<LovableToolCall<T>> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY missing");

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 90_000);

  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: opts.model ?? "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: toolName,
              description: `Save ${toolName} structured result for Marketing OS.`,
              parameters: toolSchema,
            },
          },
        ],
        tool_choice: { type: "function", function: { name: toolName } },
      }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      console.error("Lovable AI gateway error", resp.status, text);
      if (resp.status === 429) throw new Error("Превышен лимит AI, попробуйте позже");
      if (resp.status === 402) throw new Error("Закончились кредиты Lovable AI");
      throw new Error(`AI gateway ${resp.status}: ${text.slice(0, 200)}`);
    }

    const data = await resp.json();
    const call = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!call?.function?.arguments) throw new Error("AI did not return structured output");
    const args = JSON.parse(call.function.arguments) as T;
    return { args, raw: data };
  } finally {
    clearTimeout(timeout);
  }
}

export interface ProjectContext {
  project: { id: string; name: string; domain: string | null };
  brief: Record<string, unknown> | null;
  artifacts: Record<string, Record<string, unknown> | null>;
}

/** Pulls everything later commands need from previous Marketing OS steps. */
export async function getProjectContext(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ProjectContext> {
  const [{ data: project, error: pErr }, { data: brief }, { data: arts }] = await Promise.all([
    supabase.from("projects").select("id,name,domain").eq("id", projectId).single(),
    supabase.from("project_briefs").select("*").eq("project_id", projectId).maybeSingle(),
    supabase.from("marketing_os_artifacts").select("command,markdown,payload").eq("project_id", projectId),
  ]);
  if (pErr || !project) throw new Error("Project not found");

  const artifacts: ProjectContext["artifacts"] = {
    creatives: null,
    content: null,
    site_brief: null,
    site_build: null,
  };
  for (const row of arts ?? []) {
    const cmd = (row as { command: string }).command;
    if (cmd in artifacts) artifacts[cmd] = row as Record<string, unknown>;
  }

  return {
    project: {
      id: (project as { id: string }).id,
      name: (project as { name: string }).name,
      domain: (project as { domain: string | null }).domain,
    },
    brief: (brief as Record<string, unknown> | null) ?? null,
    artifacts,
  };
}

/** Upserts an artifact row with the given status — call before/after the AI call. */
export async function upsertArtifact(
  supabase: SupabaseClient,
  projectId: string,
  command: SkillName,
  patch: {
    status: "pending" | "running" | "done" | "error";
    markdown?: string | null;
    payload?: Record<string, unknown> | null;
    error?: string | null;
    created_by?: string | null;
  },
): Promise<void> {
  if (command === "onboarding") {
    throw new Error("onboarding is stored in project_briefs, not marketing_os_artifacts");
  }
  const { error } = await supabase
    .from("marketing_os_artifacts")
    .upsert(
      {
        project_id: projectId,
        command,
        ...patch,
      },
      { onConflict: "project_id,command" },
    );
  if (error) throw new Error(`upsertArtifact failed: ${error.message}`);
}

/** Renders a compact human-readable summary of the brief so prompts stay short. */
export function briefToContext(brief: Record<string, unknown> | null): string {
  if (!brief) return "Бриф ещё не заполнен.";
  const v = brief as Record<string, unknown>;
  const lines: string[] = [];
  const push = (label: string, val: unknown) => {
    if (val === null || val === undefined || val === "") return;
    if (typeof val === "object") {
      lines.push(`- ${label}: ${JSON.stringify(val)}`);
    } else {
      lines.push(`- ${label}: ${val}`);
    }
  };
  push("Ниша", v.niche);
  push("Продукт", v.product);
  push("Целевая аудитория", v.audience);
  push("УТП", v.usp);
  push("География", v.geo);
  push("Тон", v.tone);
  push("Тип продукта", v.product_type);
  push("Месячный бюджет, KZT", v.monthly_budget);
  push("Модель оплаты", v.price_model);
  push("Каналы", v.channels);
  push("Текущие клиенты", v.current_clients);
  push("Прямые конкуренты", v.direct_competitors);
  push("Косвенные конкуренты", v.indirect_competitors);
  push("Отстройка", v.differentiator);
  push("Боли (сырьё)", v.pains_raw);
  push("Сегменты (выходные данные онбординга)", v.segments);
  push("Продуктовая матрица", v.product_matrix);
  push("Сценарии запуска", v.launch_scenarios);
  push("Рекомендованный сценарий", v.recommended_scenario);
  return lines.join("\n");
}
