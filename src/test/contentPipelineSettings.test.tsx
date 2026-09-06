/**
 * Настройки контент-конвейера: проверка формы зеркалит CHECK-ограничения таблицы,
 * строка читается и сохраняется upsert'ом по project_id.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useProjectsStore", () => ({ useProjectsStore: () => ({ activeId: "p1" }) }));

const db = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  upsert: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: db.row, error: null }) }) }),
      upsert: (...args: unknown[]) => { db.upsert(...args); return Promise.resolve({ error: null }); },
    }),
  },
}));

import { ContentPipelineSettings, fromForm, PIPELINE_DEFAULTS } from "@/components/settings/ContentPipelineSettings";

const baseForm = {
  enabled: true, language: "ru", wordsMin: "90", wordsMax: "130", tone: "", context: "", forbidden: "",
  model: "gpt-4o-mini", avatar: "", voice: "", frame: "720x1280", timeout: "20", attempts: "3", parallel: "1",
  daily: "10", monthly: "100", chat: "",
};

describe("fromForm", () => {
  it("умолчания проходят и дают строку таблицы", () => {
    const r = fromForm(baseForm);
    expect("row" in r && r.row).toEqual(PIPELINE_DEFAULTS);
  });
  it("нарушения CHECK ловятся до запроса", () => {
    expect(fromForm({ ...baseForm, wordsMax: "50" })).toEqual({ error: expect.stringMatching(/не меньше минимума/) });
    expect(fromForm({ ...baseForm, attempts: "11" })).toEqual({ error: expect.stringMatching(/от 1 до 10/) });
    expect(fromForm({ ...baseForm, timeout: "0" })).toEqual({ error: expect.stringMatching(/1 до 180/) });
    expect(fromForm({ ...baseForm, daily: "-1" })).toEqual({ error: expect.stringMatching(/не меньше 0/) });
    expect(fromForm({ ...baseForm, model: " " })).toEqual({ error: expect.stringMatching(/модель/) });
  });
  it("запреты разбиваются по запятым и строкам без дублей, пустые тексты — null", () => {
    const r = fromForm({ ...baseForm, forbidden: "гарантируем, лучший\nгарантируем", tone: "  ", frame: "1080x1920" });
    if (!("row" in r)) throw new Error(r.error);
    expect(r.row.forbidden_phrases).toEqual(["гарантируем", "лучший"]);
    expect(r.row.tone_of_voice).toBeNull();
    expect(r.row.video_width).toBe(1080);
    expect(r.row.video_height).toBe(1920);
  });
});

describe("ContentPipelineSettings", () => {
  beforeEach(() => { db.row = null; db.upsert.mockClear(); });

  it("без строки — умолчания и подсказка; сохранение делает upsert по project_id", async () => {
    render(<ContentPipelineSettings />);
    await waitFor(() => expect((screen.getByLabelText("Слов, минимум") as HTMLInputElement).value).toBe("90"));
    expect(screen.getByText(/Пока действуют умолчания/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("ID аватара"), { target: { value: "av_1" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(db.upsert).toHaveBeenCalled());
    const [row, opts] = db.upsert.mock.calls[0] as [Record<string, unknown>, { onConflict: string }];
    expect(row.project_id).toBe("p1");
    expect(row.heygen_avatar_id).toBe("av_1");
    expect(opts.onConflict).toBe("project_id");
  });

  it("строка из базы подставляется в форму", async () => {
    db.row = { ...PIPELINE_DEFAULTS, script_words_min: 60, tone_of_voice: "по делу", forbidden_phrases: ["гарантируем"] };
    render(<ContentPipelineSettings />);
    await waitFor(() => expect((screen.getByLabelText("Слов, минимум") as HTMLInputElement).value).toBe("60"));
    expect((screen.getByLabelText("Тон голоса") as HTMLTextAreaElement).value).toBe("по делу");
    expect((screen.getByLabelText(/Запрещённые фразы/) as HTMLInputElement).value).toBe("гарантируем");
    expect(screen.queryByText(/Пока действуют умолчания/)).toBeNull();
  });

  it("неверное значение не уходит в базу", async () => {
    render(<ContentPipelineSettings />);
    await waitFor(() => expect((screen.getByLabelText("Слов, минимум") as HTMLInputElement).value).toBe("90"));
    fireEvent.change(screen.getByLabelText("Попыток на тему"), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/от 1 до 10/);
    expect(db.upsert).not.toHaveBeenCalled();
  });
});
