#!/usr/bin/env node
/**
 * Удалённый MCP MarkVision по HTTP (Streamable HTTP, без сессий).
 *
 * Один процесс обслуживает любое число проектов и агентов: каждый запрос несёт
 * `Authorization: Bearer <API-ключ проекта>` (mv_live_…), по нему создаётся
 * клиент API на время запроса. Сервер ключей не хранит и базы не видит —
 * те же права и лимиты, что у stdio-варианта (docs/MCP.md).
 *
 * Переменные окружения:
 *   MARKVISION_API_URL  — адрес API (обязателен), например https://<проект>.supabase.co/functions/v1/api/v1
 *   MARKVISION_MCP_PORT — порт (8787)
 *   MARKVISION_MCP_HOST — интерфейс (127.0.0.1; 0.0.0.0 — только за TLS-прокси)
 *   MARKVISION_MCP_PATH — путь (/mcp)
 *
 * Клиент (Claude Code): `claude mcp add --transport http markvision https://host/mcp --header "Authorization: Bearer mv_live_…"`.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { MarkVisionClient } from "./client.js";
import { createMarkVisionServer } from "./tools.js";

export interface HttpOptions {
  apiUrl: string;
  path?: string;
  /** Подмена сети для тестов и прокси. */
  fetchFn?: typeof fetch;
}

/** API-ключ из заголовка Authorization: Bearer … (или x-api-key). */
export function bearerOf(req: IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (typeof auth === "string") {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m?.[1]) return m[1].trim();
  }
  const x = req.headers["x-api-key"];
  if (typeof x === "string" && x.trim()) return x.trim();
  return null;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

/** Один запрос MCP: ключ → клиент → сервер с инструментами → транспорт без сессии. */
export async function handleMcpRequest(req: IncomingMessage, res: ServerResponse, opts: HttpOptions): Promise<void> {
  const apiKey = bearerOf(req);
  if (!apiKey) {
    sendJson(res, 401, { jsonrpc: "2.0", error: { code: -32001, message: "Нужен заголовок Authorization: Bearer <API-ключ проекта MarkVision>" }, id: null });
    return;
  }
  const client = new MarkVisionClient({ apiKey, baseUrl: opts.apiUrl, ...(opts.fetchFn ? { fetchFn: opts.fetchFn } : {}) });
  const server = createMarkVisionServer(client);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (e) {
    if (!res.headersSent) {
      sendJson(res, 500, { jsonrpc: "2.0", error: { code: -32603, message: e instanceof Error ? e.message : String(e) }, id: null });
    }
  }
}

export function startHttpServer(opts: HttpOptions & { host: string; port: number }): Server {
  const path = opts.path ?? "/mcp";
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/healthz") {
      sendJson(res, 200, { ok: true, service: "markvision-mcp", transport: "streamable-http" });
      return;
    }
    if (url.pathname !== path) {
      sendJson(res, 404, { error: `MCP живёт на ${path}` });
      return;
    }
    if (!["POST", "GET", "DELETE"].includes(req.method ?? "")) {
      sendJson(res, 405, { error: "method not allowed" });
      return;
    }
    void handleMcpRequest(req, res, opts);
  });
  server.listen(opts.port, opts.host);
  return server;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const apiUrl = process.env.MARKVISION_API_URL?.trim();
  if (!apiUrl) {
    process.stderr.write("MARKVISION_API_URL не задан — например https://<проект>.supabase.co/functions/v1/api/v1\n");
    process.exit(1);
  }
  const host = process.env.MARKVISION_MCP_HOST?.trim() || "127.0.0.1";
  const port = Number(process.env.MARKVISION_MCP_PORT ?? 8787) || 8787;
  const path = process.env.MARKVISION_MCP_PATH?.trim() || "/mcp";
  startHttpServer({ apiUrl, host, port, path });
  process.stderr.write(`markvision-mcp (HTTP) слушает http://${host}:${port}${path}\n`);
}
