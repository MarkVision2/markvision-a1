/**
 * Инструменты MCP MarkVision — общие для stdio (index.ts) и HTTP (http.ts).
 * createMarkVisionServer(client) регистрирует все инструменты поверх клиента
 * API проекта; ключ и адрес API — снаружи (переменные окружения или Bearer запроса).
 *
 * Чего здесь нет намеренно: подключение/удаление аккаунтов, токены, смена
 * политики AI и согласование удержанных публикаций — это решения человека
 * (docs/MCP.md, раздел Policy).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiError, type MarkVisionClient } from "./client.js";

export const MCP_VERSION = "0.6.0";

export function createMarkVisionServer(client: MarkVisionClient, version: string = MCP_VERSION): McpServer {
  const server = new McpServer({ name: "markvision", version });

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
    description:
      "Подключённые аккаунты Instagram / TikTok / YouTube / Threads проекта: id, площадка, имя, статус, здоровье, лимит, группа. " +
      "Без limit — весь список; с limit — страница по offset и total/has_more. q — поиск по имени/handle.",
    inputSchema: {
      limit: z.number().int().min(1).max(500).optional(),
      offset: z.number().int().min(0).optional(),
      q: z.string().optional(),
      platform: z.enum(["instagram", "tiktok", "youtube", "threads"]).optional(),
      group_id: z.string().optional().describe("uuid группы или none — без группы"),
      status: z.enum(["active", "token_expired", "limited", "error", "disabled"]).optional(),
    },
  }, (opts) => run(() => client.accounts(compact(opts))));

  server.registerTool("markvision_accounts_bulk_update", {
    title: "Массовая правка аккаунтов",
    description:
      "Одна правка на пачку аккаунтов (массовый онбординг): группа, персона, рутина, пояс, окно, лимит, разгон, включение, статус. " +
      "Один UPDATE на сервере; возвращает updated и missing (не из проекта / не найдены).",
    inputSchema: {
      account_ids: z.array(uuid).min(1).max(500),
      publish_enabled: z.boolean().optional(),
      daily_limit: z.number().int().min(1).max(200).optional(),
      status: z.enum(["active", "disabled"]).optional(),
      group_id: z.string().nullable().optional(),
      persona_id: z.string().nullable().optional(),
      routine_id: z.string().nullable().optional(),
      timezone: z.string().nullable().optional(),
      window_start: z.string().nullable().optional().describe("HH:MM"),
      window_end: z.string().nullable().optional().describe("HH:MM"),
      ramp_enabled: z.boolean().optional(),
    },
  }, ({ account_ids, ...patch }) => run(() => client.bulkUpdateAccounts(account_ids, compact(patch))));

  server.registerTool("markvision_calendar", {
    title: "Календарь публикаций",
    description:
      "Задания публикации по аккаунтам за период (до 31 дня): что и когда выходит в каждом аккаунте, статусы, дневные лимиты. " +
      "Основа для вопросов «что запланировано на неделю» и «где свободные слоты».",
    inputSchema: {
      from: z.string().describe("Начало периода, ISO 8601."),
      to: z.string().describe("Конец периода (исключительно), ISO 8601."),
      group_id: uuid.optional(),
      account_ids: z.array(uuid).optional(),
    },
  }, (opts) => run(() => client.calendar(compact(opts) as { from: string; to: string; group_id?: string; account_ids?: string[] })));

  server.registerTool("markvision_list_groups", {
    title: "Группы аккаунтов",
    description: "Группы аккаунтов проекта (id, название, площадка, состав). Группу удобно передавать в group_id при публикации.",
    inputSchema: {},
  }, () => run(() => client.groups()));

  server.registerTool("markvision_upload_media", {
    title: "Загрузить видео",
    description: "Загружает видеофайл с диска в хранилище MarkVision и возвращает file_url для markvision_create_publication. До 2 ГБ; mp4/mov; длительность 3–900 секунд (короче площадки не принимают).",
    inputSchema: { file_path: z.string().describe("Абсолютный путь к файлу на этой машине.") },
  }, ({ file_path }) => run(() => client.uploadFile(file_path)));

  server.registerTool("markvision_create_publication", {
    title: "Поставить публикацию",
    description:
      "Принимает готовое видео по ссылке (mp4/mov, 3–900 секунд, до 1 ГБ) и ставит задания публикации по аккаунтам. " +
      "Если не передать ни group_id, ни account_ids — задания не создаются, только принимается видео (потом markvision_create_jobs). " +
      "Возвращает publication id и созданные задания с временем.",
    inputSchema: {
      file_url: z.string().url().describe("https-ссылка на видео (из markvision_upload_media или любая публичная)."),
      title: z.string().max(200).optional(),
      caption: z.string().optional().describe("Подпись к посту. Хэштеги передаются отдельно."),
      hashtags: z.array(z.string()).optional().describe("Без решётки или с ней — всё равно."),
      caption_variants: z.array(z.string()).optional().describe("Варианты подписи — раздаются аккаунтам по кругу."),
      duration_sec: z.number().min(3).max(900).optional().describe("Длительность в секундах, если известна: 3–900."),
      ...targetShape,
    },
  }, (input) => run(() => client.createPublication(input)));

  server.registerTool("markvision_create_jobs", {
    title: "Задания на принятое видео",
    description: "Ставит задания публикации на видео, которое уже принято (publication_id из markvision_create_publication или списка).",
    inputSchema: { publication_id: uuid, ...targetShape },
  }, ({ publication_id, ...target }) => run(() => client.createJobs(publication_id, target)));

  server.registerTool("markvision_distribute", {
    title: "Разложить пачку по сети",
    description:
      "Пачка контент-завода: каждый принятый ролик уходит ровно в один аккаунт (не копии во все), " +
      "не больше per_day роликов на аккаунт в сутки (по умолчанию 3), ролики с одним topic_key — в разные дни и разные аккаунты. " +
      "Без group_id/account_ids берутся все активные аккаунты проекта. Возвращает, какой ролик в какой аккаунт и когда.",
    inputSchema: {
      videos: z.array(z.object({
        id: uuid.describe("publication id из markvision_create_publication (принято без target)."),
        topic_key: z.string().max(200).optional().describe("Ключ темы, чтобы похожие ролики не вышли в один день."),
      })).min(1).max(500),
      batch_id: z.string().max(120).optional().describe("Имя пачки производства для сводной статистики."),
      group_id: uuid.optional(),
      account_ids: z.array(uuid).optional(),
      start_at: z.string().optional().describe("ISO 8601, начало дня 0. По умолчанию сейчас."),
      per_day: z.number().int().min(1).max(20).optional(),
      max_days: z.number().int().min(1).max(90).optional(),
    },
  }, ({ videos, batch_id, ...target }) => run(() => client.distribute(compact({ videos, batch_id, target: compact(target) }))));

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
      status: z.enum(["pending", "processing", "verifying", "published", "retry", "failed", "manual_review", "cancelled"]).optional(),
      limit: z.number().int().min(1).max(500).optional(),
      offset: z.number().int().min(0).optional().describe("Страница: пропустить столько заданий (ответ содержит has_more)."),
      video_id: uuid.optional(),
      account_id: uuid.optional(),
      campaign_id: uuid.optional(),
    },
  }, ({ status, limit, offset, ...extra }) => run(() => client.jobs(status, limit ?? 100, offset ?? 0, compact(extra))));

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

  /* ───────────── Phase 4: аналитик, темы, варианты ───────────── */

  server.registerTool("markvision_content_insights", {
    title: "AI Content Analyst",
    description:
      "Инсайты по публикациям за период (по умолчанию 30 дней): площадки, лучшие часы и дни недели в поясе аккаунта, " +
      "лучшие и худшие аккаунты, классы ошибок, лучший ролик и рекомендации словами. Детерминированный расчёт по publish_publications.",
    inputSchema: { days: z.number().int().min(1).max(365).optional() },
  }, ({ days }) => run(() => client.insights(days ?? 30)));

  server.registerTool("markvision_list_content", {
    title: "Темы контент-плана",
    description:
      "Темы контент-плана проекта (content_plan_items): id, название, статус, родитель (варианты), целевая группа, готовое видео. " +
      "roots=true — только корневые темы; из них делаются варианты по группам.",
    inputSchema: {
      status: z.string().optional(),
      roots: z.boolean().optional(),
      limit: z.number().int().min(1).max(500).optional(),
    },
  }, (opts) => run(() => client.contentItems(compact(opts))));

  server.registerTool("markvision_create_variations", {
    title: "Варианты темы по группам",
    description:
      "Из корневой темы контент-плана делает дочерние темы под указанные группы аккаунтов (с персоной группы) и запускает конвейер. " +
      "Так масштабируется победитель: markvision_content_analytics → тема ролика → варианты по группам. Готовые ролики проходят согласование по политике проекта.",
    inputSchema: { item_id: uuid, group_ids: z.array(uuid).min(1).max(50) },
  }, ({ item_id, group_ids }) => run(() => client.createVariations(item_id, group_ids)));

  return server;
}
