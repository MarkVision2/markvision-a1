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
  it("uses the default energetic-editing directive when no montageBrief is given", async () => {
    await generateVideoAgent({ prompt: "Сценарий ролика" });
    const body = invoke.mock.calls.at(-1)?.[1]?.body as { agent: { prompt: string } };
    expect(body.agent.prompt).toContain("Сценарий ролика");
    expect(body.agent.prompt).toContain("Монтаж энергичный: частая смена планов");
    expect(body.agent.prompt).not.toContain("ТЗ на монтаж");
  });

  it("prioritizes an explicit montageBrief over the default editing directive", async () => {
    await generateVideoAgent({
      prompt: "Набор учеников на футбол",
      montageBrief: "футбольная тематика, вставки с тренировками",
    });
    const body = invoke.mock.calls.at(-1)?.[1]?.body as { agent: { prompt: string } };
    expect(body.agent.prompt).toContain("Набор учеников на футбол");
    expect(body.agent.prompt).toContain("ТЗ на монтаж (приоритетно, следуй строго): футбольная тематика, вставки с тренировками");
    expect(body.agent.prompt).not.toContain("Монтаж энергичный: частая смена планов");
  });

  it("still enforces Russian-language captions regardless of montageBrief", async () => {
    await generateVideoAgent({ prompt: "Текст", montageBrief: "Стиль X" });
    const body = invoke.mock.calls.at(-1)?.[1]?.body as { agent: { prompt: string } };
    expect(body.agent.prompt).toContain("Субтитры на русском языке обязательны");
  });

  it("always requires captions to sit below center, never over the speaker's face", async () => {
    await generateVideoAgent({ prompt: "Сценарий ролика" });
    const body = invoke.mock.calls.at(-1)?.[1]?.body as { agent: { prompt: string } };
    expect(body.agent.prompt).toContain("ниже вертикального центра");
    expect(body.agent.prompt).toContain("не закрывай им лицо говорящего");
  });
});
