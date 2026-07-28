(function (global) {
  "use strict";

  function parseCsv(text) {
    const cleaned = String(text || "").replace(/^\uFEFF/, "");
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;

    for (let i = 0; i < cleaned.length; i += 1) {
      const ch = cleaned[i];
      const next = cleaned[i + 1];
      if (quoted) {
        if (ch === '"' && next === '"') {
          field += '"';
          i += 1;
        } else if (ch === '"') {
          quoted = false;
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        quoted = true;
      } else if (ch === ",") {
        row.push(field);
        field = "";
      } else if (ch === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else if (ch !== "\r") {
        field += ch;
      }
    }
    if (field.length || row.length) {
      row.push(field);
      rows.push(row);
    }

    const headers = (rows.shift() || []).map((value) => value.trim());
    return rows
      .filter((values) => values.some((value) => String(value).trim() !== ""))
      .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
  }

  function toNumber(value) {
    if (value === null || value === undefined || String(value).trim() === "") return null;
    const result = Number(value);
    return Number.isFinite(result) ? result : null;
  }

  function typedEvidenceRow(row) {
    const numeric = [
      "threshold", "tp", "fp", "fn", "tn", "sensitivity", "precision", "f1", "iou", "mcc",
      "tvs", "cldice", "sf1", "thin_gt_pixels", "thin_tp_pixels",
      "prediction_skeleton_pixels", "gt_skeleton_pixels",
    ];
    const output = { ...row };
    numeric.forEach((field) => { output[field] = toNumber(row[field]); });
    return output;
  }

  function typedGenericRow(row) {
    const output = { ...row };
    Object.keys(output).forEach((field) => {
      const text = String(output[field] ?? "").trim();
      if (text !== "" && /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) {
        output[field] = Number(text);
      }
    });
    return output;
  }

  async function fetchText(path) {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) throw new Error(`Failed to load ${path}: HTTP ${response.status}`);
    return response.text();
  }

  async function fetchCsv(path, mapper = typedGenericRow) {
    return parseCsv(await fetchText(path)).map(mapper);
  }

  async function fetchJson(path) {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) throw new Error(`Failed to load ${path}: HTTP ${response.status}`);
    return response.json();
  }

  const api = { parseCsv, toNumber, typedEvidenceRow, typedGenericRow, fetchText, fetchCsv, fetchJson };
  global.RankingCsv = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
