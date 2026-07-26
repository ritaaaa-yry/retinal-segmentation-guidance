(function (global) {
  const RANGE_01 = ["f1", "sensitivity", "precision", "iou", "tvs", "cldice", "sf1"];
  const RANGE_MCC = ["mcc"];
  const REQUIRED = ["model", "dataset", "image_id"];

  function validateResults(rows) {
    const errors = [];
    const warnings = [];
    if (!rows.length) errors.push("Results CSV has no data rows.");
    for (const field of REQUIRED) {
      if (!rows.every((r) => Object.prototype.hasOwnProperty.call(r, field))) errors.push(`Missing required field: ${field}`);
    }
    const seen = new Set();
    rows.forEach((r, idx) => {
      for (const field of REQUIRED) {
        if (!String(r[field] || "").trim()) errors.push(`Row ${idx + 2}: ${field} is empty.`);
      }
      const key = `${r.model}||${r.dataset}||${r.image_id}`;
      if (seen.has(key)) warnings.push(`Duplicate model-dataset-image row: ${key}`);
      seen.add(key);
      for (const field of RANGE_01) {
        if (!(field in r) || String(r[field]).trim() === "") continue;
        const n = Number(r[field]);
        if (!Number.isFinite(n)) errors.push(`Row ${idx + 2}: ${field} is not numeric.`);
        else if (n < 0 || n > 1) errors.push(`Row ${idx + 2}: ${field} must be in [0,1].`);
      }
      for (const field of RANGE_MCC) {
        if (!(field in r) || String(r[field]).trim() === "") continue;
        const n = Number(r[field]);
        if (!Number.isFinite(n)) errors.push(`Row ${idx + 2}: ${field} is not numeric.`);
        else if (n < -1 || n > 1) errors.push(`Row ${idx + 2}: ${field} must be in [-1,1].`);
      }
    });
    const thresholdSources = new Set(rows.map((r) => String(r.threshold_source || "").trim()).filter(Boolean));
    if (thresholdSources.size > 1) warnings.push("Multiple threshold protocols detected; compare models cautiously.");
    return { errors, warnings, thresholdSources: [...thresholdSources] };
  }

  global.RankingValidation = { validateResults };
  if (typeof module !== "undefined") module.exports = global.RankingValidation;
})(typeof window !== "undefined" ? window : globalThis);
