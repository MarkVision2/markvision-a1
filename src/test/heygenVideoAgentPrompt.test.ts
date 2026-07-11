import { describe, expect, it, vi } from "vitest";

// generateVideoAgent talks to HeyGen through the heygen-proxy edge function via
// supabase.functions.invoke — mock just that call and capture the body it sends,
// so we can assert on the exact prompt text built from prompt/montageBrief.
const { invoke } = vi.hoisted(() => ({
  invoke: vi.fn(async () => ({ data: { data: { session_id: "sess_1" } }, error: null })),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke } },
}));

import { estimateAgentPromptOverheadChars, generateVideoAgent, HEYGEN_AGENT_PROMPT_LIMIT } from "@/hooks/useHeygen";

describe("generateVideoAgent prompt construction", () => {
  it("uses the default energetic-editing + music directive when no montageBrief is given", async () => {
    await generateVideoAgent({ prompt: "Сценарий ролика" });
    const body = invoke.mock.calls.at(-1)?.[1]?.body as { agent: { prompt: string } };
    expect(body.agent.prompt).toContain("Сценарий ролика");
    expect(body.agent.prompt).toContain("Монтаж обязан быть энергичным и динамичным");
    expect(body.agent.prompt).toContain("энергичную, динамичную фоновую музыку");
    expect(body.agent.prompt).not.toContain("ТЗ на монтаж");
  });

  it("keeps the energetic-editing + music baseline even with an explicit montageBrief, and adds the brief on top", async () => {
    await generateVideoAgent({
      prompt: "Набор учеников на футбол",
      montageBrief: "футбольная тематика, вставки с тренировками",
    });
    const body = invoke.mock.calls.at(-1)?.[1]?.body as { agent: { prompt: string } };
    expect(body.agent.prompt).toContain("Набор учеников на футбол");
    expect(body.agent.prompt).toContain("Монтаж обязан быть энергичным и динамичным");
    expect(body.agent.prompt).toContain("энергичную, динамичную фоновую музыку");
    expect(body.agent.prompt).toContain(
      "ТЗ на монтаж (приоритетно для темы и стиля — следуй строго, но это дополняет, а не отменяет требование энергичного монтажа и музыки выше): футбольная тематика, вставки с тренировками",
    );
  });

  it("still enforces Russian-language captions regardless of montageBrief", async () => {
    await generateVideoAgent({ prompt: "Текст", montageBrief: "Стиль X" });
    const body = invoke.mock.calls.at(-1)?.[1]?.body as { agent: { prompt: string } };
    expect(body.agent.prompt).toContain("Субтитры на русском языке ОБЯЗАТЕЛЬНЫ");
  });

  it("always requires captions to sit below center, never over the speaker's face", async () => {
    await generateVideoAgent({ prompt: "Сценарий ролика" });
    const body = invoke.mock.calls.at(-1)?.[1]?.body as { agent: { prompt: string } };
    expect(body.agent.prompt).toContain("ниже вертикального центра");
    expect(body.agent.prompt).toContain("не закрывай им лицо говорящего");
  });

  it("requires a continuous caption track, not just occasional keyword popups", async () => {
    await generateVideoAgent({ prompt: "Сценарий ролика" });
    const body = invoke.mock.calls.at(-1)?.[1]?.body as { agent: { prompt: string } };
    expect(body.agent.prompt).toContain("должны идти непрерывно на протяжении всего ролика");
    expect(body.agent.prompt).toContain("а не замена им");
  });

  it("forbids plashka/banner text from being cut off at the frame edge", async () => {
    await generateVideoAgent({ prompt: "Сценарий ролика" });
    const body = invoke.mock.calls.at(-1)?.[1]?.body as { agent: { prompt: string } };
    expect(body.agent.prompt).toContain("не должны обрезаться или выходить за границы экрана");
  });

  it("estimates the real directive overhead so a maxed-out user prompt can never push HeyGen over its 10k limit", async () => {
    // Регрессия: клиентский лимит на ввод пользователя был захардкожен под
    // старую, гораздо более короткую версию директив — когда их несколько раз
    // подряд расширяли (субтитры/позиционирование/энергичность), реальный
    // оверхед вырос почти в 4 раза, а лимит не обновили. HeyGen режет prompt по
    // своему хардлимиту С КОНЦА — там как раз наши директивы — и субтитры
    // тихо переставали появляться. Проверяем, что оценка всегда совпадает с
    // РЕАЛЬНОЙ длиной директив, а не с оценкой на глаз.
    const overheadNoBrief = estimateAgentPromptOverheadChars("9:16", false);
    await generateVideoAgent({ prompt: "X", aspect: "9:16" });
    const bodyNoBrief = invoke.mock.calls.at(-1)?.[1]?.body as { agent: { prompt: string } };
    // "X" + "\n\n" + directives — overhead уже включает эти +2, так что
    // фактическая длина промпта = длина пользовательского текста + overhead.
    expect(bodyNoBrief.agent.prompt.length).toBe("X".length + overheadNoBrief);

    const overheadWithBrief = estimateAgentPromptOverheadChars("9:16", true);
    expect(overheadWithBrief).toBeGreaterThan(overheadNoBrief);

    // Реалистичный «потолок» пользовательского ввода (как в CreateMontage.tsx)
    // с запасом — итоговый prompt не должен превышать хардлимит HeyGen.
    const SAFETY_MARGIN = 200;
    const maxUserChars = HEYGEN_AGENT_PROMPT_LIMIT - overheadWithBrief - SAFETY_MARGIN;
    const userPrompt = "п".repeat(Math.floor(maxUserChars * 0.6));
    const montageBrief = "б".repeat(Math.ceil(maxUserChars * 0.4));
    await generateVideoAgent({ prompt: userPrompt, aspect: "9:16", montageBrief });
    const body = invoke.mock.calls.at(-1)?.[1]?.body as { agent: { prompt: string } };
    expect(body.agent.prompt.length).toBeLessThan(HEYGEN_AGENT_PROMPT_LIMIT);
  });
});
