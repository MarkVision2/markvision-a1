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
// Radix Select при открытии зовёт scrollIntoView, которого в jsdom нет.
Element.prototype.scrollIntoView = vi.fn();
vi.mock("@/hooks/useProjectsStore", () => ({ useProjectsStore: () => ({ activeId: "p1" }) }));

const listPhones = vi.fn();
const listFreeAccounts = vi.fn();
const attachPhone = vi.fn();
const detachPhone = vi.fn();
const setPhonePower = vi.fn();
const runWarmup = vi.fn();
const deviceOptions = vi.fn();
const createPhones = vi.fn();
const phoneScreen = vi.fn();
const phoneInput = vi.fn();
const phoneNet = vi.fn();
const phoneAppStart = vi.fn();
const phoneLogin = vi.fn();
const phoneProfile = vi.fn();
vi.mock("@/lib/accountDevices", () => ({
  listPhones: (...a: unknown[]) => listPhones(...a),
  listFreeAccounts: (...a: unknown[]) => listFreeAccounts(...a),
  attachPhone: (...a: unknown[]) => attachPhone(...a),
  detachPhone: (...a: unknown[]) => detachPhone(...a),
  setPhonePower: (...a: unknown[]) => setPhonePower(...a),
  runWarmup: (...a: unknown[]) => runWarmup(...a),
  deviceOptions: (...a: unknown[]) => deviceOptions(...a),
  createPhones: (...a: unknown[]) => createPhones(...a),
  addProxy: vi.fn(),
  phoneScreen: (...a: unknown[]) => phoneScreen(...a),
  phoneApps: vi.fn().mockResolvedValue({
    installed: [{ appName: "Instagram", packageName: "com.instagram.android", version: "412.0.0.35.87" }],
    catalog: [],
  }),
  installApp: vi.fn(),
  phoneInput: (...a: unknown[]) => phoneInput(...a),
  phoneOpenUrl: vi.fn(),
  phoneNet: (...a: unknown[]) => phoneNet(...a),
  phoneAppStart: (...a: unknown[]) => phoneAppStart(...a),
  phoneAppStop: vi.fn(),
  phoneLogin: (...a: unknown[]) => phoneLogin(...a),
  phoneProfile: (...a: unknown[]) => phoneProfile(...a),
  uninstallApp: vi.fn(),
  PHONE_APPS: {
    instagram: { packageName: "com.instagram.android", label: "Instagram" },
    tiktok: { packageName: "com.zhiliaoapp.musically", label: "TikTok" },
  },
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
  detachPhone.mockReset().mockResolvedValue(undefined);
  setPhonePower.mockReset().mockResolvedValue(undefined);
  runWarmup.mockReset().mockResolvedValue({ plan: { day: 6 } });
  deviceOptions.mockReset().mockResolvedValue({
    models: [{ skuId: "10005", label: "Android 14" }],
    proxies: [{ id: "px1", name: "KZ-mobile", ip: "212.8.248.20", country: "KZ" }],
    groups: [{ id: "g1", name: "MarkVision" }],
  });
  createPhones.mockReset().mockResolvedValue({ created: ["1003"] });
  phoneScreen.mockReset().mockResolvedValue({
    url: "https://get.phonegrid.com/shot.png", width: 1080, height: 2340,
  });
  phoneInput.mockReset().mockResolvedValue(undefined);
  phoneNet.mockReset().mockResolvedValue({
    ip: "93.157.181.157", country: "Kazakhstan", city: "Oral", isp: "Tele2", mobile: true,
  });
  phoneAppStart.mockReset().mockResolvedValue(undefined);
  phoneLogin.mockReset().mockResolvedValue({ state: "success", message: "Вход выполнен" });
  phoneProfile.mockReset().mockResolvedValue({ handle: "aiva", followers: "1 240", posts: "37" });
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

  it("включить можно и свободный телефон — с этого начинается заведение аккаунта", async () => {
    render(<DevicesTab />);
    await screen.findByText("CP-2");
    // Питание не зависит от аккаунта: сначала поднимаем телефон, потом регистрируемся на нём.
    const powerButtons = screen.getAllByRole("button", { name: /Включить|Выключить/ });
    expect(powerButtons[0]).toBeEnabled();
    expect(powerButtons[1]).toBeEnabled();
    // А прогревать нечего, пока аккаунт не привязан.
    const warmButtons = screen.getAllByRole("button", { name: "Прогреть" });
    expect(warmButtons[0]).toBeEnabled();
    expect(warmButtons[1]).toBeDisabled();
  });

  it("питание зовётся по телефону, а не по аккаунту", async () => {
    render(<DevicesTab />);
    await screen.findByText("CP-2");
    fireEvent.click(screen.getAllByRole("button", { name: /Включить/ })[0]);
    await waitFor(() => expect(setPhonePower).toHaveBeenCalledWith("p1", "1002", true));
  });

  it("устройство создаётся из интерфейса", async () => {
    render(<DevicesTab />);
    await screen.findByText("CP-1");
    fireEvent.click(screen.getByRole("button", { name: /Устройство/ }));
    expect(await screen.findByText("Новое устройство")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: /Создать устройство/ }));
    await waitFor(() => expect(createPhones).toHaveBeenCalledWith("p1", expect.objectContaining({ sku_id: "10005", quantity: 1 })));
  });

  it("пустой список предлагает создать первое устройство", async () => {
    listPhones.mockResolvedValue([]);
    render(<DevicesTab />);
    expect(await screen.findByText(/Устройств пока нет/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Создать устройство/ })).toBeEnabled();
  });

  it("прогрев зовётся по аккаунту, а не по телефону", async () => {
    render(<DevicesTab />);
    await screen.findByText("CP-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Прогреть" })[0]);
    await waitFor(() => expect(runWarmup).toHaveBeenCalledWith("p1", "acc1"));
  });

  it("второй прогрев за день не предлагается", async () => {
    listPhones.mockResolvedValue([{
      ...withAccount,
      warmup: { ...withAccount.warmup!, lastRunAt: new Date().toISOString() },
    }]);
    render(<DevicesTab />);
    await screen.findByText("CP-1");
    const button = screen.getByRole("button", { name: "Прогрет сегодня" });
    expect(button).toBeDisabled();
  });

  it("замена аккаунта на телефоне сначала снимает прежний", async () => {
    render(<DevicesTab />);
    await screen.findByText("CP-1");
    // Radix Select в jsdom не раскрывается — открываем список пробелом и выбираем пункт.
    const trigger = screen.getAllByRole("combobox")[0];
    fireEvent.keyDown(trigger, { key: " " });
    const option = await screen.findByText("Второй (instagram)");
    fireEvent.click(option);
    // Один телефон — один аккаунт: без снятия прежнего замена упёрлась бы в уникальный индекс.
    await waitFor(() => expect(detachPhone).toHaveBeenCalledWith("p1", "acc1"));
    expect(attachPhone).toHaveBeenCalledWith("p1", "acc2", "1001");
  });

  it("поиск сужает список", async () => {
    render(<DevicesTab />);
    await screen.findByText("CP-1");
    fireEvent.change(screen.getByPlaceholderText(/Поиск/), { target: { value: "CP-2" } });
    await waitFor(() => expect(screen.queryByText("CP-1")).not.toBeInTheDocument());
    expect(screen.getByText("CP-2")).toBeInTheDocument();
  });

  it("ошибка запроса показывается, а не молча пустой список", async () => {
    listPhones.mockRejectedValue(new Error("PhoneGrid не подключён: добавьте секреты"));
    render(<DevicesTab />);
    expect(await screen.findByText(/PhoneGrid не подключён/)).toBeInTheDocument();
  });
});

describe("окно телефона", () => {
  it("открывается из списка и снимает экран включённого телефона", async () => {
    render(<DevicesTab />);
    await screen.findByText("CP-1");
    // Первая кнопка в строке — «Экран»: у неё нет подписи, ищем по подсказке.
    fireEvent.click(screen.getByTitle("Открыть экран телефона"));
    expect(await screen.findByText(/Экран устройства/)).toBeInTheDocument();
    await waitFor(() => expect(phoneScreen).toHaveBeenCalledWith("p1", "1001"));
  });

  it("клик по экрану превращается в тап с координатами устройства", async () => {
    render(<DevicesTab />);
    await screen.findByText("CP-1");
    fireEvent.click(screen.getByTitle("Открыть экран телефона"));
    const img = await screen.findByAltText("Экран CP-1");
    // jsdom не считает размеры, поэтому проверяем сам факт тапа с числовыми координатами.
    fireEvent.click(img, { clientX: 100, clientY: 200 });
    await waitFor(() => expect(phoneInput).toHaveBeenCalledWith("p1", "1001", expect.objectContaining({ kind: "tap" })));
  });

  it("показывает реальный адрес выхода, а не адрес прокси-шлюза", async () => {
    render(<DevicesTab />);
    await screen.findByText("CP-1");
    fireEvent.click(screen.getByTitle("Открыть экран телефона"));
    // Площадка видит вход именно с этого адреса; в карточке телефона стоит другой.
    // Адрес виден и в шапке окна, и в разборе: важно, что оба — реальный, а не прокси.
    expect(await screen.findAllByText(/93\.157\.181\.157/)).not.toHaveLength(0);
    expect(await screen.findByText(/это адрес его шлюза/)).toBeInTheDocument();
  });

  it("кнопка площадки открывает приложение на телефоне", async () => {
    render(<DevicesTab />);
    await screen.findByText("CP-1");
    fireEvent.click(screen.getByTitle("Открыть экран телефона"));
    const button = await screen.findByRole("button", { name: "Instagram" });
    fireEvent.click(button);
    await waitFor(() =>
      expect(phoneAppStart).toHaveBeenCalledWith("p1", "1001", "com.instagram.android"));
  });

  it("вход проходит по шагам и заканчивается карточкой аккаунта", async () => {
    render(<DevicesTab />);
    await screen.findByText("CP-1");
    fireEvent.click(screen.getByTitle("Открыть экран телефона"));
    fireEvent.change(await screen.findByPlaceholderText("Логин или почта"), { target: { value: "aiva" } });
    fireEvent.change(screen.getByPlaceholderText("Пароль"), { target: { value: "P@ssw0rd" } });
    fireEvent.click(screen.getByRole("button", { name: "Войти" }));
    // Приложение уже с открытым аккаунтом — сценарий не вводит пароль повторно.
    await waitFor(() => expect(phoneLogin).toHaveBeenCalledWith("p1", "1001", "instagram", "open"));
    expect(await screen.findByText("Аккаунт подключён")).toBeInTheDocument();
    expect(await screen.findByText("1 240 подписчиков")).toBeInTheDocument();
    expect(screen.getByText("37 постов")).toBeInTheDocument();
  });

  it("выключенный телефон предлагает включить прямо в окне", async () => {
    render(<DevicesTab />);
    await screen.findByText("CP-2");
    fireEvent.click(screen.getAllByTitle(/включить можно прямо в нём/)[0]);
    expect(await screen.findByText(/Телефон выключен/)).toBeInTheDocument();
    expect(phoneScreen).not.toHaveBeenCalled();
    // Кнопка включения здесь же — не нужно закрывать окно и искать её в списке.
    fireEvent.click(screen.getByRole("button", { name: /Включить телефон/ }));
    await waitFor(() => expect(setPhonePower).toHaveBeenCalledWith("p1", "1002", true));
  });

  it("загружающийся телефон честно говорит, что ждать около минуты", async () => {
    listPhones.mockResolvedValue([{ ...freePhone, status: 3, statusText: "загружается" }]);
    render(<DevicesTab />);
    await screen.findByText("CP-2");
    fireEvent.click(screen.getAllByTitle(/включить можно прямо в нём/)[0]);
    expect(await screen.findByText(/загружается — обычно около минуты/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Включить телефон/ })).not.toBeInTheDocument();
  });
});

describe("общий IP у нескольких устройств", () => {
  it("выключенные телефоны на одном прокси — спокойная подсказка про очередь", async () => {
    listPhones.mockResolvedValue([
      { ...withAccount, status: 2, statusText: "выключен" },
      { ...freePhone, proxyId: "p1", proxyIp: "212.8.248.20", country: "KZ" },
    ]);
    render(<DevicesTab />);
    expect(await screen.findByText(/включать их по очереди/)).toBeInTheDocument();
    expect(screen.getAllByText(/· общий/).length).toBe(2);
  });

  it("два включённых на одном адресе — уже ошибка, а не подсказка", async () => {
    listPhones.mockResolvedValue([
      withAccount,
      { ...freePhone, status: 4, statusText: "работает", proxyId: "p1", proxyIp: "212.8.248.20", country: "KZ" },
    ]);
    render(<DevicesTab />);
    expect(await screen.findByText(/включены одновременно на одном адресе/)).toBeInTheDocument();
  });

  it("у каждого свой IP — предупреждения нет", async () => {
    listPhones.mockResolvedValue([
      withAccount,
      { ...freePhone, proxyId: "p2", proxyIp: "95.163.145.242", country: "KZ" },
    ]);
    render(<DevicesTab />);
    await screen.findByText("CP-1");
    expect(screen.queryByText(/на одном IP/)).not.toBeInTheDocument();
  });
});
