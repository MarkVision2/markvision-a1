import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Изолируем страницу от Supabase-зависимого стора проектов.
vi.mock("@/hooks/useProjectsStore", () => ({
  useProjectsStore: () => ({ activeId: "render-test-project" }),
}));

import AiAgents from "@/pages/AiAgents";

const renderPage = () =>
  render(
    <MemoryRouter>
      <AiAgents />
    </MemoryRouter>,
  );

describe("AiAgents page", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("монтируется и показывает заголовок раздела и KPI", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "AI агенты" })).toBeInTheDocument();
    expect(screen.getByText("Всего агентов")).toBeInTheDocument();
    expect(screen.getByText("Каналов подключено")).toBeInTheDocument();
  });

  it("рендерит карточку засеянного агента-черновика", () => {
    renderPage();
    expect(screen.getByText("Администратор клиники")).toBeInTheDocument();
    expect(screen.getByText("Черновик")).toBeInTheDocument();
  });

  it("открывает диалог создания агента по кнопке", () => {
    renderPage();
    const header = screen.getByRole("banner");
    fireEvent.click(within(header).getByRole("button", { name: /Создать агента/i }));
    expect(screen.getByText("Новый ИИ-агент")).toBeInTheDocument();
    // Каналы в форме — WhatsApp и Instagram
    expect(screen.getAllByText("WhatsApp").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Instagram").length).toBeGreaterThan(0);
  });
});
