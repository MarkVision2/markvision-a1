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

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SB = process.env.SUPABASE_URL || "https://szfgdruhlebfvcmlvxdk.supabase.co";

/** Публикуемый ключ (он же в сборке фронта) — им проверяем наличие таблиц. */
function publishableKey() {
  if (process.env.VITE_SUPABASE_PUBLISHABLE_KEY) return process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  try {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const line = readFileSync(join(root, ".env.production"), "utf8")
      .split("\n").find((l) => l.startsWith("VITE_SUPABASE_PUBLISHABLE_KEY="));
    return line ? line.slice("VITE_SUPABASE_PUBLISHABLE_KEY=".length).trim() : "";
  } catch {
    return "";
  }
}

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
  // publish-accounts проверяет JWT на шлюзе Supabase; публикуемого ключа хватает,
  // а внутри функции авторизует уже x-automation-key.
  const anonKey = publishableKey();
  if (anonKey) headers.Authorization = `Bearer ${anonKey}`;
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

/* 2. Схема в базе. Спрашиваем PostgREST напрямую: функции и миграции едут
      разными шагами деплоя, и функции спокойно живут без таблиц. Отсутствие
      таблицы — это PGRST205, а не пустой ответ. */
const anon = publishableKey();

console.log("\nСхема в базе");
if (!anon) {
  console.log(warn("не нашёл публикуемый ключ — пропускаю (VITE_SUPABASE_PUBLISHABLE_KEY)"));
} else {
  const RELATIONS = ["publish_accounts_safe", "publish_videos", "publish_jobs", "publish_logs", "publish_account_groups"];
  const missing = [];
  for (const rel of RELATIONS) {
    let res;
    try {
      res = await fetch(`${SB}/rest/v1/${rel}?select=*&limit=1`, {
        headers: { apikey: anon, Authorization: `Bearer ${anon}` },
      });
    } catch (e) {
      console.log(bad(`${rel} — сеть недоступна: ${String(e).slice(0, 120)}`));
      continue;
    }
    if (res.status === 404) {
      console.log(bad(`${rel} — нет в схеме`));
      missing.push(rel);
    } else {
      console.log(ok(`${rel} — есть`));
    }
  }
  if (missing.length) {
    problems.push(
      "миграция не применилась: смотрите шаг «Apply database migrations» в последнем запуске supabase-deploy",
    );
  }
}

/* 3. Ключ автоматизации. Проверяем безобидным режимом монитора. */
console.log("\nКлюч автоматизации");
if (!key) {
  console.log(warn("не передан — пропускаю (--key или AUTOMATION_KEY)"));
  problems.push("не проверен ключ автоматизации: запустите с --key");
} else {
  const r = await call("publish-monitor", { mode: "errors" });
  if (r.status === 200 && r.json?.error) {
    // Функция ответила, но упёрлась в БД. Самый частый случай — миграция не
    // применилась: функции выкатываются отдельным шагом деплоя и живут без схемы.
    console.log(ok("ключ принят"));
    console.log(bad(`база не отвечает как надо: ${r.json.error}`));
    problems.push(
      /does not exist|relation .* does not exist|schema cache/i.test(r.json.error)
        ? "схема не применена: смотрите шаг «Apply database migrations» в деплое Supabase"
        : `монитор не смог прочитать таблицы: ${r.json.error}`,
    );
  } else if (r.status === 200) {
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

/* 4. Готовность подключать аккаунты: секрет шифрования и Meta-токен проекта.
      Обе проверки читающие — connect без page_ids и available только
      перечисляет страницы. */
if (projectId && key && anon) {
  console.log("\nПодключение аккаунтов");
  const authHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${anon}`,
    "x-automation-key": key,
  };
  const post = async (body) => {
    try {
      const res = await fetch(`${SB}/functions/v1/publish-accounts`, {
        method: "POST", headers: authHeaders, body: JSON.stringify(body),
      });
      return { status: res.status, json: await res.json().catch(() => null) };
    } catch (e) {
      return { status: 0, json: { error: String(e) } };
    }
  };

  // Ключ шифрования проверяем без побочек: connect доходит до проверки ключа
  // раньше, чем до списка страниц, и падает на page_ids, если ключ на месте.
  const probe = await post({ action: "connect", project_id: projectId });
  const probeErr = probe.json?.error ?? "";
  if (/PUBLISH_TOKEN_KEY/.test(probeErr)) {
    console.log(bad("PUBLISH_TOKEN_KEY не задан — новые аккаунты подключить нельзя"));
    problems.push("добавьте секрет PUBLISH_TOKEN_KEY в Supabase → Edge Functions → Secrets");
  } else if (/page_ids/.test(probeErr)) {
    console.log(ok("PUBLISH_TOKEN_KEY задан"));
  } else {
    console.log(warn(`неожиданный ответ проверки ключа: ${probeErr || probe.status}`));
  }

  const pages = await post({ action: "available", project_id: projectId });
  const pagesErr = pages.json?.error ?? "";
  if (pagesErr) {
    // Протухший Meta-токен — самая частая причина: страницы перечисляются
    // пользовательским токеном, а публикует потом page-токен аккаунта.
    const stale = /OAuth|access token|Meta-токен/i.test(pagesErr);
    console.log(bad(`список страниц недоступен: ${pagesErr}`));
    problems.push(stale
      ? "Meta-токен проекта недействителен: переподключите Facebook в MarkVision → Настройки → Meta"
      : `не удалось получить список страниц: ${pagesErr}`);
  } else {
    const list = pages.json?.pages ?? [];
    const free = list.filter((p) => p.connectable && !p.already_connected);
    const noIg = list.filter((p) => !p.connectable);
    console.log(ok(`страниц в охвате токена: ${list.length}`));
    console.log(`  готовы к подключению: ${free.length}${free.length ? " — " + free.map((p) => p.ig_username ?? p.page_name).join(", ") : ""}`);
    if (noIg.length) console.log(warn(`без Instagram Business/Creator: ${noIg.length}`));
  }
}

/* 5. Аккаунты и очередь по проекту. */
if (projectId && key) {
  console.log("\nАккаунты проекта");
  const r = await call("publish-accounts", { action: "list", project_id: projectId });
  if (r.status !== 200) {
    console.log(bad(`не получил список (${r.status}): ${(r.text ?? "").slice(0, 200)}`));
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
