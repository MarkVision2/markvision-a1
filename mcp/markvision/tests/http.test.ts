/**
 * Удалённый MCP по HTTP: без ключа — 401, с ключом — initialize отвечает
 * сервером markvision, инструменты видны, вызов инструмента идёт в API с этим ключом.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startHttpServer } from "../src/http.ts";
import type { Server } from "node:http";

const seen: { url: string; auth: string | null }[] = [];
const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  const headers = new Headers(init?.headers);
  seen.push({ url, auth: headers.get("authorization") });
  return new Response(JSON.stringify({ ok: true, project: { id: "p1", name: "Тест" }, key: { name: "k", scopes: ["read"] } }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}) as typeof fetch;

let server: Server;
let base = "";

test("старт на свободном порту", async () => {
  server = startHttpServer({ apiUrl: "https://x.supabase.co", host: "127.0.0.1", port: 0, fetchFn: fakeFetch });
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  base = `http://127.0.0.1:${(addr as { port: number }).port}`;
  const health = await fetch(`${base}/healthz`);
  assert.equal(health.status, 200);
});

after(() => server?.close());

const rpc = (id: number, method: string, params: unknown = {}) => JSON.stringify({ jsonrpc: "2.0", id, method, params });
const mcpHeaders = (key?: string) => ({
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
  ...(key ? { Authorization: `Bearer ${key}` } : {}),
});
const initParams = { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } };

test("без Authorization — 401", async () => {
  const r = await fetch(`${base}/mcp`, { method: "POST", headers: mcpHeaders(), body: rpc(1, "initialize", initParams) });
  assert.equal(r.status, 401);
});

test("initialize и tools/list с ключом", async () => {
  const init = await fetch(`${base}/mcp`, { method: "POST", headers: mcpHeaders("mv_live_test"), body: rpc(1, "initialize", initParams) });
  assert.equal(init.status, 200);
  const body = await init.json() as { result: { serverInfo: { name: string } } };
  assert.equal(body.result.serverInfo.name, "markvision");

  const list = await fetch(`${base}/mcp`, { method: "POST", headers: mcpHeaders("mv_live_test"), body: rpc(2, "tools/list") });
  assert.equal(list.status, 200);
  const tools = (await list.json() as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name);
  assert.ok(tools.includes("markvision_whoami"));
  assert.ok(tools.includes("markvision_content_insights"));
  assert.ok(tools.includes("markvision_create_variations"));
  // Согласование и политика AI — не для агента.
  assert.ok(!tools.some((t) => /approve|policy/.test(t)));
});

test("вызов инструмента уходит в API с ключом из запроса", async () => {
  seen.length = 0;
  const call = await fetch(`${base}/mcp`, {
    method: "POST", headers: mcpHeaders("mv_live_abc"),
    body: rpc(3, "tools/call", { name: "markvision_whoami", arguments: {} }),
  });
  assert.equal(call.status, 200);
  const res = await call.json() as { result: { content: { text: string }[]; isError?: boolean } };
  assert.ok(!res.result.isError);
  assert.match(res.result.content[0].text, /"Тест"/);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].auth, "Bearer mv_live_abc");
  assert.match(seen[0].url, /\/functions\/v1\/api\/v1\/me$/);
});

test("чужой путь — 404", async () => {
  const r = await fetch(`${base}/other`, { method: "POST", headers: mcpHeaders("k"), body: "{}" });
  assert.equal(r.status, 404);
});
