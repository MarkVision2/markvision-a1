#!/usr/bin/env node
/**
 * MCP-сервер MarkVision (stdio). Даёт агенту инструменты автопостинга по
 * API-ключу проекта: посмотреть аккаунты и группы, загрузить видео,
 * поставить публикацию, узнать статус, отменить или повторить задание.
 * Инструменты — src/tools.ts; удалённый вариант по HTTP — src/http.ts.
 *
 * Переменные окружения:
 *   MARKVISION_API_KEY — ключ из «Настройки → API и MCP» (mv_live_…)
 *   MARKVISION_API_URL — адрес API (https://<проект>.supabase.co/functions/v1/api/v1)
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MarkVisionClient } from "./client.js";
import { createMarkVisionServer } from "./tools.js";

const apiKey = process.env.MARKVISION_API_KEY?.trim();
const apiUrl = process.env.MARKVISION_API_URL?.trim();
if (!apiKey) {
  process.stderr.write("MARKVISION_API_KEY не задан — создайте ключ в MarkVision: Настройки → API и MCP\n");
  process.exit(1);
}
if (!apiUrl) {
  process.stderr.write("MARKVISION_API_URL не задан — например https://<проект>.supabase.co/functions/v1/api/v1\n");
  process.exit(1);
}

const server = createMarkVisionServer(new MarkVisionClient({ apiKey, baseUrl: apiUrl }));
const transport = new StdioServerTransport();
await server.connect(transport);
