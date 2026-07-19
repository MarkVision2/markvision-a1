import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { AutopostComposerDialog } from "@/components/autopost/AutopostComposerDialog";

vi.stubGlobal("URL", {
  createObjectURL: vi.fn((file: File) => `blob:${file.name}`),
  revokeObjectURL: vi.fn(),
});

describe("AutopostComposerDialog schedule + AI caption", () => {
  const onDayChange = vi.fn();
  const onHourChange = vi.fn();
  const onMinuteChange = vi.fn();
  const onGenerateCaption = vi.fn();
  const onCaptionChange = vi.fn();
  const onPickFiles = vi.fn();

  beforeEach(() => {
    onDayChange.mockReset();
    onHourChange.mockReset();
    onMinuteChange.mockReset();
    onGenerateCaption.mockReset();
    onCaptionChange.mockReset();
    onPickFiles.mockReset();
  });

  const baseProps = () => ({
    day: "2026-07-19",
    dayLabel: "19 июля 2026",
    onDayChange,
    hourReach: new Map<number, number>(),
    bestHour: null as number | null,
    hasAccount: true,
    busy: false,
    onClose: vi.fn(),
    onSubmitNow: vi.fn(),
    onSubmitSchedule: vi.fn(),
    type: "CAROUSEL" as const,
    onTypeChange: vi.fn(),
    files: [] as File[],
    previews: [] as string[],
    onPickFiles,
    onRemoveFile: vi.fn(),
    onMoveFile: vi.fn(),
    caption: "",
    onCaptionChange,
    captionBusy: false,
    onGenerateCaption,
    hour: 12,
    minute: 0,
    onHourChange,
    onMinuteChange,
    dryRun: false,
    onDryRunChange: vi.fn(),
    videoSrc: null,
    coverPreview: null,
    seek: 0,
    duration: 0,
    onSeekChange: vi.fn(),
    onDurationChange: vi.fn(),
    onCaptureFrame: vi.fn(),
    onPickCover: vi.fn(),
    onClearCover: vi.fn(),
    videoRef: createRef<HTMLVideoElement>(),
    fileInputRef: createRef<HTMLInputElement>(),
    coverInputRef: createRef<HTMLInputElement>(),
  });

  it("shows caption and AI generate above the fold, before slides", () => {
    render(<AutopostComposerDialog {...baseProps()} />);

    expect(screen.getByLabelText("Подпись к публикации")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Сгенерировать описание/i })).toBeDisabled();
    expect(screen.getByText(/Когда публиковать/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Завтра 10:00/i })).toBeTruthy();
    expect(screen.getByLabelText("Дата публикации")).toBeTruthy();

    const caption = screen.getByLabelText("Подпись к публикации");
    const slides = screen.getByText(/Слайды · порядок/i);
    expect(
      caption.compareDocumentPosition(slides) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("applies tomorrow morning preset", () => {
    render(<AutopostComposerDialog {...baseProps()} />);
    fireEvent.click(screen.getByRole("button", { name: /Завтра 10:00/i }));
    expect(onDayChange).toHaveBeenCalledWith("2026-07-20");
    expect(onHourChange).toHaveBeenCalledWith(10);
    expect(onMinuteChange).toHaveBeenCalledWith(0);
  });

  it("enables AI caption after media and calls handler", async () => {
    const files = [
      new File(["a"], "a.png", { type: "image/png" }),
      new File(["b"], "b.png", { type: "image/png" }),
    ];
    render(
      <AutopostComposerDialog
        {...baseProps()}
        files={files}
        previews={["blob:a", "blob:b"]}
      />,
    );

    const btn = screen.getByRole("button", { name: /Сгенерировать описание/i });
    await waitFor(() => expect(btn).toBeEnabled());
    fireEvent.click(btn);
    expect(onGenerateCaption).toHaveBeenCalled();
  });

  it("opens calendar popover with time slots", async () => {
    render(<AutopostComposerDialog {...baseProps()} />);
    fireEvent.click(screen.getByLabelText("Дата публикации"));
    expect(await screen.findByText(/Время · Сегодня/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "15:00" }));
    expect(onHourChange).toHaveBeenCalledWith(15);
    expect(onMinuteChange).toHaveBeenCalledWith(0);
  });
});
