import { describe, expect, it } from "vitest";
import {
  buildReelsSourceConfig,
  sanitizeAssetFilename,
  type ReelsBrollMode,
} from "@/lib/reelsAssets";

describe("Reels B-roll source config", () => {
  it("uses automatic generation when no project folder is selected", () => {
    expect(buildReelsSourceConfig("library", [])).toEqual({
      brollMode: "auto",
      assetFolderIds: [],
    });
  });

  it("preserves selected project folders for random asset pickup", () => {
    expect(buildReelsSourceConfig("library", ["folder-a", "folder-b", "folder-a"])).toEqual({
      brollMode: "library",
      assetFolderIds: ["folder-a", "folder-b"],
    });
  });

  it.each<ReelsBrollMode>(["auto", "pexels", "kie"])("does not attach folders to %s mode", (mode) => {
    expect(buildReelsSourceConfig(mode, ["folder-a"])).toEqual({
      brollMode: mode,
      assetFolderIds: [],
    });
  });

  it("sanitizes uploaded filenames without dropping the extension", () => {
    expect(sanitizeAssetFilename("Мой B-roll №1.MOV")).toMatch(/^[a-z0-9-]+\.mov$/);
  });
});
