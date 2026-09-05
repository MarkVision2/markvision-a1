/**
 * Радар идей: превью поста. Ссылки CDN протухают и режутся по referrer —
 * картинка грузится без referrer, а при ошибке вместо битого <img> заглушка
 * с началом подписи; после смены ссылки заглушка сбрасывается.
 */
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PostThumb } from "@/components/radar/RadarBits";
import type { RadarPost } from "@/lib/radarClient";

const base: Pick<RadarPost, "thumbnail_url" | "platform" | "caption" | "author_handle"> = {
  thumbnail_url: "https://scontent.cdninstagram.com/t.jpg?oe=1",
  platform: "instagram",
  caption: "Хотите узнать, как сделать ваши фотографии незабываемыми?",
  author_handle: "zapiski",
};

describe("PostThumb", () => {
  it("грузит картинку без referrer", () => {
    render(<PostThumb post={base} />);
    const img = document.querySelector("img") as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(img.getAttribute("src")).toBe(base.thumbnail_url);
    expect(screen.queryByTestId("post-thumb-fallback")).toBeNull();
  });

  it("ошибка загрузки → заглушка с началом подписи, а не битая картинка", () => {
    render(<PostThumb post={base} />);
    fireEvent.error(document.querySelector("img") as HTMLImageElement);
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByTestId("post-thumb-fallback")).toBeTruthy();
    expect(screen.getByText(/Хотите узнать, как сделать/)).toBeTruthy();
  });

  it("без ссылки — заглушка сразу; без подписи в ней ник автора", () => {
    render(<PostThumb post={{ ...base, thumbnail_url: null, caption: null }} />);
    expect(screen.getByTestId("post-thumb-fallback")).toBeTruthy();
    expect(screen.getByText("@zapiski")).toBeTruthy();
  });

  it("ссылка на видеофайл в <img> не идёт", () => {
    render(<PostThumb post={{ ...base, thumbnail_url: "https://cdn.example.com/v.mp4" }} />);
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByTestId("post-thumb-fallback")).toBeTruthy();
  });

  it("новая ссылка после ошибки — снова пробуем картинку", () => {
    const { rerender } = render(<PostThumb post={base} />);
    fireEvent.error(document.querySelector("img") as HTMLImageElement);
    expect(screen.getByTestId("post-thumb-fallback")).toBeTruthy();
    rerender(<PostThumb post={{ ...base, thumbnail_url: "https://abc.supabase.co/storage/v1/object/public/radar-thumbs/p/x.jpg" }} />);
    expect(document.querySelector("img")).toBeTruthy();
    expect(screen.queryByTestId("post-thumb-fallback")).toBeNull();
  });
});
