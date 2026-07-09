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

import CreateMontage from "@/pages/CreateMontage";
import { generateVideoAgent } from "@/hooks/useHeygen";

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
  beforeEach(() => localStorage.clear());

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
});
