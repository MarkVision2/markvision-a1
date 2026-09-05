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
const server = new McpServer({ name: "markvision", version: "0.4.0" });

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

server.registerTool("markvision_get_job", {
  title: "Трасса задания",
  description:
    "Одно задание публикации целиком: статус, верификация (verified / unverified / skipped), класс ошибки, " +
    "шаги воркера по времени (JOB_CLAIMED → AUTH_OK → MEDIA_CREATED → VERIFIED → SUCCESS), сырые записи журнала и снятые метрики.",
  inputSchema: { job_id: uuid },
}, ({ job_id }) => run(() => client.job(job_id)));

server.registerTool("markvision_content_analytics", {
  title: "Аналитика контента",
  description:
    "Каждое видео во всех аккаунтах: публикаций, сумма и среднее просмотров, реакции, лучший аккаунт, Performance Score 0–100 " +
    "и is_winner (верхние 10 % проекта). winners=true — только победители. Основа для решений «что масштабировать».",
  inputSchema: { limit: z.number().int().min(1).max(200).optional(), winners: z.boolean().optional() },
}, ({ limit, winners }) => run(() => client.contentAnalytics({ limit, winners })));

server.registerTool("markvision_content_analytics_item", {
  title: "Аналитика одного видео",
  description: "Сводка по видео и все его публикации по аккаунтам с последней контрольной точкой метрик и score.",
  inputSchema: { publication_id: uuid.describe("id видео (publication id из markvision_list_publications)") },
}, ({ publication_id }) => run(() => client.contentAnalyticsItem(publication_id)));

server.registerTool("markvision_account_analytics", {
  title: "Аналитика аккаунта",
  description: "Витрина аккаунта: посты, охват, ER, подписчики, здоровье с причинами — и последние публикации с метриками.",
  inputSchema: { account_id: uuid },
}, ({ account_id }) => run(() => client.accountAnalytics(account_id)));

server.registerTool("markvision_notifications", {
  title: "Уведомления проекта",
  description: "Центр уведомлений: reconnect аккаунтов, упавшие и неподтверждённые публикации, ручной разбор. unread=true — только непрочитанные.",
  inputSchema: { limit: z.number().int().min(1).max(200).optional(), unread: z.boolean().optional() },
}, ({ limit, unread }) => run(() => client.notifications({ limit, unread })));

server.registerTool("markvision_notification_read", {
  title: "Отметить уведомление прочитанным",
  description: "Снимает уведомление из непрочитанных.",
  inputSchema: { notification_id: uuid },
}, ({ notification_id }) => run(() => client.readNotification(notification_id)));

server.registerTool("markvision_list_campaigns", {
  title: "Кампании",
  description: "Кампании проекта с метриками: статус, период, постов в день, очередь контента, заданий/опубликовано/ошибок, просмотры.",
  inputSchema: {},
}, () => run(() => client.campaigns()));

server.registerTool("markvision_get_campaign", {
  title: "Кампания целиком",
  description: "Кампания, её очередь контента (queued / planned / skipped) и задания по аккаунтам.",
  inputSchema: { campaign_id: uuid },
}, ({ campaign_id }) => run(() => client.campaign(campaign_id)));

const campaignShape = {
  name: z.string().min(1).max(120).optional(),
  objective: z.string().max(1000).optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD, по умолчанию сегодня"),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  timezone: z.string().optional().describe("IANA, по умолчанию пояс группы / Asia/Almaty"),
  group_id: uuid.nullable().optional().describe("Группа аккаунтов (из markvision_list_groups)."),
  account_ids: z.array(uuid).optional().describe("Явный список аккаунтов (пересекается с группой, если задана)."),
  posts_per_day: z.number().int().min(1).max(24).optional(),
  slot_times: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).optional().describe("Времена публикаций HH:MM; пусто — равномерно 10:00–19:00."),
  weekdays: z.array(z.number().int().min(1).max(7)).optional().describe("Дни недели 1..7 (пн..вс)."),
  mode: z.enum(["drip", "now"]).optional().describe("drip — разнести аккаунты по слотам планировщика (по умолчанию); now — все в момент слота."),
  distribution: z.enum(["fanout", "spread"]).optional().describe("fanout — каждое видео во все аккаунты (по умолчанию); spread — каждое видео в один аккаунт по кругу."),
};

server.registerTool("markvision_create_campaign", {
  title: "Создать кампанию",
  description:
    "Создаёт кампанию (черновик). Дальше: markvision_campaign_add_content → markvision_campaign_action start. " +
    "Планировщик сам создаёт задания на сегодня и завтра каждый час по правилу (постов в день × времена × дни недели).",
  inputSchema: { ...campaignShape, name: z.string().min(1).max(120) },
}, (input) => run(() => client.createCampaign(input)));

server.registerTool("markvision_update_campaign", {
  title: "Изменить кампанию",
  description: "Частичная правка правил кампании (период, аккаунты, постов в день, времена, режим).",
  inputSchema: { campaign_id: uuid, ...campaignShape },
}, ({ campaign_id, ...patch }) => run(() => client.updateCampaign(campaign_id, patch)));

server.registerTool("markvision_campaign_add_content", {
  title: "Добавить контент в кампанию",
  description: "Ставит видео (publication id из markvision_list_publications / markvision_create_publication) в очередь кампании.",
  inputSchema: { campaign_id: uuid, video_ids: z.array(uuid).min(1) },
}, ({ campaign_id, video_ids }) => run(() => client.campaignAddItems(campaign_id, video_ids)));

server.registerTool("markvision_campaign_remove_content", {
  title: "Убрать контент из кампании",
  description: "Снимает ещё не запланированные видео из очереди кампании.",
  inputSchema: { campaign_id: uuid, video_ids: z.array(uuid).min(1) },
}, ({ campaign_id, video_ids }) => run(() => client.campaignRemoveItems(campaign_id, video_ids)));

server.registerTool("markvision_campaign_action", {
  title: "Запустить / остановить кампанию",
  description: "start — активировать и сразу спланировать сегодня и завтра; pause; complete; archive; plan — спланировать ближайшие дни сейчас.",
  inputSchema: { campaign_id: uuid, action: z.enum(["start", "pause", "complete", "archive", "plan"]) },
}, ({ campaign_id, action }) => run(() => client.campaignAction(campaign_id, action)));

server.registerTool("markvision_list_webhooks", {
  title: "Вебхуки проекта",
  description: "Подписки на события (publication.published / failed / needs_human / unverified, account.reconnect_required, campaign.completed, report.daily).",
  inputSchema: {},
}, () => run(() => client.webhooks()));

server.registerTool("markvision_create_webhook", {
  title: "Создать вебхук",
  description: "Подписка на события: https-адрес и список событий (или [\"*\"]). Секрет для проверки подписи HMAC возвращается один раз.",
  inputSchema: { name: z.string().min(1).max(80), url: z.string().url(), events: z.array(z.string()).optional() },
}, (input) => run(() => client.createWebhook(input)));

server.registerTool("markvision_webhook_deliveries", {
  title: "Доставки вебхука",
  description: "Последние доставки: событие, статус (pending / retry / delivered / failed), код ответа, ошибка.",
  inputSchema: { webhook_id: uuid },
}, ({ webhook_id }) => run(() => client.webhookDeliveries(webhook_id)));

server.registerTool("markvision_daily_report", {
  title: "Отчёт за сутки",
  description: "Сводка проекта за последние 24 часа: аккаунты, запланировано / опубликовано / ошибок, успешность, просмотры за 7 дней, лучший контент.",
  inputSchema: {},
}, () => run(() => client.dailyReport()));

server.registerTool("markvision_list_members", {
  title: "Участники проекта и роли",
  description: "Кто имеет доступ к проекту и с какой ролью (owner / admin / manager / content_manager / operator / viewer). Роли меняются в интерфейсе владельцем или администратором.",
  inputSchema: {},
}, () => run(() => client.members()));

const stepSchema = z.object({
  action: z.enum(["ACCOUNT_HEALTH_CHECK", "TOKEN_CHECK", "METRICS_SYNC"]),
  offset_minutes: z.number().int().describe("Минуты относительно публикации: отрицательные — до (проверки), положительные — после (метрики)."),
});

server.registerTool("markvision_list_routines", {
  title: "Рутины",
  description: "Рутины проекта (шаги вокруг публикации: проверка аккаунта до, метрики после) и кому они назначены (группы, аккаунты). is_default — для всех без своей рутины.",
  inputSchema: {},
}, () => run(() => client.routines()));

server.registerTool("markvision_create_routine", {
  title: "Создать рутину",
  description: "Например IG_STANDARD: ACCOUNT_HEALTH_CHECK −15 мин, METRICS_SYNC +20 мин, +240 мин, +1440 мин. Затем markvision_assign_routine.",
  inputSchema: { name: z.string().min(1).max(80), description: z.string().max(1000).optional(), steps: z.array(stepSchema).min(1).max(20), is_default: z.boolean().optional() },
}, (input) => run(() => client.createRoutine(input)));

server.registerTool("markvision_update_routine", {
  title: "Изменить рутину",
  description: "Частичная правка: имя, описание, шаги (список целиком), флаг по умолчанию.",
  inputSchema: { routine_id: uuid, name: z.string().min(1).max(80).optional(), description: z.string().max(1000).optional(), steps: z.array(stepSchema).max(20).optional(), is_default: z.boolean().optional() },
}, ({ routine_id, ...patch }) => run(() => client.updateRoutine(routine_id, patch)));

server.registerTool("markvision_assign_routine", {
  title: "Назначить рутину",
  description: "Рутина → группам аккаунтов и/или отдельным аккаунтам проекта.",
  inputSchema: { routine_id: uuid, group_ids: z.array(uuid).optional(), account_ids: z.array(uuid).optional() },
}, ({ routine_id, ...target }) => run(() => client.assignRoutine(routine_id, target)));

server.registerTool("markvision_list_tasks", {
  title: "Задачи рутин",
  description: "Очередь задач рутин: проверки аккаунтов до публикации и снятия метрик после — статус pending / running / done / failed / skipped.",
  inputSchema: { status: z.enum(["pending", "running", "done", "failed", "skipped"]).optional(), limit: z.number().int().min(1).max(500).optional() },
}, ({ status, limit }) => run(() => client.tasks(status, limit ?? 100)));

const transport = new StdioServerTransport();
await server.connect(transport);
