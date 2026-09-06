/**
 * Автопилот победителей (_lib/publishReplication.ts): какие группы получают
 * варианты и какие победители достойны размножения.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_GROUPS_PER_WINNER,
  MAX_WINNERS_PER_RUN,
  pickReplicationTargets,
  pickWinners,
  type ReplicationGroup,
} from "../../supabase/functions/_lib/publishReplication.ts";

const g = (id: string, accounts: string[], review_mode = "review_required"): ReplicationGroup => ({ id, name: `Группа ${id}`, account_ids: accounts, review_mode });

describe("pickReplicationTargets", () => {
  it("берёт группы, где ролик не выходил, без варианта и записи, не на паузе", () => {
    const r = pickReplicationTargets({
      groups: [g("a", ["1", "2"]), g("b", ["3"]), g("c", ["4"], "paused"), g("d", ["5"]), g("e", ["6"]), g("f", [])],
      publishedAccountIds: ["2"],
      variantGroupIds: ["d"],
      replicatedGroupIds: ["e"],
    });
    expect(r.targets.map((t) => t.id)).toEqual(["b"]);
    expect(r.skipped.map((s) => [s.group_id, s.reason])).toEqual([
      ["a", "ролик уже выходил в этой группе"],
      ["c", "группа на паузе"],
      ["d", "у темы уже есть вариант для этой группы"],
      ["e", "уже размножено"],
      ["f", "в группе нет аккаунтов"],
    ]);
  });

  it("ручной список групп сужает выбор, лимит за проход держится", () => {
    const groups = Array.from({ length: MAX_GROUPS_PER_WINNER + 2 }, (_, i) => g(`g${i}`, [`acc${i}`]));
    const all = pickReplicationTargets({ groups, publishedAccountIds: [], variantGroupIds: [], replicatedGroupIds: [] });
    expect(all.targets).toHaveLength(MAX_GROUPS_PER_WINNER);
    expect(all.skipped.filter((s) => /лимит/.test(s.reason))).toHaveLength(2);

    const only = pickReplicationTargets({ groups, publishedAccountIds: [], variantGroupIds: [], replicatedGroupIds: [], onlyGroupIds: ["g3", "g5"] });
    expect(only.targets.map((t) => t.id)).toEqual(["g3", "g5"]);
    expect(only.skipped).toHaveLength(0);
  });
});

describe("pickWinners", () => {
  it("только is_winner с достаточной выборкой, лучшие первыми, не больше лимита", () => {
    const rows = [
      { content_id: "w1", title: "1", score: 70, publications_measured: 3, is_winner: true },
      { content_id: "w2", title: "2", score: 90, publications_measured: 5, is_winner: true },
      { content_id: "thin", title: "3", score: 99, publications_measured: 1, is_winner: true },
      { content_id: "loser", title: "4", score: 10, publications_measured: 9, is_winner: false },
      { content_id: "w3", title: "5", score: 80, publications_measured: 3, is_winner: true },
      { content_id: "w4", title: "6", score: 60, publications_measured: 4, is_winner: true },
    ];
    expect(pickWinners(rows).map((r) => r.content_id)).toEqual(["w2", "w3", "w1"].slice(0, MAX_WINNERS_PER_RUN));
    expect(pickWinners(rows, { minMeasured: 1, max: 10 }).map((r) => r.content_id)).toEqual(["thin", "w2", "w3", "w1", "w4"]);
  });
});
