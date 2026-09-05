/**
 * Скрипты контент-завода без ffmpeg: разбор пауз, отрезки, правила проверки, раскадровка.
 *   node --test scripts/factory.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSilences, segmentsFromSilences } from "./factory-cut.mjs";
import { verify } from "./factory-check.mjs";
import { parseScript, renderItem } from "./factory-storyboard.mjs";

test("parseSilences: пары start/end из вывода silencedetect", () => {
  const stderr = [
    "[silencedetect @ 0x1] silence_start: 31.2",
    "[silencedetect @ 0x1] silence_end: 36.4 | silence_duration: 5.2",
    "[silencedetect @ 0x1] silence_start: 70.05",
    "[silencedetect @ 0x1] silence_end: 75.1 | silence_duration: 5.05",
  ].join("\n");
  assert.deepEqual(parseSilences(stderr), [{ start: 31.2, end: 36.4 }, { start: 70.05, end: 75.1 }]);
});

test("segmentsFromSilences: три ролика из двух пауз, края с запасом, без наездов", () => {
  const segs = segmentsFromSilences([{ start: 31.2, end: 36.4 }, { start: 70.05, end: 75.1 }], 100, 0.15);
  assert.equal(segs.length, 3);
  assert.equal(segs[0].from, 0);
  assert.ok(Math.abs(segs[0].to - 31.35) < 1e-9);
  assert.ok(Math.abs(segs[1].from - 36.25) < 1e-9);
  assert.ok(segs[1].to <= segs[2].from);
  assert.equal(segs[2].to, 100);
});

test("segmentsFromSilences: хвост короче 0,5 с не становится роликом", () => {
  const segs = segmentsFromSilences([{ start: 20, end: 25 }], 25.3, 0);
  assert.equal(segs.length, 1);
});

const good = { format: { duration: 31.2, size: 40e6 }, video: { width: 1080, height: 1920, duration: 31.2 }, audio: { duration: 31.18 } };

test("verify: ролик проходит, когда видео = звук и 1080×1920", () => {
  assert.deepEqual(verify(good), { ok: true, errors: [] });
});

test("verify: видео длиннее звука на секунду (обложка кадром) — ошибка", () => {
  const r = verify({ ...good, video: { ...good.video, duration: 32.2 } });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /видео 32.20 с ≠ звук 31.18 с/);
});

test("verify: не то разрешение, нет звука, слишком длинно — по ошибке на каждое", () => {
  const r = verify({ format: { duration: 1000, size: 1 }, video: { width: 720, height: 1280, duration: 1000 }, audio: null });
  assert.equal(r.errors.length, 3);
});

test("parseScript берёт hook/cta из варианта A", () => {
  const md = "# id\n## A\nhook: Первый хук\ntext: …\ncta: Подпишитесь\n## B\nhook: Другой\ncta: Другой CTA\n";
  assert.deepEqual(parseScript(md), { hook: "Первый хук", cta: "Подпишитесь" });
});

test("renderItem рисует сцены в цветах темы и экранирует текст", () => {
  const html = renderItem({
    id: "v1", account_id: "acc", theme: { bg: "#000", accent: "#5B8CFF", text: "#fff" },
    scenes: [{ from_ms: 0, to_ms: 4000, layout: "avatar_full", title: "<хук>" }, { from_ms: 4000, to_ms: 14000, layout: "avatar_bottom", bullets: ["a", "b"] }],
  }, { hook: "Хук", cta: "CTA" });
  assert.match(html, /--accent:#5B8CFF/);
  assert.match(html, /&lt;хук&gt;/);
  assert.match(html, /class="scene avatar_bottom"/);
  assert.match(html, /a · b/);
});
