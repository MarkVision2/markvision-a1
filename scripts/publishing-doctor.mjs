#!/usr/bin/env node
/**
 * Готовность контура автопубликации: что задеплоено, работает ли ключ
 * автоматизации, есть ли аккаунты и что происходит в очереди.
 *
 * Ничего не публикует и ничего не меняет — только читает. Из вызовов с
 * побочными эффектами не трогается ни один: publish-worker не дёргается,
 * publish-monitor зовётся в режиме errors, который без аварийных аккаунтов
 * ничего не делает.
 *
 * Запуск:
 *   node scripts/publishing-doctor.mjs --key <automation_settings.cron_secret> [--project <uuid>]
 *
 * Ключ можно передать переменной окружения AUTOMATION_KEY.
 */

const SB = process.env.SUPABASE_URL || "https://szfgdruhlebfvcmlvxdk.supabase.co";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : null;
}

const key = arg("key") || process.env.AUTOMATION_KEY || "";
const projectId = arg("project");

const ok = (s) => `\x1b[32m✓\x1b[0m ${s}`;
const bad = (s) => `\x1b[31m✗\x1b[0m ${s}`;
const warn = (s) => `\x1b[33m•\x1b[0m ${s}`;

async function call(fn, body, withKey = true) {
  const headers = { "Content-Type": "application/json" };
  if (withKey && key) headers["x-automation-key"] = key;
  try {
    const res = await fetch(`${SB}/functions/v1/${fn}`, {
      method: "POST", headers, body: JSON.stringify(body ?? {}),
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* не JSON — вернём как есть */ }
    return { status: res.status, json, text };
  } catch (e) {
    return { status: 0, json: null, text: String(e) };
  }
}

const FUNCTIONS = ["publish-intake", "publish-worker", "publish-dispatch", "publish-monitor", "publish-accounts"];

const problems = [];

console.log(`\nПроект Supabase: ${SB}\n`);

/* 1. Задеплоены ли функции. Без ключа: 404 — нет функции, что угодно другое — есть. */
console.log("Функции");
for (const fn of FUNCTIONS) {
  const r = await call(fn, {}, false);
  const missing = r.status === 404 || /Requested function was not found/i.test(r.text ?? "");
  if (missing) {
    console.log(bad(`${fn} — не задеплоена`));
    problems.push(`${fn} не задеплоена: влейте ветку в main, деплой пойдёт сам`);
  } else {
    console.log(ok(`${fn} — отвечает (${r.status})`));
  }
}

/* 2. Ключ автоматизации. Проверяем безобидным режимом монитора. */
console.log("\nКлюч автоматизации");
if (!key) {
  console.log(warn("не передан — пропускаю (--key или AUTOMATION_KEY)"));
  problems.push("не проверен ключ автоматизации: запустите с --key");
} else {
  const r = await call("publish-monitor", { mode: "errors" });
  if (r.status === 200) {
    const d = r.json ?? {};
    console.log(ok("ключ принят"));
    console.log(`  аккаунтов отключено монитором сейчас: ${d.disabled ?? 0}; заданий на ручном разборе: ${d.manual_review ?? 0}`);
  } else if (r.status === 401 || r.status === 403) {
    console.log(bad("ключ не принят — publish-monitor ответил " + r.status));
    problems.push("ключ автоматизации неверный: возьмите automation_settings.cron_secret из Supabase");
  } else if (r.status === 404) {
    console.log(warn("функция ещё не задеплоена — проверю ключ после деплоя"));
  } else {
    console.log(bad(`неожиданный ответ ${r.status}: ${(r.text ?? "").slice(0, 200)}`));
  }
}

/* 3. Аккаунты и очередь по проекту. */
if (projectId && key) {
  console.log("\nАккаунты проекта");
  const r = await call("publish-accounts", { action: "list", project_id: projectId });
  if (r.status !== 200) {
    console.log(bad(`не получил список (${r.status}): ${(r.text ?? "").slice(0, 200)}`));
    // publish-accounts проверяет JWT на шлюзе — из скрипта это ожидаемо.
    if (r.status === 401) console.log(warn("для этой функции нужен пользовательский JWT — смотрите список в интерфейсе или через SQL"));
  } else {
    const list = r.json?.accounts ?? [];
    if (!list.length) {
      console.log(bad("аккаунтов нет"));
      problems.push("не подключено ни одного аккаунта: publish-accounts → available → connect");
    }
    for (const a of list) {
      const line = `${a.account_name} (${a.platform}) — ${a.status}${a.publish_enabled ? "" : ", публикация выключена"}`;
      console.log(a.status === "active" && a.publish_enabled ? ok(line) : warn(line));
      if (a.last_error) console.log(`    последняя ошибка: ${a.last_error}`);
    }
  }
} else if (!projectId) {
  console.log(`\n${warn("проект не передан (--project <uuid>) — аккаунты и очередь не проверял")}`);
}

console.log("\nИтог");
if (!problems.length) {
  console.log(ok("контур готов к работе"));
} else {
  for (const p of problems) console.log(bad(p));
}
console.log("\nПодробности — docs/PUBLISHING-SYSTEM.md\n");
process.exit(problems.length ? 1 : 0);
