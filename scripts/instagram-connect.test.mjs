/**
 * Конвейер подключения Instagram-аккаунтов без сети: разбор хэндлов и флагов, вердикты
 * приёмки этапов 2–4, пресет пачки, TOTP.
 *   node --test scripts/instagram-connect.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accountVerdict,
  base32Decode,
  batchVerdict,
  buildPreset,
  duplicateIps,
  hasPublishScope,
  ipReport,
  manifestPath,
  matchRows,
  normalizeHandle,
  parseArgs,
  parseHandles,
  parseIpImport,
  parsePair,
  parseWindow,
  tokensSummary,
  tokenVerdict,
  totp,
  validIp,
} from "./instagram-connect.mjs";

test("parseArgs: флаги, повторяемые флаги и булевы", () => {
  const f = parseArgs(["--project", "p1", "--set", "@a=1.1.1.1", "--set", "b=2.2.2.2", "--ramp", "--hours", "24"]);
  assert.equal(f.project, "p1");
  assert.deepEqual(f.set, ["@a=1.1.1.1", "b=2.2.2.2"]);
  assert.equal(f.ramp, true);
  assert.equal(f.hours, "24");
});

test("normalizeHandle: @, ссылка, регистр; мусор — ошибка", () => {
  assert.equal(normalizeHandle("@Shop.KZ "), "shop.kz");
  assert.equal(normalizeHandle("https://www.instagram.com/toyota_center/?hl=ru"), "toyota_center");
  assert.throws(() => normalizeHandle("не хэндл"), /Не похоже на хэндл/);
  assert.throws(() => normalizeHandle(""), /Не похоже на хэндл/);
});

test("parseHandles: строка + файл, комментарии, без повторов", () => {
  const list = parseHandles("@a, b", "# пачка 1\nc\n@A\n\nb # дубль\n");
  assert.deepEqual(list, ["a", "b", "c"]);
});

test("manifestPath: имя пачки → work/ig-connect, путь .json — как есть", () => {
  assert.equal(manifestPath("batch-1", "/r"), "/r/work/ig-connect/batch-1.json");
  assert.equal(manifestPath("x/y.json", "/r"), "/r/x/y.json");
  assert.throws(() => manifestPath("плохое имя", "/r"), /Имя пачки/);
  assert.throws(() => manifestPath("", "/r"), /--batch/);
});

test("parsePair и parseIpImport", () => {
  assert.deepEqual(parsePair("@a=1.2.3.4"), ["a", "1.2.3.4"]);
  assert.throws(() => parsePair("a"), /@хэндл=значение/);
  const rows = parseIpImport("handle;ip;profile\n@a;1.1.1.1;env-1\nb,2.2.2.2\n\n# c;3.3.3.3\n");
  assert.deepEqual(rows, [{ handle: "a", ip: "1.1.1.1", profile: "env-1" }, { handle: "b", ip: "2.2.2.2", profile: undefined }]);
});

test("validIp: v4/v6, мусор — нет", () => {
  assert.equal(validIp("93.157.181.157"), true);
  assert.equal(validIp("2a00:1450::8a"), true);
  assert.equal(validIp("999.1.1.1"), false);
  assert.equal(validIp("шлюз"), false);
});

test("duplicateIps / ipReport: приёмка этапа 2 — у каждого свой адрес", () => {
  const accounts = { a: { ip: "1.1.1.1" }, b: { ip: "2.2.2.2" }, c: { ip: "1.1.1.1" }, d: {} };
  assert.deepEqual(duplicateIps(accounts), [{ ip: "1.1.1.1", handles: ["a", "c"] }]);
  const r = ipReport(accounts);
  assert.equal(r.accepted, false);
  assert.deepEqual(r.missing, ["d"]);
  assert.equal(ipReport({ a: { ip: "1.1.1.1" }, b: { ip: "2.2.2.2" } }).accepted, true);
  assert.equal(ipReport({}).accepted, false);
});

test("hasPublishScope: право есть / нет / неизвестно", () => {
  assert.equal(hasPublishScope("instagram_business_basic,instagram_business_content_publish"), true);
  assert.equal(hasPublishScope("instagram_business_basic"), false);
  assert.equal(hasPublishScope(null), null);
});

const good = {
  platform: "instagram", auth_status: "connected", connection_type: "oauth", status: "active",
  oauth_scope: "instagram_business_basic,instagram_business_content_publish",
};

test("accountVerdict: подключён с правом публикации и сгоревшей ссылкой — ok", () => {
  const v = accountVerdict({ link: { state: "exhausted" }, account: good });
  assert.equal(v.ok, true);
  assert.equal(v.state, "подключён");
});

test("accountVerdict: без аккаунта — ждёт при живой ссылке, отказ при сгоревшей", () => {
  assert.equal(accountVerdict({ link: { state: "active" }, account: null }).state, "ждёт подключения");
  const dead = accountVerdict({ link: { state: "expired" }, account: null });
  assert.equal(dead.ok, false);
  assert.match(dead.problems[0], /выдать новую/);
  assert.match(accountVerdict({ link: null, account: null }).problems[0], /links/);
});

test("accountVerdict: перечисляет все замечания", () => {
  const v = accountVerdict({
    link: { state: "active" },
    account: { ...good, auth_status: "reconnect_required", oauth_scope: "instagram_business_basic", connection_type: "device" },
  });
  assert.equal(v.ok, false);
  assert.equal(v.problems.length, 4);
  assert.match(v.problems.join("\n"), /reconnect_required/);
  assert.match(v.problems.join("\n"), /instagram_business_content_publish/);
  assert.match(v.problems.join("\n"), /connection_type = device/);
  assert.match(v.problems.join("\n"), /ссылка всё ещё активна/);
  // Пустой scope — не отказ, а предупреждение.
  assert.equal(accountVerdict({ link: { state: "exhausted" }, account: { ...good, oauth_scope: null } }).ok, false);
});

test("matchRows + batchVerdict: сопоставление по ссылке, потом по хэндлу", () => {
  const manifest = { accounts: { a: { link_id: "l1" }, b: { link_id: "l2" }, c: { link_id: "l3" } } };
  const links = [{ id: "l1", state: "exhausted" }, { id: "l2", state: "active" }, { id: "l3", state: "expired" }];
  const accounts = [
    { id: "acc1", handle: "other", connect_link_id: "l1", ...good },
    { id: "acc3", handle: "C", connect_link_id: null, ...good },
  ];
  const rows = matchRows(manifest, links, accounts);
  assert.equal(rows[0].account.id, "acc1");
  assert.equal(rows[1].account, null);
  assert.equal(rows[2].account.id, "acc3");
  const v = batchVerdict(rows);
  assert.deepEqual(v, { total: 3, ok: 2, waiting: 1, failed: 0, accepted: false });
  assert.equal(batchVerdict(rows.filter((r) => r.verdict.ok)).accepted, true);
  assert.equal(batchVerdict([]).accepted, false);
});

test("parseWindow и buildPreset", () => {
  assert.deepEqual(parseWindow("9:00-20:30"), { window_start: "09:00", window_end: "20:30" });
  assert.throws(() => parseWindow("утро"), /ЧЧ:ММ/);
  const p = buildPreset({ group: "g1", timezone: "Asia/Almaty", window: "10:00-20:00", "daily-limit": "2", ramp: true, enable: true });
  assert.deepEqual(p, {
    group_id: "g1", timezone: "Asia/Almaty", window_start: "10:00", window_end: "20:00",
    daily_limit: 2, ramp_enabled: true, ramp_restart: true, publish_enabled: true,
  });
  assert.throws(() => buildPreset({ "daily-limit": "0" }), /1 до 200/);
  assert.throws(() => buildPreset({}), /Нечего менять/);
});

test("tokenVerdict / tokensSummary: приёмка этапа 4", () => {
  const now = Date.parse("2026-09-07T10:00:00Z");
  const fresh = {
    account_name: "A", alive: true, refreshed: true, refresh_error: null, token_kind: "instagram_login",
    token_refreshed_at: "2026-09-07T09:59:00Z", auth_status: "connected",
  };
  assert.equal(tokenVerdict(fresh).ok, true);
  assert.equal(tokenVerdict(fresh).kind, "IGAA (60 дн.)");
  const dead = { ...fresh, account_name: "B", alive: false, refreshed: false, auth_status: "reconnect_required" };
  assert.match(tokenVerdict(dead).problems[0], /reconnect_required/);
  // Мёртвый токен с правильной пометкой — это ожидаемое поведение, приёмку не роняет.
  assert.equal(tokensSummary([fresh, dead], now).accepted, true);
  const stale = { ...fresh, account_name: "C", token_refreshed_at: "2026-09-01T00:00:00Z" };
  const s = tokensSummary([stale], now);
  assert.equal(s.accepted, false);
  assert.match(s.notes[0], /token_refreshed_at/);
  const wrongDead = { ...dead, auth_status: "connected" };
  assert.match(tokensSummary([wrongDead], now).notes[0], /auth_status = connected/);
  assert.equal(tokensSummary([{ ...fresh, refresh_error: "refresh failed" }], now).accepted, false);
  assert.equal(tokensSummary([], now).accepted, false);
});

test("TOTP: контрольные значения RFC 6238 (SHA-1, 6 цифр)", () => {
  // Секрет из RFC — «12345678901234567890» в base32.
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  assert.equal(base32Decode(secret).toString("ascii"), "12345678901234567890");
  assert.equal(totp(secret, { time: 59_000 }), "287082");
  assert.equal(totp(secret, { time: 1_111_111_109_000 }), "081804");
  assert.equal(totp(secret, { time: 1_234_567_890_000 }), "005924");
  assert.equal(totp("gezd gnbv-gy3t qojq gezd gnbv gy3t qojq", { time: 59_000 }), "287082");
  assert.throws(() => totp("не base32", { time: 0 }), /base32/);
});
