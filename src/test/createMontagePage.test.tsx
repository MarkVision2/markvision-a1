import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Активный проект (клиент) — дефолты и Telegram привязаны к проекту.
vi.mock("@/hooks/useProjectsStore", () => ({
  useProjectsStore: () => ({ activeId: "proj-1" }),
}));

// Моки HeyGen-хука: аватары (обычный + видео-аватар) и голоса с превью.
vi.mock("@/hooks/useHeygen", () => ({
  fetchAvatars: vi.fn(async () => [
    { id: "av1", name: "Anna", kind: "avatar", mine: false, preview_image_url: "http://x/anna.png" },
    { id: "tp1", name: "Мой аватар", kind: "talking_photo", mine: true, preview_image_url: "http://x/me.png" },
    { id: "av2", name: "Bob", kind: "avatar", mine: false, preview_image_url: "http://x/bob.png" },
  ]),
  fetchVoices: vi.fn(async () => [
    { voice_id: "v-ru", name: "Ivan", language: "Russian", gender: "Male", preview_audio: "http://x/ivan.mp3" },
    { voice_id: "v-en", name: "John", language: "English", gender: "Male" },
  ]),
  fetchTemplates: vi.fn(async () => []),
  fetchTemplateDetail: vi.fn(async () => []),
  fetchQuota: vi.fn(async () => ({ remaining_quota: 100 })),
  fetchVideoStatus: vi.fn(async () => ({ status: "pending" })),
  generateAvatarVideo: vi.fn(async () => "vid_1"),
  generateFromClips: vi.fn(async () => "vid_2"),
  generateTemplateVideo: vi.fn(async () => "vid_3"),
  generateVideoAgent: vi.fn(async () => "sess_1"),
  uploadClip: vi.fn(async () => ({ id: "a1", url: "http://x/clip.mp4" })),
  // Нужны HeygenUsagePanel, который рендерится на этой же странице ниже формы.
  fetchAccountStats: vi.fn(async () => ({})),
  fetchRecentVideos: vi.fn(async () => []),
}));

// enqueueAgentJob шлётся fire-and-forget при отправке брифа — воркер сам
// доставит готовое видео (heygen_jobs), эта страница его не ждёт и не поллит.
vi.mock("@/lib/heygenUsage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/heygenUsage")>();
  return { ...actual, enqueueAgentJob: vi.fn(async () => {}) };
});

// Эксклюзивная привязка аватар→проект — по умолчанию ничего не закреплено
// (пустая карта), конкретные тесты переопределяют fetchAllAvatarAssignments.
vi.mock("@/lib/heygenAvatarAssignments", () => ({
  fetchAllAvatarAssignments: vi.fn(async () => new Map()),
  assignAvatarToProject: vi.fn(async () => {}),
  unassignAvatar: vi.fn(async () => {}),
}));

import CreateMontage from "@/pages/CreateMontage";
import { generateVideoAgent } from "@/hooks/useHeygen";
import { assignAvatarToProject, fetchAllAvatarAssignments, unassignAvatar } from "@/lib/heygenAvatarAssignments";

const renderPage = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CreateMontage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe("CreateMontage page", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(fetchAllAvatarAssignments).mockReset().mockResolvedValue(new Map());
    vi.mocked(assignAvatarToProject).mockReset().mockResolvedValue(undefined);
    vi.mocked(unassignAvatar).mockReset().mockResolvedValue(undefined);
  });

  it("монтируется, показывает режимы + «Готовые», «Быстро» — по умолчанию", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "AI монтаж" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Быстро/ })).toHaveAttribute("data-state", "active");
    expect(screen.queryByRole("tab", { name: /Аватар/ })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Шаблон/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Из клипов/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Готовые/ })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/45 секунд/)).toBeInTheDocument();
  });

  it("подгружает аватары, показывает раздел «Мои аватары» и выбирает аватар с превью", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Anna")).toBeInTheDocument());
    expect(screen.getByText("Мои аватары")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Anna"));
    // появилась панель выбранного аватара
    expect(screen.getByText("Выбранный аватар")).toBeInTheDocument();
  });

  it("подгружает голоса и фильтрует поиском", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Ivan")).toBeInTheDocument());
    expect(screen.getByText("John")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/Поиск/), { target: { value: "Ivan" } });
    expect(screen.getByText("Ivan")).toBeInTheDocument();
    expect(screen.queryByText("John")).not.toBeInTheDocument();
  });

  it("выбирает голос — появляется чип выбранного голоса", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Ivan")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Ivan"));
    // чип содержит имя, язык и пол в одном узле
    expect(
      screen.getByText((_, el) => !!el && /Ivan/.test(el.textContent ?? "") && /Russian/.test(el.textContent ?? "") && el.tagName === "SPAN"),
    ).toBeInTheDocument();
  });

  it("сохраняет аватар «по умолчанию» и подставляет его при повторном заходе", async () => {
    const first = renderPage();
    await waitFor(() => expect(screen.getByText("Anna")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Anna"));
    fireEvent.click(screen.getByRole("button", { name: /Сделать по умолчанию/ }));
    first.unmount();

    // Новый заход — аватар уже выбран из дефолта.
    renderPage();
    await waitFor(() => expect(screen.getByText("Выбранный аватар")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /По умолчанию/ })).toBeInTheDocument();
  });

  it("запускает Video Agent из текста", async () => {
    renderPage();
    fireEvent.change(screen.getByPlaceholderText(/45 секунд/), {
      target: { value: "Сделай ролик про запуск продукта" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Собрать видео/ }));
    await waitFor(() =>
      expect(generateVideoAgent).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: "Сделай ролик про запуск продукта" }),
      ),
    );
  });

  it("после отправки ТЗ сразу показывает подтверждение вместо бесконечного статуса", async () => {
    renderPage();
    fireEvent.change(screen.getByPlaceholderText(/45 секунд/), { target: { value: "тест" } });
    fireEvent.click(screen.getByRole("button", { name: /Собрать видео/ }));
    // Быстрое создание — fire-and-forget: подтверждение приходит сразу же,
    // без опроса статуса HeyGen (он был ненадёжен и мог висеть часами).
    await waitFor(() => expect(screen.getByText("Видео успешно отправлено на монтаж")).toBeInTheDocument());
    // Поле очищено — готово для следующего брифа («кнопка создать новое видео»).
    expect(screen.getByPlaceholderText(/45 секунд/)).toHaveValue("");
    expect(screen.queryByText("Готово")).not.toBeInTheDocument();
  });

  it("передаёт отдельное ТЗ на монтаж в generateVideoAgent, не смешивая со сценарием", async () => {
    renderPage();
    fireEvent.change(screen.getByPlaceholderText(/футбольная тематика/), {
      target: { value: "футбольная тематика, вставки с тренировками" },
    });
    fireEvent.change(screen.getByPlaceholderText(/45 секунд/), {
      target: { value: "Набор учеников на футбол" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Собрать видео/ }));
    await waitFor(() =>
      expect(generateVideoAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: "Набор учеников на футбол",
          montageBrief: "футбольная тематика, вставки с тренировками",
        }),
      ),
    );
    // Поле ТЗ на монтаж тоже очищается после отправки, как и сценарий.
    await waitFor(() => expect(screen.getByPlaceholderText(/футбольная тематика/)).toHaveValue(""));
  });

  it("принимает длинную раскадровку в ТЗ на монтаж (в пределах лимита HeyGen)", async () => {
    renderPage();
    // Реальная раскадровка на несколько кадров с таймингами, репликами и
    // b-roll — HeyGen Video Agent допускает промпт до 10 000 символов, наш
    // запас — 9000 на сценарий+ТЗ, чтобы не упереться в отказ HeyGen.
    const storyboard = "# ТЗ на монтаж Reels\n" + "Кадр: реплика, b-roll, монтаж, эффект.\n".repeat(150);
    expect(storyboard.length).toBeGreaterThan(3000);
    expect(storyboard.length).toBeLessThan(9000);

    fireEvent.change(screen.getByPlaceholderText(/футбольная тематика/), { target: { value: storyboard } });
    fireEvent.change(screen.getByPlaceholderText(/45 секунд/), { target: { value: "Сценарий" } });
    const submit = screen.getByRole("button", { name: /Собрать видео/ });
    expect(submit).not.toBeDisabled();

    fireEvent.click(submit);
    await waitFor(() =>
      expect(generateVideoAgent).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: "Сценарий", montageBrief: storyboard.trim() }),
      ),
    );
  });

  it("блокирует отправку и предупреждает, если сценарий + ТЗ превышают лимит", async () => {
    renderPage();
    const tooLong = "x".repeat(9500);
    fireEvent.change(screen.getByPlaceholderText(/45 секунд/), { target: { value: tooLong } });
    expect(screen.getByText(/слишком длинно, HeyGen отклонит запрос/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Собрать видео/ })).toBeDisabled();
  });

  it("скрывает аватар, закреплённый за другим проектом, но показывает его в «Управлять»", async () => {
    vi.mocked(fetchAllAvatarAssignments).mockResolvedValue(new Map([["avatar:av2", "other-project"]]));
    renderPage();
    await waitFor(() => expect(screen.getByText("Anna")).toBeInTheDocument());
    expect(screen.queryByText("Bob")).not.toBeInTheDocument();

    // Аватар и голос оба имеют кнопку «Управлять» на этой же вкладке —
    // AvatarPicker рендерится первым.
    fireEvent.click(screen.getAllByRole("button", { name: /Управлять/ })[0]);
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("закрепляет аватар за текущим проектом из режима «Управлять»", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Anna")).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("button", { name: /Управлять/ })[0]);

    const lockButtons = screen.getAllByTitle("Закрепить только за этим проектом (скроется у остальных)");
    fireEvent.click(lockButtons[0]);

    await waitFor(() => expect(assignAvatarToProject).toHaveBeenCalledWith("proj-1", expect.any(String), expect.stringMatching(/^(avatar|talking_photo)$/)));
  });
});
