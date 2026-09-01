import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const MANUAL = join(ROOT, "supabase/migrations_client_config/009_content_factory_cleanup.sql");
const AUTO = join(ROOT, "supabase/migrations/20260901100000_content_factory_direct.sql");
const CLEANUP_FN = join(ROOT, "supabase/functions/content-factory-cleanup/index.ts");
const CONFIG = join(ROOT, "supabase/config.toml");

// Тело cleanup_content_factory_data лежит в двух местах: в ручном наборе (009)
// и в авто-наборе, который применяет db push. Дубль вынужденный — ежедневный
// крон зовёт эту функцию, а расписание не проверяет команду при постановке,
// поэтому отсутствие функции обернулось бы молчаливым падением каждую ночь.
// Тест держит копии в согласии: разъехавшееся тело — это очистка, которая
// в одной из баз ведёт себя не так, как в другой.
function functionBody(path: string, tag: string): string {
  const sql = readFileSync(path, "utf8");
  const re = new RegExp(
    String.raw`CREATE OR REPLACE FUNCTION public\.cleanup_content_factory_data.*?AS \$${tag}\$(.*?)\$${tag}\$;`,
    "s",
  );
  const match = sql.match(re);
  if (!match) throw new Error(`Не найдено объявление cleanup_content_factory_data в ${path}`);
  return match[1].trim();
}

describe("cleanup_content_factory_data", () => {
  it("объявлена в авто-наборе миграций, а не только в ручном", () => {
    const sql = readFileSync(AUTO, "utf8");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.cleanup_content_factory_data");
    // Функция пишет в лог — таблица должна создаваться там же, иначе INSERT упадёт.
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.content_factory_cleanup_log");
  });

  it("тело копии совпадает с оригиналом из 009", () => {
    expect(functionBody(AUTO, "CLEANUP")).toBe(functionBody(MANUAL, ""));
  });

  it("ежедневный крон зовёт функцию со сроками из требования", () => {
    const sql = readFileSync(AUTO, "utf8");
    expect(sql).toContain("cleanup_content_factory_data(7, 3, true)");
  });

  it("сроки не срезаются нижней границей функции", () => {
    // Функция поднимает аргументы до минимумов GREATEST(…, 7) и GREATEST(…, 3):
    // 7 и 3 проходят как есть, а не подменяются на 30/14 по умолчанию.
    const body = functionBody(MANUAL, "");
    expect(body).toContain("GREATEST(p_gallery_days, 7)");
    expect(body).toContain("GREATEST(p_results_days, 3)");
  });
});

describe("очистка Storage", () => {
  // Файлы в Storage из SQL не удалить — это делает edge-функция. Её дёргал
  // только GitHub Actions по секрету CONTENT_FACTORY_CLEANUP_KEY, который в
  // репозитории не задан: все 13 запусков упали на проверке ключа, и
  // референсные фото не удалялись ни разу. Крон в БД ходит своим ключом.
  it("крон в БД зовёт функцию очистки ключом автоматизации", () => {
    const sql = readFileSync(AUTO, "utf8");
    expect(sql).toContain("content-factory-storage-cleanup-daily");
    expect(sql).toContain("functions/v1/content-factory-cleanup");
    const cron = sql.slice(sql.indexOf("content-factory-storage-cleanup-daily"));
    expect(cron).toContain("'x-automation-key'");
    expect(cron).toContain("cron_secret FROM public.automation_settings");
    expect(cron).toContain("'uploads_days', 7");
  });

  it("функция принимает x-automation-key, не потеряв прежний x-cleanup-key", () => {
    const fn = readFileSync(CLEANUP_FN, "utf8");
    expect(fn).toContain('req.headers.get("x-cleanup-key")');
    expect(fn).toContain('req.headers.get("x-automation-key")');
    expect(fn).toContain("automation_settings");
    // Проверка ключа стала асинхронной — вызов обязан её дожидаться, иначе
    // Promise всегда истинный и функция открыта без ключа вообще.
    expect(fn).toContain("await isAuthorized(req)");
    expect(fn).not.toMatch(/if \(!isAuthorized\(req\)\)/);
  });

  it("функция доступна крону без JWT", () => {
    const config = readFileSync(CONFIG, "utf8");
    const section = config.slice(config.indexOf("[functions.content-factory-cleanup]"));
    expect(section.slice(0, 120)).toContain("verify_jwt = false");
  });
});
