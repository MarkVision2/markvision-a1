import { supabase } from "@/integrations/supabase/client";
import {
  CDI_SELECT_LEGACY,
  CDI_SELECT_REPORT_LEGACY,
  CDI_SELECT_REPORT_WITH_AD_MANUAL,
  CDI_SELECT_WITH_AD_MANUAL,
  cdiMissingAdManualColumns,
} from "@/lib/cdiColumns";

type CdiQuery = ReturnType<typeof supabase.from>;

function applyCdiFilters(
  q: CdiQuery,
  opts: {
    externalIds?: string[];
    since: string;
    until: string;
    projectId?: string | null;
    order?: boolean;
  },
) {
  let query = q.gte("date", opts.since).lte("date", opts.until);
  if (opts.externalIds?.length) {
    query = query.in("external_id", opts.externalIds);
  }
  if (opts.projectId) query = query.eq("project_id", opts.projectId);
  if (opts.order) query = query.order("date", { ascending: true });
  return query;
}

/** Чтение CDI с fallback, если миграция manual_spend/leads ещё не применена. */
export async function fetchCdiRows<T extends Record<string, unknown>>(
  select: string,
  opts: {
    externalIds?: string[];
    since: string;
    until: string;
    projectId?: string | null;
    order?: boolean;
  },
): Promise<T[]> {
  const run = async (cols: string) => {
    const q = applyCdiFilters(
      supabase.from("cabinet_daily_insights").select(cols) as CdiQuery,
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
