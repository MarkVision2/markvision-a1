import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Каждая таблица, к которой ходит фронт, должна создаваться миграцией в репозитории.
 * Иначе новое окружение (staging, свежий проект Supabase) поднимается сломанным, а
 * RLS этих таблиц нигде не зафиксирована — она живёт только в проде.
 *
 * Список ниже — уже существующий долг: эти таблицы заведены в проде руками, миграций
 * на них нет. Чинится добавлением миграции и удалением строки отсюда. Новые таблицы
 * в этот список добавлять нельзя — тест на то и падает.
 */
const CREATED_OUTSIDE_REPO = [
  "client_dashboard_tokens", // клиентский дашборд /client/:token
  "heygen_defaults",
  "heygen_jobs",
  "heygen_usage", // AI-монтаж через HeyGen
  "reels_jobs",
  "reels_usage", // Reels-видео
].sort();

const ROOT = resolve(__dirname, "..", "..");

function walk(dir: string, match: (f: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, match));
    else if (match(entry)) out.push(full);
  }
  return out;
}

function tablesUsedByFrontend(): string[] {
  const files = walk(join(ROOT, "src"), (f) => f.endsWith(".ts") || f.endsWith(".tsx"));
  const found = new Set<string>();
  for (const f of files) {
    for (const m of readFileSync(f, "utf8").matchAll(/\.from\("([a-z0-9_]+)"/g)) found.add(m[1]);
  }
  return [...found].sort();
}

function relationsCreatedByMigrations(): Set<string> {
  const dirs = ["supabase/migrations", "supabase/migrations_client_config"].map((d) => join(ROOT, d));
  const found = new Set<string>();
  const re = /create\s+(?:or\s+replace\s+)?(?:table|view|materialized\s+view)\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z0-9_]+)/gi;
  for (const dir of dirs) {
    for (const f of walk(dir, (n) => n.endsWith(".sql"))) {
      for (const m of readFileSync(f, "utf8").matchAll(re)) found.add(m[1].toLowerCase());
    }
  }
  return found;
}

describe("покрытие таблиц миграциями", () => {
  it("источники разобраны", () => {
    expect(tablesUsedByFrontend().length).toBeGreaterThan(50);
    expect(relationsCreatedByMigrations().size).toBeGreaterThan(50);
  });

  it("фронт не ходит в таблицы, которых нет ни в одной миграции", () => {
    const created = relationsCreatedByMigrations();
    const missing = tablesUsedByFrontend().filter((t) => !created.has(t));
    expect(missing).toEqual(CREATED_OUTSIDE_REPO);
  });
});
