import { describe, expect, it } from "vitest";
import {
  canArchiveMontageJob,
  partitionMontageJobs,
  type MontageJob,
} from "@/lib/montageJobs";

const job = (status: MontageJob["status"], id: string): MontageJob => ({
  id,
  project_id: "project",
  status,
  progress: null,
  formats: ["16:9"],
  shorts_count: null,
  brief: null,
  source_url: "https://example.com/source.mp4",
  source_name: `${id}.mov`,
  mode: "standard",
  source2_url: null,
  source2_name: null,
  notify_telegram: true,
  result_video_url: null,
  result: null,
  error: null,
  created_at: "2026-07-18T00:00:00.000Z",
  updated_at: "2026-07-18T00:00:00.000Z",
  archived_at: null,
});

describe("montage jobs UI helpers", () => {
  it("separates active jobs from terminal history", () => {
    const jobs = [
      job("done", "done"),
      job("processing", "processing"),
      job("failed", "failed"),
      job("queued", "queued"),
      job("canceled", "canceled"),
      job("rendering", "rendering"),
    ];

    expect(partitionMontageJobs(jobs).active.map((item) => item.id)).toEqual([
      "processing",
      "queued",
      "rendering",
    ]);
    expect(partitionMontageJobs(jobs).history.map((item) => item.id)).toEqual([
      "done",
      "failed",
      "canceled",
    ]);
  });

  it("allows archiving only terminal jobs", () => {
    expect(canArchiveMontageJob(job("done", "done"))).toBe(true);
    expect(canArchiveMontageJob(job("failed", "failed"))).toBe(true);
    expect(canArchiveMontageJob(job("canceled", "canceled"))).toBe(true);
    expect(canArchiveMontageJob(job("queued", "queued"))).toBe(false);
    expect(canArchiveMontageJob(job("processing", "processing"))).toBe(false);
    expect(canArchiveMontageJob(job("rendering", "rendering"))).toBe(false);
  });
});
