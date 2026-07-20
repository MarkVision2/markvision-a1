import { describe, it, expect, vi, beforeEach } from "vitest";

const insertMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ insert: insertMock }),
  },
}));

describe("enqueueAgentJob", () => {
  beforeEach(() => {
    insertMock.mockReset();
  });

  it("returns ok when insert succeeds", async () => {
    insertMock.mockResolvedValue({ error: null });
    const { enqueueAgentJob } = await import("@/lib/heygenUsage");
    const res = await enqueueAgentJob("proj", "sess", "script text", "9:16", "brief");
    expect(res).toEqual({ ok: true });
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: "proj",
        session_id: "sess",
        source: "web",
        script: "script text",
        montage_brief: "brief",
        aspect: "9:16",
      }),
    );
  });

  it("returns error when supabase insert fails", async () => {
    insertMock.mockResolvedValue({ error: { message: "RLS blocked" } });
    // fresh import not needed — module already loaded; call again
    const { enqueueAgentJob } = await import("@/lib/heygenUsage");
    const res = await enqueueAgentJob("proj", "sess", "script");
    expect(res).toEqual({ ok: false, error: "RLS blocked" });
  });

  it("returns error when projectId missing", async () => {
    const { enqueueAgentJob } = await import("@/lib/heygenUsage");
    const res = await enqueueAgentJob("", "sess", "script");
    expect(res.ok).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
  });
});
