/**
 * FFmpeg-worker: защита загрузчика (worker/content-worker/urlGuard.mjs) —
 * Node-зеркало checkSourceUrl из edge-lib. Оба должны отвечать одинаково.
 */
import { describe, expect, it } from "vitest";
import {
  checkSourceUrl as tsCheck,
} from "../../supabase/functions/_lib/contentPipeline.ts";
import {
  checkSourceUrl,
  isPrivateIp,
  outputFileName,
  parseAllowedHosts,
} from "../../worker/content-worker/urlGuard.mjs";

const cases: [string, string][] = [
  ["https://files2.heygen.ai/x.mp4", "ok"],
  ["https://cdn.files2.heygen.ai/x.mp4", "ok"],
  ["http://files2.heygen.ai/x.mp4", "scheme"],
  ["https://evil.com/x.mp4", "not_allowlisted"],
  ["https://files2.heygen.ai.evil.com/x.mp4", "not_allowlisted"],
  ["https://u:p@files2.heygen.ai/x.mp4", "credentials"],
  ["https://files2.heygen.ai:8443/x.mp4", "port"],
  ["https://127.0.0.1/x.mp4", "ip_literal"],
  ["https://[fd00::1]/x.mp4", "ip_literal"],
  ["https://localhost/x.mp4", "private_host"],
  ["мусор", "invalid_url"],
];

describe("urlGuard воркера", () => {
  it.each(cases)("%s → %s (одинаково с edge-lib)", (url, expected) => {
    const node = checkSourceUrl(url);
    const ts = tsCheck(url);
    const nodeReason = node.ok === false ? node.reason : "ok";
    const tsReason = ts.ok === false ? ts.reason : "ok";
    expect(nodeReason).toBe(expected);
    expect(tsReason).toBe(expected);
  });

  it("приватные IP из DNS-ответа", () => {
    for (const ip of ["10.0.0.5", "172.18.0.1", "192.168.1.1", "127.0.0.1", "169.254.169.254", "100.64.1.1", "::1", "fd12::1", "fe80::1", "::ffff:10.1.1.1"]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "172.32.0.1", "100.128.0.1", "2606:4700::1111"]) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });

  it("allowlist из env, пустой → дефолт HeyGen", () => {
    expect(parseAllowedHosts("")).toContain("files2.heygen.ai");
    expect(parseAllowedHosts("*.a.com, b.org")).toEqual(["a.com", "b.org"]);
    expect(checkSourceUrl("https://x.a.com/v.mp4", parseAllowedHosts("*.a.com")).ok).toBe(true);
  });

  it("имя файла результата: id без путей, версия — целое", () => {
    expect(outputFileName("8f1b2c3d-0000-4000-8000-000000000001", undefined)).toBe("8f1b2c3d-0000-4000-8000-000000000001.mp4");
    expect(outputFileName("abc123", 2)).toBe("abc123_v2.mp4");
    expect(outputFileName("../etc/passwd", 1)).toBeNull();
    expect(outputFileName("abc", "x")).toBeNull();
    expect(outputFileName("abc123", 0)).toBeNull();
  });
});
