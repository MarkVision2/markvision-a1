import { supabase } from "@/integrations/supabase/client";
import { FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";

export type MetaSyncKind = "daily" | "structure";

export type MetaSyncCabinetResult = {
  cabinet?: string;
  cabinet_id?: string;
  ok: boolean;
  error?: string;
  days?: number;
  spend?: number;
  leads?: number;
  campaigns?: number;
  creatives?: number;
  campaign_daily?: number;
  creative_daily?: number;
};

export type MetaSyncFunctionResult = {
  kind: MetaSyncKind;
  ok: boolean;
  error?: string;
  since?: string;
  until?: string;
  results: MetaSyncCabinetResult[];
};

export type MetaFullSyncResult = {
  daily: MetaSyncFunctionResult;
  structure: MetaSyncFunctionResult;
};

type SyncBody = {
  since: string;
  until: string;
  cabinet_id?: string;
  /** Только meta_*_daily из Insights API — без перезагрузки 200+ креативов и постеров. */
  insights_only?: boolean;
};

const ADMIN_FORBIDDEN =
  "Синхронизация Meta доступна только пользователям с ролью admin или manager.";

const FUNCTION_NOT_DEPLOYED =
  "Edge Function не задеплоена на Supabase. Проверьте GitHub Actions → Deploy Meta edge functions.";

const ALMATY_TZ = "Asia/Almaty";

function ymdAlmatyParts(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ALMATY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Сегодня по часовому поясу рекламного кабинета (Asia/Almaty). */
export function ymdAlmaty(d = new Date()): string {
  return ymdAlmatyParts(d);
}

/** День события CRM/Meta в Asia/Almaty — как date_start в CDI и Таблице показателей. */
export function ymdAlmatyFromIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return ymdAlmatyParts(d);
}

/** Для ручной синхронизации включаем сегодня, но не будущие даты. */
export function metaSyncUntilForRange(rangeUntilYmd: string): string {
  const today = ymdAlmaty();
  return rangeUntilYmd > today ? today : rangeUntilYmd;
}

async function parseInvokeError(error: FunctionsHttpError): Promise<string> {
  try {
    const ctx = error.context as Response | undefined;
    if (ctx && typeof ctx.json === "function") {
      const body = await ctx.json();
      if (body && typeof body === "object" && "error" in body) {
        return String((body as { error: unknown }).error);
      }
    }
  } catch {
    /* ignore */
  }
  return error.message;
}

function normalizeRelayError(message: string): string {
  const lower = message.toLowerCase();
  if (
    lower.includes("failed to send a request to the edge function")
    || lower.includes("failed to fetch")
    || lower.includes("function not found")
    || lower.includes("404")
  ) {
    return FUNCTION_NOT_DEPLOYED;
  }
  if (lower.includes("forbidden") || lower.includes("403")) {
    return ADMIN_FORBIDDEN;
  }
  return message;
}

async function invokeMetaSync(
  kind: MetaSyncKind,
  body: SyncBody,
): Promise<MetaSyncFunctionResult> {
  const functionName = kind === "daily" ? "meta-daily-sync" : "meta-structure-sync";

  const { data, error } = await supabase.functions.invoke(functionName, { body });

  if (error) {
    let message = error.message;
    if (error instanceof FunctionsHttpError) {
      message = await parseInvokeError(error);
    } else if (error instanceof FunctionsRelayError) {
      message = error.message;
    }
    return {
      kind,
      ok: false,
      error: normalizeRelayError(message),
      results: [],
    };
  }

  const payload = (data ?? {}) as {
    since?: string;
    until?: string;
    results?: MetaSyncCabinetResult[];
    error?: string;
    ok?: boolean;
  };

  if (payload.error && (!payload.results || payload.results.length === 0)) {
    return {
      kind,
      ok: false,
      error: normalizeRelayError(String(payload.error)),
      since: payload.since,
      until: payload.until,
      results: [],
    };
  }

  const results = Array.isArray(payload.results) ? payload.results : [];
  const okCount = results.filter((r) => r.ok).length;

  return {
    kind,
    ok: okCount > 0 || (results.length === 0 && payload.ok !== false && !payload.error),
    since: payload.since ?? body.since,
    until: payload.until ?? body.until,
    results,
  };
}

function buildSyncBody(params: SyncBody): SyncBody {
  return {
    since: params.since,
    until: metaSyncUntilForRange(params.until),
    ...(params.cabinet_id ? { cabinet_id: params.cabinet_id } : {}),
    ...(params.insights_only ? { insights_only: true } : {}),
  };
}

export async function syncMetaDaily(params: SyncBody): Promise<MetaSyncFunctionResult> {
  return invokeMetaSync("daily", buildSyncBody(params));
}

export async function syncMetaFull(params: SyncBody): Promise<MetaFullSyncResult> {
  const body = buildSyncBody(params);
  const structureBody = buildSyncBody(params);

  const [daily, structure] = await Promise.all([
    invokeMetaSync("daily", body),
    invokeMetaSync("structure", structureBody),
  ]);

  return { daily, structure };
}

export type MetaSyncMessages = {
  success?: string;
  error?: string;
  warnings: string[];
};

function summarizeDaily(results: MetaSyncCabinetResult[]): string | null {
  const ok = results.filter((r) => r.ok);
  if (ok.length === 0) return null;
  const days = ok.reduce((s, r) => s + (r.days ?? 0), 0);
  const leads = ok.reduce((s, r) => s + (r.leads ?? 0), 0);
  const spend = ok.reduce((s, r) => s + (r.spend ?? 0), 0);
  return `расходы/лиды: ${ok.length} каб., ${days} дн., ${leads} лидов, ${Math.round(spend).toLocaleString("ru-RU")} ₸`;
}

function summarizeStructure(results: MetaSyncCabinetResult[]): string | null {
  const ok = results.filter((r) => r.ok);
  if (ok.length === 0) return null;
  const adDays = ok.reduce((s, r) => s + (r.creative_daily ?? 0), 0);
  if (adDays > 0) {
    return `по объявлениям: ${ok.length} каб., ${adDays} строк расходов`;
  }
  const campaigns = ok.reduce((s, r) => s + (r.campaigns ?? 0), 0);
  const creatives = ok.reduce((s, r) => s + (r.creatives ?? 0), 0);
  return `кампании/креативы: ${ok.length} каб., ${campaigns} камп., ${creatives} креативов`;
}

function failedCabinetHint(results: MetaSyncCabinetResult[]): string | null {
  const failed = results.filter((r) => !r.ok);
  if (failed.length === 0) return null;
  const first = failed[0];
  const name = first.cabinet ?? "кабинет";
  const detail = first.error ? `: ${first.error}` : "";
  return `${name}${detail}`;
}

/** Сообщения для toast после полной синхронизации Meta. */
export function formatMetaSyncMessages(result: MetaFullSyncResult): MetaSyncMessages {
  const warnings: string[] = [];
  const parts: string[] = [];

  const dailySummary = summarizeDaily(result.daily.results);
  const structureSummary = summarizeStructure(result.structure.results);

  if (dailySummary) parts.push(dailySummary);
  if (structureSummary) parts.push(structureSummary);

  if (result.daily.error) {
    warnings.push(`Расходы/лиды — ${result.daily.error}`);
  } else {
    const hint = failedCabinetHint(result.daily.results);
    if (hint) warnings.push(`Расходы/лиды — ошибка по ${hint}`);
  }

  if (result.structure.error) {
    warnings.push(`Кампании/креативы — ${result.structure.error}`);
  } else {
    const hint = failedCabinetHint(result.structure.results);
    if (hint) warnings.push(`Кампании/креативы — ошибка по ${hint}`);
  }

  const hasCabinets =
    result.daily.results.length > 0 || result.structure.results.length > 0;
  const hasSuccess = !!dailySummary || !!structureSummary;

  if (!hasCabinets && !result.daily.error && !result.structure.error) {
    return {
      error:
        "Нет Meta-кабинетов с Ad Account ID. Добавьте кабинет в разделе «Реклама» и укажите act_…",
      warnings,
    };
  }

  if (hasSuccess) {
    return {
      success: `Синхронизировано: ${parts.join("; ")}`,
      warnings,
    };
  }

  const topError =
    result.daily.error
    ?? result.structure.error
    ?? warnings[0]
    ?? "Meta не вернула данных за выбранный период";

  return { error: topError, warnings };
}
