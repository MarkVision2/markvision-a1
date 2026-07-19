import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ContentPlanComposerDialog } from "@/components/content-plan/ContentPlanComposerDialog";

vi.stubGlobal("URL", {
  createObjectURL: vi.fn(() => "blob:mock"),
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

describe("ContentPlanComposerDialog unified publish", () => {
  beforeEach(() => {
    createAutopost.mockReset();
    upsertPlan.mockReset();
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
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Заменить/i })).toBeInTheDocument();
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
});
