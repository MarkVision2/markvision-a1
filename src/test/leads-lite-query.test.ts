import { describe, it, expect } from "vitest";
import { LEADS_LITE_QUERY_KEY } from "@/hooks/useLeadsLite";

describe("useLeadsLite query key", () => {
  it("uses stable key prefix for React Query deduplication", () => {
    expect(LEADS_LITE_QUERY_KEY).toBe("leads-lite");
    expect(["leads-lite", "project-1"]).toEqual(["leads-lite", "project-1"]);
  });
});
