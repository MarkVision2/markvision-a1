#!/usr/bin/env node
/**
 * Конвейер подключения сети Instagram-аккаунтов (ТЗ docs/TZ-instagram-100-accounts.md).
 *
 * Сами профили браузера ведёт Claude-сессия через MCP `phonegrid` (manage_browser /
 * browser_operate, скилл .claude/skills/instagram-connect). Этот скрипт — всё остальное,
 * что делается через наш backend с ключом автоматизации и что нужно принять по ТЗ:
 *
 *   node scripts/instagram-connect.mjs links  --project <uuid> --handles @a,@b,… [--file handles.txt]
 *                                             [--batch <имя>] [--hours 48] [--group <id>] [--persona <id>]
 *       одноразовая ссылка /connect/<token> на каждый аккаунт (max_uses 1, platforms instagram);
 *       реестр пачки — work/ig-connect/<batch>.json: хэндл → ссылка → профиль → IP → аккаунт
 *   node scripts/instagram-connect.mjs status --batch <имя>            # приёмка этапа 3
 *       по каждому хэндлу: состояние ссылки, аккаунт в сетке, auth_status, право публикации,
 *       connection_type; код выхода 1, пока пачка не принята целиком
 *   node scripts/instagram-connect.mjs ip     --batch <имя> --set @a=1.2.3.4 [--set …] | --import ips.csv
 *       реестр «профиль → @хэндл → IP» и проверка повторов адресов (приёмка этапа 2);
 *       --profile @a=<envId> запоминает id профиля PhoneGrid
 *   node scripts/instagram-connect.mjs preset --batch <имя> [--group <id>] [--persona <id>] [--timezone Asia/Almaty]
 *                                             [--window 10:00-20:00] [--daily-limit 2] [--ramp] [--enable|--disable]
 *       одна правка на всю пачку (accounts_bulk_update)
 *   node scripts/instagram-connect.mjs tokens --project <uuid> [--batch <имя>] [--account <id>…]
 *       publish-monitor mode=tokens по выбранным аккаунтам: продлён ли токен, новый срок,
 *       живость, auth_status (этап 4 — проверить продление, пока аккаунтов мало)
 *   node scripts/instagram-connect.mjs trace  --project <uuid> --job <id> | --video <id>
 *       трасса задания queued → processing → published, external_post_id и контрольные
 *       точки post_metrics d1/d3/d7 (этап 5)
 *   node scripts/instagram-connect.mjs totp                             # секрет — со stdin
 *       код двухфакторки для входа в профиле; секрет не попадает ни в аргументы, ни в файлы
 *
 * Ключ: --key <automation_settings.cron_secret> или AUTOMATION_KEY в .env. Адрес Supabase —
 * SUPABASE_URL / VITE_SUPABASE_URL (по умолчанию прод). Пароли аккаунтов скрипт не хранит
 * и не принимает — платформа паролей не хранит принципиально.
 */
import { createHmac } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_SB = "https://szfgdruhlebfvcmlvxdk.supabase.co";
export const PUBLISH_SCOPE = "instagram_business_content_publish";
export const MANIFEST_DIR = "work/ig-connect";

/* ───────────────────────── чистая часть (тесты scripts/instagram-connect.test.mjs) ───────────────────────── */

/** argv → { _: позиционные, флаги }; повторяемые флаги (--set, --account) собираются в массив. */
export function parseArgs(argv, multi = ["set", "profile", "account"]) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { out._.push(a); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    const value = next !== undefined && !next.startsWith("--") ? argv[++i] : true;
    if (multi.includes(key)) (out[key] ??= []).push(value);
    else out[key] = value;
  }
  return out;
}

/** «@Handle », «https://instagram.com/handle/», «handle» → «handle» (Instagram — регистронезависимый). */
export function normalizeHandle(raw) {
  let h = String(raw ?? "").trim();
  h = h.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/[/?#].*$/, "");
  h = h.replace(/^@+/, "").toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(h)) throw new Error(`Не похоже на хэндл Instagram: «${raw}»`);
  return h;
}

/** Список хэндлов из строки (--handles) и/или файла (по одному в строке, # — комментарий), без повторов. */
export function parseHandles(inline, fileText) {
  const src = [];
  if (inline) src.push(...String(inline).split(/[,\s]+/));
  if (fileText) src.push(...fileText.split(/\r?\n/).map((l) => l.replace(/#.*$/, "")));
  const seen = new Set();
  for (const s of src) {
    if (!s.trim()) continue;
    seen.add(normalizeHandle(s));
  }
  return [...seen];
}

/** Имя пачки → путь реестра; путь к .json принимается как есть. */
export function manifestPath(batch, root = process.cwd()) {
  if (!batch) throw new Error("Нужна пачка: --batch <имя>");
  if (/\.json$/i.test(batch)) return resolve(root, batch);
  if (!/^[\w.-]+$/.test(batch)) throw new Error(`Имя пачки — буквы, цифры, «-», «_»: «${batch}»`);
  return resolve(root, MANIFEST_DIR, `${batch}.json`);
}

export function newManifest(batch, projectId) {
  return { batch, project_id: projectId, created_at: new Date().toISOString(), accounts: {} };
}

/** «@a=1.2.3.4» → [handle, value]; значение — всё после первого «=». */
export function parsePair(raw) {
  const s = String(raw ?? "");
  const eq = s.indexOf("=");
  if (eq <= 0 || eq === s.length - 1) throw new Error(`Ожидаю @хэндл=значение, получил «${raw}»`);
  return [normalizeHandle(s.slice(0, eq)), s.slice(eq + 1).trim()];
}

/** CSV/TSV «хэндл;ip[;профиль]» (разделитель , ; или таб; заголовок допускается) → пары. */
export function parseIpImport(text) {
  const rows = [];
  for (const line of String(text).split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const cells = t.split(/[;,\t]/).map((c) => c.trim());
    if (cells.length < 2) continue;
    if (/^(handle|хэндл|аккаунт)/i.test(cells[0])) continue;
    rows.push({ handle: normalizeHandle(cells[0]), ip: cells[1], profile: cells[2] || undefined });
  }
  return rows;
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
export function validIp(ip) {
  return IPV4.test(String(ip ?? "").trim()) || /^[0-9a-f:]+:[0-9a-f:]*$/i.test(String(ip ?? "").trim());
}

/**
 * Повторы адресов выхода: площадка связывает аккаунты с одним IP (ТЗ, раздел 3),
 * поэтому приёмка этапа 2 — «без повторов». accounts: { handle: { ip } }.
 */
export function duplicateIps(accounts) {
  const byIp = new Map();
  for (const [handle, a] of Object.entries(accounts)) {
    if (!a?.ip) continue;
    byIp.set(a.ip, [...(byIp.get(a.ip) ?? []), handle]);
  }
  return [...byIp.entries()].filter(([, hs]) => hs.length > 1).map(([ip, handles]) => ({ ip, handles }));
}

export function ipReport(accounts) {
  const handles = Object.keys(accounts);
  const withIp = handles.filter((h) => accounts[h]?.ip);
  const dups = duplicateIps(accounts);
  return {
    total: handles.length,
    with_ip: withIp.length,
    missing: handles.filter((h) => !accounts[h]?.ip),
    duplicates: dups,
    accepted: handles.length > 0 && withIp.length === handles.length && dups.length === 0,
  };
}

/** Право публикации в oauth_scope: пустой scope площадка иногда не отдаёт — это «неизвестно», а не отказ. */
export function hasPublishScope(scope) {
  if (!scope) return null;
  return scope.includes(PUBLISH_SCOPE) || scope.includes("instagram_content_publish");
}

/**
 * Вердикт по одной строке пачки — приёмка этапа 3 ТЗ: аккаунт есть, auth_status =
 * connected, в oauth_scope есть право публикации, connection_type = oauth, ссылка
 * использована. link — из connect_link_list (state), account — из list.
 */
export function accountVerdict({ link, account }) {
  const problems = [];
  if (!account) {
    if (!link) return { ok: false, state: "нет ссылки", problems: ["ссылка не создана — links"] };
    if (link.state === "active") return { ok: false, state: "ждёт подключения", problems: [] };
    return { ok: false, state: `ссылка ${link.state}`, problems: [`ссылка ${link.state}, аккаунт не приехал — выдать новую (links)`] };
  }
  if (account.platform !== "instagram") problems.push(`площадка ${account.platform}, а не instagram`);
  if ((account.auth_status ?? "connected") !== "connected") problems.push(`auth_status = ${account.auth_status}`);
  const scope = hasPublishScope(account.oauth_scope);
  if (scope === false) problems.push(`в oauth_scope нет ${PUBLISH_SCOPE}: ${account.oauth_scope}`);
  if (scope === null) problems.push("oauth_scope пустой — право публикации подтвердится первой публикацией");
  if (account.connection_type && account.connection_type !== "oauth") problems.push(`connection_type = ${account.connection_type}`);
  if (account.status && account.status !== "active") problems.push(`status = ${account.status}`);
  if (link && link.state === "active") problems.push("ссылка всё ещё активна — лимит не сработал, отозвать (connect_link_revoke)");
  return { ok: problems.length === 0, state: problems.length ? "с замечаниями" : "подключён", problems };
}

/** Итог по пачке: принята, когда все строки ok и не осталось живых неиспользованных ссылок. */
export function batchVerdict(rows) {
  const ok = rows.filter((r) => r.verdict.ok).length;
  const waiting = rows.filter((r) => !r.account && r.link?.state === "active").length;
  const failed = rows.length - ok - waiting;
  return { total: rows.length, ok, waiting, failed, accepted: rows.length > 0 && ok === rows.length };
}

/** Сопоставление строк реестра с ссылками и аккаунтами: сначала по connect_link_id, потом по хэндлу. */
export function matchRows(manifest, links, accounts) {
  const linkById = new Map(links.map((l) => [l.id, l]));
  const byLink = new Map();
  const byHandle = new Map();
  for (const a of accounts) {
    if (a.connect_link_id) byLink.set(a.connect_link_id, a);
    if (a.handle) byHandle.set(normalizeHandle(a.handle), a);
  }
  return Object.entries(manifest.accounts).map(([handle, row]) => {
    const link = row.link_id ? linkById.get(row.link_id) ?? null : null;
    const account = (row.link_id && byLink.get(row.link_id)) || byHandle.get(handle) || null;
    return { handle, row, link, account, verdict: accountVerdict({ link, account }) };
  });
}

/** «10:00-20:00» → { window_start, window_end }. */
export function parseWindow(raw) {
  const m = /^(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})$/.exec(String(raw ?? "").trim());
  if (!m) throw new Error(`Окно публикации — ЧЧ:ММ-ЧЧ:ММ, получил «${raw}»`);
  const norm = (t) => t.padStart(5, "0");
  return { window_start: norm(m[1]), window_end: norm(m[2]) };
}

/** Флаги preset → патч accounts_bulk_update (те же поля, что в интерфейсе). */
export function buildPreset(flags) {
  const patch = {};
  if (typeof flags.group === "string") patch.group_id = flags.group;
  if (typeof flags.persona === "string") patch.persona_id = flags.persona;
  if (typeof flags.timezone === "string") patch.timezone = flags.timezone;
  if (typeof flags.window === "string") Object.assign(patch, parseWindow(flags.window));
  if (flags["daily-limit"] !== undefined) {
    const n = Number(flags["daily-limit"]);
    if (!Number.isInteger(n) || n < 1 || n > 200) throw new Error("--daily-limit — целое от 1 до 200");
    patch.daily_limit = n;
  }
  if (flags.ramp === true) { patch.ramp_enabled = true; patch.ramp_restart = true; }
  if (flags.enable === true) patch.publish_enabled = true;
  if (flags.disable === true) patch.publish_enabled = false;
  if (!Object.keys(patch).length) throw new Error("Нечего менять: --group, --persona, --timezone, --window, --daily-limit, --ramp, --enable/--disable");
  return patch;
}

/** Строка отчёта по аккаунту из results режима tokens publish-monitor. */
export function tokenVerdict(r) {
  const problems = [];
  if (!r.alive) problems.push(`токен мёртв → auth_status ${r.auth_status}`);
  if (r.refresh_error) problems.push(`продление: ${r.refresh_error}`);
  if (r.alive && r.auth_status !== "connected") problems.push(`auth_status ${r.auth_status}`);
  const kind = r.token_kind === "instagram_login" ? "IGAA (60 дн.)" : r.token_kind === "page" ? "page (вечный)" : r.token_kind;
  return { ok: problems.length === 0, kind, problems };
}

/** Итог этапа 4: все живы, ни одной ошибки продления, а у кого продлевали — стоит свежий token_refreshed_at. */
export function tokensSummary(results, now = Date.now()) {
  const dead = results.filter((r) => !r.alive);
  const errors = results.filter((r) => r.refresh_error);
  const refreshed = results.filter((r) => r.refreshed);
  const stale = refreshed.filter((r) => !r.token_refreshed_at || now - Date.parse(r.token_refreshed_at) > 3_600_000);
  const badDead = dead.filter((r) => r.auth_status !== "reconnect_required");
  return {
    checked: results.length, refreshed: refreshed.length, dead: dead.length, errors: errors.length,
    accepted: results.length > 0 && errors.length === 0 && stale.length === 0 && badDead.length === 0,
    notes: [
      ...stale.map((r) => `${r.account_name}: продлён, но token_refreshed_at не обновился`),
      ...badDead.map((r) => `${r.account_name}: токен мёртв, а auth_status = ${r.auth_status}`),
    ],
  };
}

/* ─── TOTP (RFC 6238): код двухфакторки из секрета менеджера паролей ─── */

export function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = String(input).toUpperCase().replace(/[\s=-]/g, "");
  if (!clean || /[^A-Z2-7]/.test(clean)) throw new Error("Секрет TOTP должен быть в base32 (A–Z, 2–7)");
  const bytes = [];
  let bits = 0, value = 0;
  for (const ch of clean) {
    value = (value << 5) | alphabet.indexOf(ch);
    bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(bytes);
}

export function totp(secret, { time = Date.now(), step = 30, digits = 6 } = {}) {
  const key = base32Decode(secret);
  const counter = Math.floor(time / 1000 / step);
  const msg = Buffer.alloc(8);
  msg.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  msg.writeUInt32BE(counter >>> 0, 4);
  const h = createHmac("sha1", key).update(msg).digest();
  const off = h[h.length - 1] & 0x0f;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}

/* ───────────────────────── окружение и вызовы ───────────────────────── */

function parseEnvFile(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

function loadEnv() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  let file = {};
  try { file = parseEnvFile(readFileSync(resolve(root, ".env"), "utf8")); } catch { /* .env может отсутствовать */ }
  return { root, env: { ...file, ...process.env } };
}

function makeClient(env, flags) {
  const key = flags.key || env.AUTOMATION_KEY || "";
  if (!key) throw new Error("Нужен ключ автоматизации: --key <automation_settings.cron_secret> или AUTOMATION_KEY в .env");
  const sb = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || DEFAULT_SB).replace(/\/+$/, "");
  const anon = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || "";
  return async function call(fn, body) {
    const headers = { "Content-Type": "application/json", "x-automation-key": key };
    if (anon) { headers.apikey = anon; headers.Authorization = `Bearer ${anon}`; }
    const res = await fetch(`${sb}/functions/v1/${fn}`, { method: "POST", headers, body: JSON.stringify(body ?? {}) });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* не JSON */ }
    if (!res.ok || json?.error) throw new Error(`${fn}${body?.action ? ` ${body.action}` : ""}: ${json?.error ?? `HTTP ${res.status} ${text.slice(0, 200)}`}`);
    return json ?? {};
  };
}

function readManifest(path) {
  if (!existsSync(path)) throw new Error(`Реестр пачки не найден: ${path} — сначала links`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeManifest(path, manifest) {
  mkdirSync(dirname(path), { recursive: true });
  manifest.updated_at = new Date().toISOString();
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
}

/** Все аккаунты проекта (список постраничный — на сотне и больше одной страницы мало). */
async function listAccounts(call, projectId) {
  const out = [];
  for (let offset = 0; ; offset += 500) {
    const r = await call("publish-accounts", { action: "list", project_id: projectId, platform: "instagram", limit: 500, offset });
    out.push(...(r.accounts ?? []));
    if (!r.has_more) break;
  }
  return out;
}

const ok = (s) => `\x1b[32m✓\x1b[0m ${s}`;
const bad = (s) => `\x1b[31m✗\x1b[0m ${s}`;
const wait = (s) => `\x1b[33m…\x1b[0m ${s}`;
const short = (iso) => (iso ? String(iso).slice(0, 16).replace("T", " ") : "—");

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

/* ───────────────────────── команды ───────────────────────── */

async function cmdLinks(flags, env, root) {
  const projectId = flags.project;
  if (!projectId) throw new Error("--project <uuid> обязателен");
  const fileText = flags.file ? readFileSync(resolve(root, flags.file), "utf8") : null;
  const handles = parseHandles(flags.handles, fileText);
  if (!handles.length) throw new Error("Нет хэндлов: --handles @a,@b или --file handles.txt");
  if (handles.length > 30) console.error(`Внимание: ${handles.length} аккаунтов — ТЗ ведёт пачками по 20–30.`);
  const batch = flags.batch || new Date().toISOString().slice(0, 10);
  const path = manifestPath(batch, root);
  const manifest = existsSync(path) ? readManifest(path) : newManifest(batch, projectId);
  if (manifest.project_id !== projectId) throw new Error(`Пачка «${batch}» уже привязана к проекту ${manifest.project_id}`);
  const call = makeClient(env, flags);
  const hours = Number(flags.hours ?? 48);
  // expires_days — целые дни; часы округляем вверх, чтобы ссылка не сгорела раньше.
  const days = Math.max(1, Math.ceil(hours / 24));

  let created = 0;
  for (const handle of handles) {
    const row = manifest.accounts[handle];
    if (row?.link_id && !flags.renew) { console.log(wait(`@${handle} — ссылка уже есть: ${row.url}`)); continue; }
    const r = await call("publish-accounts", {
      action: "connect_link_create", project_id: projectId,
      label: `@${handle}`, note: `Профиль @${handle}, пачка ${batch}`,
      platforms: ["instagram"], max_uses: 1, expires_days: days,
      ...(flags.group ? { group_id: flags.group } : {}), ...(flags.persona ? { persona_id: flags.persona } : {}),
    });
    manifest.accounts[handle] = { ...(row ?? {}), link_id: r.link.id, url: r.link.url, expires_at: r.link.expires_at, created_at: r.link.created_at };
    created++;
    console.log(ok(`@${handle} → ${r.link.url}`));
  }
  writeManifest(path, manifest);
  console.log(`\nСоздано ссылок: ${created}. Реестр пачки: ${path}`);
  console.log("Дальше — по скиллу instagram-connect: открыть каждую ссылку в профиле аккаунта, затем `status --batch`.");
}

async function cmdStatus(flags, env, root) {
  const path = manifestPath(flags.batch, root);
  const manifest = readManifest(path);
  const call = makeClient(env, flags);
  const [{ links = [] }, accounts] = await Promise.all([
    call("publish-accounts", { action: "connect_link_list", project_id: manifest.project_id }),
    listAccounts(call, manifest.project_id),
  ]);
  const rows = matchRows(manifest, links, accounts);
  for (const r of rows) {
    if (r.account) { r.row.account_id = r.account.id; r.row.account_name = r.account.account_name; }
    const line = `@${r.handle} — ${r.verdict.state}${r.account ? ` (${r.account.account_name}, health ${r.account.health_score ?? "—"})` : ""}`;
    console.log(r.verdict.ok ? ok(line) : r.verdict.state === "ждёт подключения" ? wait(line) : bad(line));
    for (const p of r.verdict.problems) console.log(`    ${p}`);
  }
  writeManifest(path, manifest);
  const v = batchVerdict(rows);
  console.log(`\nПачка «${manifest.batch}»: подключено ${v.ok}/${v.total}, ждут ${v.waiting}, с проблемами ${v.failed}.`);
  console.log(v.accepted ? ok("Этап 3 принят: все аккаунты подключены с правом публикации, неиспользованных ссылок нет.") : bad("Этап 3 не принят — смотрите строки выше."));
  if (flags.json) console.log(JSON.stringify({ batch: manifest.batch, ...v, rows: rows.map((r) => ({ handle: r.handle, ...r.verdict, account_id: r.account?.id ?? null })) }, null, 2));
  process.exitCode = v.accepted ? 0 : 1;
}

function cmdIp(flags, root) {
  const path = manifestPath(flags.batch, root);
  const manifest = readManifest(path);
  const upd = (handle, patch) => {
    if (!manifest.accounts[handle]) throw new Error(`@${handle} нет в пачке «${manifest.batch}» — сначала links`);
    Object.assign(manifest.accounts[handle], patch);
  };
  for (const s of flags.set ?? []) {
    const [handle, ip] = parsePair(s);
    if (!validIp(ip)) throw new Error(`Не IP: «${ip}» у @${handle}`);
    upd(handle, { ip, ip_checked_at: new Date().toISOString() });
  }
  for (const s of flags.profile ?? []) {
    const [handle, profile] = parsePair(s);
    upd(handle, { profile });
  }
  if (flags.import) {
    for (const r of parseIpImport(readFileSync(resolve(root, flags.import), "utf8"))) {
      if (!validIp(r.ip)) throw new Error(`Не IP: «${r.ip}» у @${r.handle}`);
      upd(r.handle, { ip: r.ip, ip_checked_at: new Date().toISOString(), ...(r.profile ? { profile: r.profile } : {}) });
    }
  }
  writeManifest(path, manifest);

  // Повторы ищем не только внутри пачки, но и по всем пачкам проекта: адрес,
  // уже занятый прошлой пачкой, площадке так же виден.
  const all = { ...manifest.accounts };
  if (flags.all !== false) {
    for (const f of readdirSync(dirname(path)).filter((n) => n.endsWith(".json") && n !== basename(path))) {
      try {
        const m = JSON.parse(readFileSync(join(dirname(path), f), "utf8"));
        for (const [h, a] of Object.entries(m.accounts ?? {})) if (!all[h]) all[h] = { ...a, batch: m.batch };
      } catch { /* чужой файл — пропускаем */ }
    }
  }
  const report = ipReport(manifest.accounts);
  for (const [h, a] of Object.entries(manifest.accounts)) {
    const cell = `@${h}\t${a.profile ?? "профиль —"}`;
    console.log(a.ip ? ok(`${cell}\t${a.ip}`) : wait(`${cell}\tIP не записан`));
  }
  const dupsAll = duplicateIps(all);
  for (const d of dupsAll) console.log(bad(`адрес ${d.ip} повторяется: ${d.handles.map((h) => "@" + h).join(", ")}`));
  console.log(`\nЗаписано IP: ${report.with_ip}/${report.total}${report.missing.length ? `, без адреса: ${report.missing.map((h) => "@" + h).join(", ")}` : ""}.`);
  const accepted = report.accepted && dupsAll.length === 0;
  console.log(accepted ? ok("Этап 2 принят: у каждого профиля свой адрес выхода.") : bad("Этап 2 не принят."));
  process.exitCode = accepted ? 0 : 1;
}

async function cmdPreset(flags, env, root) {
  const path = manifestPath(flags.batch, root);
  const manifest = readManifest(path);
  const patch = buildPreset(flags);
  const ids = Object.values(manifest.accounts).map((a) => a.account_id).filter(Boolean);
  if (!ids.length) throw new Error("В пачке нет подключённых аккаунтов — сначала status");
  const call = makeClient(env, flags);
  const r = await call("publish-accounts", { action: "accounts_bulk_update", project_id: manifest.project_id, account_ids: ids, patch });
  console.log(ok(`обновлено ${r.updated} из ${ids.length}${r.missing ? `, не найдено ${r.missing}` : ""}: ${JSON.stringify(r.patch)}`));
}

async function cmdTokens(flags, env, root) {
  const projectId = flags.project || (flags.batch ? readManifest(manifestPath(flags.batch, root)).project_id : null);
  if (!projectId) throw new Error("--project <uuid> или --batch <имя>");
  let accountIds = flags.account ?? [];
  if (flags.batch) {
    const m = readManifest(manifestPath(flags.batch, root));
    accountIds = [...accountIds, ...Object.values(m.accounts).map((a) => a.account_id).filter(Boolean)];
  }
  const call = makeClient(env, flags);
  const r = await call("publish-monitor", { mode: "tokens", project_id: projectId, ...(accountIds.length ? { account_ids: accountIds } : {}) });
  const results = r.results ?? [];
  for (const row of results) {
    const v = tokenVerdict(row);
    const line = `${row.account_name}${row.handle ? ` @${row.handle}` : ""} — ${v.kind}; ` +
      `${row.refreshed ? "продлён" : "не продлевали"} (${row.refresh_reason}); срок ${short(row.token_expires_at)}; продлён ${short(row.token_refreshed_at)}; ${row.alive ? "жив" : "МЁРТВ"}; auth_status ${row.auth_status}`;
    console.log(v.ok ? ok(line) : bad(line));
    for (const p of v.problems) console.log(`    ${p}`);
  }
  const s = tokensSummary(results);
  for (const n of s.notes) console.log(bad(n));
  console.log(`\nПроверено ${s.checked}, продлено ${s.refreshed}, мёртвых ${s.dead}, ошибок продления ${s.errors}${r.skipped ? `, не успели ${r.skipped}` : ""}.`);
  console.log(s.accepted ? ok("Этап 4: продление работает, мёртвые токены помечены reconnect_required.") : bad("Этап 4 не принят — смотрите строки выше."));
  if (flags.json) console.log(JSON.stringify(r, null, 2));
  process.exitCode = s.accepted ? 0 : 1;
}

async function printJob(call, projectId, jobId) {
  const r = await call("publish-accounts", { action: "job_get", project_id: projectId, job_id: jobId });
  const j = r.job;
  const acc = j.publish_accounts ?? {};
  console.log(`\nЗадание ${j.id} — ${acc.account_name ?? ""}${acc.handle ? ` @${acc.handle}` : ""} (${j.platform}) — статус ${j.status}`);
  console.log(`  ролик: ${j.publish_videos?.title ?? j.video_id}; попыток ${j.attempts}; external_post_id ${j.external_post_id ?? "—"}; ${j.external_post_url ?? ""}`);
  if (j.error_message) console.log(`  ошибка: ${j.error_code ?? ""} ${j.error_message}`);
  console.log("  трасса:");
  for (const e of r.events ?? []) console.log(`    ${short(e.created_at)}  ${e.step.padEnd(14)} ${e.level === "error" ? "✗" : "·"} ${e.message ?? ""}`);
  const metrics = r.metrics ?? [];
  if (metrics.length) {
    console.log("  метрики:");
    for (const m of metrics) console.log(`    ${m.checkpoint}  ${short(m.captured_at)}  охват ${m.reach ?? "—"}, просмотры ${m.views ?? "—"}, лайки ${m.likes ?? "—"}, комментарии ${m.comments ?? "—"}, сохранения ${m.saves ?? "—"}, репосты ${m.shares ?? "—"}`);
  } else {
    console.log(`  метрики: пока нет${j.metrics_unavailable_reason ? ` (${j.metrics_unavailable_reason})` : j.published_at ? " — d1 приходит через сутки после публикации (крон publish-metrics-6h)" : ""}`);
  }
  const published = j.status === "published" && Boolean(j.external_post_id);
  const d1 = metrics.some((m) => m.checkpoint === "d1");
  return { published, d1 };
}

async function cmdTrace(flags, env) {
  if (!flags.project) throw new Error("--project <uuid> обязателен");
  const call = makeClient(env, flags);
  const jobIds = [];
  if (flags.job) jobIds.push(flags.job);
  if (flags.video) {
    const r = await call("publish-accounts", { action: "jobs_list", project_id: flags.project, video_id: flags.video, limit: 500 });
    jobIds.push(...(r.jobs ?? []).map((j) => j.id));
    console.log(`Заданий по ролику: ${(r.jobs ?? []).length}; по статусам: ${JSON.stringify(r.counts)}`);
  }
  if (!jobIds.length) throw new Error("--job <id> или --video <id>");
  let published = 0, d1 = 0;
  for (const id of jobIds) {
    const s = await printJob(call, flags.project, id);
    if (s.published) published++;
    if (s.d1) d1++;
  }
  console.log(`\nОпубликовано через API: ${published}/${jobIds.length}; с метриками d1: ${d1}/${jobIds.length}.`);
  const accepted = published === jobIds.length && d1 === jobIds.length;
  console.log(accepted ? ok("Этап 5 принят: пост опубликован через API, метрики d1 собраны.") : published === jobIds.length ? wait("Публикация есть, метрики d1 ещё не собраны.") : bad("Этап 5 не принят."));
  process.exitCode = accepted ? 0 : 1;
}

async function cmdTotp() {
  if (process.stdin.isTTY) throw new Error("Секрет подаётся со stdin, чтобы не попасть в историю команд: echo \"$SECRET\" | node scripts/instagram-connect.mjs totp");
  const secret = (await readStdin()).trim();
  const now = Date.now();
  const code = totp(secret, { time: now });
  const left = 30 - Math.floor((now / 1000) % 30);
  console.log(JSON.stringify({ code, seconds_left: left, next: totp(secret, { time: now + 30_000 }) }));
}

const USAGE = "Команды: links | status | ip | preset | tokens | trace | totp — подробности в шапке файла";

export async function main(argv) {
  const [cmd, ...rest] = argv;
  const flags = parseArgs(rest);
  const { root, env } = loadEnv();
  switch (cmd) {
    case "links": return cmdLinks(flags, env, root);
    case "status": return cmdStatus(flags, env, root);
    case "ip": return cmdIp(flags, root);
    case "preset": return cmdPreset(flags, env, root);
    case "tokens": return cmdTokens(flags, env, root);
    case "trace": return cmdTrace(flags, env);
    case "totp": return cmdTotp();
    default: throw new Error(USAGE);
  }
}

const isMain = process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]));
if (isMain) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
