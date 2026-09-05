#!/usr/bin/env node
/**
 * MCP-сервер MarkVision (stdio). Даёт агенту инструменты автопостинга по
 * API-ключу проекта: посмотреть аккаунты и группы, загрузить видео,
 * поставить публикацию, узнать статус, отменить или повторить задание.
 *
 * Переменные окружения:
 *   MARKVISION_API_KEY — ключ из «Публикации → Настройки → API-ключи» (mv_live_…)
 *   MARKVISION_API_URL — адрес API (https://<проект>.supabase.co/functions/v1/api/v1)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ApiError, MarkVisionClient } from "./client.js";

const apiKey = process.env.MARKVISION_API_KEY?.trim();
const apiUrl = process.env.MARKVISION_API_URL?.trim();
if (!apiKey) {
  process.stderr.write("MARKVISION_API_KEY не задан — создайте ключ в MarkVision: Публикации → Настройки → API-ключи\n");
  process.exit(1);
}
if (!apiUrl) {
  process.stderr.write("MARKVISION_API_URL не задан — например https://<проект>.supabase.co/functions/v1/api/v1\n");
  process.exit(1);
}

const client = new MarkVisionClient({ apiKey, baseUrl: apiUrl });
const server = new McpServer({ name: "markvision", version: "0.1.0" });

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function fail(e: unknown): ToolResult {
  const message = e instanceof ApiError ? `${e.message} (HTTP ${e.status})` : e instanceof Error ? e.message : String(e);
  return { content: [{ type: "text", text: `Ошибка: ${message}` }], isError: true };
}

async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try { return ok(await fn()); } catch (e) { return fail(e); }
}

const uuid = z.string().uuid();
const targetShape = {
  group_id: uuid.optional().describe("Группа аккаунтов (из markvision_list_groups). Без группы и account_ids — все активные аккаунты проекта."),
  account_ids: z.array(uuid).optional().describe("Явный список аккаунтов (из markvision_list_accounts)."),
  mode: z.enum(["now", "drip", "daily"]).optional().describe("now — все сразу; drip — по слотам с интервалом (по умолчанию); daily — по одному в день."),
  start_at: z.string().optional().describe("Когда начинать, ISO 8601. По умолчанию — сейчас."),
  per_hour: z.number().positive().optional().describe("Темп для drip: публикаций в час."),
};

server.registerTool("markvision_whoami", {
  title: "Проект и права ключа",
  description: "Показывает, к какому проекту MarkVision привязан ключ и какие права у него есть.",
  inputSchema: {},
}, () => run(() => client.me()));

server.registerTool("markvision_list_accounts", {
  title: "Аккаунты площадок",
  description: "Подключённые аккаунты Instagram / TikTok / YouTube / Threads проекта: id, площадка, имя, статус, здоровье.",
  inputSchema: {},
}, () => run(() => client.accounts()));

server.registerTool("markvision_list_groups", {
  title: "Группы аккаунтов",
  description: "Группы аккаунтов проекта (id, название, площадка, состав). Группу удобно передавать в group_id при публикации.",
  inputSchema: {},
}, () => run(() => client.groups()));

server.registerTool("markvision_upload_media", {
  title: "Загрузить видео",
  description: "Загружает видеофайл с диска в хранилище MarkVision и возвращает file_url для markvision_create_publication. До 2 ГБ; mp4/mov.",
  inputSchema: { file_path: z.string().describe("Абсолютный путь к файлу на этой машине.") },
}, ({ file_path }) => run(() => client.uploadFile(file_path)));

server.registerTool("markvision_create_publication", {
  title: "Поставить публикацию",
  description:
    "Принимает готовое видео по ссылке и ставит задания публикации по аккаунтам. " +
    "Если не передать ни group_id, ни account_ids — задания не создаются, только принимается видео (потом markvision_create_jobs). " +
    "Возвращает publication id и созданные задания с временем.",
  inputSchema: {
    file_url: z.string().url().describe("https-ссылка на видео (из markvision_upload_media или любая публичная)."),
    title: z.string().max(200).optional(),
    caption: z.string().optional().describe("Подпись к посту. Хэштеги передаются отдельно."),
    hashtags: z.array(z.string()).optional().describe("Без решётки или с ней — всё равно."),
    caption_variants: z.array(z.string()).optional().describe("Варианты подписи — раздаются аккаунтам по кругу."),
    duration_sec: z.number().positive().optional(),
    ...targetShape,
  },
}, (input) => run(() => client.createPublication(input)));

server.registerTool("markvision_create_jobs", {
  title: "Задания на принятое видео",
  description: "Ставит задания публикации на видео, которое уже принято (publication_id из markvision_create_publication или списка).",
  inputSchema: { publication_id: uuid, ...targetShape },
}, ({ publication_id, ...target }) => run(() => client.createJobs(publication_id, target)));

server.registerTool("markvision_list_publications", {
  title: "Последние публикации",
  description: "Последние принятые видео проекта и сводка заданий по статусам.",
  inputSchema: { limit: z.number().int().min(1).max(100).optional() },
}, ({ limit }) => run(() => client.publications(limit ?? 20)));

server.registerTool("markvision_get_publication", {
  title: "Статус публикации",
  description: "Видео и все его задания по аккаунтам: статус, время, ссылка на пост, текст ошибки.",
  inputSchema: { publication_id: uuid },
}, ({ publication_id }) => run(() => client.publication(publication_id)));

server.registerTool("markvision_cancel_job", {
  title: "Отменить задание",
  description: "Отменяет задание, которое ещё не ушло на площадку (pending / scheduled / manual_review).",
  inputSchema: { job_id: uuid },
}, ({ job_id }) => run(() => client.cancelJob(job_id)));

server.registerTool("markvision_retry_job", {
  title: "Повторить задание",
  description: "Ставит упавшее или остановленное задание обратно в очередь.",
  inputSchema: { job_id: uuid },
}, ({ job_id }) => run(() => client.retryJob(job_id)));

/* ───────────── управление: аккаунты, группы, настройки ───────────── */

const timeHHMM = z.string().regex(/^\d{2}:\d{2}$/, "формат HH:MM");
const platform = z.enum(["instagram", "tiktok", "youtube", "threads"]);

/** Ключи со значением undefined в тело не попадают. */
function compact(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

server.registerTool("markvision_update_account", {
  title: "Изменить аккаунт",
  description:
    "Правит настройки аккаунта площадки: включить/выключить публикации, дневной лимит, группа, персона, " +
    "часовой пояс и окно публикаций, разгон, статус (active вернёт в строй, disabled выключит).",
  inputSchema: {
    account_id: uuid,
    publish_enabled: z.boolean().optional(),
    daily_limit: z.number().int().min(0).max(200).optional(),
    status: z.enum(["active", "disabled", "limited"]).optional(),
    group_id: uuid.nullable().optional().describe("null — убрать из группы"),
    persona_id: uuid.nullable().optional(),
    timezone: z.string().nullable().optional().describe("IANA, например Asia/Almaty"),
    window_start: timeHHMM.nullable().optional(),
    window_end: timeHHMM.nullable().optional(),
    ramp_enabled: z.boolean().optional(),
    ramp_restart: z.literal(true).optional().describe("Начать разгон частоты заново."),
    notes: z.string().optional(),
  },
}, ({ account_id, ...patch }) => run(() => client.updateAccount(account_id, compact(patch))));

server.registerTool("markvision_health_check", {
  title: "Проверить здоровье аккаунтов",
  description: "Живая проверка токенов у площадок: живой ли токен, срок, health_score с причинами. Без account_ids — весь проект.",
  inputSchema: { account_ids: z.array(uuid).optional() },
}, ({ account_ids }) => run(() => client.healthCheck(account_ids)));

const groupShape = {
  name: z.string().min(1).max(120).optional(),
  account_ids: z.array(uuid).optional().describe("Полный состав группы (заменяет прежний)."),
  platform: platform.nullable().optional(),
  publish_strategy: z.enum(["all_at_once", "drip", "daily"]).optional(),
  per_hour: z.number().int().min(1).max(120).optional(),
  persona_id: uuid.nullable().optional(),
  review_mode: z.enum(["review_required", "auto_publish", "paused"]).optional(),
  timezone: z.string().optional(),
  window_start: timeHHMM.optional(),
  window_end: timeHHMM.optional(),
  min_gap_minutes: z.number().int().min(0).max(1440).optional(),
  jitter_minutes: z.number().int().min(0).max(180).optional(),
};

server.registerTool("markvision_create_group", {
  title: "Создать группу аккаунтов",
  description: "Новая группа: название, состав, площадка, стратегия и темп, окно публикаций, режим согласования.",
  inputSchema: { ...groupShape, name: z.string().min(1).max(120) },
}, (input) => run(() => client.createGroup(compact(input))));

server.registerTool("markvision_update_group", {
  title: "Изменить группу",
  description: "Частичная правка группы: переданные поля заменяют текущие, остальные не трогаются.",
  inputSchema: { group_id: uuid, ...groupShape },
}, ({ group_id, ...patch }) => run(() => client.updateGroup(group_id, compact(patch))));

server.registerTool("markvision_delete_group", {
  title: "Удалить группу",
  description: "Удаляет группу аккаунтов. Сами аккаунты остаются, только выходят из группы.",
  inputSchema: { group_id: uuid },
}, ({ group_id }) => run(() => client.deleteGroup(group_id)));

server.registerTool("markvision_get_settings", {
  title: "Настройки проекта",
  description: "Пауза публикаций, режим уведомлений, чат дайджеста, бюджеты и расход.",
  inputSchema: {},
}, () => run(() => client.settings()));

server.registerTool("markvision_update_settings", {
  title: "Изменить настройки проекта",
  description: "paused=true — аварийная пауза всех публикаций проекта (очередь сохраняется). Уведомления, чат дайджеста, бюджеты в $.",
  inputSchema: {
    paused: z.boolean().optional(),
    notify_mode: z.enum(["digest", "each", "silent"]).optional(),
    digest_chat_id: z.string().nullable().optional(),
    daily_usd: z.number().min(0).optional(),
    monthly_usd: z.number().min(0).optional(),
  },
}, (patch) => run(() => client.updateSettings(compact(patch))));

server.registerTool("markvision_list_jobs", {
  title: "Задания очереди",
  description: "Задания публикации проекта, при желании по статусу: pending, processing, published, retry, failed, manual_review, cancelled.",
  inputSchema: {
    status: z.enum(["pending", "processing", "published", "retry", "failed", "manual_review", "cancelled"]).optional(),
    limit: z.number().int().min(1).max(500).optional(),
  },
}, ({ status, limit }) => run(() => client.jobs(status, limit ?? 100)));

server.registerTool("markvision_metrics", {
  title: "Метрики",
  description: "Витрины проекта: публикации, радар идей, видео, группы и аккаунты (охваты, просмотры, здоровье).",
  inputSchema: {},
}, () => run(() => client.metrics()));

const transport = new StdioServerTransport();
await server.connect(transport);
