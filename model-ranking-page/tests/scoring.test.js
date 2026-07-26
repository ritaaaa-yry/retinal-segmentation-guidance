const assert = require("assert");
const scoring = require("../src/scoring.js");

function metricRow(model, dataset, imageId, sensitivity, precision, extra = {}) {
  return {
    model,
    dataset,
    image_id: imageId,
    sensitivity,
    precision,
    tvs: extra.tvs ?? 0.7,
    cldice: extra.cldice ?? 0.7,
    sf1: extra.sf1 ?? 0.7,
    ...extra,
  };
}

function rank(rows, options = {}, metadata = []) {
  return scoring.scoreModels(rows, metadata, {
    fnfpPreference: "Balanced",
    pixelWeight: 1,
    thinWeight: 0,
    structureWeight: 0,
    deploymentWeight: 0,
    risk: 0,
    beta: 1,
    strictMode: true,
    minPrecision: 0,
    minSensitivity: 0,
    ...options,
  }).rows;
}

const thresholdRows = [
  metricRow("high_precision", "D1", "a", 0.55, 0.95),
  metricRow("high_sensitivity", "D1", "a", 0.95, 0.55),
];
assert.strictEqual(rank(thresholdRows, { fnfpPreference: "Low FP", beta: 0.5 })[0].model, "high_precision");
assert.strictEqual(rank(thresholdRows, { fnfpPreference: "Very low FN", beta: 3 })[0].model, "high_sensitivity");

const riskRows = [
  metricRow("swingy", "D1", "a", 0.95, 0.95),
  metricRow("swingy", "D2", "a", 0.50, 0.50),
  metricRow("steady", "D1", "a", 0.70, 0.70),
  metricRow("steady", "D2", "a", 0.68, 0.68),
];
assert.strictEqual(rank(riskRows, { risk: 0 })[0].model, "swingy");
assert.strictEqual(rank(riskRows, { risk: 1 })[0].model, "steady");

const thinRows = [
  metricRow("thin_better", "D1", "a", 0.70, 0.70, { tvs: 0.95 }),
  metricRow("thin_weaker", "D1", "a", 0.80, 0.80, { tvs: 0.20 }),
];
assert.strictEqual(rank(thinRows, { pixelWeight: 0, thinWeight: 1 })[0].model, "thin_better");

const structureRows = [
  metricRow("centerline_better", "D1", "a", 0.70, 0.70, { cldice: 0.90, sf1: 0.50 }),
  metricRow("sf1_better", "D1", "a", 0.70, 0.70, { cldice: 0.50, sf1: 0.90 }),
];
assert.strictEqual(rank(structureRows, { pixelWeight: 0, structureWeight: 1, eta: 0.8 })[0].model, "centerline_better");
assert.strictEqual(rank(structureRows, { pixelWeight: 0, structureWeight: 1, eta: 0.2 })[0].model, "sf1_better");

const metadata = [{ model: "too_large", params_m: 90 }, { model: "small", params_m: 10 }];
const constrained = rank([
  metricRow("too_large", "D1", "a", 0.90, 0.90),
  metricRow("small", "D1", "a", 0.60, 0.60),
], { constraints: { maxParams: 20 } }, metadata);
assert.strictEqual(constrained[0].model, "small");
assert.strictEqual(constrained.find((row) => row.model === "too_large").feasibility, "Not feasible");

const missingThin = rank([
  metricRow("missing", "D1", "a", 0.90, 0.90, { tvs: "" }),
], { pixelWeight: 0, thinWeight: 1, strictMode: true });
assert.strictEqual(missingThin[0].finalScore, null);

const equalDatasetRows = [
  metricRow("A", "small_dataset", "1", 0.80, 0.80),
  metricRow("A", "large_dataset", "1", 0.20, 0.20),
  metricRow("A", "large_dataset", "2", 0.20, 0.20),
  metricRow("B", "small_dataset", "1", 0.50, 0.50),
  metricRow("B", "large_dataset", "1", 0.50, 0.50),
  metricRow("B", "large_dataset", "2", 0.50, 0.50),
];
assert.strictEqual(rank(equalDatasetRows)[0].model, "A");

const forward = rank(equalDatasetRows).map((row) => row.model);
const reverse = rank([...equalDatasetRows].reverse()).map((row) => row.model);
assert.deepStrictEqual(forward, reverse);

const tied = rank([
  metricRow("A", "D1", "a", 0.80, 0.80),
  metricRow("B", "D1", "a", 0.80, 0.80),
]);
assert.strictEqual(tied[0].finalScore, tied[1].finalScore);

console.log("scoring tests passed");
