(function (global) {
  function mulberry32(seed) {
    return function () {
      let t = (seed += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function weightSensitivity(rows, metadata, options, repetitions = 500) {
    const rng = mulberry32(20260726);
    const counts = new Map();
    const models = [...new Set(rows.map((r) => r.model))];
    models.forEach((m) => counts.set(m, 0));
    for (let i = 0; i < repetitions; i += 1) {
      const jitter = (v) => Math.max(0, v * (0.8 + rng() * 0.4));
      const trial = {
        ...options,
        pixelWeight: jitter(options.pixelWeight ?? 1),
        thinWeight: jitter(options.thinWeight ?? 0),
        structureWeight: jitter(options.structureWeight ?? 0),
        deploymentWeight: jitter(options.deploymentWeight ?? 0),
      };
      const result = global.RankingScoring.scoreModels(rows, metadata, trial).rows;
      const top = result.find((r) => r.finalScore !== null);
      if (top) counts.set(top.model, (counts.get(top.model) || 0) + 1);
    }
    return [...counts.entries()].map(([model, count]) => ({ model, frequency: count / repetitions }));
  }

  function bootstrapStatus(rows) {
    const datasets = new Set(rows.map((r) => r.dataset));
    const images = new Set(rows.map((r) => `${r.dataset}||${r.image_id}`));
    if (datasets.size < 2 || images.size < 10) {
      return { enabled: false, message: "Bootstrap disabled: image-level data are insufficient." };
    }
    return { enabled: true, message: "Image-level data available; lightweight browser bootstrap can be added for deeper review." };
  }

  global.RankingBootstrap = { weightSensitivity, bootstrapStatus };
})(typeof window !== "undefined" ? window : globalThis);
