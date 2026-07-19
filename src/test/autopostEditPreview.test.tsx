import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AutopostEditDialog } from "@/components/autopost/AutopostEditDialog";

describe("AutopostEditDialog preview aspect", () => {
  const base = {
    busy: false,
    editable: true,
    caption: "Текст",
    ymd: "2026-07-22",
    hour: 9,
    minute: 5,
    timeLabel: "09:05",
    dayLabel: "22 июля 2026",
    errorText: null,
    showReconnectLink: false,
    onClose: vi.fn(),
    onCaptionChange: vi.fn(),
    onYmdChange: vi.fn(),
    onHourChange: vi.fn(),
    onMinuteChange: vi.fn(),
    onDelete: vi.fn(),
    onRetry: vi.fn(),
    onPublishNow: vi.fn(),
    onSave: vi.fn(),
  };

  it("shows full 9:16 frame for Reels instead of cropped banner", () => {
    const { container } = render(
      <MemoryRouter>
        <AutopostEditDialog
          {...base}
          post={{
            id: "1",
            media_type: "REELS",
            media_url: "https://cdn.example/a.mp4",
            thumbnail_url: "https://cdn.example/cover.jpg",
            caption: "x",
            scheduled_at: "2026-07-22T04:05:00.000Z",
            status: "queued",
            error: null,
          }}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText(/Кадр 9:16/i)).toBeTruthy();
    expect(screen.getByTestId("edit-preview-frame").getAttribute("data-aspect")).toBe("9/16");
    expect(container.querySelector(".h-44")).toBeNull();
  });

  it("shows 4:5 frame for feed posts", () => {
    render(
      <MemoryRouter>
        <AutopostEditDialog
          {...base}
          post={{
            id: "2",
            media_type: "IMAGE",
            media_url: "https://cdn.example/a.jpg",
            thumbnail_url: "https://cdn.example/a.jpg",
            caption: "x",
            scheduled_at: "2026-07-22T04:05:00.000Z",
            status: "queued",
            error: null,
          }}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText(/Кадр 4:5/i)).toBeTruthy();
    expect(screen.getByTestId("edit-preview-frame").getAttribute("data-aspect")).toBe("4/5");
  });
});
