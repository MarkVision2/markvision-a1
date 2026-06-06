import { describe, expect, it } from "vitest";
import {
  isNeuroPhotoTypeId,
  resolveContentTypeRoute,
} from "@/lib/contentFactoryRoutes";

describe("contentFactoryRoutes", () => {
  it("maps google-ads with hyphen", () => {
    expect(resolveContentTypeRoute("google-ads")).toBe("google-ads");
  });

  it("maps neuro-photo", () => {
    expect(resolveContentTypeRoute("neuro-photo")).toBe("neuro-photo");
  });

  it("falls back unknown to fb-target", () => {
    expect(resolveContentTypeRoute("unknown")).toBe("fb-target");
    expect(resolveContentTypeRoute("")).toBe("fb-target");
  });

  it("detects neuro photo type id", () => {
    expect(isNeuroPhotoTypeId("neuro-photo")).toBe(true);
    expect(isNeuroPhotoTypeId("facebook-ads")).toBe(false);
  });
});
