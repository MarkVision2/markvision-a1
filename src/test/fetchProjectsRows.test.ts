import { describe, expect, it } from "vitest";
import { isMissingCreativeUsernameColumn } from "@/lib/projectColumns";

describe("projectColumns fallback", () => {
  it("detects missing creative_username column errors", () => {
    expect(
      isMissingCreativeUsernameColumn('column projects.creative_username does not exist'),
    ).toBe(true);
    expect(isMissingCreativeUsernameColumn("permission denied")).toBe(false);
  });
});
