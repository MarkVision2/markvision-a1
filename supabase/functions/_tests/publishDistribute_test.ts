/**
 * Раскладка пачки по сети: один ролик → один аккаунт, лимит в сутки, разнос тем.
 *   cd supabase/functions && deno test _tests/publishDistribute_test.ts
 */
import { assert, assertEquals } from "jsr:@std/assert@1";
import { DEFAULT_PER_DAY, orderAccounts, planDistribution } from "../_lib/publishDistribute.ts";

const START = new Date("2026-09-08T09:00:00Z");
const accs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `acc-${i + 1}`, health_score: 100 - i }));
const vids = (n: number, topic?: (i: number) => string) =>
  Array.from({ length: n }, (_, i) => ({ id: `v-${i + 1}`, topic_key: topic ? topic(i) : null }));

Deno.test("каждый ролик уходит ровно в один аккаунт, аккаунты по кругу", () => {
  const plan = planDistribution(vids(6), accs(3), { start: START });
  assertEquals(plan.unassigned, []);
  assertEquals(plan.assignments.map((a) => a.account_id), ["acc-1", "acc-2", "acc-3", "acc-1", "acc-2", "acc-3"]);
  assertEquals(new Set(plan.assignments.map((a) => a.video_id)).size, 6);
  assert(plan.assignments.every((a) => a.day === 0));
});

Deno.test("лимит в сутки: 3 на аккаунт по умолчанию, остальное на следующий день", () => {
  assertEquals(DEFAULT_PER_DAY, 3);
  const plan = planDistribution(vids(8), accs(2), { start: START });
  const day0 = plan.assignments.filter((a) => a.day === 0);
  const day1 = plan.assignments.filter((a) => a.day === 1);
  assertEquals(day0.length, 6);
  assertEquals(day1.length, 2);
  assertEquals(day1[0].start_at, "2026-09-09T09:00:00.000Z");
});

Deno.test("одна тема не попадает в один день и в один аккаунт", () => {
  const plan = planDistribution(vids(4, () => "тема-А"), accs(3), { start: START, perDay: 5 });
  const days = plan.assignments.map((a) => a.day);
  assertEquals(new Set(days).size, 4, "четыре ролика одной темы — четыре разных дня");
  const firstThree = plan.assignments.slice(0, 3).map((a) => a.account_id);
  assertEquals(new Set(firstThree).size, 3, "пока есть свободные аккаунты — тема не повторяется в аккаунте");
});

Deno.test("разные темы в один день ставятся, одинаковые — разносятся", () => {
  const plan = planDistribution(vids(4, (i) => (i < 2 ? "A" : "B")), accs(2), { start: START, perDay: 5 });
  const byTopic = (t: string) => plan.assignments.filter((a) => a.video_id === (t === "A" ? "v-1" : "v-3") || a.video_id === (t === "A" ? "v-2" : "v-4"));
  assertEquals(byTopic("A").map((a) => a.day), [0, 1]);
  assertEquals(byTopic("B").map((a) => a.day), [0, 1]);
});

Deno.test("здоровые аккаунты вперёд, план воспроизводим", () => {
  const ordered = orderAccounts([{ id: "b", health_score: 40 }, { id: "a", health_score: 90 }, { id: "c", health_score: 90 }]);
  assertEquals(ordered.map((a) => a.id), ["a", "c", "b"]);
  const p1 = planDistribution(vids(5), ordered, { start: START });
  const p2 = planDistribution(vids(5), ordered, { start: START });
  assertEquals(p1, p2);
});

Deno.test("нет аккаунтов или горизонт исчерпан — ролики в unassigned", () => {
  assertEquals(planDistribution(vids(2), [], { start: START }).unassigned, ["v-1", "v-2"]);
  const plan = planDistribution(vids(5), accs(1), { start: START, perDay: 1, maxDays: 3 });
  assertEquals(plan.assignments.length, 3);
  assertEquals(plan.unassigned, ["v-4", "v-5"]);
});
