#!/usr/bin/env node
/**
 * Готовность интеграции TikTok (docs/TIKTOK-DEVELOPER-APP.md): задеплоены ли
 * функции, заданы ли ключи приложения в секретах Supabase, похожи ли они на
 * ключи TikTok, что отвечает TikTok на наш client key, открываются ли
 * публичные /terms и /privacy на боевом домене.
 *
 * Ничего не меняет и секретов не печатает — только читает диагностику
 * (publish-oauth/diag и probe-tiktok показывают длину/префикс ключа, не значение).
 *
 * Запуск:
 *   node scripts/tiktok-doctor.mjs --key <automation_settings.cron_secret>
 *
 * Ключ можно передать переменной окружения AUTOMATION_KEY. Без ключа
 * проверяются только деплой функций и публичные страницы.
 */

const SB = process.env.SUPABASE_URL || "https://szfgdruhlebfvcmlvxdk.supabase.co";
const SITE = process.env.SITE_URL || "https://www.markvision.kz";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : null;
}

const key = arg("key") || process.env.AUTOMATION_KEY || "";

const ok = (s) => `\x1b[32m✓\x1b[0m ${s}`;
const bad = (s) => `\x1b[31m✗\x1b[0m ${s}`;
const warn = (s) => `\x1b[33m•\x1b[0m ${s}`;
const info = (s) => `  ${s}`;

let problems = 0;

async function get(path, headers = {}) {
  try {
    const res = await fetch(`${SB}/functions/v1/${path}`, { headers });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* не JSON */ }
    return { status: res.status, json, text };
  } catch (e) {
    return { status: 0, json: null, text: String(e) };
  }
}

/* ───────────────────────── 1. деплой функций ───────────────────────── */

console.log("\nФункции Supabase");
for (const fn of ["publish-oauth/diag", "tiktok-connect"]) {
  const r = await get(fn);
  // 404 — функции нет; 401 — есть, ждёт авторизацию; всё остальное — есть.
  if (r.status === 404 || (r.json && /not found/i.test(String(r.json.error ?? "")) && r.status !== 401)) {
    problems++;
    console.log(bad(`${fn.split("/")[0]} не задеплоена (HTTP ${r.status}) — деплой идёт при пуше в main (.github/workflows/supabase-deploy.yml)`));
  } else if (r.status === 0) {
    problems++;
    console.log(bad(`${fn.split("/")[0]}: нет связи с ${SB} — ${r.text}`));
  } else {
    console.log(ok(`${fn.split("/")[0]} задеплоена (HTTP ${r.status})`));
  }
}

/* ───────────────────────── 2. ключи приложения ───────────────────────── */

console.log("\nКлючи приложения TikTok");
if (!key) {
  console.log(warn("ключ автоматизации не передан (--key или AUTOMATION_KEY) — проверка секретов пропущена"));
} else {
  const diag = await get("publish-oauth/diag", { "x-automation-key": key });
  if (diag.status === 401 || diag.status === 403) {
    problems++;
    console.log(bad("ключ автоматизации не принят — сверьте automation_settings.cron_secret"));
  } else if (!diag.json?.ok) {
    problems++;
    console.log(bad(`diag ответил HTTP ${diag.status}: ${diag.text.slice(0, 200)}`));
  } else {
    const tt = (diag.json.platforms ?? []).find((p) => p.platform === "tiktok");
    if (!tt) {
      problems++;
      console.log(bad("diag не вернул платформу tiktok — задеплоена старая версия publish-oauth"));
    } else {
      if (tt.client_id_set) console.log(ok(`${tt.client_id_env} задан: ${tt.client_id_length} символов, префикс ${tt.client_id_prefix}`));
      else { problems++; console.log(bad(`${tt.client_id_env} не задан`)); }
      if (tt.secret_set) console.log(ok(`${tt.secret_env} задан`));
      else { problems++; console.log(bad(`${tt.secret_env} не задан`)); }
      if (tt.client_id_had_whitespace || tt.secret_had_whitespace) {
        console.log(warn("в секрете был пробел/перевод строки — функция его обрезает, но лучше пересохранить без него"));
      }
      if (tt.shape_problem) { problems++; console.log(bad(tt.shape_problem)); }
      else if (tt.client_id_set) {
        const sandbox = /^sb/i.test(String(tt.client_id_prefix ?? ""));
        console.log(info(sandbox
          ? "ключ песочницы (sbaw…): входить могут только target users песочницы, Direct Post — только в приватный аккаунт"
          : "боевой ключ (aw…): до одобрения App review авторизация для обычных пользователей не работает — для демо нужен sandbox"));
      }
      console.log(info(`redirect URI для Login Kit: ${tt.redirect_uri}`));
    }
    if (diag.json.token_key_configured) console.log(ok("PUBLISH_TOKEN_KEY задан — токены аккаунтов будет куда сохранять"));
    else { problems++; console.log(bad("PUBLISH_TOKEN_KEY не задан — подключение аккаунта упадёт на сохранении токена")); }

    const probe = await get("publish-oauth/probe-tiktok", { "x-automation-key": key });
    if (probe.json?.ok) {
      const bad_ = /не принимает|не выдаёт|не удался/.test(probe.json.verdict);
      if (bad_) problems++;
      console.log((bad_ ? bad : ok)(`ответ TikTok на client key: ${probe.json.verdict}`));
      if (probe.json.location_error) console.log(info(`error_code от TikTok: ${probe.json.location_error}`));
    } else {
      console.log(warn(`probe-tiktok: HTTP ${probe.status} ${String(probe.json?.error ?? probe.text).slice(0, 160)}`));
    }
  }
}

/* ───────────────────────── 3. публичные страницы ───────────────────────── */

console.log("\nЮридические страницы (адреса для формы приложения)");
for (const path of ["/terms", "/privacy"]) {
  try {
    const res = await fetch(`${SITE}${path}`, { redirect: "follow" });
    const html = await res.text();
    // SPA: index.html отдаётся на любой путь, поэтому проверяем и статус, и что это наш бандл.
    if (res.ok && /MarkVision/.test(html)) console.log(ok(`${SITE}${path} отвечает ${res.status}`));
    else { problems++; console.log(bad(`${SITE}${path}: HTTP ${res.status}`)); }
  } catch (e) {
    problems++;
    console.log(bad(`${SITE}${path}: ${String(e)}`));
  }
}
console.log(info("страницы появятся на домене после деплоя фронта из main (Vercel)"));

console.log(problems ? `\n${problems} проблем(ы) — см. docs/TIKTOK-DEVELOPER-APP.md\n` : "\nВсё готово к демо и подаче заявки.\n");
process.exit(problems ? 1 : 0);
