import assert from "node:assert/strict";
import {
  isOpaqueAssetName,
  isWeakStockQuery,
  pickLibraryAsset,
  scoreAssetAgainstNeed,
} from "../scripts/lib/brollMatch.mjs";

assert.equal(isOpaqueAssetName("IMG_9190.MOV"), true);
assert.equal(isOpaqueAssetName("RPReplay_Final1784535980.MP4"), true);
assert.equal(isOpaqueAssetName("Дизайн без названия.MP4"), true);
assert.equal(isOpaqueAssetName("dashboard-analytics.mp4"), false);

assert.ok(isWeakStockQuery("business"));
assert.ok(isWeakStockQuery("office people"));
assert.equal(isWeakStockQuery("laptop analytics dashboard"), false);

const assets = [
  { id: "1", name: "IMG_9190.MOV" },
  { id: "2", name: "instagram-ads-report.mp4" },
  { id: "3", name: "RPReplay_Final1.MP4" },
];
const used = new Set();
const semantic = pickLibraryAsset(assets, used, "отчёт по рекламе в инстаграм", { minScore: 0.2 });
assert.equal(semantic.asset.id, "2");
assert.equal(semantic.reason, "semantic");
used.add(semantic.asset.id);

const next = pickLibraryAsset(assets, used, "важный тезис без визуала", { minScore: 0.2 });
assert.ok(next.asset);
assert.ok(["opaque-pool", "fallback-pool"].includes(next.reason));

assert.ok(scoreAssetAgainstNeed({ name: "fish-market.mp4" }, "отчёты реклама") < 0.2);

console.log("brollMatch ok");
