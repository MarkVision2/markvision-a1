/**
 * Облачные телефоны аккаунтов — клиент к edge-функции `account-devices`.
 *
 * Телефон нужен, чтобы завести аккаунт и прогреть его; публикация идёт через официальные
 * API площадок и устройства не требует (docs/AUTOPOST-ARCHITECTURE.md). Движок — PhoneGrid,
 * но кабинет PhoneGrid открывать не нужно: всё здесь.
 *
 * Паролей от площадок платформа не хранит и не спрашивает — вход в приложение делает
 * человек руками на самом телефоне.
 */
import { supabase } from "@/integrations/supabase/client";

export interface DeviceAccountRef {
  id: string;
  account_name: string;
  handle: string | null;
  platform: string;
}

export interface DevicePhone {
  id: string;
  name: string;
  status: number;
  statusText: string;
  remark: string;
  proxyId: string | null;
  proxyIp: string | null;
  country: string | null;
  account: DeviceAccountRef | null;
  /** Прогрев привязанного аккаунта; null — телефон свободен. */
  warmup: {
    day: number | null;
    ready: boolean;
    startedAt: string | null;
    lastRunAt: string | null;
    lastState: string | null;
  } | null;
}

export interface WarmupPlan {
  day: number;
  ready: boolean;
  note: string;
  videos: number;
  like: number;
  follow: number;
  comments: number;
}

export interface WarmupRun {
  startedAt: string | null;
  finishedAt: string | null;
  state: string;
  error: string | null;
}

export interface DeviceStatus {
  phone: { id: string; name: string | null } | null;
  warmup: {
    startedAt: string | null;
    lastRunAt: string | null;
    lastState: string | null;
    plan: WarmupPlan;
  };
  supported: boolean;
  requirements: { app: string; version: string | null; locale: string } | null;
  history: WarmupRun[];
}

export interface DeviceOptions {
  models: { skuId: string; label: string }[];
  proxies: { id: string; name: string; ip: string; country: string | null }[];
  groups: { id: string; name: string }[];
}

export interface CreatePhoneInput {
  sku_id: string;
  quantity: number;
  remark?: string;
  proxy_id?: string | null;
  group_id?: string | null;
  tags?: string[];
}

export class DeviceApiError extends Error {}

async function call<T>(action: string, projectId: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("account-devices", {
    body: { action, project_id: projectId, ...body },
  });
  if (error) {
    // Тело ответа несёт понятную причину — показываем её, а не «Edge Function returned…».
    const ctx = (error as { context?: Response }).context;
    let message = error.message || "Ошибка запроса";
    if (ctx && typeof ctx.json === "function") {
      try {
        const j = (await ctx.json()) as { error?: string };
        if (j?.error) message = j.error;
      } catch {
        /* тело не разобралось — оставляем исходное сообщение */
      }
    }
    throw new DeviceApiError(message);
  }
  return data as T;
}

export async function listPhones(projectId: string): Promise<DevicePhone[]> {
  const r = await call<{ phones: DevicePhone[] }>("phones", projectId);
  return r.phones ?? [];
}

/** Что предложить в форме создания устройства: модели, прокси и группы PhoneGrid. */
export async function deviceOptions(projectId: string): Promise<DeviceOptions> {
  return await call<DeviceOptions>("options", projectId);
}

/**
 * Создание облачных телефонов — **платная операция**: устройства начинают тарифицироваться
 * сразу. Больше десяти за раз PhoneGrid не отдаёт.
 */
export async function createPhones(projectId: string, input: CreatePhoneInput): Promise<{ created: string[] }> {
  return await call<{ created: string[] }>("create_phone", projectId, input as unknown as Record<string, unknown>);
}

/** Прокси строкой socks5://логин:пароль@хост:порт; refresh_url — ссылка смены IP, если есть. */
export async function addProxy(projectId: string, url: string, name?: string, refreshUrl?: string): Promise<void> {
  await call("proxy_add", projectId, { url, name, refresh_url: refreshUrl });
}

/** Аккаунты проекта без телефона — для привязки прямо из списка устройств. */
export async function listFreeAccounts(projectId: string): Promise<DeviceAccountRef[]> {
  const r = await call<{ accounts: DeviceAccountRef[] }>("accounts_free", projectId);
  return r.accounts ?? [];
}

export async function attachPhone(projectId: string, accountId: string, phoneId: string): Promise<void> {
  await call("attach", projectId, { account_id: accountId, phone_id: phoneId });
}

export async function detachPhone(projectId: string, accountId: string): Promise<void> {
  await call("detach", projectId, { account_id: accountId });
}

/**
 * Включение и выключение телефона: тарифицируется по минутам, гасим после работы.
 * Работает и на свободном телефоне — с включения начинается заведение нового аккаунта.
 */
export async function setPhonePower(projectId: string, phoneId: string, on: boolean): Promise<void> {
  await call("power", projectId, { phone_id: phoneId, on });
}

export async function deviceStatus(projectId: string, accountId: string): Promise<DeviceStatus> {
  return await call<DeviceStatus>("warmup_status", projectId, { account_id: accountId });
}

/** Снимок экрана телефона: ссылка на картинку в хранилище PhoneGrid (кадр готовится ~5 секунд). */
export async function phoneScreen(projectId: string, phoneId: string): Promise<string> {
  const r = await call<{ url: string }>("screen", projectId, { phone_id: phoneId });
  return r.url;
}

export type PhoneKey = "home" | "back" | "enter" | "tab" | "delete" | "recent";

/** Ввод на телефоне: палец по экрану и клавиатура. Координаты — в пикселях экрана устройства. */
export async function phoneInput(
  projectId: string,
  phoneId: string,
  input:
    | { kind: "tap"; x: number; y: number }
    | { kind: "swipe"; x: number; y: number; x2: number; y2: number; ms?: number }
    | { kind: "text"; text: string }
    | { kind: "key"; key: PhoneKey },
): Promise<void> {
  await call("input", projectId, { phone_id: phoneId, ...input });
}

/** Открыть ссылку в браузере телефона — так авторизация идёт с его IP. */
export async function phoneOpenUrl(projectId: string, phoneId: string, url: string): Promise<void> {
  await call("open_url", projectId, { phone_id: phoneId, url });
}

/** Прогрев на сегодня: телефон должен быть выключен — RPA включает его сам. */
export async function runWarmup(projectId: string, accountId: string): Promise<{ plan: WarmupPlan }> {
  return await call<{ plan: WarmupPlan }>("warmup", projectId, { account_id: accountId });
}
