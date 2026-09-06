/**
 * Продление long-lived токенов без сети: кому, когда и почему нет.
 *   cd supabase/functions && deno test --allow-env _tests/publishTokenRefresh_test.ts
 */
import { assertEquals, assertMatch } from "jsr:@std/assert@1";
import {
  expiresAtFromRefresh,
  longLivedKind,
  MIN_TOKEN_AGE_HOURS,
  REFRESH_BEFORE_DAYS,
  refreshPlan,
} from "../_lib/publishTokenRefresh.ts";

const NOW = Date.parse("2026-09-07T10:00:00Z");
const days = (n: number) => new Date(NOW + n * 86_400_000).toISOString();
const hours = (n: number) => new Date(NOW + n * 3_600_000).toISOString();

Deno.test("вид токена по площадке и префиксу", () => {
  assertEquals(longLivedKind("instagram", "IGAAQx..."), "instagram_login");
  assertEquals(longLivedKind("instagram", "EAAGx..."), "page");
  assertEquals(longLivedKind("threads", "THx..."), "threads");
  assertEquals(longLivedKind("tiktok", "act..."), "other");
});

Deno.test("page-токен Facebook не продлевается никогда", () => {
  const p = refreshPlan({ platform: "instagram", token: "EAA1", tokenExpiresAt: days(1), tokenRefreshedAt: null }, NOW);
  assertEquals(p.refresh, false);
  assertMatch(p.reason, /не истекает/);
});

Deno.test("IGAA: продлеваем за REFRESH_BEFORE_DAYS до истечения, раньше — рано", () => {
  const soon = refreshPlan({ platform: "instagram", token: "IGAA1", tokenExpiresAt: days(REFRESH_BEFORE_DAYS - 1), tokenRefreshedAt: days(-30) }, NOW);
  assertEquals(soon.refresh, true);
  const early = refreshPlan({ platform: "instagram", token: "IGAA1", tokenExpiresAt: days(REFRESH_BEFORE_DAYS + 5), tokenRefreshedAt: days(-30) }, NOW);
  assertEquals(early.refresh, false);
  assertMatch(early.reason, /рано/);
});

Deno.test("IGAA: срок вышел или неизвестен — продлеваем сейчас", () => {
  assertEquals(refreshPlan({ platform: "instagram", token: "IGAA1", tokenExpiresAt: days(-1), tokenRefreshedAt: days(-60) }, NOW).refresh, true);
  const unknown = refreshPlan({ platform: "instagram", token: "IGAA1", tokenExpiresAt: null, tokenRefreshedAt: null }, NOW);
  assertEquals(unknown.refresh, true);
  assertMatch(unknown.reason, /неизвестен/);
});

Deno.test("свежепродлённый токен (моложе 24 ч) площадка продлить не даст — пропускаем без ошибки", () => {
  const p = refreshPlan({ platform: "instagram", token: "IGAA1", tokenExpiresAt: days(1), tokenRefreshedAt: hours(-(MIN_TOKEN_AGE_HOURS - 1)) }, NOW);
  assertEquals(p.refresh, false);
  assertMatch(p.reason, /24 ч/);
  // Ровно сутки прошли — можно.
  assertEquals(refreshPlan({ platform: "instagram", token: "IGAA1", tokenExpiresAt: days(1), tokenRefreshedAt: hours(-MIN_TOKEN_AGE_HOURS) }, NOW).refresh, true);
});

Deno.test("Threads — те же правила, что у Instagram Login", () => {
  assertEquals(refreshPlan({ platform: "threads", token: "TH1", tokenExpiresAt: days(3), tokenRefreshedAt: days(-20) }, NOW).kind, "threads");
  assertEquals(refreshPlan({ platform: "threads", token: "TH1", tokenExpiresAt: days(3), tokenRefreshedAt: days(-20) }, NOW).refresh, true);
});

Deno.test("expiresAtFromRefresh: секунды из ответа, без числа — 60 дней", () => {
  assertEquals(expiresAtFromRefresh(5_184_000, NOW), days(60));
  assertEquals(expiresAtFromRefresh("3600", NOW), hours(1));
  assertEquals(expiresAtFromRefresh(undefined, NOW), days(60));
  assertEquals(Date.parse(expiresAtFromRefresh(-5, NOW)) > NOW, true);
});
