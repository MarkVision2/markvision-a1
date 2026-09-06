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

/**
 * Открыть на телефоне страницу подключения аккаунта.
 *
 * Токен площадки нельзя достать из приложения, в которое вы вошли: Meta и TikTok выдают его
 * только через OAuth. Зато сам OAuth проходит прямо на телефоне — площадка видит вход с его IP,
 * а платформа по возврату получает токен и заводит аккаунт со статистикой.
 */
export async function connectAccountOnPhone(
  projectId: string,
  phoneId: string,
  platform?: string,
): Promise<{ url: string }> {
  return await call<{ url: string }>("connect_on_phone", projectId, { phone_id: phoneId, platform });
}

/**
 * Завести карточку аккаунта, который вы подняли на этом телефоне.
 * Статистики и автопубликации у него пока нет — они появятся после подключения по API.
 */
export async function createDeviceAccount(
  projectId: string,
  input: { phone_id: string; platform: string; account_name: string; handle?: string },
): Promise<{ account: DeviceAccountRef }> {
  return await call<{ account: DeviceAccountRef }>("create_account", projectId, input);
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

export interface PhoneApps {
  installed: { appName: string; packageName: string; version: string }[];
  catalog: {
    appName: string;
    packageName: string;
    /** Версия, которую требует сценарий прогрева; null — ещё не выяснена. */
    warmupVersion: string | null;
    /** Что поставим: версию под прогрев, а если её нет — самую свежую. */
    installVersionId: string | null;
    installVersion: string | null;
    versions: { id: string; version: string }[];
  }[];
}

/** Что стоит на телефоне и что можно поставить. */
export async function phoneApps(projectId: string, phoneId: string): Promise<PhoneApps> {
  return await call<PhoneApps>("apps", projectId, { phone_id: phoneId });
}

/** Установка занимает до минуты; телефон при этом должен быть включён. */
export async function installApp(projectId: string, phoneId: string, appVersionId: string): Promise<void> {
  await call("install_app", projectId, { phone_id: phoneId, app_version_id: appVersionId });
}

export type ShotFormat = "png" | "mp4";

export interface PhoneShot {
  url: string;
  /** Реальное разрешение экрана — по нему пересчитывается клик в тап. */
  width: number;
  height: number;
  /** png — застывший кадр, mp4 — секунда живого движения и в 25 раз меньше веса. */
  format: ShotFormat;
  /** Сколько секунд телефон работает: тарификация поминутная, это надо видеть. */
  uptime: number;
}

/**
 * Кадр с экрана телефона: ссылка на файл в хранилище PhoneGrid.
 *
 * Быстрее ~9 секунд кадр не собрать, и это не наша медлительность: у PhoneGrid любой вызов
 * API идёт около трёх секунд (пустая команда `true` возвращается за 2952 мс), плюс ~5,7 с
 * уходит на подготовку файла в хранилище — одинаково для 17 КБ и для 1,2 МБ. Видеопотока
 * в Open API нет вовсе, он есть лишь в собственном клиенте PhoneGrid (WebRTC через их
 * приватный шлюз).
 *
 * Отсюда два обхода: кадры снимаются внахлёст (у каждого запроса свой файл на телефоне),
 * а формат mp4 весит ~46 КБ против 1,2 МБ у png — браузер тянет его вдвое быстрее, и вместо
 * застывшей картинки видно секунду живого движения.
 */
export async function phoneScreen(
  projectId: string,
  phoneId: string,
  format: ShotFormat = "png",
): Promise<PhoneShot> {
  return await call<PhoneShot>("screen", projectId, { phone_id: phoneId, format });
}

/** Куда телефон реально выходит в сеть: этот адрес и видит площадка при входе. */
export interface PhoneNet {
  ip: string;
  country: string | null;
  city: string | null;
  isp: string | null;
  mobile: boolean | null;
  /** Адрес прошлой сессии этого телефона — с ним и сравниваем. */
  previousIp?: string | null;
  /** IP не сменился с прошлого раза: аккаунт выйдет с того же адреса. */
  same?: boolean;
  /** Этим же адресом за последний час выходил другой телефон — площадка свяжет аккаунты. */
  collisionWith?: string | null;
}

export async function phoneNet(projectId: string, phoneId: string): Promise<PhoneNet> {
  return await call<PhoneNet>("net", projectId, { phone_id: phoneId });
}

export const PHONE_APPS = {
  instagram: { packageName: "com.instagram.android", label: "Instagram" },
  tiktok: { packageName: "com.zhiliaoapp.musically", label: "TikTok" },
} as const;

export type LoginPlatform = keyof typeof PHONE_APPS;

export async function phoneAppStart(projectId: string, phoneId: string, packageName: string): Promise<void> {
  await call("app_start", projectId, { phone_id: phoneId, package_name: packageName });
}

export async function phoneAppStop(projectId: string, phoneId: string, packageName: string): Promise<void> {
  await call("app_stop", projectId, { phone_id: phoneId, package_name: packageName });
}

export async function phoneAppRestart(projectId: string, phoneId: string, packageName: string): Promise<void> {
  await call("app_restart", projectId, { phone_id: phoneId, package_name: packageName });
}

/**
 * Стереть данные приложения: вход в аккаунт слетает, приложение становится как только что
 * установленное. Нужно, чтобы завести на том же телефоне другой аккаунт, не трогая версию
 * под прогрев (переустановка её бы сбила).
 */
export async function phoneAppClear(projectId: string, phoneId: string, packageName: string): Promise<void> {
  await call("app_clear", projectId, { phone_id: phoneId, package_name: packageName });
}

export type LoginState =
  | "success"
  | "post_login"
  | "wrong_password"
  | "two_factor"
  | "challenge"
  | "form"
  | "unknown";

export interface LoginResult {
  state: LoginState;
  message: string;
  /** Только для шага probe: открыто ли сейчас приложение этой площадки. */
  foreground?: boolean;
}

/**
 * Вход в приложение площадки по шагам. Шаги раздельные, потому что каждый обмен с телефоном
 * занимает секунды, и окно должно показывать, на чём оно сейчас, а не молчать полминуты.
 *
 * Пароль уходит одним запросом в `input text` на телефон и нигде не сохраняется: ни в базе,
 * ни в браузере, ни в логах.
 */
export async function phoneLogin(
  projectId: string,
  phoneId: string,
  platform: LoginPlatform,
  stage: "probe" | "open" | "fill" | "submit" | "check",
  credentials?: { username: string; password: string },
): Promise<LoginResult> {
  return await call<LoginResult>("login", projectId, {
    phone_id: phoneId,
    platform,
    stage,
    ...(credentials ?? {}),
  });
}

/** Имя и счётчики аккаунта, прочитанные с экрана профиля приложения. */
export interface PhoneProfile {
  handle: string | null;
  followers: string | null;
  posts: string | null;
}

export async function phoneProfile(projectId: string, phoneId: string): Promise<PhoneProfile> {
  return await call<PhoneProfile>("profile", projectId, { phone_id: phoneId });
}

/** Снести приложение — нужно, когда стоит версия, несовместимая с шаблоном прогрева. */
export async function uninstallApp(projectId: string, phoneId: string, packageName: string): Promise<void> {
  await call("uninstall_app", projectId, { phone_id: phoneId, package_name: packageName });
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
