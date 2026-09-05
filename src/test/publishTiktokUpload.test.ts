/**
 * Раскладка видео по кускам для TikTok FILE_UPLOAD — зеркало правил площадки:
 * до 64 МБ — один кусок размером с файл; дальше floor(size/chunk) кусков,
 * хвост приклеен к последнему. Ошибка здесь = TikTok отвечает
 * invalid_param на init, и ни один ролик не уходит.
 */
import { describe, it, expect } from "vitest";
import {
  TIKTOK_CHUNK, TIKTOK_MAX_CHUNK, TIKTOK_MAX_VIDEO, planTikTokChunks,
} from "../../supabase/functions/_lib/publishers/tiktok.ts";

const MB = 1024 * 1024;

describe("planTikTokChunks", () => {
  it("файл до 64 МБ — один кусок размером с файл", () => {
    const p = planTikTokChunks(40 * MB);
    expect(p).toEqual({ chunkSize: 40 * MB, totalChunkCount: 1, chunks: [{ start: 0, end: 40 * MB - 1 }] });
    expect(planTikTokChunks(TIKTOK_MAX_CHUNK).totalChunkCount).toBe(1);
  });

  it("100 МБ при куске 32 МБ → 3 куска, последний забирает хвост", () => {
    const p = planTikTokChunks(100 * MB);
    expect(p.chunkSize).toBe(TIKTOK_CHUNK);
    expect(p.totalChunkCount).toBe(3); // floor(100/32)
    expect(p.chunks).toEqual([
      { start: 0, end: 32 * MB - 1 },
      { start: 32 * MB, end: 64 * MB - 1 },
      { start: 64 * MB, end: 100 * MB - 1 }, // 36 МБ — хвост приклеен
    ]);
  });

  it("куски покрывают файл без дыр и перекрытий", () => {
    const size = 333 * MB + 777;
    const p = planTikTokChunks(size);
    expect(p.chunks[0].start).toBe(0);
    expect(p.chunks.at(-1)!.end).toBe(size - 1);
    for (let i = 1; i < p.chunks.length; i++) expect(p.chunks[i].start).toBe(p.chunks[i - 1].end + 1);
    expect(p.chunks.length).toBe(p.totalChunkCount);
  });

  it("явно заданный кусок зажимается в границы площадки 5–64 МБ", () => {
    expect(planTikTokChunks(200 * MB, 1 * MB).chunkSize).toBe(5 * MB);
    expect(planTikTokChunks(200 * MB, 500 * MB).chunkSize).toBe(TIKTOK_MAX_CHUNK);
  });

  it("неизвестный размер и файл больше 4 ГБ — ошибка до обращения к площадке", () => {
    expect(() => planTikTokChunks(0)).toThrow(/размер видео/);
    expect(() => planTikTokChunks(NaN)).toThrow(/размер видео/);
    expect(() => planTikTokChunks(TIKTOK_MAX_VIDEO + 1)).toThrow(/4096 МБ/);
  });
});
