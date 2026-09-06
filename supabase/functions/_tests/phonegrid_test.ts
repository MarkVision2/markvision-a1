/**
 * Прогрев аккаунтов без сети: план по дням, параметры шаблона, счёт дня, сводка телефона.
 *   cd supabase/functions && deno test --allow-env _tests/phonegrid_test.ts
 */
import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  inputTextCommand,
  phoneStatusText,
  shellQuote,
  summarizePhone,
  warmupDayFrom,
  warmupParameter,
  warmupPlan,
  warmupTemplates,
  WARMUP_TEMPLATES,
} from "../_lib/phonegrid.ts";

Deno.test("первые два дня — только просмотр, без единого действия", () => {
  for (const day of [1, 2]) {
    const p = warmupPlan(day);
    assertEquals(p.like, 0);
    assertEquals(p.follow, 0);
    assertEquals(p.comments, 0);
    assert(p.videos >= 8 && p.videos <= 14, `видео ${p.videos} вне диапазона первых дней`);
    assertEquals(p.ready, false);
  }
});

Deno.test("подписки появляются не раньше пятого дня, готовность — с пятнадцатого", () => {
  assertEquals(warmupPlan(3).follow, 0);
  assertEquals(warmupPlan(4).follow, 0);
  assert(warmupPlan(6).follow > 0);
  assertEquals(warmupPlan(14).ready, false);
  assertEquals(warmupPlan(15).ready, true);
  assertEquals(warmupPlan(120).ready, true);
});

Deno.test("день меньше единицы подтягивается к первому", () => {
  assertEquals(warmupPlan(0).day, 1);
  assertEquals(warmupPlan(-5).day, 1);
});

Deno.test("вероятности не выходят за потолок шаблона площадки", () => {
  for (let i = 0; i < 60; i++) {
    for (const platform of ["instagram", "tiktok"]) {
      const p = warmupPlan(30, platform);
      const max = WARMUP_TEMPLATES[platform].max;
      assert(p.like >= 0 && p.like <= max.like);
      assert(p.follow >= 0 && p.follow <= max.follow);
      assert(p.comments >= 0 && p.comments <= max.comments);
    }
  }
});

Deno.test("параметры уходят под теми же ключами, что ждёт шаблон маркетплейса", () => {
  const parsed = JSON.parse(warmupParameter({ day: 3, ready: false, note: "", videos: 12, like: 5, follow: 0, comments: 3 }));
  assertEquals(parsed, {
    "Estimated number of videos browsed": 12,
    "Probability of following": 0,
    "Probability of liking": 5,
    "Probability of viewing comments": 3,
  });
});

Deno.test("день прогрева считается от даты старта, первый день — единица", () => {
  const now = new Date("2026-09-20T12:00:00Z");
  assertEquals(warmupDayFrom("2026-09-20T09:00:00Z", now), 1);
  assertEquals(warmupDayFrom("2026-09-19T09:00:00Z", now), 2);
  assertEquals(warmupDayFrom("2026-09-06T12:00:00Z", now), 15);
  assertEquals(warmupDayFrom(null, now), 1);
  assertEquals(warmupDayFrom("не дата", now), 1);
});

Deno.test("требования шаблона Instagram зафиксированы — иначе PhoneGrid отклонит задачу", () => {
  const ig = WARMUP_TEMPLATES.instagram;
  assertEquals(ig.requiredVersion, "412.0.0.35.87");
  assertEquals(ig.requiredLocale, "en-US");
  assertEquals(ig.packageName, "com.instagram.android");
  assertEquals(WARMUP_TEMPLATES.tiktok.requiredVersion, null, "версия TikTok ещё не выяснена");
});

Deno.test("сводка телефона: статус словами, прокси из вложенного объекта", () => {
  const s = summarizePhone({ id: 1, envName: "CP-1", envStatus: 4, envRemark: "заметка", proxy: { id: 7, proxyIp: "1.2.3.4", country: "KZ" } });
  assertEquals(s, { id: "1", name: "CP-1", status: 4, statusText: "работает", remark: "заметка", proxyId: "7", proxyIp: "1.2.3.4", country: "KZ" });
  assertEquals(phoneStatusText(2), "выключен");
  assertEquals(phoneStatusText(3), "загружается");
  assertEquals(phoneStatusText(99), "статус 99");
});

Deno.test("версия под прогрев подменяется секретами только парой версия+id", () => {
  const env = (n: string) => ({
    PHONEGRID_TIKTOK_WARMUP_VERSION: "43.9.1",
    PHONEGRID_TIKTOK_WARMUP_APP_VERSION_ID: "1690000000000001",
    PHONEGRID_INSTAGRAM_WARMUP_VERSION: "999.0",
  } as Record<string, string>)[n];
  const t = warmupTemplates(env);
  assertEquals(t.tiktok.requiredVersion, "43.9.1");
  assertEquals(t.tiktok.appVersionId, "1690000000000001");
  // Без id версия одна ничего не запустит — оставляем зашитую.
  assertEquals(t.instagram.requiredVersion, WARMUP_TEMPLATES.instagram.requiredVersion);
  // Без секретов — как в коде.
  assertEquals(warmupTemplates(() => undefined).tiktok.requiredVersion, null);
});

Deno.test("аргумент для shell телефона не раскрывает $ и кавычки", () => {
  assertEquals(shellQuote("a$b `c` \"d\""), "'a$b `c` \"d\"'");
  assertEquals(shellQuote("o'neil"), "'o'\\''neil'");
});

Deno.test("ввод текста: пробел как %s, кириллица — понятная ошибка", () => {
  assertEquals(inputTextCommand("my pass 1"), "input text 'my%spass%s1'");
  assertThrows(() => inputTextCommand("пароль"), Error, "латиницей");
});
