/**
 * Клиент API: нормализация адреса, заголовки, разбор ошибок, загрузка файла
 * в два шага (presign → PUT). Сеть подменяется.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiError, MarkVisionClient, contentTypeFor, normalizeBaseUrl } from "../src/client.ts";

test("normalizeBaseUrl достраивает путь до /functions/v1/api/v1", () => {
  assert.equal(normalizeBaseUrl("https://x.supabase.co"), "https://x.supabase.co/functions/v1/api/v1");
  assert.equal(normalizeBaseUrl("https://x.supabase.co/functions/v1/api/"), "https://x.supabase.co/functions/v1/api/v1");
  assert.equal(normalizeBaseUrl("https://x.supabase.co/functions/v1/api/v1"), "https://x.supabase.co/functions/v1/api/v1");
});

test("contentTypeFor по расширению", () => {
  assert.equal(contentTypeFor("/a/b.MP4"), "video/mp4");
  assert.equal(contentTypeFor("/a/b.mov"), "video/quicktime");
  assert.equal(contentTypeFor("/a/b.bin"), "application/octet-stream");
});

function fakeFetch(handler: (url: string, init: RequestInit) => { status: number; body?: unknown }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    const r = handler(url, init ?? {});
    return new Response(r.body === undefined ? "" : JSON.stringify(r.body), { status: r.status });
  }) as typeof fetch;
  return { fn, calls };
}

test("Bearer-заголовок и ошибка сервера превращаются в ApiError", async () => {
  const { fn, calls } = fakeFetch(() => ({ status: 403, body: { error: "у ключа нет права publish" } }));
  const c = new MarkVisionClient({ apiKey: "mv_live_k", baseUrl: "https://x.supabase.co", fetchFn: fn });
  await assert.rejects(() => c.createPublication({ file_url: "https://v/x.mp4" }), (e: unknown) => {
    assert.ok(e instanceof ApiError);
    assert.equal(e.status, 403);
    assert.match(e.message, /publish/);
    return true;
  });
  assert.equal(calls[0].url, "https://x.supabase.co/functions/v1/api/v1/publications");
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer mv_live_k");
});

test("uploadFile: presign с размером и типом, затем PUT байтов, возвращает file_url", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mv-"));
  const file = join(dir, "clip.mp4");
  await writeFile(file, Buffer.alloc(1234, 1));

  const { fn, calls } = fakeFetch((url) =>
    url.endsWith("/media/upload-url")
      ? { status: 200, body: { ok: true, upload_url: "https://r2.example/put?sig=1", file_url: "https://cdn.example/posts/clip.mp4" } }
      : { status: 200 },
  );
  const c = new MarkVisionClient({ apiKey: "mv_live_k", baseUrl: "https://x.supabase.co", fetchFn: fn });
  const r = await c.uploadFile(file);
  assert.equal(r.file_url, "https://cdn.example/posts/clip.mp4");
  assert.equal(r.size, 1234);

  const presign = JSON.parse(String(calls[0].init.body));
  assert.deepEqual(presign, { filename: "clip.mp4", size: 1234, content_type: "video/mp4" });
  assert.equal(calls[1].url, "https://r2.example/put?sig=1");
  assert.equal(calls[1].init.method, "PUT");
  assert.equal((calls[1].init.headers as Record<string, string>)["Content-Type"], "video/mp4");
});

test("uploadFile: нет файла — понятная ошибка без похода в сеть", async () => {
  const { fn, calls } = fakeFetch(() => ({ status: 200 }));
  const c = new MarkVisionClient({ apiKey: "k", baseUrl: "https://x.supabase.co", fetchFn: fn });
  await assert.rejects(() => c.uploadFile("/nope/never.mp4"), /файл не найден/);
  assert.equal(calls.length, 0);
});

test("distribute: POST /publications/distribute с телом как есть", async () => {
  const { fn, calls } = fakeFetch(() => ({ status: 200, body: { ok: true, created: 2, unassigned: [] } }));
  const c = new MarkVisionClient({ apiKey: "mv_live_k", baseUrl: "https://x.supabase.co", fetchFn: fn });
  const body = { videos: [{ id: "3fa85f64-5717-4562-b3fc-2c963f66afa6", topic_key: "A" }], target: { per_day: 3 } };
  const r = await c.distribute(body);
  assert.equal(r.created, 2);
  assert.equal(calls[0].url, "https://x.supabase.co/functions/v1/api/v1/publications/distribute");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), body);
});
