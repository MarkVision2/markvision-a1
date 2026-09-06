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

/** Включение и выключение телефона: он тарифицируется по минутам, гасим после работы. */
export async function setPhonePower(projectId: string, accountId: string, on: boolean): Promise<void> {
  await call("power", projectId, { account_id: accountId, on });
}

export async function deviceStatus(projectId: string, accountId: string): Promise<DeviceStatus> {
  return await call<DeviceStatus>("warmup_status", projectId, { account_id: accountId });
}

/** Прогрев на сегодня: телефон должен быть выключен — RPA включает его сам. */
export async function runWarmup(projectId: string, accountId: string): Promise<{ plan: WarmupPlan }> {
  return await call<{ plan: WarmupPlan }>("warmup", projectId, { account_id: accountId });
}
