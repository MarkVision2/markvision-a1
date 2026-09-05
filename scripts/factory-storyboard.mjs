#!/usr/bin/env node
/**
 * Контент-завод, этап 8: раскадровка всей пачки одной HTML-страницей для модерации.
 *
 *   node scripts/factory-storyboard.mjs <batch_dir> [--out storyboard.html]
 *
 * Читает scenes/<id>.json (раскладки, тайминги, тексты, тема аккаунта) и scripts/<id>.md
 * (hook/cta), рисует по строке на ролик: прямоугольники сцен в цветах темы, подпись раскладки,
 * длительность, текст на экране. Чёрный блок снизу = аватар внизу, круг = круглый аватар,
 * заполненный кадр = аватар на весь экран, пустой = контент на весь экран.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** hook/cta из scripts/<id>.md, вариант A. */
export function parseScript(md) {
  const a = md.split(/^## A\s*$/m)[1]?.split(/^## B\s*$/m)[0] ?? md;
  const pick = (k) => (a.match(new RegExp(`^${k}:\\s*(.+)$`, "m")) ?? [])[1]?.trim() ?? "";
  return { hook: pick("hook"), cta: pick("cta") };
}

/** Один ролик → строка сцен. Чистая функция ради теста. */
export function renderItem(scene, script) {
  const theme = scene.theme ?? { bg: "#111", accent: "#5B8CFF", text: "#fff" };
  const total = Math.max(...scene.scenes.map((s) => s.to_ms), 1);
  const cells = scene.scenes.map((s) => {
    const w = Math.max(6, ((s.to_ms - s.from_ms) / total) * 100);
    const label = esc(s.title ?? s.bullets?.join(" · ") ?? "");
    const dur = ((s.to_ms - s.from_ms) / 1000).toFixed(1);
    return `<div class="scene ${esc(s.layout)}" style="width:${w.toFixed(1)}%;--bg:${esc(theme.bg)};--accent:${esc(theme.accent)};--text:${esc(theme.text)}" title="${esc(s.layout)} · ${dur} c">
      <div class="frame"><span class="txt">${label}</span><i class="avatar"></i></div>
      <div class="meta">${esc(s.layout)} · ${dur} c</div></div>`;
  }).join("");
  return `<section class="item"><h2>${esc(scene.id)} <small>${esc(scene.account_id ?? "")}</small></h2>
    <p class="hook">Хук: ${esc(script.hook)}</p><div class="row">${cells}</div><p class="cta">CTA: ${esc(script.cta)}</p></section>`;
}

const CSS = `body{font:14px/1.4 system-ui,sans-serif;margin:0;padding:24px;background:#f5f5f7;color:#111}
h1{font-size:20px;margin:0 0 16px}.item{background:#fff;border-radius:12px;padding:16px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
h2{font-size:15px;margin:0 0 6px}h2 small{color:#888;font-weight:400;margin-left:8px}.hook,.cta{margin:4px 0;color:#333}
.row{display:flex;gap:6px;margin:10px 0;overflow-x:auto}.scene{flex:0 0 auto;min-width:72px}
.frame{aspect-ratio:9/16;border-radius:6px;background:var(--bg);color:var(--text);position:relative;overflow:hidden;padding:8px;box-sizing:border-box}
.txt{font-size:10px;line-height:1.2;display:block}.avatar{position:absolute;background:#000;opacity:.85}
.avatar_full .avatar{inset:0;opacity:.35}.avatar_full .txt{position:absolute;left:8px;right:8px;bottom:12px;z-index:1}
.avatar_bottom .avatar,.content_top .avatar{left:0;right:0;bottom:0;height:34%}
.avatar_circle .avatar{width:38%;aspect-ratio:1;border-radius:50%;right:6px;bottom:6px;border:2px solid var(--accent)}
.content_full .avatar{display:none}.meta{font-size:10px;color:#777;margin-top:3px;white-space:nowrap}`;

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (isMain) {
  const dir = process.argv[2];
  if (!dir) { console.error("usage: factory-storyboard.mjs <batch_dir> [--out file]"); process.exit(1); }
  const outIdx = process.argv.indexOf("--out");
  const outFile = outIdx > 0 ? process.argv[outIdx + 1] : join(dir, "storyboard.html");
  const scenesDir = join(dir, "scenes");
  if (!existsSync(scenesDir)) { console.error(`нет папки ${scenesDir}`); process.exit(1); }
  const files = readdirSync(scenesDir).filter((f) => f.endsWith(".json")).sort();
  const items = files.map((f) => {
    const scene = JSON.parse(readFileSync(join(scenesDir, f), "utf8"));
    const md = join(dir, "scripts", `${basename(f, ".json")}.md`);
    const script = existsSync(md) ? parseScript(readFileSync(md, "utf8")) : { hook: "", cta: "" };
    return renderItem(scene, script);
  });
  const html = `<!doctype html><meta charset="utf-8"><title>Раскадровка ${esc(basename(dir))}</title><style>${CSS}</style>
<h1>Раскадровка пачки ${esc(basename(dir))} · роликов: ${items.length}</h1>${items.join("\n")}`;
  writeFileSync(outFile, html);
  console.log(JSON.stringify({ out: outFile, items: items.length }));
}
