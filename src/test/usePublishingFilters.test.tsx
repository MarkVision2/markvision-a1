/**
 * usePublishing: фильтры очереди привязаны к проекту — при смене проекта чужое
 * видео и статус сбрасываются, а запрос заданий уходит уже без них.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const store = vi.hoisted(() => ({ activeId: "p1" as string | null }));
vi.mock("@/hooks/useProjectsStore", () => ({ useProjectsStore: () => ({ activeId: store.activeId }) }));

const jobsList = vi.hoisted(() => vi.fn());
vi.mock("@/lib/publishingClient", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/publishingClient")>();
  return {
    ...orig,
    runHealthCheck: vi.fn(),
    publishingApi: {
      ...orig.publishingApi,
      list: vi.fn().mockResolvedValue({ accounts: [] }),
      groupList: vi.fn().mockResolvedValue({ groups: [] }),
      personaList: vi.fn().mockResolvedValue({ personas: [] }),
      settingsGet: vi.fn().mockResolvedValue(null),
      metrics: vi.fn().mockResolvedValue({ publish: null, radar: null, videos: [] }),
      jobsList,
    },
  };
});

import { usePublishing } from "@/hooks/usePublishing";

beforeEach(() => {
  store.activeId = "p1";
  jobsList.mockReset();
  jobsList.mockResolvedValue({ jobs: [] });
});

describe("usePublishing — фильтры заданий", () => {
  it("фильтр по видео уходит на сервер и сбрасывается при смене проекта", async () => {
    const { result, rerender } = renderHook(() => usePublishing());
    await waitFor(() => expect(jobsList).toHaveBeenCalledWith("p1", expect.objectContaining({ limit: 200 })));

    act(() => result.current.setJobsVideo("v1"));
    await waitFor(() => expect(jobsList).toHaveBeenLastCalledWith("p1", expect.objectContaining({ video_id: "v1" })));
    expect(result.current.jobsVideo).toBe("v1");

    store.activeId = "p2";
    rerender();
    await waitFor(() => expect(jobsList).toHaveBeenLastCalledWith("p2", expect.anything()));
    const last = jobsList.mock.calls[jobsList.mock.calls.length - 1][1] as Record<string, unknown>;
    expect(last.video_id).toBeUndefined();
    expect(result.current.jobsVideo).toBeNull();
    expect(result.current.jobsStatus).toBe("all");
  });

  it("смена статуса сбрасывает страницу, «Показать ещё» растит лимит", async () => {
    const { result } = renderHook(() => usePublishing());
    await waitFor(() => expect(jobsList).toHaveBeenCalled());
    act(() => result.current.loadMoreJobs());
    await waitFor(() => expect(jobsList).toHaveBeenLastCalledWith("p1", expect.objectContaining({ limit: 400 })));
    act(() => result.current.setJobsStatus("failed"));
    await waitFor(() => expect(jobsList).toHaveBeenLastCalledWith("p1", expect.objectContaining({ status: "failed", limit: 200 })));
  });
});
