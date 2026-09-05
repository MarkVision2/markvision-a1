/** Трасса задания: структурная строка лога и очистка данных от секретов. */
import { describe, expect, it } from "vitest";
import { sanitizeTraceData, traceLine } from "../../supabase/functions/_lib/publishTrace.ts";

describe("sanitizeTraceData", () => {
  it("выбрасывает ключи, похожие на секреты, и режет длинные строки", () => {
    const out = sanitizeTraceData({ access_token: "x", Authorization: "y", code: "190", long: "a".repeat(600) });
    expect(out).not.toHaveProperty("access_token");
    expect(out).not.toHaveProperty("Authorization");
    expect(out?.code).toBe("190");
    expect(String(out?.long).length).toBe(501);
    expect(sanitizeTraceData(undefined)).toBeNull();
  });
});

describe("traceLine", () => {
  it("даёт JSON с trace_id, job_id и шагом", () => {
    const line = traceLine(
      { jobId: "j1", projectId: "p1", accountId: "a1", traceId: "t1" },
      { step: "VERIFIED", message: "пост найден", data: { url: "https://x" } },
      new Date("2026-09-05T12:00:00Z"),
    );
    const parsed = JSON.parse(line);
    expect(parsed).toMatchObject({ scope: "publish", trace_id: "t1", job_id: "j1", project_id: "p1", account_id: "a1", step: "VERIFIED", level: "info" });
    expect(parsed.at).toBe("2026-09-05T12:00:00.000Z");
  });
});
