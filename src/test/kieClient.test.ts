/**
 * Поток генерации через kie.ai целиком, на подставном сервере.
 *
 * Живой домен api.kie.ai закрыт сетевой политикой среды, поэтому единственный
 * способ проверить логику — прогнать её с подменённым fetch. Проверяем то,
 * что стоит денег: повторное использование taskId (иначе ретрай оплатит
 * генерацию дважды), возврат в очередь при незавершённой задаче и то, что
 * фатальные ошибки не уходят в бесконечные повторы.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FetchCall = { url: string; init: RequestInit | undefined };

let calls: FetchCall[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let kie: any;

/** Ответ подставного сервера. */
function reply(status: number, body: unknown): Response {
  return {
    ok: status < 400,
    status,
    json: async () => body,
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    headers: { get: () => "image/png" },
  } as unknown as Response;
}

beforeEach(async () => {
  calls = [];
  // jsdom не реализует AbortSignal.timeout, в Deno он есть. Полифиллим,
  // иначе падает не код, а среда теста.
  if (typeof AbortSignal.timeout !== "function") {
    (AbortSignal as unknown as { timeout: (ms: number) => AbortSignal }).timeout = (ms: number) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), ms);
      return controller.signal;
    };
  }
  // Модуль написан для Deno: подменяем окружение до импорта.
  vi.stubGlobal("Deno", { env: { get: (k: string) => (k === "KIE_API_KEY" ? "test-key" : undefined) } });
  vi.resetModules();
  kie = await import("../../supabase/functions/_lib/kie.ts");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Подменяет fetch по очереди ответов, записывая обращения. */
function mockFetch(responses: Array<(url: string) => Response>) {
  let i = 0;
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const make = responses[Math.min(i, responses.length - 1)];
    i++;
    return Promise.resolve(make(String(url)));
  });
}

const successRecord = {
  code: 200,
  data: {
    state: "success",
    resultJson: JSON.stringify({ resultUrls: ["https://cdn.kie.ai/out.png"] }),
  },
};

describe("kieImage — успешный путь", () => {
  it("создаёт задачу, дожидается и скачивает кадр", async () => {
    mockFetch([
      () => reply(200, { code: 200, data: { taskId: "task_1" } }),
      () => reply(200, successRecord),
      () => reply(200, {}), // скачивание картинки
    ]);

    const res = await kie.kieImage("промпт", [], { deadline: Date.now() + 60_000 });

    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ data: "AQID", mime: "image/png" });
    expect(calls[0].url).toContain("jobs/createTask");
    expect(calls[1].url).toContain("jobs/recordInfo");
    expect(calls[1].url).toContain("task_1");
    expect(calls[2].url).toBe("https://cdn.kie.ai/out.png");
  });

  it("ключ уходит заголовком Bearer", async () => {
    mockFetch([() => reply(200, { code: 200, data: { taskId: "t" } }), () => reply(200, successRecord), () => reply(200, {})]);
    await kie.kieImage("p", [], { deadline: Date.now() + 60_000 });
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-key");
  });

  it("референсы уходят ссылками, аспект приводится к соотношению", async () => {
    mockFetch([() => reply(200, { code: 200, data: { taskId: "t" } }), () => reply(200, successRecord), () => reply(200, {})]);
    await kie.kieImage("p", ["https://cdn/a.jpg"], { deadline: Date.now() + 60_000, aspect: "1080x1350" });
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.input.image_urls).toEqual(["https://cdn/a.jpg"]);
    expect(body.input.image_size).toBe("4:5");
  });
});

describe("kieImage — незавершённая задача", () => {
  it("отдаёт pending с taskId, а не ошибку", async () => {
    mockFetch([
      () => reply(200, { code: 200, data: { taskId: "task_slow" } }),
      () => reply(200, { code: 200, data: { state: "generating", progress: 0.3 } }),
    ]);

    // Дедлайн уже почти вышел — опрос сделает один заход и вернётся.
    const res = await kie.kieImage("p", [], { deadline: Date.now() + 100 });

    expect(res.ok).toBe(false);
    expect(res.pending).toBe(true);
    expect(res.taskId).toBe("task_slow");
  });

  it("сообщает taskId сразу после создания — чтобы задание его запомнило", async () => {
    const saved: string[] = [];
    mockFetch([
      () => reply(200, { code: 200, data: { taskId: "task_x" } }),
      () => reply(200, { code: 200, data: { state: "queuing" } }),
    ]);

    await kie.kieImage("p", [], {
      deadline: Date.now() + 100,
      onTask: async (id: string) => { saved.push(id); },
    });
    expect(saved).toEqual(["task_x"]);
  });

  it("с готовым taskId не создаёт новую задачу — иначе платим дважды", async () => {
    mockFetch([() => reply(200, successRecord), () => reply(200, {})]);

    const res = await kie.kieImage("p", [], {
      taskId: "task_existing",
      deadline: Date.now() + 60_000,
    });

    expect(res.ok).toBe(true);
    expect(calls.some((c) => c.url.includes("createTask"))).toBe(false);
    expect(calls[0].url).toContain("task_existing");
  });
});

describe("kieImage — ошибки", () => {
  it("нехватка кредитов фатальна, повторов не будет", async () => {
    mockFetch([() => reply(402, { code: 402, msg: "insufficient credits" })]);
    const res = await kie.kieImage("p", [], { deadline: Date.now() + 10_000 });
    expect(res.ok).toBe(false);
    expect(res.retryable).toBe(false);
    expect(res.error).toContain("кредитов");
  });

  it("неверный ключ фатален", async () => {
    mockFetch([() => reply(401, { code: 401, msg: "unauthorized" })]);
    const res = await kie.kieImage("p", [], { deadline: Date.now() + 10_000 });
    expect(res.retryable).toBe(false);
    expect(res.error).toContain("ключ");
  });

  it("упавшая задача не повторяется — тот же промпт даст то же самое", async () => {
    mockFetch([
      () => reply(200, { code: 200, data: { taskId: "t" } }),
      () => reply(200, { code: 200, data: { state: "fail", failMsg: "content policy" } }),
    ]);
    const res = await kie.kieImage("p", [], { deadline: Date.now() + 30_000 });
    expect(res.ok).toBe(false);
    expect(res.retryable).toBe(false);
    expect(res.error).toContain("content policy");
  });

  it("успех без ссылки не выдаётся за готовый кадр", async () => {
    mockFetch([
      () => reply(200, { code: 200, data: { taskId: "t" } }),
      () => reply(200, { code: 200, data: { state: "success", resultJson: "{}" } }),
    ]);
    const res = await kie.kieImage("p", [], { deadline: Date.now() + 30_000 });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("не вернул ссылку");
  });

  it("внутренний адрес в ответе не скачивается", async () => {
    mockFetch([
      () => reply(200, { code: 200, data: { taskId: "t" } }),
      () => reply(200, {
        code: 200,
        data: { state: "success", resultJson: JSON.stringify({ resultUrls: ["http://169.254.169.254/x"] }) },
      }),
    ]);
    const res = await kie.kieImage("p", [], { deadline: Date.now() + 30_000 });
    expect(res.ok).toBe(false);
    // До скачивания дело не дошло: обращений ровно два — createTask и recordInfo.
    expect(calls).toHaveLength(2);
  });

  it("сетевой сбой повторяем", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("network down")));
    const res = await kie.kieImage("p", [], { deadline: Date.now() + 10_000 });
    expect(res.ok).toBe(false);
    expect(res.retryable).toBe(true);
  });
});
