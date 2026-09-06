/**
 * Окно «Устройство и прогрев» в карточке аккаунта: питание телефона зовётся по id телефона,
 * а не по id аккаунта — иначе edge-функция шлёт в PhoneGrid `id: NaN`, и кнопка не работает.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AccountDeviceDialog } from "@/components/publishing/AccountDeviceDialog";
import type { DevicePhone, DeviceStatus } from "@/lib/accountDevices";
import type { PublishAccount } from "@/lib/publishingClient";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useProjectsStore", () => ({ useProjectsStore: () => ({ activeId: "p1" }) }));

const listPhones = vi.fn();
const deviceStatus = vi.fn();
const setPhonePower = vi.fn();
const runWarmup = vi.fn();
vi.mock("@/lib/accountDevices", () => ({
  listPhones: (...a: unknown[]) => listPhones(...a),
  deviceStatus: (...a: unknown[]) => deviceStatus(...a),
  setPhonePower: (...a: unknown[]) => setPhonePower(...a),
  runWarmup: (...a: unknown[]) => runWarmup(...a),
  attachPhone: vi.fn(),
  detachPhone: vi.fn(),
}));

const account = {
  id: "acc1", project_id: "p1", platform: "instagram", account_name: "Клиника Айва", handle: "aiva",
} as unknown as PublishAccount;

const phone: DevicePhone = {
  id: "1001", name: "CP-1", status: 2, statusText: "выключен", remark: "",
  proxyId: "px1", proxyIp: "212.8.248.20", country: "KZ", claimed: true,
  account: { id: "acc1", account_name: "Клиника Айва", handle: "aiva", platform: "instagram" },
  warmup: { day: 3, ready: false, startedAt: "2026-09-04T00:00:00Z", lastRunAt: null, lastState: null },
};

const status: DeviceStatus = {
  phone: { id: "1001", name: "CP-1" },
  warmup: {
    startedAt: "2026-09-04T00:00:00Z", lastRunAt: null, lastState: null,
    plan: { day: 3, ready: false, note: "появляются первые лайки", videos: 20, like: 5, follow: 0, comments: 3 },
  },
  supported: true,
  requirements: { app: "com.instagram.android", version: "412.0.0.35.87", locale: "en-US" },
  history: [],
};

beforeEach(() => {
  listPhones.mockReset().mockResolvedValue([phone]);
  deviceStatus.mockReset().mockResolvedValue(status);
  setPhonePower.mockReset().mockResolvedValue(undefined);
  runWarmup.mockReset().mockResolvedValue({ plan: status.warmup.plan });
});

describe("устройство в карточке аккаунта", () => {
  it("питание зовётся по id телефона, а не аккаунта", async () => {
    render(<AccountDeviceDialog open account={account} onClose={() => {}} />);
    expect(await screen.findByText("День 3 из 15")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Включить" }));
    await waitFor(() => expect(setPhonePower).toHaveBeenCalledWith("p1", "1001", true));
  });

  it("прогрев зовётся по аккаунту", async () => {
    render(<AccountDeviceDialog open account={account} onClose={() => {}} />);
    await screen.findByText("День 3 из 15");
    fireEvent.click(screen.getByRole("button", { name: "Прогреть сегодня" }));
    await waitFor(() => expect(runWarmup).toHaveBeenCalledWith("p1", "acc1"));
  });

  it("без версии под шаблон прогрев недоступен и объясняет почему", async () => {
    deviceStatus.mockResolvedValue({ ...status, supported: false, requirements: { app: "com.zhiliaoapp.musically", version: null, locale: "en-US" } });
    render(<AccountDeviceDialog open account={{ ...account, platform: "tiktok" } as PublishAccount} onClose={() => {}} />);
    expect(await screen.findByText(/сценарий прогрева пока не настроен/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Прогреть сегодня" })).toBeDisabled();
  });
});
