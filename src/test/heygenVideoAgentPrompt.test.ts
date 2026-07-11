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

import { generateVideoAgent } from "@/hooks/useHeygen";

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
});
