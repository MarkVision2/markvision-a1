#!/usr/bin/env node
/**
 * PhoneGrid (облачные Android-телефоны) — обёртка над двумя API:
 *   Local API  — http://127.0.0.1:30000, работает только при запущенном клиенте PhoneGrid.app
 *                на этой машине; ключ — PHONEGRID_LOCAL_API_KEY в .env (заголовок Authorization: Bearer).
 *   Open API   — https://api.phonegrid.com, серверный доступ: PHONEGRID_OPEN_API_ID + PHONEGRID_OPEN_API_KEY
 *                обмениваются на access_token (/oauth2/token, client_credentials, живёт 1 час).
 *
 *   node scripts/phonegrid.mjs phones                       # список облачных телефонов
 *   node scripts/phonegrid.mjs phone <id>                   # карточка телефона
 *   node scripts/phonegrid.mjs apps [название]              # каталог приложений (TikTok, Instagram…)
 *   node scripts/phonegrid.mjs installed <id>               # что установлено на телефоне
 *   node scripts/phonegrid.mjs power on|off <id>
 *   node scripts/phonegrid.mjs install <id> <appVersionId>
 *   node scripts/phonegrid.mjs start-app <id> <packageName>
 *   node scripts/phonegrid.mjs exec <id> "<shell-команда>"  # adb shell внутри телефона
 *   node scripts/phonegrid.mjs upload <id> <файл> [/Download]
 *   node scripts/phonegrid.mjs call <path> '<json>'         # любой Local API endpoint
 *
 *   Прокси (строка вида socks5://логин:пароль@хост:порт, http:// и https:// тоже можно):
 *   node scripts/phonegrid.mjs proxy add <url> [--name KZ-mobile] [--refresh <ссылка смены IP>]
 *   node scripts/phonegrid.mjs proxy list
 *   node scripts/phonegrid.mjs bind <phoneId> <proxyId>         # привязать прокси к телефону
 *   node scripts/phonegrid.mjs rotate [proxyId]                 # сменить IP по ссылке (refreshUrl прокси
 *                                                               #   или PHONEGRID_PROXY_REFRESH_URL) и показать новый IP
 *   node scripts/phonegrid.mjs ip [proxyUrl]                    # какой IP сейчас у прокси (PHONEGRID_PROXY_URL)
 *   node scripts/phonegrid.mjs switch <phoneId>                 # выключить остальные телефоны → сменить IP → включить этот
 *   RPA (раздел «Автоматизация» PhoneGrid):
 *   node scripts/phonegrid.mjs rpa templates                    # шаблоны маркетплейса
 *   node scripts/phonegrid.mjs rpa history [n]                  # последние запуски с причинами отказа
 *   node scripts/phonegrid.mjs rpa tasks                        # расписания
 *   node scripts/phonegrid.mjs warmup <phoneId> <ig|tt> <день>  # прогрев по плану дня (1…14+)
 *   node scripts/phonegrid.mjs warmup-plan [день]               # показать план прогрева
 *
 *   node scripts/phonegrid.mjs token                        # access_token Open API
 *   node scripts/phonegrid.mjs open <path> '<json>'         # любой Open API endpoint
 *
 * Создание телефонов (/api/cloudphone/create) намеренно не обёрнуто — это платная операция,
 * делать её осознанно через `call`. Справочник — docs/PHONEGRID.md.
 */
import { readFileSync, openAsBlob } from "node:fs";
import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const LOCAL_BASE = "http://127.0.0.1:30000";
export const OPEN_BASE = "https://api.phonegrid.com";

/** Разбор .env без зависимостей: KEY=value, комментарии и пустые строки пропускаются. */
export function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** Запрос к Local API: путь + тело → параметры fetch. Чистая функция ради теста. */
export function buildLocalRequest(path, body, key) {
  if (!key) throw new Error("Нет PHONEGRID_LOCAL_API_KEY в .env");
  if (!path.startsWith("/api/")) throw new Error(`Путь Local API должен начинаться с /api/: ${path}`);
  return {
    url: LOCAL_BASE + path,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body ?? {}),
    },
  };
}

/** Тело запроса токена Open API (client_credentials). */
export function buildTokenBody(apiId, apiKey) {
  if (!apiId || !apiKey) {
    throw new Error("Для Open API нужны PHONEGRID_OPEN_API_ID (числовой API ID из клиента) и PHONEGRID_OPEN_API_KEY");
  }
  return { client_id: String(apiId), client_secret: apiKey, grant_type: "client_credentials" };
}

/** Ответ API → данные или понятная ошибка (code≠0 — ошибка PhoneGrid). */
export function unwrap(json, context) {
  if (json && json.code === 0) return json.data;
  const msg = json?.msg ?? json?.message ?? JSON.stringify(json);
  throw new Error(`${context}: ${msg} (code ${json?.code ?? "?"})`);
}

/** Короткая сводка по телефону для вывода списка. */
export function summarizePhone(p) {
  return {
    id: p.id ?? p.envId,
    name: p.envName ?? p.name ?? "",
    status: p.status ?? p.powerStatus ?? p.runStatus ?? "",
    country: p.country ?? "",
    proxy: p.proxyIp ?? p.proxyInfo?.ip ?? "",
    remark: p.envRemark ?? p.remark ?? "",
  };
}

/** Коды провайдеров PhoneGrid для обычных прокси по схеме URL. */
export const PROXY_PROVIDER = { http: 0, https: 1, socks5: 2, socks5h: 2, ssh: 3 };

/** socks5://логин:пароль@хост:порт → поля /api/proxyInfo/add. */
export function parseProxyUrl(raw) {
  let u;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new Error(`Не разобрать прокси «${raw}». Ожидаю socks5://логин:пароль@хост:порт`);
  }
  const scheme = u.protocol.replace(":", "").toLowerCase();
  if (!(scheme in PROXY_PROVIDER)) throw new Error(`Схема ${scheme} не поддерживается (http, https, socks5, ssh)`);
  // у http/https URL опускает стандартный порт — восстанавливаем его
  const port = u.port || { http: "80", https: "443" }[scheme] || "";
  if (!u.hostname || !port) throw new Error("В прокси нужны хост и порт");
  return {
    proxyProvider: PROXY_PROVIDER[scheme],
    proxyIp: u.hostname,
    proxyPort: Number(port),
    username: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
  };
}

/** Тело /api/proxyInfo/add: прокси + имя + ссылка смены IP; мониторинг смены IP выключен (мобильный IP меняется штатно). */
export function buildProxyAdd(parsed, { name, refreshUrl } = {}) {
  return {
    ...parsed,
    proxyName: name || `${parsed.proxyIp}:${parsed.proxyPort}`,
    refreshUrl: refreshUrl || "",
    ipMonitor: false,
    ipChangeAction: 1,
  };
}

/** Ответ ip-сервиса → { ip, country, city } (поддерживает ipify, ip-api, ipinfo). */
export function parseIpInfo(json) {
  if (!json) return null;
  return {
    ip: json.ip ?? json.query ?? null,
    country: json.country ?? json.countryCode ?? json.country_name ?? null,
    city: json.city ?? null,
  };
}

/** Прокси-URL из записи PhoneGrid (для локальной проверки IP через curl). */
export function proxyUrlFromRecord(p) {
  if (!p.proxyPort) throw new Error(`У прокси ${p.id ?? ""} неизвестен порт — задайте PHONEGRID_PROXY_URL в .env`);
  const scheme = { 0: "http", 1: "https", 2: "socks5h", 3: "ssh" }[p.proxyProvider ?? p.proxyType] ?? "socks5h";
  const auth = p.username ? `${encodeURIComponent(p.username)}:${encodeURIComponent(p.password ?? "")}@` : "";
  return `${scheme}://${auth}${p.proxyIp}:${p.proxyPort}`;
}

/**
 * Шаблоны прогрева из маркетплейса PhoneGrid и их ЖЁСТКИЕ требования.
 * Требования видно только в UI («Просмотр» шаблона) — API их не отдаёт, а при несовпадении
 * задача падает с `33603 app is not installed or the version is incompatible` ещё на сервере,
 * не доходя до телефона. Версия приложения и язык обязаны совпадать точно.
 */
export const WARMUP_TEMPLATES = {
  ig: {
    templateId: 1686892291414622,
    title: "Instagram AI account warmup",
    packageName: "com.instagram.android",
    requiredVersion: "412.0.0.35.87",
    appVersionId: "1682134957917431",
    requiredLocale: "en-US",
    keys: {
      videos: "Estimated number of videos browsed",
      follow: "Probability of following",
      like: "Probability of liking",
      comments: "Probability of viewing comments",
    },
    max: { follow: 90, like: 90, comments: 90 },
  },
  tt: {
    templateId: 1686875577110812,
    title: "TikTok Account Warm-up",
    packageName: "com.zhiliaoapp.musically",
    requiredVersion: null, // смотреть в UI: Автоматизация → Маркетплейс → Просмотр
    appVersionId: null,
    requiredLocale: "en-US",
    keys: {
      videos: "Estimated number of videos browsed",
      follow: "Probability of following",
      like: "Probability of liking",
      comments: "Probability of viewing comments",
    },
    max: { follow: 95, like: 95, comments: 95 },
  },
};

/**
 * План прогрева нового аккаунта по дням. Смысл: первые дни аккаунт только смотрит —
 * действия (лайки, подписки) у свежего аккаунта площадки считают ботоводством,
 * поэтому они появляются позже и растут плавно. С 15-го дня аккаунт считается прогретым
 * и его можно подключать в контур публикации (docs/PUBLISHING-SYSTEM.md).
 */
export function warmupPlan(day, platform = "ig") {
  const d = Math.max(1, Math.floor(Number(day) || 1));
  const stage =
    d <= 2 ? { videos: [8, 14], like: 0, follow: 0, comments: 0, note: "только просмотр — аккаунт осматривается" }
    : d <= 4 ? { videos: [15, 25], like: 5, follow: 0, comments: 3, note: "появляются первые лайки" }
    : d <= 7 ? { videos: [25, 40], like: 10, follow: 3, comments: 5, note: "лайки чаще, первые подписки" }
    : d <= 14 ? { videos: [40, 70], like: 18, follow: 5, comments: 8, note: "выход на обычную активность" }
    : { videos: [60, 110], like: 22, follow: 5, comments: 10, note: "прогрет — можно подключать к публикации" };
  // разброс внутри дня, чтобы дни не были одинаковыми
  const [lo, hi] = stage.videos;
  const videos = lo + Math.floor(Math.random() * (hi - lo + 1));
  const jitter = (v) => (v === 0 ? 0 : Math.max(0, v + Math.floor(Math.random() * 5) - 2));
  const cap = WARMUP_TEMPLATES[platform]?.max ?? { follow: 90, like: 90, comments: 90 };
  return {
    day: d,
    ready: d >= 15,
    note: stage.note,
    videos,
    like: Math.min(jitter(stage.like), cap.like),
    follow: Math.min(jitter(stage.follow), cap.follow),
    comments: Math.min(jitter(stage.comments), cap.comments),
  };
}

/** План дня → templateParameter шаблона (ключи у шаблонов — человекочитаемые фразы). */
export function warmupParameter(plan, platform = "ig") {
  const t = WARMUP_TEMPLATES[platform];
  if (!t) throw new Error(`Неизвестная площадка «${platform}», ожидаю ig или tt`);
  return JSON.stringify({
    [t.keys.videos]: plan.videos,
    [t.keys.follow]: plan.follow,
    [t.keys.like]: plan.like,
    [t.keys.comments]: plan.comments,
  });
}

/** Расшифровка состояний RPA-задачи (в документации PhoneGrid описаны не все). */
export const RPA_STATE = {
  0: "ожидает запуска",
  1: "выполняется",
  2: "выполнена",
  3: "отменена",
  4: "ошибка",
  5: "останавливается",
};

function loadEnv() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  let fileEnv = {};
  try {
    fileEnv = parseEnv(readFileSync(resolve(root, ".env"), "utf8"));
  } catch {
    /* .env может отсутствовать — тогда только переменные окружения */
  }
  return { ...fileEnv, ...process.env };
}

async function localCall(env, path, body) {
  const { url, init } = buildLocalRequest(path, body, env.PHONEGRID_LOCAL_API_KEY);
  let res;
  try {
    res = await fetch(url, init);
  } catch (e) {
    throw new Error(`Local API недоступен (${url}). Запущен ли клиент PhoneGrid.app и выполнен ли вход? ${e.message}`);
  }
  const json = await res.json().catch(() => ({ code: res.status, msg: res.statusText }));
  if (res.status === 401) throw new Error("Local API: недействительный API-ключ (PHONEGRID_LOCAL_API_KEY)");
  return unwrap(json, `Local API ${path}`);
}

async function localUpload(env, id, file, dest) {
  const form = new FormData();
  form.set("id", String(id));
  form.set("uploadDest", dest);
  form.set("file", await openAsBlob(file), basename(file));
  const res = await fetch(`${LOCAL_BASE}/api/cloudphone/uploadFile`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.PHONEGRID_LOCAL_API_KEY}` },
    body: form,
  });
  return unwrap(await res.json(), "Local API /api/cloudphone/uploadFile");
}

async function openToken(env) {
  const body = buildTokenBody(env.PHONEGRID_OPEN_API_ID, env.PHONEGRID_OPEN_API_KEY);
  const res = await fetch(`${OPEN_BASE}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return unwrap(await res.json(), "Open API /oauth2/token");
}

async function openCall(env, path, body) {
  const { access_token } = await openToken(env);
  const res = await fetch(OPEN_BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${access_token}` },
    body: JSON.stringify(body ?? {}),
  });
  return unwrap(await res.json(), `Open API ${path}`);
}

const IP_SERVICE = "http://ip-api.com/json/?fields=query,country,countryCode,city";

/** Текущий IP через прокси — curl -x с этого Mac (Node fetch прокси не умеет). */
export function ipViaProxy(proxyUrl) {
  const r = spawnSync("curl", ["-s", "-m", "25", "-x", proxyUrl, IP_SERVICE], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`curl через прокси не прошёл (код ${r.status}): ${r.stderr.trim() || "нет ответа"}`);
  try {
    return parseIpInfo(JSON.parse(r.stdout));
  } catch {
    throw new Error(`ip-сервис ответил не JSON: ${r.stdout.slice(0, 200)}`);
  }
}

/** Список прокси; /api/proxyInfo/page не отдаёт порт — добираем его из привязок телефонов. */
async function proxyRecords(env) {
  const data = await localCall(env, "/api/proxyInfo/page", { ...PAGE, isCloudPhoneProxy: false });
  const list = data.dataList ?? [];
  if (!list.length || list.every((p) => p.proxyPort)) return list;
  const phones = (await localCall(env, "/api/cloudphone/page", PAGE)).dataList ?? [];
  const ports = new Map();
  for (const ph of phones) {
    try {
      const info = await localCall(env, "/api/cloudphone/info", { id: Number(ph.id) });
      if (info?.proxy?.id && info.proxy.proxyPort) ports.set(String(info.proxy.id), info.proxy.proxyPort);
    } catch {
      /* телефон без прокси */
    }
  }
  return list.map((p) => (p.proxyPort ? p : { ...p, proxyPort: ports.get(String(p.id)) ?? portFromName(p.proxyName) }));
}

/** «http://host:port» или «host:port» в имени прокси → порт, иначе undefined. */
export function portFromName(name) {
  const m = /:(\d{2,5})(?:\/|$)/.exec(String(name ?? ""));
  return m ? Number(m[1]) : undefined;
}

async function findProxy(env, proxyId) {
  const list = await proxyRecords(env);
  if (!list.length) throw new Error("В PhoneGrid нет прокси — сначала proxy add <url>");
  if (!proxyId) return list[0];
  const p = list.find((x) => String(x.id) === String(proxyId));
  if (!p) throw new Error(`Прокси ${proxyId} не найден; есть: ${list.map((x) => x.id).join(", ")}`);
  return p;
}

/** Смена IP по ссылке + ожидание + новый IP. */
async function rotateIp(env, proxyId) {
  const p = await findProxy(env, proxyId);
  const refreshUrl = p.refreshUrl || env.PHONEGRID_PROXY_REFRESH_URL;
  if (!refreshUrl) throw new Error("Нет ссылки смены IP: задайте при proxy add --refresh или PHONEGRID_PROXY_REFRESH_URL в .env");
  const proxyUrl = env.PHONEGRID_PROXY_URL || proxyUrlFromRecord(p);
  let before = null;
  try {
    before = ipViaProxy(proxyUrl);
  } catch {
    /* прокси мог быть недоступен до смены — не критично */
  }
  const res = await fetch(refreshUrl, { method: "GET" });
  const body = (await res.text()).slice(0, 200);
  if (!res.ok) throw new Error(`Ссылка смены IP ответила ${res.status}: ${body}`);
  const waitMs = Number(env.PHONEGRID_ROTATE_WAIT_MS || 15000);
  await sleep(waitMs);
  let after = null;
  for (let i = 0; i < 4 && !after; i++) {
    try {
      after = ipViaProxy(proxyUrl);
    } catch {
      await sleep(5000);
    }
  }
  return { proxyId: p.id, before, after, changed: Boolean(before?.ip && after?.ip && before.ip !== after.ip), refreshResponse: body };
}

const PAGE = { pageNo: 1, pageSize: 100 };

async function main(argv) {
  const env = loadEnv();
  const [cmd, a, b, c] = argv;
  const num = (v, what) => {
    if (!v) throw new Error(`Нужен ${what}`);
    return Number(v);
  };
  switch (cmd) {
    case "phones": {
      const data = await localCall(env, "/api/cloudphone/page", PAGE);
      const list = data.dataList ?? [];
      if (!list.length) return { total: 0, phones: [], hint: "Облачных телефонов нет — создайте в клиенте PhoneGrid или через call /api/cloudphone/create" };
      return { total: Number(data.total), phones: list.map(summarizePhone) };
    }
    case "phone":
      return localCall(env, "/api/cloudphone/info", { id: num(a, "id телефона") });
    case "apps": {
      const data = await localCall(env, "/api/cloudphone/app/page", { ...PAGE, appName: a ?? "" });
      return (data.dataList ?? []).map((x) => ({
        appName: x.appName,
        packageName: x.packageName,
        versions: (x.appVersionList ?? []).slice(0, 5).map((v) => ({ appVersionId: v.id, version: v.versionName })),
      }));
    }
    case "installed":
      return localCall(env, "/api/cloudphone/app/installedList", { id: num(a, "id телефона") });
    case "power": {
      if (a !== "on" && a !== "off") throw new Error("power on|off <id>");
      return localCall(env, a === "on" ? "/api/cloudphone/powerOn" : "/api/cloudphone/powerOff", { id: num(b, "id телефона") });
    }
    case "install":
      return localCall(env, "/api/cloudphone/app/install", { id: num(a, "id телефона"), appVersionId: String(b ?? "") });
    case "start-app":
      return localCall(env, "/api/cloudphone/app/start", { id: num(a, "id телефона"), packageName: b });
    case "exec":
      if (!b) throw new Error('exec <id> "<команда>"');
      return localCall(env, "/api/cloudphone/exeCommand", { id: num(a, "id телефона"), command: b });
    case "upload":
      if (!b) throw new Error("upload <id> <файл> [dest]");
      return localUpload(env, num(a, "id телефона"), b, c ?? "/Download");
    case "proxy": {
      if (a === "list") {
        return (await proxyRecords(env)).map((p) => ({
          id: p.id, name: p.proxyName, ip: p.proxyIp, port: p.proxyPort, provider: p.proxyProvider,
          refreshUrl: p.refreshUrl || "", checkStatus: p.proxyCheckStatus, status: p.proxyStatus,
        }));
      }
      if (a === "add") {
        if (!b) throw new Error("proxy add <url> [--name …] [--refresh …]");
        const opt = (flag) => {
          const i = argv.indexOf(flag);
          return i > 0 ? argv[i + 1] : undefined;
        };
        const body = buildProxyAdd(parseProxyUrl(b), { name: opt("--name"), refreshUrl: opt("--refresh") });
        const added = await localCall(env, "/api/proxyInfo/add", body);
        return { added, hint: "дальше: bind <phoneId> <proxyId> → power on" };
      }
      throw new Error("proxy add <url> | proxy list");
    }
    case "bind":
      return localCall(env, "/api/cloudphone/edit/batch", { id: [num(a, "id телефона")], proxyId: num(b, "id прокси") });
    case "rotate":
      return rotateIp(env, a);
    case "ip": {
      const proxyUrl = a || env.PHONEGRID_PROXY_URL || proxyUrlFromRecord(await findProxy(env));
      return ipViaProxy(proxyUrl);
    }
    case "switch": {
      const target = num(a, "id телефона");
      const phones = (await localCall(env, "/api/cloudphone/page", PAGE)).dataList ?? [];
      const others = phones.filter((p) => String(p.id) !== String(target));
      const off = [];
      for (const p of others) {
        try {
          await localCall(env, "/api/cloudphone/powerOff", { id: Number(p.id) });
          off.push(p.id);
        } catch {
          /* уже выключен */
        }
      }
      const rotation = await rotateIp(env, undefined).catch((e) => ({ error: e.message }));
      const on = await localCall(env, "/api/cloudphone/powerOn", { id: target });
      return { poweredOff: off, rotation, poweredOn: on ?? target };
    }
    case "rpa": {
      if (a === "templates") {
        const data = await localCall(env, "/api/cloudphone/rpa/template/market/page", { ...PAGE });
        return (data.dataList ?? []).map((t) => ({ id: t.id, title: t.title, type: t.type, author: t.author }));
      }
      if (a === "tasks") {
        const data = await localCall(env, "/api/cloudphone/rpa/task/page", { ...PAGE });
        return data.dataList ?? [];
      }
      if (a === "history") {
        const data = await localCall(env, "/api/cloudphone/rpa/subTask/page", { pageNo: 1, pageSize: Number(b) || 10 });
        return (data.dataList ?? []).map((s2) => ({
          task: s2.taskName,
          phone: s2.cloudPhoneName,
          template: s2.templateName,
          state: RPA_STATE[s2.taskState] ?? s2.taskState,
          poweredOn: s2.powerOnTime,
          finished: s2.endTime,
          error: s2.handleFailReason ? `${s2.handleFailCode} ${s2.handleFailReason}` : null,
        }));
      }
      throw new Error("rpa templates | rpa tasks | rpa history [n]");
    }
    case "warmup-plan": {
      if (a) return warmupPlan(a, b || "ig");
      return Array.from({ length: 16 }, (_, i) => warmupPlan(i + 1, "ig"));
    }
    case "warmup": {
      const phoneId = num(a, "id телефона");
      const platform = (b || "ig").toLowerCase();
      const t = WARMUP_TEMPLATES[platform];
      if (!t) throw new Error("Площадка: ig или tt");
      if (!t.requiredVersion) {
        throw new Error(`Для ${platform} не заполнена требуемая версия приложения — посмотрите её в клиенте: Автоматизация → Маркетплейс → «${t.title}» → Просмотр, и впишите в WARMUP_TEMPLATES`);
      }
      // требования шаблона: точная версия приложения, язык и выключенный телефон
      const installed = await localCall(env, "/api/cloudphone/app/installedList", { id: phoneId });
      const app = (installed ?? []).find((x) => x.packageName === t.packageName);
      if (!app) throw new Error(`На телефоне нет ${t.packageName} — поставьте версию ${t.requiredVersion}: install ${phoneId} ${t.appVersionId}`);
      if (app.versionName !== t.requiredVersion) {
        throw new Error(`Версия ${app.versionName} не подойдёт, шаблон требует ровно ${t.requiredVersion}. Переустановите: call /api/cloudphone/app/uninstall '{"id":${phoneId},"packageName":"${t.packageName}"}' затем install ${phoneId} ${t.appVersionId} (авторизация в приложении при этом слетит)`);
      }
      const info = await localCall(env, "/api/cloudphone/info", { id: phoneId });
      if (info.settings?.language !== t.requiredLocale) {
        throw new Error(`Язык телефона ${info.settings?.language || "авто"}, шаблон требует ${t.requiredLocale}: call /api/cloudphone/edit/batch '{"id":[${phoneId}],"automaticLanguage":false,"language":"${t.requiredLocale}"}' и перезагрузить телефон`);
      }
      if (info.envStatus !== 2) {
        throw new Error(`Телефон должен быть выключён — RPA включает его сам (иначе 33309). Сейчас статус ${info.envStatus}: power off ${phoneId}`);
      }
      const plan = warmupPlan(c, platform);
      const saved = await localCall(env, "/api/cloudphone/rpa/onceTask/save", {
        cloudPhoneId: phoneId,
        scheduleName: `Прогрев ${platform.toUpperCase()} — день ${plan.day}`,
        templateId: t.templateId,
        templateParameter: warmupParameter(plan, platform),
        description: plan.note,
      });
      return { taskId: saved, plan, hint: "ход выполнения: rpa history" };
    }
    case "call":
      return localCall(env, a, b ? JSON.parse(b) : {});
    case "token":
      return openToken(env);
    case "open":
      return openCall(env, a, b ? JSON.parse(b) : {});
    default:
      throw new Error("Команды: phones | phone <id> | apps [name] | installed <id> | power on|off <id> | install <id> <appVersionId> | start-app <id> <pkg> | exec <id> \"<cmd>\" | upload <id> <file> [dest] | proxy add <url> [--name] [--refresh] | proxy list | bind <phoneId> <proxyId> | rotate [proxyId] | ip [proxyUrl] | switch <phoneId> | rpa templates|tasks|history | warmup <phoneId> <ig|tt> <день> | warmup-plan [день] | call <path> '<json>' | token | open <path> '<json>'");
  }
}

const isMain = process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]));
if (isMain) {
  main(process.argv.slice(2))
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
