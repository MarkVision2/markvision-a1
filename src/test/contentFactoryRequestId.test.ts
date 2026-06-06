import { describe, expect, it } from "vitest";
import {
  buildContentFactoryRequestId,
  parseContentFactoryRequestId,
  requestIdBelongsToProject,
} from "@/lib/contentFactoryRequestId";

describe("contentFactoryRequestId", () => {
  it("строит и парсит новый формат", () => {
    const rid = buildContentFactoryRequestId("proj-1", "batch-1", "ugc");
    expect(rid).toBe("proj-1:batch-1:ugc");
    expect(parseContentFactoryRequestId(rid)).toEqual({
      projectId: "proj-1",
      batchId: "batch-1",
      styleId: "ugc",
    });
  });

  it("определяет принадлежность проекту", () => {
    const sessions = new Set(["old-batch"]);
    expect(requestIdBelongsToProject("proj-1:batch-1:ugc", "proj-1", sessions)).toBe(true);
    expect(requestIdBelongsToProject("proj-2:batch-1:ugc", "proj-1", sessions)).toBe(false);
    expect(requestIdBelongsToProject("old-batch:auto", "proj-1", sessions)).toBe(true);
    expect(requestIdBelongsToProject("other-batch:auto", "proj-1", sessions)).toBe(false);
  });
});
