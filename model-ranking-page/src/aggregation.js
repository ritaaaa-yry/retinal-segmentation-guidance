(function (global) {
  function mean(values) {
    const xs = values.filter((v) => Number.isFinite(v));
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  }

  function aggregateByDataset(rows, metricFn) {
    const by = new Map();
    rows.forEach((r) => {
      const key = `${r.model}||${r.dataset}`;
      if (!by.has(key)) by.set(key, { model: r.model, dataset: r.dataset, values: [] });
      const value = metricFn(r);
      if (Number.isFinite(value)) by.get(key).values.push(value);
    });
    return [...by.values()].map((g) => ({ model: g.model, dataset: g.dataset, value: mean(g.values), n: g.values.length }));
  }

  function riskAdjust(datasetRows, r) {
    const values = datasetRows.map((x) => x.value).filter((v) => Number.isFinite(v));
    if (!values.length) return null;
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const worst = Math.min(...values);
    return (1 - r) * avg + r * worst;
  }

  function equalDatasetSummary(rows, metricFn, risk) {
    const ds = aggregateByDataset(rows, metricFn);
    const byModel = new Map();
    ds.forEach((r) => {
      if (!byModel.has(r.model)) byModel.set(r.model, []);
      byModel.get(r.model).push(r);
    });
    return [...byModel.entries()].map(([model, dsRows]) => {
      const values = dsRows.map((x) => x.value).filter((v) => Number.isFinite(v));
      return {
        model,
        datasetRows: dsRows,
        mean: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
        worst: values.length ? Math.min(...values) : null,
        adjusted: riskAdjust(dsRows, risk),
        coverageDatasets: values.length,
      };
    });
  }

  global.RankingAggregation = { mean, aggregateByDataset, equalDatasetSummary, riskAdjust };
  if (typeof module !== "undefined") module.exports = global.RankingAggregation;
})(typeof window !== "undefined" ? window : globalThis);
