#!/usr/bin/env node
/**
 * CLI-клиент n8n Public API — чтобы Claude управлял воркфлоу напрямую,
 * а не через markdown-доки под ручной перенос в интерфейс.
 *
 * Auth: заголовок X-N8N-API-KEY = N8N_API_KEY из .env
 * База:  N8N_BASE_URL (по умолчанию https://n8n.zapoinov.com)
 *
 * Команды (из корня репозитория):
 *   node scripts/n8n.mjs ping
 *       Проверить связь и ключ. Печатает число воркфлоу.
 *   node scripts/n8n.mjs list [--active] [--name <подстрока>] [--limit N]
 *       Таблица воркфлоу: id, активность, имя, число нод.
 *   node scripts/n8n.mjs get <id> [--out <файл.json>]
 *       Полный JSON воркфлоу (в stdout или файл).
 *   node scripts/n8n.mjs pull [--dir n8n/workflows]
 *       Выгрузить ВСЕ воркфлоу в файлы — версионирование в git.
 *       Имя файла: <слаг-имени>.<id>.json
 *   node scripts/n8n.mjs push <файл.json> [--id <id>] [--activate]
 *       Залить файл в n8n. Без --id берётся id из самого файла;
 *       если id нет — создаётся новый воркфлоу.
 *   node scripts/n8n.mjs activate <id> | deactivate <id>
 *   node scripts/n8n.mjs executions [--workflow <id>] [--status error] [--limit N]
 *       Последние запуски — с чего начинать разбор поломки.
 *   node scripts/n8n.mjs execution <id> [--data]
 *       Один запуск; --data выгружает полезную нагрузку по нодам.
 *
 * Public API не умеет запускать воркфлоу — прод-запуск только через его webhook.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

function loadEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}
const env = { ...loadEnv(resolve(".env")), ...process.env };

const BASE = (env.N8N_BASE_URL || "https://n8n.zapoinov.com").replace(/\/+$/, "");
const API_KEY = env.N8N_API_KEY;
const API = `${BASE}/api/v1`;

if (!API_KEY) {
  console.error(
    "Нужен N8N_API_KEY в .env.\n" +
      "Взять: n8n → Settings → n8n API → Create an API key.\n" +
      `База сейчас: ${BASE} (меняется через N8N_BASE_URL).`,
  );
  process.exit(1);
}

/** Разбор `--flag value` и `--flag` из argv. */
function parseFlags(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      rest.push(a);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }
  return { flags, rest };
}

async function api(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: {
        "X-N8N-API-KEY": API_KEY,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    throw new Error(
      `Не достучались до ${BASE}: ${err.message}\n` +
        "Если это облачная сессия Claude Code — исходящая сеть режется политикой окружения; " +
        "добавьте хост в allowlist окружения или запускайте локально.",
    );
  }

  const text = await res.text();
  if (!res.ok) {
    if (res.status === 401) throw new Error("401 — N8N_API_KEY неверный или отозван.");
    if (res.status === 403 && /allowlist/i.test(text)) {
      throw new Error(
        `Хост ${new URL(BASE).host} закрыт политикой сети окружения (не n8n отказал).\n` +
          "Claude Code на вебе → настройки окружения → network egress: добавить хост. " +
          "Локальная сессия ходит напрямую и в allowlist не нуждается.",
      );
    }
    if (res.status === 404) throw new Error(`404 — нет такого объекта: ${path}`);
    throw new Error(`n8n вернул ${res.status}: ${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : null;
}

/** Public API отдаёт страницы по курсору — собираем всё. */
async function apiAll(path, limit = Infinity) {
  const items = [];
  let cursor;
  do {
    const sep = path.includes("?") ? "&" : "?";
    const page = await api(
      `${path}${sep}limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    items.push(...(page.data || []));
    cursor = page.nextCursor;
  } while (cursor && items.length < limit);
  return items.slice(0, limit === Infinity ? undefined : limit);
}

/** PUT /workflows/:id принимает только эти поля — остальные ломают запрос 400-й. */
function updatablePayload(wf) {
  const payload = {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: wf.settings ?? {},
  };
  if (wf.staticData != null) payload.staticData = wf.staticData;
  return payload;
}

function slug(name) {
  return (name || "workflow")
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

const [cmd, ...argv] = process.argv.slice(2);
const { flags, rest } = parseFlags(argv);

async function main() {
  switch (cmd) {
    case "ping": {
      const wfs = await apiAll("/workflows");
      const active = wfs.filter((w) => w.active).length;
      console.log(`OK ${BASE} — воркфлоу: ${wfs.length} (активных ${active})`);
      break;
    }

    case "list": {
      const query = flags.active ? "/workflows?active=true" : "/workflows";
      let wfs = await apiAll(query, flags.limit ? Number(flags.limit) : Infinity);
      if (flags.name) {
        const needle = String(flags.name).toLowerCase();
        wfs = wfs.filter((w) => (w.name || "").toLowerCase().includes(needle));
      }
      if (!wfs.length) {
        console.log("Ничего не найдено.");
        break;
      }
      for (const w of wfs) {
        console.log(
          `${w.active ? "●" : "○"} ${String(w.id).padEnd(20)} ${String((w.nodes || []).length).padStart(3)} нод  ${w.name}`,
        );
      }
      console.log(`\nВсего: ${wfs.length}`);
      break;
    }

    case "get": {
      const id = rest[0];
      if (!id) throw new Error("Нужен id: node scripts/n8n.mjs get <id>");
      const wf = await api(`/workflows/${encodeURIComponent(id)}`);
      const out = JSON.stringify(wf, null, 2);
      if (flags.out) {
        writeFileSync(resolve(String(flags.out)), `${out}\n`);
        console.log(`→ ${flags.out}`);
      } else {
        console.log(out);
      }
      break;
    }

    case "pull": {
      const dir = resolve(String(flags.dir || "n8n/workflows"));
      mkdirSync(dir, { recursive: true });
      const list = await apiAll("/workflows");
      for (const meta of list) {
        const wf = await api(`/workflows/${encodeURIComponent(meta.id)}`);
        const file = join(dir, `${slug(wf.name)}.${wf.id}.json`);
        writeFileSync(file, `${JSON.stringify(wf, null, 2)}\n`);
        console.log(`→ ${file}`);
      }
      console.log(`\nВыгружено: ${list.length}. Теперь diff воркфлоу видно в git.`);
      break;
    }

    case "push": {
      const file = rest[0];
      if (!file) throw new Error("Нужен файл: node scripts/n8n.mjs push <файл.json>");
      const wf = JSON.parse(readFileSync(resolve(file), "utf8"));
      const id = flags.id ? String(flags.id) : wf.id;
      const payload = updatablePayload(wf);

      let saved;
      if (id) {
        saved = await api(`/workflows/${encodeURIComponent(id)}`, {
          method: "PUT",
          body: payload,
        });
        console.log(`Обновлён ${saved.id} — ${saved.name}`);
      } else {
        saved = await api("/workflows", { method: "POST", body: payload });
        console.log(`Создан ${saved.id} — ${saved.name}`);
      }

      if (flags.activate) {
        await api(`/workflows/${encodeURIComponent(saved.id)}/activate`, { method: "POST" });
        console.log("Активирован.");
      } else if (wf.active && !saved.active) {
        console.log(
          "Внимание: исходный воркфлоу был активен, а после записи — нет. " +
            "Активность через API не переносится, добавьте --activate.",
        );
      }
      break;
    }

    case "activate":
    case "deactivate": {
      const id = rest[0];
      if (!id) throw new Error(`Нужен id: node scripts/n8n.mjs ${cmd} <id>`);
      const wf = await api(`/workflows/${encodeURIComponent(id)}/${cmd}`, { method: "POST" });
      console.log(`${wf.name} — ${wf.active ? "активен" : "выключен"}`);
      break;
    }

    case "executions": {
      const params = new URLSearchParams();
      if (flags.workflow) params.set("workflowId", String(flags.workflow));
      if (flags.status) params.set("status", String(flags.status));
      const qs = params.toString();
      const limit = flags.limit ? Number(flags.limit) : 20;
      const runs = await apiAll(`/executions${qs ? `?${qs}` : ""}`, limit);
      if (!runs.length) {
        console.log("Запусков нет.");
        break;
      }
      for (const r of runs) {
        console.log(
          `${String(r.id).padEnd(10)} ${String(r.status).padEnd(9)} ${r.startedAt || "—"}  wf=${r.workflowId}`,
        );
      }
      break;
    }

    case "execution": {
      const id = rest[0];
      if (!id) throw new Error("Нужен id: node scripts/n8n.mjs execution <id>");
      const run = await api(
        `/executions/${encodeURIComponent(id)}${flags.data ? "?includeData=true" : ""}`,
      );
      console.log(JSON.stringify(run, null, 2));
      break;
    }

    default:
      console.error(
        "Команды: ping | list | get <id> | pull | push <файл> | activate <id> | " +
          "deactivate <id> | executions | execution <id>\n" +
          "Подробности — в шапке scripts/n8n.mjs и docs/N8N-CONTROL.md",
      );
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
