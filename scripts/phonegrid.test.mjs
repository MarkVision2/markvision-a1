/**
 * Обёртка PhoneGrid без сети: разбор .env, сборка запросов, разворачивание ответов.
 *   node --test scripts/phonegrid.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEnv, buildLocalRequest, buildTokenBody, unwrap, summarizePhone, LOCAL_BASE, parseProxyUrl, buildProxyAdd, parseIpInfo, proxyUrlFromRecord, portFromName, warmupPlan, warmupParameter, WARMUP_TEMPLATES, RPA_STATE } from "./phonegrid.mjs";

test("parseEnv: ключи, кавычки, комментарии", () => {
  const env = parseEnv('# c\nA=1\nB="two"\n\nC=\'x=y\'\nBROKEN\n=nokey\n');
  assert.deepEqual(env, { A: "1", B: "two", C: "x=y" });
});

test("buildLocalRequest: Bearer-заголовок и JSON-тело", () => {
  const { url, init } = buildLocalRequest("/api/cloudphone/page", { pageNo: 1 }, "k1");
  assert.equal(url, `${LOCAL_BASE}/api/cloudphone/page`);
  assert.equal(init.method, "POST");
  assert.equal(init.headers.Authorization, "Bearer k1");
  assert.equal(init.body, '{"pageNo":1}');
});

test("buildLocalRequest: без ключа и с чужим путём — ошибка", () => {
  assert.throws(() => buildLocalRequest("/api/x", {}, ""), /PHONEGRID_LOCAL_API_KEY/);
  assert.throws(() => buildLocalRequest("/oauth2/token", {}, "k"), /\/api\//);
});

test("buildTokenBody: client_credentials, id строкой", () => {
  assert.deepEqual(buildTokenBody(1672940217990530, "s"), {
    client_id: "1672940217990530",
    client_secret: "s",
    grant_type: "client_credentials",
  });
  assert.throws(() => buildTokenBody("", "s"), /PHONEGRID_OPEN_API_ID/);
});

test("unwrap: code 0 → data, иначе ошибка с msg и кодом", () => {
  assert.deepEqual(unwrap({ code: 0, data: { total: "0" } }, "x"), { total: "0" });
  assert.throws(() => unwrap({ code: 99006, msg: "id: не должно равняться null" }, "Local API /api/cloudphone/info"), /99006/);
  assert.throws(() => unwrap({ status: "error", code: 401, message: "Недействительный API-ключ" }, "x"), /Недействительный/);
});

test("summarizePhone: сводка из разных вариантов полей", () => {
  const s = summarizePhone({ id: 1, envName: "CP-1", status: "online", country: "us", proxyInfo: { ip: "1.2.3.4" } });
  assert.deepEqual(s, { id: 1, name: "CP-1", status: "online", country: "us", proxy: "1.2.3.4", remark: "" });
});

test("parseProxyUrl: socks5 с логином и паролем → поля PhoneGrid", () => {
  const p = parseProxyUrl("socks5://user%40x:p%3Ass@1.2.3.4:1080");
  assert.deepEqual(p, { proxyProvider: 2, proxyIp: "1.2.3.4", proxyPort: 1080, username: "user@x", password: "p:ss" });
  assert.equal(parseProxyUrl("http://h:80").proxyProvider, 0);
  assert.throws(() => parseProxyUrl("ftp://h:1"), /не поддерживается/);
  assert.throws(() => parseProxyUrl("socks5://host"), /порт/);
});

test("buildProxyAdd: имя по умолчанию, refreshUrl, мониторинг выключен", () => {
  const body = buildProxyAdd(parseProxyUrl("socks5://u:p@h.kz:9000"), { refreshUrl: "https://r/?k=1" });
  assert.equal(body.proxyName, "h.kz:9000");
  assert.equal(body.refreshUrl, "https://r/?k=1");
  assert.equal(body.ipMonitor, false);
  assert.equal(buildProxyAdd(parseProxyUrl("socks5://h:1"), { name: "KZ" }).proxyName, "KZ");
});

test("parseIpInfo и proxyUrlFromRecord", () => {
  assert.deepEqual(parseIpInfo({ query: "5.6.7.8", country: "Kazakhstan", countryCode: "KZ", city: "Almaty" }), { ip: "5.6.7.8", country: "Kazakhstan", city: "Almaty" });
  assert.deepEqual(parseIpInfo({ ip: "1.1.1.1" }), { ip: "1.1.1.1", country: null, city: null });
  assert.equal(proxyUrlFromRecord({ proxyProvider: 2, proxyIp: "h", proxyPort: 1, username: "u", password: "p" }), "socks5h://u:p@h:1");
  assert.equal(proxyUrlFromRecord({ proxyProvider: 0, proxyIp: "h", proxyPort: 8 }), "http://h:8");
});

test("portFromName и proxyUrlFromRecord без порта", () => {
  assert.equal(portFromName("http://212.8.248.20:10498"), 10498);
  assert.equal(portFromName("KZ-mobile Tele2 (Oral)"), undefined);
  assert.throws(() => proxyUrlFromRecord({ id: 1, proxyIp: "h" }), /порт/);
});

test("warmupPlan: первые дни без действий, дальше рост, с 15-го — готов", () => {
  for (const d of [1, 2]) {
    const p = warmupPlan(d);
    assert.equal(p.like, 0, "в первые дни лайков быть не должно");
    assert.equal(p.follow, 0);
    assert.equal(p.comments, 0);
    assert.ok(p.videos >= 8 && p.videos <= 14);
    assert.equal(p.ready, false);
  }
  assert.equal(warmupPlan(3).follow, 0, "подписки не раньше 5-го дня");
  assert.ok(warmupPlan(6).follow > 0);
  assert.equal(warmupPlan(15).ready, true);
  assert.equal(warmupPlan(99).ready, true);
  assert.equal(warmupPlan(0).day, 1, "день меньше 1 подтягивается к 1");
});

test("warmupPlan: вероятности не выходят за потолок шаблона", () => {
  for (let i = 0; i < 40; i++) {
    for (const pl of ["ig", "tt"]) {
      const p = warmupPlan(20, pl);
      const max = WARMUP_TEMPLATES[pl].max;
      assert.ok(p.like <= max.like && p.follow <= max.follow && p.comments <= max.comments);
      assert.ok(p.like >= 0 && p.follow >= 0 && p.comments >= 0);
    }
  }
});

test("warmupParameter: ключи ровно как в шаблоне маркетплейса", () => {
  const plan = { videos: 12, like: 5, follow: 0, comments: 3 };
  const parsed = JSON.parse(warmupParameter(plan, "ig"));
  assert.deepEqual(parsed, {
    "Estimated number of videos browsed": 12,
    "Probability of following": 0,
    "Probability of liking": 5,
    "Probability of viewing comments": 3,
  });
  assert.throws(() => warmupParameter(plan, "youtube"), /ig или tt/);
});

test("WARMUP_TEMPLATES: требования Instagram зафиксированы", () => {
  const ig = WARMUP_TEMPLATES.ig;
  assert.equal(ig.requiredVersion, "412.0.0.35.87");
  assert.equal(ig.requiredLocale, "en-US");
  assert.equal(ig.packageName, "com.instagram.android");
  assert.equal(RPA_STATE[4], "ошибка");
});
