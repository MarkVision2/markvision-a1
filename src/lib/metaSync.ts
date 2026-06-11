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
};

const ADMIN_FORBIDDEN =
  "Синхронизация Meta доступна только пользователям с ролью admin. Обратитесь к администратору проекта.";

const FUNCTION_NOT_DEPLOYED =
  "Edge Function не задеплоена на Supabase. Проверьте GitHub Actions → Deploy Meta edge functions.";

/** Meta отдаёт полные суточные insights с задержкой — не запрашиваем «сегодня». */
export function capMetaSyncUntil(until: string): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const yesterday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return until > yesterday ? yesterday : until;
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

export async function syncMetaFull(params: SyncBody): Promise<MetaFullSyncResult> {
  const body: SyncBody = {
    since: params.since,
    until: capMetaSyncUntil(params.until),
    ...(params.cabinet_id ? { cabinet_id: params.cabinet_id } : {}),
  };

  const [daily, structure] = await Promise.all([
    invokeMetaSync("daily", body),
    invokeMetaSync("structure", body),
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
