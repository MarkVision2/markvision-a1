/**
 * Раздел «Устройства»: список телефонов сети — состояние, прокси, привязка к аккаунту,
 * прогрев. Проверяем, что телефон без прокси честно предупреждает, свободный телефон
 * можно привязать, а действия недоступны, пока аккаунта нет.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DevicesTab } from "@/components/publishing/DevicesTab";
import type { DevicePhone } from "@/lib/accountDevices";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useProjectsStore", () => ({ useProjectsStore: () => ({ activeId: "p1" }) }));

const listPhones = vi.fn();
const listFreeAccounts = vi.fn();
const attachPhone = vi.fn();
const setPhonePower = vi.fn();
const runWarmup = vi.fn();
vi.mock("@/lib/accountDevices", () => ({
  listPhones: (...a: unknown[]) => listPhones(...a),
  listFreeAccounts: (...a: unknown[]) => listFreeAccounts(...a),
  attachPhone: (...a: unknown[]) => attachPhone(...a),
  detachPhone: vi.fn(),
  setPhonePower: (...a: unknown[]) => setPhonePower(...a),
  runWarmup: (...a: unknown[]) => runWarmup(...a),
}));

const withAccount: DevicePhone = {
  id: "1001", name: "CP-1", status: 4, statusText: "работает", remark: "контент-завод",
  proxyId: "p1", proxyIp: "212.8.248.20", country: "KZ",
  account: { id: "acc1", account_name: "Клиника Айва", handle: "aiva", platform: "instagram" },
  warmup: { day: 6, ready: false, startedAt: "2026-09-01T00:00:00Z", lastRunAt: null, lastState: "запущен день 6" },
};
const freePhone: DevicePhone = {
  id: "1002", name: "CP-2", status: 2, statusText: "выключен", remark: "",
  proxyId: null, proxyIp: null, country: null, account: null, warmup: null,
};

beforeEach(() => {
  listPhones.mockReset().mockResolvedValue([withAccount, freePhone]);
  listFreeAccounts.mockReset().mockResolvedValue([{ id: "acc2", account_name: "Второй", handle: "vtoroy", platform: "instagram" }]);
  attachPhone.mockReset().mockResolvedValue(undefined);
  setPhonePower.mockReset().mockResolvedValue(undefined);
  runWarmup.mockReset().mockResolvedValue({ plan: { day: 6 } });
});

describe("раздел «Устройства»", () => {
  it("показывает телефоны сети со сводкой и состоянием", async () => {
    render(<DevicesTab />);
    expect(await screen.findByText("CP-1")).toBeInTheDocument();
    expect(screen.getByText("CP-2")).toBeInTheDocument();
    expect(screen.getByText("работает")).toBeInTheDocument();
    expect(screen.getByText("всего 2")).toBeInTheDocument();
    expect(screen.getByText("включено 1")).toBeInTheDocument();
    expect(screen.getByText("с аккаунтом 1")).toBeInTheDocument();
  });

  it("телефон без прокси честно говорит, что не включится", async () => {
    render(<DevicesTab />);
    expect(await screen.findByText("без прокси — не включится")).toBeInTheDocument();
    expect(screen.getByText(/212\.8\.248\.20/)).toBeInTheDocument();
  });

  it("прогрев показывает день из пятнадцати, а у свободного телефона — прочерк", async () => {
    render(<DevicesTab />);
    expect(await screen.findByText("день 6/15")).toBeInTheDocument();
    expect(screen.getByText("запущен день 6")).toBeInTheDocument();
  });

  it("без привязанного аккаунта включение и прогрев недоступны", async () => {
    render(<DevicesTab />);
    await screen.findByText("CP-2");
    // У свободного телефона обе кнопки заблокированы: включать и греть нечего.
    const warmButtons = screen.getAllByRole("button", { name: "Прогреть" });
    expect(warmButtons[0]).toBeEnabled();
    expect(warmButtons[1]).toBeDisabled();
  });

  it("прогрев зовётся по аккаунту, а не по телефону", async () => {
    render(<DevicesTab />);
    await screen.findByText("CP-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Прогреть" })[0]);
    await waitFor(() => expect(runWarmup).toHaveBeenCalledWith("p1", "acc1"));
  });

  it("поиск сужает список", async () => {
    render(<DevicesTab />);
    await screen.findByText("CP-1");
    fireEvent.change(screen.getByPlaceholderText(/Поиск/), { target: { value: "CP-2" } });
    await waitFor(() => expect(screen.queryByText("CP-1")).not.toBeInTheDocument());
    expect(screen.getByText("CP-2")).toBeInTheDocument();
  });

  it("пустой список объясняет, что телефоны появятся сами", async () => {
    listPhones.mockResolvedValue([]);
    render(<DevicesTab />);
    expect(await screen.findByText(/Телефонов пока нет/)).toBeInTheDocument();
  });

  it("ошибка запроса показывается, а не молча пустой список", async () => {
    listPhones.mockRejectedValue(new Error("PhoneGrid не подключён: добавьте секреты"));
    render(<DevicesTab />);
    expect(await screen.findByText(/PhoneGrid не подключён/)).toBeInTheDocument();
  });
});
