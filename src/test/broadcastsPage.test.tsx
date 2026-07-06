import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/hooks/useProjectsStore", () => ({
  useProjectsStore: () => ({ activeId: "bcast-render-project" }),
}));
vi.mock("@/hooks/useLeadContacts", () => ({
  useLeadContacts: () => ({
    contacts: [
      { id: "1", name: "Иван", phone: "+77001112233", source: "instagram", stageKey: "new" },
      { id: "2", name: "Пётр", phone: "+77004445566", source: "whatsapp", stageKey: "paid" },
    ],
    loading: false,
    refetch: () => {},
  }),
}));
vi.mock("@/hooks/useWhatsAppConfig", () => ({
  useWhatsAppConfig: () => ({ config: { connected: false }, setWhatsapp: () => {} }),
}));

import Broadcasts from "@/pages/Broadcasts";

const renderPage = () =>
  render(
    <MemoryRouter>
      <Broadcasts />
    </MemoryRouter>,
  );

describe("Broadcasts page", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("монтируется, показывает заголовок и пустое состояние", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Рассылка" })).toBeInTheDocument();
    expect(screen.getByText("Всего рассылок")).toBeInTheDocument();
    expect(screen.getByText("Рассылок пока нет")).toBeInTheDocument();
    // счётчик контактов из мок-базы
    expect(screen.getByText("Контактов в базе")).toBeInTheDocument();
  });

  it("открывает диалог создания рассылки", () => {
    renderPage();
    const header = screen.getByRole("banner");
    fireEvent.click(within(header).getByRole("button", { name: /Создать рассылку/i }));
    expect(screen.getByText("Новая рассылка")).toBeInTheDocument();
    expect(screen.getAllByText("WhatsApp").length).toBeGreaterThan(0);
    expect(screen.getAllByText("SMS").length).toBeGreaterThan(0);
    expect(screen.getByText("База CRM")).toBeInTheDocument();
    expect(screen.getByText("Загрузить список")).toBeInTheDocument();
  });
});
