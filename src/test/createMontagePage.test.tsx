import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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
  fetchVideoStatus: vi.fn(async () => ({ status: "pending" })),
  fetchAgentStatus: vi.fn(async () => ({ status: "generating" })),
  generateAvatarVideo: vi.fn(async () => "vid_1"),
  generateFromClips: vi.fn(async () => "vid_2"),
  generateTemplateVideo: vi.fn(async () => "vid_3"),
  generateVideoAgent: vi.fn(async () => "sess_1"),
  uploadClip: vi.fn(async () => ({ id: "a1", url: "http://x/clip.mp4" })),
}));

import CreateMontage from "@/pages/CreateMontage";
import { generateVideoAgent, fetchAgentStatus } from "@/hooks/useHeygen";

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

  it("монтируется, показывает 4 режима, «Быстро» — по умолчанию", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "AI монтаж" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Быстро/ })).toHaveAttribute("data-state", "active");
    expect(screen.getByRole("tab", { name: /Аватар/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Шаблон/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Клипы/ })).toBeInTheDocument();
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

    fireEvent.change(screen.getByPlaceholderText(/Поиск: имя/), { target: { value: "Ivan" } });
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

  it("показывает готовое видео, когда Video Agent завершился", async () => {
    vi.mocked(fetchAgentStatus).mockResolvedValue({ status: "completed", video_url: "http://x/out.mp4" });
    renderPage();
    fireEvent.change(screen.getByPlaceholderText(/45 секунд/), { target: { value: "тест" } });
    fireEvent.click(screen.getByRole("button", { name: /Собрать видео/ }));
    await waitFor(() => expect(screen.getByText("Готово")).toBeInTheDocument());
    expect(screen.getByText("Скачать MP4")).toBeInTheDocument();
  });
});
