(function (global) {
  "use strict";

  function mulberry32(seed) {
    return function () {
      let value = (seed += 0x6d2b79f5);
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function quantile(values, probability) {
    const usable = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!usable.length) return null;
    const index = (usable.length - 1) * probability;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return usable[lower];
    return usable[lower] + (index - lower) * (usable[upper] - usable[lower]);
  }

  function buildPairedIndex(records) {
    const byDataset = new Map();
    records.forEach((record) => {
      if (!byDataset.has(record.dataset)) byDataset.set(record.dataset, new Map());
      const byImage = byDataset.get(record.dataset);
      if (!byImage.has(record.image_id)) byImage.set(record.image_id, []);
      byImage.get(record.image_id).push(record);
    });
    return [...byDataset.entries()].map(([dataset, byImage]) => ({
      dataset,
      images: [...byImage.entries()].map(([imageId, imageRecords]) => ({ imageId, records: imageRecords })),
    }));
  }

  function pairedBootstrap(records, options, repetitions = 400, seed = 20260727) {
    const scoring = global.RankingScoring || require("./scoring.js");
    const rng = mulberry32(seed);
    const index = buildPairedIndex(records);
    const modelNames = [...new Set(records.map((record) => record.model))].sort();
    const scores = Object.fromEntries(modelNames.map((model) => [model, []]));
    const top1 = Object.fromEntries(modelNames.map((model) => [model, 0]));
    const top2 = Object.fromEntries(modelNames.map((model) => [model, 0]));
    const rankCounts = Object.fromEntries(modelNames.map((model) => [model, Array(modelNames.length).fill(0)]));

    for (let iteration = 0; iteration < repetitions; iteration += 1) {
      const sampled = [];
      index.forEach(({ images }) => {
        for (let draw = 0; draw < images.length; draw += 1) {
          const selected = images[Math.floor(rng() * images.length)];
          selected.records.forEach((record) => sampled.push(record));
        }
      });
      const trial = scoring.scoreModels(sampled, options).rows.filter((row) => Number.isFinite(row.finalScore));
      trial.forEach((row, rankIndex) => {
        scores[row.model].push(row.finalScore);
        if (rankIndex < rankCounts[row.model].length) rankCounts[row.model][rankIndex] += 1;
      });
      if (trial[0]) top1[trial[0].model] += 1;
      trial.slice(0, 2).forEach((row) => { top2[row.model] += 1; });
    }

    return modelNames.map((model) => ({
      model,
      repetitions,
      scoreMedian: quantile(scores[model], 0.5),
      scoreCiLow: quantile(scores[model], 0.025),
      scoreCiHigh: quantile(scores[model], 0.975),
      top1Frequency: top1[model] / repetitions,
      top2Frequency: top2[model] / repetitions,
      rankFrequencies: rankCounts[model].map((count) => count / repetitions),
    })).sort((a, b) => b.top1Frequency - a.top1Frequency || a.model.localeCompare(b.model));
  }

  function weightSensitivity(records, options, repetitions = 500, seed = 20260728) {
    const scoring = global.RankingScoring || require("./scoring.js");
    const rng = mulberry32(seed);
    const models = [...new Set(records.map((record) => record.model))].sort();
    const top1 = Object.fromEntries(models.map((model) => [model, 0]));
    const base = scoring.normalizeWeights(options.weights || { pixel: 1, thin: 0, structure: 0, resource: 0 });

    for (let iteration = 0; iteration < repetitions; iteration += 1) {
      const jitter = (value) => value <= 0 ? 0 : value * (0.8 + 0.4 * rng());
      const trialOptions = {
        ...options,
        weights: {
          pixel: jitter(base.pixel),
          thin: jitter(base.thin),
          structure: jitter(base.structure),
          resource: jitter(base.resource),
        },
      };
      const trial = scoring.scoreModels(records, trialOptions).rows.find((row) => Number.isFinite(row.finalScore));
      if (trial) top1[trial.model] += 1;
    }

    return models.map((model) => ({ model, top1Frequency: top1[model] / repetitions, repetitions }))
      .sort((a, b) => b.top1Frequency - a.top1Frequency || a.model.localeCompare(b.model));
  }

  const api = { mulberry32, quantile, buildPairedIndex, pairedBootstrap, weightSensitivity };
  global.RankingBootstrap = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
