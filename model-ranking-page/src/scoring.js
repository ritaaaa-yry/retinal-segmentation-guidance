(function (global) {
  const { toNumber } = global.RankingCsv || require("./csv.js");
  const { equalDatasetSummary } = global.RankingAggregation || require("./aggregation.js");

  function betaFromPreference(pref) {
    return { "Low FP": 0.5, Balanced: 1, "Low FN": 2, "Very low FN": 3 }[pref] || 1;
  }

  function fBeta(precision, sensitivity, beta) {
    if (!Number.isFinite(precision) || !Number.isFinite(sensitivity)) return null;
    const b2 = beta * beta;
    const denom = b2 * precision + sensitivity;
    return denom ? ((1 + b2) * precision * sensitivity) / denom : 0;
  }

  function structureScore(row, eta) {
    const cldice = toNumber(row.cldice);
    const sf1 = toNumber(row.sf1);
    if (!Number.isFinite(cldice) || !Number.isFinite(sf1)) return null;
    return eta * cldice + (1 - eta) * sf1;
  }

  function metadataByModel(metadataRows) {
    const out = new Map();
    (metadataRows || []).forEach((r) => out.set(r.model, r));
    return out;
  }

  function feasible(model, meta, constraints) {
    const reasons = [];
    const insufficient = [];
    if (constraints.requireCode && String(meta.code_available || "").toLowerCase() !== "true") insufficient.push("code availability not confirmed");
    if (constraints.requireWeights && String(meta.weights_available || "").toLowerCase() !== "true") insufficient.push("weights availability not confirmed");
    for (const [field, limit, direction] of [
      ["params_m", constraints.maxParams, "max"],
      ["latency_ms", constraints.maxLatency, "max"],
      ["peak_vram_gb", constraints.maxVram, "max"],
      ["fps", constraints.minFps, "min"],
    ]) {
      if (limit === null || limit === undefined || limit === "") continue;
      const value = toNumber(meta[field]);
      if (!Number.isFinite(value)) insufficient.push(`${field} missing`);
      else if (direction === "max" && value > Number(limit)) reasons.push(`${field} exceeds limit`);
      else if (direction === "min" && value < Number(limit)) reasons.push(`${field} below limit`);
    }
    if (reasons.length) return { status: "Not feasible", reasons };
    if (insufficient.length) return { status: "Insufficient evidence", reasons: insufficient };
    return { status: "Feasible", reasons: [] };
  }

  function scoreModels(rows, metadataRows, options) {
    const beta = options.beta ?? betaFromPreference(options.fnfpPreference);
    const eta = options.eta ?? 0.8;
    const risk = options.risk ?? 0.3;
    const weights = {
      pixel: Number(options.pixelWeight ?? 1),
      thin: Number(options.thinWeight ?? 0),
      structure: Number(options.structureWeight ?? 0),
      deployment: Number(options.deploymentWeight ?? 0),
    };
    const metaMap = metadataByModel(metadataRows);
    const pixel = equalDatasetSummary(rows, (row) => fBeta(toNumber(row.precision), toNumber(row.sensitivity), beta), risk);
    const thin = equalDatasetSummary(rows, (row) => toNumber(row.tvs), risk);
    const structure = equalDatasetSummary(rows, (row) => structureScore(row, eta), risk);
    const byModel = new Map(rows.map((r) => [r.model, { model: r.model }]));
    const lookup = (arr) => Object.fromEntries(arr.map((r) => [r.model, r]));
    const pix = lookup(pixel);
    const th = lookup(thin);
    const st = lookup(structure);

    const scored = [...byModel.keys()].map((model) => {
      const meta = metaMap.get(model) || {};
      const feas = feasible(model, meta, options.constraints || {});
      const active = [];
      if (weights.pixel > 0) active.push(["pixel", weights.pixel, pix[model]?.adjusted]);
      if (weights.thin > 0) active.push(["thin", weights.thin, th[model]?.adjusted]);
      if (weights.structure > 0) active.push(["structure", weights.structure, st[model]?.adjusted]);
      if (weights.deployment > 0) active.push(["deployment", weights.deployment, null]);
      const availableWeight = active.filter(([, , v]) => Number.isFinite(v)).reduce((a, [, w]) => a + w, 0);
      const totalWeight = active.reduce((a, [, w]) => a + w, 0);
      const coverage = totalWeight ? availableWeight / totalWeight : 0;
      const strictMissing = options.strictMode !== false && coverage < 1;
      const numerator = active.reduce((a, [, w, v]) => a + (Number.isFinite(v) ? w * v : 0), 0);
      const denominator = options.strictMode === false ? availableWeight : totalWeight;
      const score = denominator && !strictMissing && feas.status === "Feasible" ? (100 * numerator) / denominator : null;
      return {
        model,
        finalScore: score,
        pixel: pix[model]?.adjusted ?? null,
        thin: th[model]?.adjusted ?? null,
        structure: st[model]?.adjusted ?? null,
        deployment: null,
        coverage,
        feasibility: feas.status,
        reasons: feas.reasons,
        meanPixel: pix[model]?.mean ?? null,
        worstPixel: pix[model]?.worst ?? null,
        missing: active.filter(([, , v]) => !Number.isFinite(v)).map(([name]) => name),
      };
    });
    scored.sort((a, b) => {
      if (a.finalScore === null && b.finalScore === null) return a.model.localeCompare(b.model);
      if (a.finalScore === null) return 1;
      if (b.finalScore === null) return -1;
      return b.finalScore - a.finalScore;
    });
    return { beta, eta, risk, weights, rows: scored };
  }

  global.RankingScoring = { betaFromPreference, fBeta, structureScore, scoreModels };
  if (typeof module !== "undefined") module.exports = global.RankingScoring;
})(typeof window !== "undefined" ? window : globalThis);
