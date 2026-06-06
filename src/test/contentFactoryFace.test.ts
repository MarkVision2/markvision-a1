import { describe, expect, it } from "vitest";
import {
  buildFaceWebhookFields,
  neuroFacePromptBlock,
  resolveFacePipeline,
} from "@/lib/contentFactoryFace";

describe("contentFactoryFace", () => {
  it("enables neuro_face_banner when people photos on ads format", () => {
    const r = resolveFacePipeline({
      typeId: "facebook-ads",
      isNeuroPhotoType: false,
      inputMode: "photo",
      peoplePhotosCount: 2,
    });
    expect(r.enabled).toBe(true);
    expect(r.pipeline).toBe("neuro_face_banner");
    expect(r.task).toBe("neuro_photo_session");
    expect(r.photosRole).toBe("face");
  });

  it("uses neuro_photo_session for neuro-photo type", () => {
    const r = resolveFacePipeline({
      typeId: "neuro-photo",
      isNeuroPhotoType: true,
      inputMode: "photo",
      peoplePhotosCount: 1,
    });
    expect(r.pipeline).toBe("neuro_photo_session");
    expect(r.task).toBe("neuro_photo_session");
  });

  it("stays ad_creative without people photos", () => {
    const r = resolveFacePipeline({
      typeId: "facebook-ads",
      isNeuroPhotoType: false,
      inputMode: "photo",
      peoplePhotosCount: 0,
    });
    expect(r.enabled).toBe(false);
    expect(r.pipeline).toBe("ad_creative");
  });

  it("builds face webhook fields with primary_face_url", () => {
    const resolution = resolveFacePipeline({
      typeId: "web-banner",
      isNeuroPhotoType: false,
      inputMode: "photo",
      peoplePhotosCount: 1,
    });
    const f = buildFaceWebhookFields({
      resolution,
      peoplePhotoUrls: ["https://cdn.example/face.jpg"],
      outputContentType: "banner",
      outputFormatLabel: "Баннер",
    });
    expect(f.face_reference_enabled).toBe(true);
    expect(f.primary_face_url).toBe("https://cdn.example/face.jpg");
    expect(f.generation_pipeline).toBe("neuro_face_banner");
    expect(f.output_content_type).toBe("banner");
  });

  it("prompt mentions recognizable face for banner", () => {
    expect(neuroFacePromptBlock(1, "neuro_face_banner", "Facebook Ads")).toContain("УЗНАВАЕМЫМ");
  });
});
