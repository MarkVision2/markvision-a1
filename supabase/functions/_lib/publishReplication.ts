/**
 * Автопилот победителей (Phase 5): ролик, попавший в верхние 10 % проекта
 * (publish_content_metrics.is_winner), размножается вариантами по группам
 * аккаунтов, где он ещё не выходил, через конвейер контента (варианты темы
 * с персоной группы). Дальше — обычные ворота: согласование ролика конвейера
 * (или доверенная группа auto_publish), политика AI, раскладка по слотам.
 *
 * Чистая часть (выбор групп) — без Deno и Supabase, покрыта vitest
 * (src/test/publishReplication.test.ts). Сетевая часть (replicateContent,
 * runWinnerReplication) зовётся из publish-accounts и publish-monitor.
 */

/** Минимум измеренных публикаций, чтобы победа считалась не случайной. */
export const MIN_MEASURED_FOR_REPLICATION = 3;
/** Победителей за один проход автопилота — чтобы конвейер не захлебнулся. */
export const MAX_WINNERS_PER_RUN = 3;
/** Групп на одного победителя за проход. */
export const MAX_GROUPS_PER_WINNER = 10;

export interface ReplicationGroup {
  id: string;
  name: string;
  account_ids: string[] | null;
  review_mode: string | null;
}

export interface ReplicationCandidateInput {
  groups: ReplicationGroup[];
  /** Аккаунты, где ролик уже публиковался (любой статус кроме cancelled). */
  publishedAccountIds: string[];
  /** Группы, под которые у корневой темы уже есть варианты. */
  variantGroupIds: string[];
  /** Группы, уже отмеченные в publish_replications для этого ролика. */
  replicatedGroupIds: string[];
  /** Явный список групп (ручной запуск) — сужает выбор. */
  onlyGroupIds?: string[] | null;
  max?: number;
}

export interface ReplicationPick {
  targets: ReplicationGroup[];
  skipped: { group_id: string; name: string; reason: string }[];
}

/** Куда размножать: группа не на паузе, ролик там не выходил, варианта и записи ещё нет. */
export function pickReplicationTargets(input: ReplicationCandidateInput): ReplicationPick {
  const published = new Set(input.publishedAccountIds);
  const hasVariant = new Set(input.variantGroupIds);
  const done = new Set(input.replicatedGroupIds);
  const only = input.onlyGroupIds?.length ? new Set(input.onlyGroupIds) : null;
  const max = Math.max(1, input.max ?? MAX_GROUPS_PER_WINNER);

  const targets: ReplicationGroup[] = [];
  const skipped: ReplicationPick["skipped"] = [];
  for (const g of input.groups) {
    if (only && !only.has(g.id)) continue;
    const skip = (reason: string) => skipped.push({ group_id: g.id, name: g.name, reason });
    if (done.has(g.id)) { skip("уже размножено"); continue; }
    if (hasVariant.has(g.id)) { skip("у темы уже есть вариант для этой группы"); continue; }
    if (g.review_mode === "paused") { skip("группа на паузе"); continue; }
    const accounts = g.account_ids ?? [];
    if (!accounts.length) { skip("в группе нет аккаунтов"); continue; }
    if (accounts.some((a) => published.has(a))) { skip("ролик уже выходил в этой группе"); continue; }
    if (targets.length >= max) { skip(`лимит ${max} групп за проход`); continue; }
    targets.push(g);
  }
  return { targets, skipped };
}

export interface WinnerRow {
  content_id: string;
  title: string | null;
  score: number | null;
  publications_measured: number;
  is_winner: boolean;
}

/** Победители, достойные размножения: is_winner и достаточно измерений; лучшие по score первыми. */
export function pickWinners(rows: WinnerRow[], opts: { minMeasured?: number; max?: number } = {}): WinnerRow[] {
  const minMeasured = opts.minMeasured ?? MIN_MEASURED_FOR_REPLICATION;
  const max = Math.max(1, opts.max ?? MAX_WINNERS_PER_RUN);
  return rows
    .filter((r) => r.is_winner && r.publications_measured >= minMeasured && r.score != null)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, max);
}

/* ───────────── сетевая часть (Supabase + content-pipeline) ───────────── */

// deno-lint-ignore no-explicit-any
type Admin = { from: (table: string) => any };

export interface ReplicateResult {
  content_id: string;
  item_id: string | null;
  created: { group_id: string; group_name: string; child_item_id: string | null }[];
  skipped: { group_id: string; name: string; reason: string }[];
  error?: string;
}

/**
 * Размножить один ролик: найти его тему в контент-плане (content_plan_items.publish_video_id),
 * подняться к корню, выбрать группы, создать варианты через content-pipeline (ключ
 * автоматизации), записать publish_replications. Ролик без темы (загружен руками или по
 * API) размножить нельзя — конвейеру нечего генерировать.
 */
export async function replicateContent(
  admin: Admin,
  opts: { projectId: string; contentId: string; groupIds?: string[] | null; createdBy: "autopilot" | "api" | "ui"; supabaseUrl: string; automationKey: string; fetchFn?: typeof fetch },
): Promise<ReplicateResult> {
  const { projectId, contentId } = opts;
  const result: ReplicateResult = { content_id: contentId, item_id: null, created: [], skipped: [] };

  const { data: itemRow } = await admin.from("content_plan_items").select("id, parent_item_id")
    .eq("project_id", projectId).eq("publish_video_id", contentId).maybeSingle();
  const item = itemRow as { id: string; parent_item_id: string | null } | null;
  if (!item) return { ...result, error: "у ролика нет темы в контент-плане — размножать нечем (загружен не через конвейер)" };
  const rootId = item.parent_item_id ?? item.id;
  result.item_id = rootId;

  const [{ data: groups }, { data: jobs }, { data: children }, { data: done }] = await Promise.all([
    admin.from("publish_account_groups").select("id, name, account_ids, review_mode").eq("project_id", projectId).order("name"),
    admin.from("publish_jobs").select("account_id").eq("video_id", contentId).neq("status", "cancelled"),
    admin.from("content_plan_items").select("target_group_id").eq("parent_item_id", rootId),
    admin.from("publish_replications").select("group_id").eq("content_id", contentId),
  ]);
  const pick = pickReplicationTargets({
    groups: (groups ?? []) as ReplicationGroup[],
    publishedAccountIds: ((jobs ?? []) as { account_id: string }[]).map((j) => j.account_id),
    variantGroupIds: ((children ?? []) as { target_group_id: string | null }[]).map((c) => c.target_group_id).filter((x): x is string => Boolean(x)),
    replicatedGroupIds: ((done ?? []) as { group_id: string }[]).map((d) => d.group_id),
    onlyGroupIds: opts.groupIds ?? null,
  });
  result.skipped = pick.skipped;
  if (!pick.targets.length) return result;

  const fetchFn = opts.fetchFn ?? fetch;
  const res = await fetchFn(`${opts.supabaseUrl}/functions/v1/content-pipeline/items/${rootId}/variants`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-automation-key": opts.automationKey },
    body: JSON.stringify({ project_id: projectId, group_ids: pick.targets.map((g) => g.id), user_id: null }),
  });
  const body = await res.json().catch(() => ({})) as { created?: { id?: string; target_group_id?: string }[]; skipped?: { group_id: string; reason: string }[]; error?: string };
  if (!res.ok) return { ...result, error: body.error ?? `content-pipeline: HTTP ${res.status}` };

  const childByGroup = new Map((body.created ?? []).map((c) => [c.target_group_id ?? "", c.id ?? null]));
  const failedByGroup = new Map((body.skipped ?? []).map((s) => [s.group_id, s.reason]));
  const rows = pick.targets.map((g) => {
    const child = childByGroup.get(g.id) ?? null;
    const reason = failedByGroup.get(g.id) ?? null;
    if (child) result.created.push({ group_id: g.id, group_name: g.name, child_item_id: child });
    else result.skipped.push({ group_id: g.id, name: g.name, reason: reason ?? "конвейер не создал вариант" });
    return {
      project_id: projectId, content_id: contentId, item_id: rootId, group_id: g.id,
      child_item_id: child, status: child ? "created" : "failed", reason, created_by: opts.createdBy,
    };
  });
  await admin.from("publish_replications").upsert(rows, { onConflict: "content_id,group_id", ignoreDuplicates: true });
  return result;
}
