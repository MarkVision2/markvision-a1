// Marketing OS chat — streaming диалог стратега с пользователем.
// System prompt = onboarding SKILL.md + контекст проекта (бриф, артефакты).
// Модель — Claude через Lovable AI Gateway (тот же LOVABLE_API_KEY).
// Поток ответа стримится в браузер через SSE-совместимый text/event-stream.

import {
  briefToContext,
  corsHeaders,
  errorResponse,
  getProjectContext,
  getServiceClient,
  loadSkill,
} from "../_lib/marketing_os.ts";

interface Body {
  projectId: string;
  userMessage: string;
  createdBy?: string;
}

const MODEL = "anthropic/claude-sonnet-4-6";

const ROLE_SYSTEM_NOTE = `
---

## Режим чата

Сейчас ты не строишь финальный документ онбординга — ты ведёшь диалог со стратегом проекта.
- Отвечай коротко, по делу, на русском.
- Если не хватает данных по нужному разделу marketing-os — спрашивай ОДНИМ пунктом за сообщение.
- Когда даёшь рекомендацию — давай её сразу и обосновывай 1-2 строками.
- Можешь предлагать конкретные правки (новые сегменты, креативы, варианты офферов).
- Если пользователь просит «перезапусти онбординг», «сделай заново стратегию», «обнови креативы» и т.п. — скажи на какой кнопке нажать (Стратегия / Креативы / Контент / Сайт ТЗ / Сборка сайта).
`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = (await req.json()) as Body;
    if (!body.projectId || !body.userMessage?.trim()) {
      return errorResponse("projectId и userMessage обязательны", 400);
    }
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) return errorResponse("LOVABLE_API_KEY missing");

    const supabase = getServiceClient();

    // 1) сохраняем сообщение пользователя
    await supabase.from("marketing_os_chat_messages").insert({
      project_id: body.projectId,
      role: "user",
      content: body.userMessage,
      created_by: body.createdBy ?? null,
    });

    // 2) собираем контекст: бриф + артефакты + последние 20 сообщений
    const ctx = await getProjectContext(supabase, body.projectId);
    const { data: history } = await supabase
      .from("marketing_os_chat_messages")
      .select("role,content")
      .eq("project_id", body.projectId)
      .order("created_at", { ascending: true })
      .limit(40);

    const artifactsSummary = (Object.entries(ctx.artifacts) as [string, Record<string, unknown> | null][])
      .filter(([, v]) => v)
      .map(([k, v]) => `\n--- ${k} ---\n${(v?.markdown as string | undefined)?.slice(0, 2000) ?? "(payload)"}\n`)
      .join("");

    const systemPrompt = `${loadSkill("onboarding")}${ROLE_SYSTEM_NOTE}

---

## Контекст текущего проекта

Проект: ${ctx.project.name}${ctx.project.domain ? ` (${ctx.project.domain})` : ""}

Бриф (project_briefs):
${briefToContext(ctx.brief)}

Готовые артефакты команд marketing-os:
${artifactsSummary || "(пока ничего не сгенерировано)"}`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...(history ?? []).map((m) => ({
        role: (m as { role: string }).role,
        content: (m as { content: string }).content,
      })),
    ];

    // 3) стримим ответ из Lovable Gateway клиенту, параллельно собирая полный текст для записи
    const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: MODEL, messages, stream: true }),
    });

    if (!upstream.ok || !upstream.body) {
      const t = await upstream.text().catch(() => "");
      console.error("Lovable gateway error", upstream.status, t);
      if (upstream.status === 429) return errorResponse("Превышен лимит AI", 429);
      if (upstream.status === 402) return errorResponse("Закончились кредиты Lovable AI", 402);
      return errorResponse(`AI gateway ${upstream.status}`);
    }

    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let assistantText = "";

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = upstream.body!.getReader();
        let buffer = "";
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              if (!line.startsWith("data:")) continue;
              const payload = line.slice(5).trim();
              if (!payload || payload === "[DONE]") continue;
              try {
                const json = JSON.parse(payload);
                const delta: string | undefined = json?.choices?.[0]?.delta?.content;
                if (delta) {
                  assistantText += delta;
                  controller.enqueue(encoder.encode(delta));
                }
              } catch {
                // ignore non-JSON SSE keepalives
              }
            }
          }
        } catch (e) {
          console.error("stream error", e);
        } finally {
          controller.close();
          // 4) записываем итоговое сообщение ассистента
          if (assistantText.trim()) {
            await supabase.from("marketing_os_chat_messages").insert({
              project_id: body.projectId,
              role: "assistant",
              content: assistantText,
              created_by: null,
            });
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (e) {
    console.error("marketing-os-chat error", e);
    return errorResponse(e instanceof Error ? e.message : String(e));
  }
});
