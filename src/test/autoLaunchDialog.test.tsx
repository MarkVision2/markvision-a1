/**
 * Диалог авто-запуска рендерится и сохраняет ровно то, что показал.
 * Тест ловит то, чего не видит typecheck: порядок хуков, недостающие
 * пропсы примитивов и рассинхрон формы с патчем кабинета.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AutoLaunchDialog } from "@/components/ads/AutoLaunchDialog";
import type { AdCabinet } from "@/types/ads";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const cabinet: AdCabinet = {
  id: "c1",
  name: "Кабинет Алматы",
  externalId: "123456",
  online: true,
  type: "Личный",
  spend: 0,
  leads: 0,
  leadCost: 0,
  sales: 0,
  revenue: 0,
  adAccountId: "act_123456",
  pageId: "777",
  pixelId: "999",
  websiteUrl: "https://example.com",
  dailyBudget: 5000,
  currency: "KZT",
  timezone: "Asia/Almaty",
  launchHour: 9,
  daysOfWeek: [1, 2, 3, 4, 5],
  targetGeo: ["Алматы"],
  creativeMediaUrls: ["https://res.cloudinary.com/demo/a.jpg"],
};

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AutoLaunchDialog", () => {
  it("показывает расписание и цель, выведенную из настроек кабинета", () => {
    render(
      <AutoLaunchDialog open cabinet={cabinet} onOpenChange={() => {}} onSave={vi.fn()} />,
    );
    expect(screen.getByText(/Кабинет Алматы/)).toBeTruthy();
    expect(screen.getByText(/Лиды с сайта/)).toBeTruthy();
    expect(screen.getByText(/Пн, Вт, Ср, Чт, Пт в 09:00/)).toBeTruthy();
  });

  it("сохраняет патч с настройками, которые видел человек", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <AutoLaunchDialog open cabinet={cabinet} onOpenChange={() => {}} onSave={onSave} />,
    );

    fireEvent.change(screen.getByLabelText("Гео"), {
      target: { value: "Алматы, Астана" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const [id, patch] = onSave.mock.calls[0];
    expect(id).toBe("c1");
    expect(patch.targetGeo).toEqual(["Алматы", "Астана"]);
    expect(patch.daysOfWeek).toEqual([1, 2, 3, 4, 5]);
    expect(patch.launchHour).toBe(9);
  });

  it("снятие дня недели попадает в патч", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <AutoLaunchDialog open cabinet={cabinet} onOpenChange={() => {}} onSave={onSave} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "понедельник" }));
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][1].daysOfWeek).toEqual([2, 3, 4, 5]);
  });

  it("недонастроенный кабинет с включённым авто-запуском не сохраняется", async () => {
    const onSave = vi.fn();
    const broken: AdCabinet = { ...cabinet, autoLaunchEnabled: true, pixelId: "" };
    render(
      <AutoLaunchDialog open cabinet={broken} onOpenChange={() => {}} onSave={onSave} />,
    );

    expect(screen.getByText(/нужен пиксель/)).toBeTruthy();
    const save = screen.getByRole("button", { name: "Сохранить" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("закрытый диалог ничего не рендерит", () => {
    const { container } = render(
      <AutoLaunchDialog open={false} cabinet={cabinet} onOpenChange={() => {}} onSave={vi.fn()} />,
    );
    expect(container.textContent).toBe("");
  });
});
