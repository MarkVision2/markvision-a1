import { chromium } from "playwright";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] }).catch(async () => chromium.launch());
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
for (const [path, name] of [["/privacy", "privacy"], ["/terms", "terms"]]) {
  await p.goto(`http://127.0.0.1:4173${path}`, { waitUntil: "networkidle" });
  await p.screenshot({ path: `/tmp/claude-0/-home-user-markvision-a1/a650f5b4-cf7e-52fc-a19c-41b04786ea82/scratchpad/${name}.png`, fullPage: false });
  console.log(name, await p.title());
}
await b.close();
