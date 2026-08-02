const assert = require("assert");
const fs = require("fs");
const path = require("path");
const csv = require("../src/csv.js");
const scoring = require("../src/scoring.js");
global.RankingScoring = scoring;
const bootstrap = require("../src/bootstrap.js");

function row(model, dataset, image, sensitivity, precision, extra = {}) {
  return {
    model,
    dataset,
    image_id: image,
    sensitivity,
    precision,
    f1: scoring.fBeta(precision, sensitivity, 1),
    iou: extra.iou ?? 0.6,
    mcc: extra.mcc ?? 0.7,
    tvs: extra.tvs ?? 0.7,
    cldice: extra.cldice ?? 0.7,
    sf1: extra.sf1 ?? 0.7,
  };
}

function rank(records, overrides = {}) {
  return scoring.scoreModels(records, {
    preference: "Balanced",
    beta: 1,
    eta: 0.8,
    risk: 0,
    weights: { pixel: 1, thin: 0, structure: 0, resource: 0 },
    strictMode: true,
    ...overrides,
  }).rows;
}

// FN/FP preference must respond to beta.
const tradeoff = [
  row("precision_model", "D1", "a", 0.55, 0.95),
  row("sensitivity_model", "D1", "a", 0.95, 0.55),
];
assert.strictEqual(rank(tradeoff, { beta: 0.5 })[0].model, "precision_model");
assert.strictEqual(rank(tradeoff, { beta: 3 })[0].model, "sensitivity_model");

// Risk must reward a stronger worst case.
const riskRows = [
  row("swingy", "D1", "a", 0.95, 0.95),
  row("swingy", "D2", "a", 0.50, 0.50),
  row("steady", "D1", "a", 0.71, 0.71),
  row("steady", "D2", "a", 0.69, 0.69),
];
assert.strictEqual(rank(riskRows, { risk: 0 })[0].model, "swingy");
assert.strictEqual(rank(riskRows, { risk: 1 })[0].model, "steady");

// Thin and structure weights must affect the result.
const thinRows = [
  row("thin_best", "D1", "a", 0.7, 0.7, { tvs: 0.95 }),
  row("pixel_best", "D1", "a", 0.85, 0.85, { tvs: 0.2 }),
];
assert.strictEqual(rank(thinRows, { weights: { pixel: 0, thin: 1, structure: 0 } })[0].model, "thin_best");

const structureRows = [
  row("cldice_best", "D1", "a", 0.7, 0.7, { cldice: 0.95, sf1: 0.4 }),
  row("sf1_best", "D1", "a", 0.7, 0.7, { cldice: 0.4, sf1: 0.95 }),
];
assert.strictEqual(rank(structureRows, { weights: { pixel: 0, thin: 0, structure: 1 }, eta: 0.8 })[0].model, "cldice_best");
assert.strictEqual(rank(structureRows, { weights: { pixel: 0, thin: 0, structure: 1 }, eta: 0.2 })[0].model, "sf1_best");

// Equal dataset weighting must not let a larger dataset dominate.
const equalWeightRows = [
  row("A", "small", "1", 0.8, 0.8),
  row("A", "large", "1", 0.2, 0.2),
  row("A", "large", "2", 0.2, 0.2),
  row("B", "small", "1", 0.49, 0.49),
  row("B", "large", "1", 0.49, 0.49),
  row("B", "large", "2", 0.49, 0.49),
];
assert.strictEqual(rank(equalWeightRows)[0].model, "A");

// Row order must not change ranking and exact ties must stay tied.
assert.deepStrictEqual(rank(equalWeightRows).map((x) => x.model), rank([...equalWeightRows].reverse()).map((x) => x.model));
const tied = rank([row("A", "D1", "1", 0.8, 0.8), row("B", "D1", "1", 0.8, 0.8)]);
assert.strictEqual(tied[0].finalScore, tied[1].finalScore);

// Verify the bundled evidence loads and produces five bounded scores.
const evidencePath = path.join(__dirname, "..", "data", "built", "ranking_evidence_perimage.csv");
const evidence = csv.parseCsv(fs.readFileSync(evidencePath, "utf8")).map(csv.typedEvidenceRow);
assert.strictEqual(evidence.length, 1220);
const real = scoring.scoreModels(evidence, {
  beta: 1,
  eta: 0.8,
  risk: 0.3,
  weights: { pixel: 50, thin: 15, structure: 20, resource: 15 },
  resourceScores: Object.fromEntries(["DCP_1024","FR-UNet","FSG-Net","GAVE","SA-UNetv2"].map((m)=>[m,{score:0.5,completeness:0,status:"test"}])),
  strictMode: true,
});
assert.strictEqual(real.rows.length, 5);
real.rows.forEach((result) => {
  assert.ok(Number.isFinite(result.finalScore));
  assert.ok(result.finalScore >= 0 && result.finalScore <= 100);
  assert.strictEqual(result.coverage, 1);
});

// Lightweight paired bootstrap should return valid frequencies.
const boot = bootstrap.pairedBootstrap(evidence, {
  beta: 1,
  eta: 0.8,
  risk: 0.3,
  weights: { pixel: 50, thin: 15, structure: 20, resource: 15 },
  resourceScores: Object.fromEntries(["DCP_1024","FR-UNet","FSG-Net","GAVE","SA-UNetv2"].map((m)=>[m,{score:0.5,completeness:0,status:"test"}])),
  strictMode: true,
}, 20, 123);
assert.strictEqual(boot.length, 5);
assert.ok(Math.abs(boot.reduce((sum, item) => sum + item.top1Frequency, 0) - 1) < 1e-9);


// Four active weights normalize to 100% and resource preference affects ranking.
const nw = scoring.normalizeWeights({ pixel: 50, thin: 15, structure: 20, resource: 15 });
assert.ok(Math.abs(nw.pixel + nw.thin + nw.structure + nw.resource - 1) < 1e-12);
assert.deepStrictEqual(scoring.RESOURCE_FIELDS, [
  "parameters_m", "gflops", "checkpoint_mb", "peak_allocated_vram_gb",
  "total_training_time_s", "median_epoch_time_s",
]);
const profilesPath = path.join(__dirname, "..", "data", "built", "resource_profiles.csv");
const profiles = csv.parseCsv(fs.readFileSync(profilesPath, "utf8")).map(csv.typedGenericRow);
const measuredResources = scoring.computeResourceScores(profiles, 0.5);
assert.strictEqual(measuredResources["SA-UNetv2"].completeness, 1);
assert.ok(measuredResources["SA-UNetv2"].score > 0.9);
const resourceTrial = scoring.scoreModels([row("cheap", "D1", "a", 0.7, 0.7), row("costly", "D1", "a", 0.7, 0.7)], {
  beta: 1, eta: 0.8, risk: 0, weights: { pixel: 0, thin: 0, structure: 0, resource: 100 }, strictMode: true,
  resourceScores: { cheap: { score: 0.9, completeness: 1, status: "measured" }, costly: { score: 0.3, completeness: 1, status: "measured" } },
}).rows;
assert.strictEqual(resourceTrial[0].model, "cheap");

// The refreshed bundled evidence must reproduce the six Chapter 4 scenario leaders.
const presetCases = [
  ["SA-UNetv2", { beta: 1, risk: 0.3, weights: { pixel: 50, thin: 15, structure: 20, resource: 15 } }],
  ["FSG-Net", { beta: 1, risk: 0, weights: { pixel: 100, thin: 0, structure: 0, resource: 0 } }],
  ["SA-UNetv2", { beta: 2, risk: 0.3, weights: { pixel: 50, thin: 50, structure: 0, resource: 0 } }],
  ["FSG-Net", { beta: 1, risk: 0.3, weights: { pixel: 0, thin: 0, structure: 100, resource: 0 } }],
  ["SA-UNetv2", { beta: 1, risk: 0.7, weights: { pixel: 100, thin: 0, structure: 0, resource: 0 } }],
  ["SA-UNetv2", { beta: 1, risk: 0.3, weights: { pixel: 30, thin: 0, structure: 0, resource: 70 } }],
];
presetCases.forEach(([expected, options]) => {
  const result = scoring.scoreModels(evidence, {
    ...options,
    eta: 0.8,
    resourceScores: measuredResources,
    strictMode: true,
  });
  assert.strictEqual(result.rows[0].model, expected);
});

console.log("scoring tests passed");
