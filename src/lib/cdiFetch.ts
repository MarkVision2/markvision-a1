import { supabase } from "@/integrations/supabase/client";
import {
  CDI_SELECT_LEGACY,
  CDI_SELECT_REPORT_LEGACY,
  CDI_SELECT_REPORT_WITH_AD_MANUAL,
  CDI_SELECT_WITH_AD_MANUAL,
  cdiMissingAdManualColumns,
} from "@/lib/cdiColumns";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CdiFilter = any;

function applyCdiFilters(
  q: CdiFilter,
  opts: {
    externalIds?: string[];
    cabinetIds?: string[];
    since: string;
    until: string;
    projectId?: string | null;
    order?: boolean;
  },
): CdiFilter {
  let query = q.gte("date", opts.since).lte("date", opts.until);
  // cabinet_id надёжнее external_id: один act_ может быть у разных проектов,
  // а external_id в ad_cabinets иногда расходится с CDI после миграции.
  if (opts.cabinetIds?.length) {
    query = query.in("cabinet_id", opts.cabinetIds);
  } else if (opts.externalIds?.length) {
    query = query.in("external_id", opts.externalIds);
  }
  if (opts.projectId) {
    query = query.or(`project_id.eq.${opts.projectId},project_id.is.null`);
  }
  if (opts.order) query = query.order("date", { ascending: true });
  return query;
}

/** Чтение CDI с fallback, если миграция manual_spend/leads ещё не применена. */
export async function fetchCdiRows<T>(
  select: string,
  opts: {
    externalIds?: string[];
    cabinetIds?: string[];
    since: string;
    until: string;
    projectId?: string | null;
    order?: boolean;
  },
): Promise<T[]> {
  const run = async (cols: string) => {
    const q = applyCdiFilters(
      supabase.from("cabinet_daily_insights").select(cols) as CdiFilter,
      opts,
    );
    return q;
  };

  const full = await run(select);
  if (!full.error) return (full.data ?? []) as T[];

  if (cdiMissingAdManualColumns(full.error.message)) {
    const legacySelect = select.includes("cabinet_id")
      ? CDI_SELECT_REPORT_LEGACY
      : CDI_SELECT_LEGACY;
    const legacy = await run(legacySelect);
    if (legacy.error) throw new Error(legacy.error.message);
    return (legacy.data ?? []) as T[];
  }

  throw new Error(full.error.message);
}

export { CDI_SELECT_WITH_AD_MANUAL, CDI_SELECT_REPORT_WITH_AD_MANUAL };
