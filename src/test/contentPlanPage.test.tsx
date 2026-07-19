import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ContentPlan from "@/pages/ContentPlan";

vi.mock("@/hooks/useContentPlan", () => ({
  useContentPlan: () => ({
    items: [],
    summary: {
      total: 0,
      scheduled: 0,
      awaitingCreation: 0,
      published: 0,
      avgReach: 0,
      avgCodewordComments: 0,
      leads: 0,
      registrations: 0,
      webinarAttended: 0,
      paid: 0,
      revenue: 0,
    },
    upcomingQueue: [],
    queueCount: 0,
    loading: false,
    error: null,
    tableMissing: false,
    refetch: vi.fn(),
    update: vi.fn(),
    adoptSynthetic: vi.fn(),
  }),
}));

vi.mock("@/hooks/useInstagramAccount", () => ({
  useInstagramAccount: () => ({
    account: { username: "test" },
    sync: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@/hooks/useProjectsStore", () => ({
  useProjectsStore: () => ({ activeId: "proj-1" }),
}));

const addDialog = vi.fn((_props: unknown) => (
  <div data-testid="autopost-add-dialog">AutopostAddDialog</div>
));

vi.mock("@/pages/AutoPost", async () => {
  const actual = await vi.importActual<typeof import("@/pages/AutoPost")>("@/pages/AutoPost");
  return {
    __esModule: true,
    default: () => <div data-testid="autopost-embedded">AutoPost</div>,
    AutopostAddDialog: (props: unknown) => {
      addDialog(props);
      return <div data-testid="autopost-add-dialog">AutopostAddDialog</div>;
    },
  };
});

describe("ContentPlan uses AutopostAddDialog", () => {
  beforeEach(() => {
    addDialog.mockClear();
  });

  it("opens the same Autopost composer on Новая публикация", () => {
    render(
      <MemoryRouter>
        <ContentPlan />
      </MemoryRouter>,
    );

    expect(screen.queryByTestId("autopost-add-dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Новая публикация/i }));
    expect(screen.getByTestId("autopost-add-dialog")).toBeTruthy();
    expect(addDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj-1",
        hasAccount: true,
      }),
    );
  });

  it("shows from-today period, upcoming queue rail, and planning list (no KPI wall)", () => {
    render(
      <MemoryRouter>
        <ContentPlan />
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: /С сегодня/i })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /Сводка за период/i })).toBeNull();
    expect(screen.getByRole("heading", { name: /Ближайшие в очереди MarkVision/i })).toBeTruthy();
    expect(screen.getByText(/В очереди пусто/i)).toBeTruthy();
    expect(screen.getByText(/Список ·/i)).toBeTruthy();
  });
});
