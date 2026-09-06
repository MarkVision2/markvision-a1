/**
 * Радар идей: просмотр ролика на странице (PostVideo). Проверяем то, что
 * ломается молча: кнопка появляется только при пригодной ссылке, плеер
 * стартует со звуком (без muted), а отказ CDN превращается не в чёрный
 * прямоугольник, а в предложение открыть оригинал.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PostVideo, playableVideoUrl } from "@/components/radar/PostVideo";
import type { RadarPost } from "@/lib/radarClient";

type VideoPost = Pick<RadarPost, "video_url" | "url" | "media_type" | "platform">;

const post = (over: Partial<VideoPost> = {}): VideoPost => ({
  video_url: "https://cdn.example.com/reel.mp4",
  url: "https://www.instagram.com/reel/C1abc/",
  media_type: "video",
  platform: "instagram",
  ...over,
});

describe("playableVideoUrl", () => {
  it("берёт только прямые https-ссылки", () => {
    expect(playableVideoUrl(post())).toBe("https://cdn.example.com/reel.mp4");
    expect(playableVideoUrl(post({ video_url: "  https://cdn/x.mp4  " }))).toBe("https://cdn/x.mp4");
    expect(playableVideoUrl(post({ video_url: "http://cdn/x.mp4" }))).toBeNull();
    expect(playableVideoUrl(post({ video_url: null }))).toBeNull();
    expect(playableVideoUrl(post({ video_url: "" }))).toBeNull();
  });
});

describe("PostVideo", () => {
  it("без видео показывает только превью — кнопки нет", () => {
    render(<PostVideo post={post({ video_url: null })} poster={<div data-testid="poster" />} />);
    expect(screen.getByTestId("poster")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Смотреть видео" })).toBeNull();
  });

  it("по кнопке запускает плеер со звуком: muted не выставлен", async () => {
    const play = vi.fn().mockResolvedValue(undefined);
    // jsdom не умеет проигрывать медиа — подменяем play().
    Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, writable: true, value: play });
    render(<PostVideo post={post()} poster={<div data-testid="poster" />} />);
    fireEvent.click(screen.getByRole("button", { name: "Смотреть видео" }));
    const video = (await screen.findByTestId("post-video")) as HTMLVideoElement;
    expect(video.getAttribute("src")).toBe("https://cdn.example.com/reel.mp4");
    expect(video.muted).toBe(false);
    expect(video.hasAttribute("controls")).toBe(true);
    await waitFor(() => expect(play).toHaveBeenCalled());
  });

  it("протухшая ссылка → объяснение и переход к оригиналу, а не чёрный экран", async () => {
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true, writable: true, value: vi.fn().mockRejectedValue(new Error("no source")),
    });
    render(<PostVideo post={post()} poster={<div data-testid="poster" />} />);
    fireEvent.click(screen.getByRole("button", { name: "Смотреть видео" }));
    expect(await screen.findByText(/ссылка устарела/i)).toBeTruthy();
    const link = screen.getByRole("link", { name: /Открыть оригинал/ });
    expect(link.getAttribute("href")).toBe("https://www.instagram.com/reel/C1abc/");
  });
});
