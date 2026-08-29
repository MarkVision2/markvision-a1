import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Page } from "@playwright/test";

const run = promisify(execFile);

/**
 * Мост до реального Supabase для прогона на живых данных.
 *
 * Chromium в этом окружении не ходит через egress-прокси (CONNECT отклоняется),
 * а curl — ходит. Поэтому запросы страницы к *.supabase.co перехватываем и
 * выполняем из Node через curl, возвращая настоящий ответ в браузер.
 */
export type ProxyStats = { requests: number; failures: string[] };

export async function installLiveSupabaseProxy(page: Page, stats: ProxyStats): Promise<void> {
  await page.route("**://*.supabase.co/**", async (route) => {
    const req = route.request();

    if (req.method() === "OPTIONS") {
      return route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "*",
          "access-control-allow-methods": "*",
        },
      });
    }

    const dir = mkdtempSync(join(tmpdir(), "sbproxy-"));
    const bodyFile = join(dir, "body");
    const headFile = join(dir, "head");
    try {
      const args = [
        "-s", "--compressed", "--max-time", "45",
        "-X", req.method(),
        "-o", bodyFile, "-D", headFile, "-w", "%{http_code}",
      ];
      const skip = new Set(["host", "connection", "content-length", "accept-encoding", "origin", "referer"]);
      for (const [k, v] of Object.entries(req.headers())) {
        if (!skip.has(k.toLowerCase())) args.push("-H", `${k}: ${v}`);
      }
      const post = req.postData();
      if (post) args.push("--data-binary", post);
      args.push(req.url());

      const { stdout } = await run("curl", args, { maxBuffer: 64 * 1024 * 1024 });
      const status = Number(stdout.trim()) || 500;
      const body = readFileSync(bodyFile);

      // Из ответа переносим только то, что нужно клиенту; остальное мешает (кодировки, длины)
      const raw = readFileSync(headFile, "utf8");
      const headers: Record<string, string> = {
        "access-control-allow-origin": "*",
        "access-control-expose-headers": "content-range, content-type",
      };
      for (const line of raw.split(/\r?\n/)) {
        const m = /^([a-z0-9-]+):\s*(.*)$/i.exec(line);
        if (!m) continue;
        const key = m[1].toLowerCase();
        if (key === "content-type" || key === "content-range") headers[key] = m[2];
      }

      stats.requests++;
      if (status >= 400) {
        stats.failures.push(`${status} ${req.method()} ${req.url().split("?")[0]} — ${body.toString().slice(0, 200)}`);
      }
      await route.fulfill({ status, headers, body });
    } catch (e) {
      stats.failures.push(`мост упал: ${req.url().split("?")[0]} — ${(e as Error).message}`);
      await route.fulfill({ status: 502, contentType: "application/json", body: "{}" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
