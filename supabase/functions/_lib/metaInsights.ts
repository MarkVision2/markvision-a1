// Общая логика чтения Insights API для meta-daily-sync и meta-structure-sync.
// Раньше формулы жили в двух файлах копипастой и успели разъехаться.

export interface MetaAction {
  action_type?: string;
  value?: string | number;
}

/** Заявки: форма, сайт, пиксель. Meta отдаёт одно и то же событие под разными именами. */
export const LEAD_ACTIONS = [
  "lead",
  "leadgen.other",
  "onsite_conversion.lead_grouped",
  "offsite_conversion.fb_pixel_lead",
  "onsite_web_lead",
];

/** Начатые переписки — то же событие, что Meta показывает в «Начало переписки». */
export const MESSAGING_ACTIONS = [
  "onsite_conversion.messaging_conversation_started_7d",
];

export const PURCHASE_ACTIONS = [
  "purchase",
  "offsite_conversion.fb_pixel_purchase",
  "omni_purchase",
];

export function maxAction(actions: MetaAction[] | undefined | null, types: string[]): number {
  if (!Array.isArray(actions)) return 0;
  let max = 0;
  for (const a of actions) {
    if (!types.includes(String(a?.action_type ?? ""))) continue;
    const v = Number(a?.value ?? 0);
    if (Number.isFinite(v) && v > max) max = v;
  }
  return max;
}

export function sumActions(actions: MetaAction[] | undefined | null, types: string[]): number {
  if (!Array.isArray(actions)) return 0;
  let sum = 0;
  for (const a of actions) {
    if (!types.includes(String(a?.action_type ?? ""))) continue;
    const v = Number(a?.value ?? 0);
    if (Number.isFinite(v)) sum += v;
  }
  return sum;
}

/**
 * Лиды ОДНОГО объекта — кампании или объявления.
 *
 * Максимум по всем лид-событиям, включая переписки. Складывать «заявки» и
 * «переписки» нельзя: для кампаний с целью «Лиды» и назначением в мессенджер
 * Meta кладёт один и тот же диалог и в `lead` / `onsite_conversion.lead_grouped`,
 * и в `messaging_conversation_started_7d` — прежняя сумма двоила такие лиды.
 *
 * На уровне ОДНОЙ кампании двойственности нет: она ведёт либо в переписку, либо
 * в форму/на сайт, поэтому максимум = реальное число результатов. Для кабинета
 * с разными кампаниями складывайте уже посчитанные значения кампаний
 * (`leadsByDateFromCampaignRows`), а не события аккаунта целиком.
 */
export function leadsOfObject(actions: MetaAction[] | undefined | null): number {
  return maxAction(actions, [...LEAD_ACTIONS, ...MESSAGING_ACTIONS]);
}

/** Начатые переписки объекта — отдельной колонкой, для разбора «из чего лиды». */
export function messagesOfObject(actions: MetaAction[] | undefined | null): number {
  return maxAction(actions, MESSAGING_ACTIONS);
}

export function purchasesOfObject(actions: MetaAction[] | undefined | null): number {
  return maxAction(actions, PURCHASE_ACTIONS);
}

export interface DayLeads {
  leads: number;
  messages: number;
}

/**
 * Лиды кабинета по дням = сумма лидов его кампаний за день.
 * Каждая кампания считается по своей логике (см. leadsOfObject), поэтому
 * кабинет с формами И перепиской одновременно считается верно.
 */
export function leadsByDateFromCampaignRows(
  rows: Array<Record<string, unknown>>,
): Map<string, DayLeads> {
  const byDate = new Map<string, DayLeads>();
  for (const row of rows) {
    const date = String(row?.date_start ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const actions = row?.actions as MetaAction[] | undefined;
    const cur = byDate.get(date) ?? { leads: 0, messages: 0 };
    cur.leads += leadsOfObject(actions);
    cur.messages += messagesOfObject(actions);
    byDate.set(date, cur);
  }
  return byDate;
}

/** Поля Insights. inline_link_clicks — клики по ссылке, по ним Ads Manager считает CTR/CPC. */
export const INSIGHT_FIELDS = [
  "date_start",
  "spend",
  "impressions",
  "clicks",
  "inline_link_clicks",
  "actions",
  "action_values",
];

export interface InsightsUrlOptions {
  apiVersion: string;
  actId: string;
  since: string;
  until: string;
  token: string;
  level: "account" | "campaign" | "ad";
  /** Доп. поля к INSIGHT_FIELDS — например campaign_id. */
  extraFields?: string[];
  limit?: number;
}

/**
 * URL запроса Insights.
 *
 * use_unified_attribution_setting=true — обязателен: без него Graph API считает
 * конверсии в своём окне атрибуции, а Ads Manager — в окне объявления, и цифры
 * в интерфейсе не сходятся с тем, что видит пользователь в Meta.
 */
export function buildInsightsUrl(o: InsightsUrlOptions): string {
  const fields = [...INSIGHT_FIELDS, ...(o.extraFields ?? [])].join(",");
  const params = new URLSearchParams({
    fields,
    time_range: JSON.stringify({ since: o.since, until: o.until }),
    time_increment: "1",
    level: o.level,
    use_unified_attribution_setting: "true",
    limit: String(o.limit ?? 500),
    access_token: o.token,
  });
  return `https://graph.facebook.com/${o.apiVersion}/${o.actId}/insights?${params}`;
}

/**
 * Все страницы ответа. limit=500 хватает на месяц по аккаунту, но не на месяц
 * по кампаниям — без пагинации данные молча обрезались.
 */
export async function fetchAllInsightPages(
  firstUrl: string,
  fetcher: (url: string) => Promise<Response>,
  maxPages = 25,
): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];
  let url: string | null = firstUrl;
  for (let page = 0; page < maxPages && url; page++) {
    const res = await fetcher(url);
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
    rows.push(...((json?.data ?? []) as Array<Record<string, unknown>>));
    url = (json?.paging?.next as string | undefined) ?? null;
  }
  return rows;
}

/** Колонки, добавленные миграцией 20260903120000. */
export const NEW_INSIGHT_COLUMNS = ["link_clicks", "messages"];

/**
 * PostgREST на не применённой миграции отвечает «Could not find the 'link_clicks'
 * column … in the schema cache». Отличаем это от настоящей ошибки записи, чтобы
 * функция, задеплоенная раньше миграции, не роняла всю синхронизацию.
 */
export function isUnknownColumnError(message: string, columns = NEW_INSIGHT_COLUMNS): boolean {
  if (!/column|schema cache/i.test(message)) return false;
  return columns.some((c) => message.includes(c));
}

/** Те же строки без новых колонок — для повторной записи в старую схему. */
export function withoutColumns<T extends Record<string, unknown>>(
  rows: T[],
  columns = NEW_INSIGHT_COLUMNS,
): Array<Record<string, unknown>> {
  return rows.map((row) => {
    const copy: Record<string, unknown> = { ...row };
    for (const c of columns) delete copy[c];
    return copy;
  });
}
