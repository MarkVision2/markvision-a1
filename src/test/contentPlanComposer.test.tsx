import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { ContentPlanComposerDialog } from "@/components/content-plan/ContentPlanComposerDialog";

vi.stubGlobal("URL", {
  createObjectURL: vi.fn((file: File) => `blob:${file.name}`),
  revokeObjectURL: vi.fn(),
});

vi.mock("@/hooks/useProjectsStore", () => ({
  useProjectsStore: () => ({ activeId: "proj-1" }),
}));

vi.mock("@/hooks/useInstagramAccount", () => ({
  useInstagramAccount: () => ({ account: { username: "test" } }),
}));

const createAutopost = vi.fn();
const upsertPlan = vi.fn();

vi.mock("@/lib/autopostClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/autopostClient")>();
  return {
    ...actual,
    createAutopostPublication: (...args: unknown[]) => createAutopost(...args),
  };
});

vi.mock("@/lib/contentPlanAutopostBridge", () => ({
  upsertContentPlanFromAutopost: (...args: unknown[]) => upsertPlan(...args),
}));

const generateCaption = vi.fn();
vi.mock("@/lib/autopostAiCaption", () => ({
  generateAutopostCaption: (...args: unknown[]) => generateCaption(...args),
  captureFrameFromVideoFile: vi.fn(async () => ({
    dataUrl: "data:image/jpeg;base64,xx",
    blob: new Blob(["x"], { type: "image/jpeg" }),
    file: new File(["x"], "cover.jpg", { type: "image/jpeg" }),
  })),
  fileToJpegDataUrl: vi.fn(async () => "data:image/jpeg;base64,xx"),
}));

function makeFileList(files: File[]): FileList {
  const list = {
    length: files.length,
    item: (i: number) => files[i] ?? null,
    [Symbol.iterator]: function* () {
      for (const f of files) yield f;
    },
  } as FileList;
  files.forEach((f, i) => {
    Object.defineProperty(list, i, { value: f, enumerable: true });
  });
  return list;
}

describe("ContentPlanComposerDialog unified publish", () => {
  beforeEach(() => {
    createAutopost.mockReset();
    upsertPlan.mockReset();
    generateCaption.mockReset();
    createAutopost.mockResolvedValue({
      id: "ap-1",
      scheduledAt: "2026-07-20T07:00:00.000Z",
      status: "scheduled",
      mediaUrl: "https://x/a.mp4",
      thumbnailUrl: null,
      childUrls: null,
      caption: "title",
      mediaType: "REELS",
    });
    upsertPlan.mockResolvedValue(undefined);
    generateCaption.mockResolvedValue("AI описание из слайдов\n\n#marketing");
  });

  it("requires media before scheduling", async () => {
    render(<ContentPlanComposerDialog open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/3 вещи/i), {
      target: { value: "Тест заголовок" },
    });
    fireEvent.click(screen.getByRole("button", { name: /автопост/i }));
    await waitFor(() => {
      expect(createAutopost).not.toHaveBeenCalled();
    });
  });

  it("uploads and mirrors into content plan", async () => {
    render(<ContentPlanComposerDialog open onOpenChange={() => {}} onDone={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/3 вещи/i), {
      target: { value: "Тест заголовок" },
    });
    const file = new File(["x"], "clip.mp4", { type: "video/mp4" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: makeFileList([file]) } });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Заменить$/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /автопост/i }));

    await waitFor(() => {
      expect(createAutopost).toHaveBeenCalled();
      expect(upsertPlan).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "proj-1",
          autopostId: "ap-1",
          title: "Тест заголовок",
        }),
      );
    });
  });

  it("uses calendar popover and quick schedule presets", async () => {
    render(<ContentPlanComposerDialog open onOpenChange={() => {}} />);

    expect(screen.queryByText(/Код-слово/i)).toBeNull();
    expect(screen.queryByText(/^Хэштеги$/i)).toBeNull();
    expect(screen.queryByText(/^Промпты$/i)).toBeNull();
    expect(screen.queryByText(/^Категория$/i)).toBeNull();

    expect(screen.getByLabelText("Дата публикации")).toBeTruthy();
    expect(screen.getByLabelText("Час")).toBeTruthy();
    expect(screen.getByLabelText("Минуты")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Завтра 10:00/i }));
    expect(screen.getByText(/Завтра · 10:00 Алматы/i)).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Дата публикации"));
    expect(await screen.findByText(/Время · Завтра/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "15:00" }));
    expect(screen.getByText(/Завтра · 15:00 Алматы/i)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Минуты"), { target: { value: "30" } });
    expect(screen.getByText(/Завтра · 15:30 Алматы/i)).toBeTruthy();
  });

  it("generates description from media via AI button", async () => {
    render(
      <ContentPlanComposerDialog
        open
        onOpenChange={() => {}}
        initialType="CAROUSEL"
      />,
    );

    const files = [
      new File(["a"], "slide-a.png", { type: "image/png" }),
      new File(["b"], "slide-b.png", { type: "image/png" }),
    ];
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: makeFileList(files) } });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Сгенерировать описание/i })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole("button", { name: /Сгенерировать описание/i }));

    await waitFor(() => {
      expect(generateCaption).toHaveBeenCalledWith(
        expect.objectContaining({ mediaType: "CAROUSEL", files: expect.any(Array) }),
      );
    });
    await waitFor(() => {
      expect(screen.getByDisplayValue(/AI описание из слайдов/i)).toBeTruthy();
    });
  });

  it("previews and reorders carousel slides", async () => {
    render(
      <ContentPlanComposerDialog
        open
        onOpenChange={() => {}}
        initialType="CAROUSEL"
      />,
    );

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.multiple).toBe(true);

    const files = [
      new File(["a"], "slide-a.png", { type: "image/png" }),
      new File(["b"], "slide-b.png", { type: "image/png" }),
      new File(["c"], "slide-c.png", { type: "image/png" }),
    ];
    fireEvent.change(input, { target: { files: makeFileList(files) } });

    expect(await screen.findByText(/Слайд 1 из 3/i)).toBeTruthy();
    expect(screen.getByText("Порядок слайдов")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Заменить слайд/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Ещё слайд/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Следующий слайд" }));
    expect(screen.getByText(/Слайд 2 из 3/i)).toBeTruthy();

    const orderSection = screen.getByText("Порядок слайдов").parentElement!;
    const leftButtons = within(orderSection).getAllByLabelText("Левее");
    fireEvent.click(leftButtons[1]);

    expect(screen.getByText(/Слайд 1 из 3/i)).toBeTruthy();
    expect(screen.getByAltText("Слайд 1")).toHaveAttribute("src", "blob:slide-b.png");
  });
});
