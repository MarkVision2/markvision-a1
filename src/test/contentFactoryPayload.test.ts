import { describe, expect, it } from "vitest";
import {
  assertNeuroPhotoPayload,
  buildContentFactoryFormatFields,
  buildContentFactoryImageUrls,
  buildMarketingWebhookFields,
} from "@/lib/contentFactoryPayload";
import { resolveFacePipeline } from "@/lib/contentFactoryFace";
import type { Step3Flow } from "@/data/contentTypeFlows";

const ADS_STEP3: Step3Flow = {
  label: "Стиль и маркетинг",
  subtitle: "",
  showCreativeFormats: true,
  showNeuroStyles: false,
  showAngles: false,
  showGoal: true,
  showTone: true,
  showCta: true,
  showColor: true,
};

const MARKETPLACE_STEP3: Step3Flow = { ...ADS_STEP3, showCta: false };

describe("contentFactoryPayload", () => {
  const faceNeuro = resolveFacePipeline({
    typeId: "neuro-photo",
    isNeuroPhotoType: true,
    inputMode: "photo",
    peoplePhotosCount: 1,
  });

  const faceBanner = resolveFacePipeline({
    typeId: "facebook-ads",
    isNeuroPhotoType: false,
    inputMode: "photo",
    peoplePhotosCount: 1,
  });

  it("neuro image_urls stays empty", () => {
    expect(
      buildContentFactoryImageUrls({
        isNeuroPhoto: true,
        facePipeline: faceNeuro,
        logoUrl: "https://x/logo.png",
        peoplePhotoUrls: ["https://clony.supabase.co/storage/v1/object/public/bucket/face.jpg"],
        productPhotoUrls: [],
        brandUrls: [],
      }),
    ).toEqual([]);
  });

  it("neuro_face_banner excludes people from image_urls", () => {
    const urls = buildContentFactoryImageUrls({
      isNeuroPhoto: false,
      facePipeline: faceBanner,
      logoUrl: "https://x/logo.png",
      peoplePhotoUrls: ["https://x/face.jpg"],
      productPhotoUrls: ["https://x/product.jpg"],
      brandUrls: [],
    });
    expect(urls).toEqual(["https://x/logo.png", "https://x/product.jpg"]);
    expect(urls).not.toContain("https://x/face.jpg");
  });

  it("neuro format fields omit creative_format", () => {
    const f = buildContentFactoryFormatFields({
      isNeuroPhoto: true,
      styleId: "neuro_business",
      styleLabel: "Деловой портрет",
      creativeFormatFields: null,
    });
    expect(f).toEqual({
      style_id: "neuro_business",
      n8n_pipeline: "neuro_business",
      style: "Деловой портрет",
    });
    expect(f).not.toHaveProperty("creative_format");
  });

  it("marketplace marketing omits CTA", () => {
    const { flat, nested } = buildMarketingWebhookFields({
      step3: MARKETPLACE_STEP3,
      isNeuroPhoto: false,
      cta: { id: "learn_more", label: "Узнать", phrase: "Узнать →", description: "" },
      tone: { id: "selling", label: "Продающий", description: "" },
      goal: { id: "conversions", label: "Конверсии", description: "" },
    });
    expect(flat.ctas).toBe("");
    expect(nested.cta.phrase).toBe("");
  });

  it("neuro marketing is fully empty", () => {
    const { flat, nested } = buildMarketingWebhookFields({
      step3: ADS_STEP3,
      isNeuroPhoto: true,
      cta: { id: "learn_more", label: "x", phrase: "x", description: "" },
      tone: { id: "selling", label: "x", description: "" },
      goal: { id: "conversions", label: "x", description: "" },
    });
    expect(flat.ctas).toBe("");
    expect(nested.cta.id).toBe("");
  });

  it("assertNeuroPhotoPayload accepts valid neuro contract", () => {
    const url =
      "https://szfgdruhlebfvcmlvxdk.supabase.co/storage/v1/object/public/content-factory-uploads/face.jpg";
    const r = assertNeuroPhotoPayload({
      content_type: "neuro-photo",
      route: "neuro-photo",
      task: "neuro_photo_session",
      generation_pipeline: "neuro_photo_session",
      neuro_photo_session: true,
      face_reference_enabled: true,
      photos_role: "face",
      people_photo_urls: [url],
      primary_face_url: url,
      image_urls: [],
    });
    expect(r.ok).toBe(true);
  });

  it("assertNeuroPhotoPayload rejects Fallback route", () => {
    const r = assertNeuroPhotoPayload({
      content_type: "fb-target",
      route: "fb-target",
      task: "ad_creative",
      generation_pipeline: "ad_creative",
      neuro_photo_session: false,
      face_reference_enabled: false,
      photos_role: "brand_assets",
      people_photo_urls: [],
      primary_face_url: "",
      image_urls: [],
    });
    expect(r.ok).toBe(false);
  });
});
