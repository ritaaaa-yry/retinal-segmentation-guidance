(function () {
  "use strict";

  const state = {
    evidence: [], modelSummary: [], errorProfiles: [], resourceProfiles: [], resourceScores: {},
    manifest: null, quality: null, scored: null, bootstrap: [], sensitivity: [],
    bootstrapTimer: null, calculationToken: 0,
  };

  const PRESETS = {
    balanced: { preference: "Balanced", pixel: 50, thin: 15, structure: 20, resource: 15, aggregation: "balanced", label: "Balanced multi-objective" },
    overall: { preference: "Balanced", pixel: 100, thin: 0, structure: 0, resource: 0, aggregation: "mean", label: "Pixel level comparison" },
    unknown: { preference: "Balanced", pixel: 100, thin: 0, structure: 0, resource: 0, aggregation: "robust", label: "Unknown-domain robustness" },
    lowfn: { preference: "Low FN", pixel: 50, thin: 50, structure: 0, resource: 0, aggregation: "balanced", label: "Low FN / thin vessels" },
    structure: { preference: "Balanced", pixel: 0, thin: 0, structure: 100, resource: 0, aggregation: "balanced", label: "Structural fidelity" },
    resource: { preference: "Balanced", pixel: 30, thin: 0, structure: 0, resource: 70, aggregation: "balanced", label: "Low GPU / compute cost" },
  };
  const AGGREGATION_RISK = { mean: 0, balanced: 0.3, robust: 0.7 };
  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => RankingCharts.escapeHtml(value);
  const fmt = (value, digits = 3) => Number.isFinite(value) ? value.toFixed(digits) : "n/a";
  const pct = (value, digits = 1) => Number.isFinite(value) ? `${(100 * value).toFixed(digits)}%` : "n/a";

  async function loadData() {
    setLoading("Loading bundled benchmark evidence…");
    try {
      const [manifest, quality] = await Promise.all([
        RankingCsv.fetchJson("data/built/manifest.json"), RankingCsv.fetchJson("data/built/data_quality.json"),
      ]);
      const [evidence, modelSummary, errorProfiles, resourceProfiles] = await Promise.all([
        RankingCsv.fetchCsv(`data/${manifest.score_data}`, RankingCsv.typedEvidenceRow),
        RankingCsv.fetchCsv(`data/${manifest.model_summary}`, RankingCsv.typedGenericRow),
        RankingCsv.fetchCsv(`data/${manifest.error_model_summary}`, RankingCsv.typedGenericRow),
        RankingCsv.fetchCsv("data/built/resource_profiles.csv", RankingCsv.typedGenericRow),
      ]);
      state.manifest = manifest; state.quality = quality; state.evidence = evidence; state.modelSummary = modelSummary;
      state.errorProfiles = errorProfiles; state.resourceProfiles = resourceProfiles;
      state.resourceScores = RankingScoring.computeResourceScores(resourceProfiles, 0.5);
      renderDataOverview(); renderQuality(); /* source/resource sections removed from DOM; don't call their renderers */
      applyPreset("balanced"); setLoading("");
    } catch (error) {
      setLoading(""); if ($("fatal-error")) { $("fatal-error").hidden = false; $("fatal-error").textContent = `The bundled data could not be loaded. Open the page through GitHub Pages or a local HTTP server rather than double-clicking index.html. Details: ${error.message || error}`; }
    }
  }
  function setLoading(message) { if ($("loading-status")) { $("loading-status").textContent = message; $("loading-status").hidden = !message; } }
  function renderDataOverview() { const counts = state.manifest.source_counts; const quality = state.quality; if ($("data-overview")) { $("data-overview").innerHTML = `<div class="kpi"><strong>${quality.models.length}</strong><span>models</span></div><div class="kpi"><strong>${counts.datasets}</strong><span>datasets</span></div><div class="kpi"><strong>${quality.primary_image_rows.toLocaleString()}</strong><span>model-image evaluations</span></div>`; } if ($("data-version")) $("data-version").textContent = state.manifest.version; }
  function renderQuality() { const q = state.quality; const status = q.status === "pass" ? "Passed" : "Review required"; if ($("quality-status")) { $("quality-status").innerHTML = `<span class="status-badge ${q.status}">${status}</span>`; } if ($("threshold-warning")) { $("threshold-warning").hidden = !q.methodological_warning; $("threshold-warning").textContent = q.methodological_warning || ""; } if ($("sd-note")) $("sd-note").textContent = q.sd_convention_note || ""; }

  function renderSourceManifest() { /* retained for backward compatibility but not called by loadData anymore */ if (!$("source-body")) return; $("source-body").innerHTML = state.manifest.sources.map((source) => `<tr><td>${escapeHtml(source.file.replace("source/", ""))}</td><td><span class="role-pill ${source.role}">${escapeHtml(source.role)}</span></td><td class="numeric">${source.rows}</td><td>${escapeHtml(source.rationale || "")}</td></tr>`).join(""); }
  function renderResourceEvidence() { /* retained but not called by default */ if (!$("resource-body")) return; $("resource-body").innerHTML = state.resourceProfiles.map((p) => { const r = state.resourceScores[p.model]; return `<tr><td><strong>${escapeHtml(p.model)}</strong></td><td class="numeric">${fmt(p.parameters)}</td><td class="numeric">${fmt(p.gflops)}</td><td class="numeric">${fmt(p.peak_vram)}</td><td class="numeric">${fmt(p.train_minutes)}</td><td class="numeric">${pct(r)}</td><td>${escapeHtml(p.evidence || "-")}</td></tr>`; }).join(""); }

  function optionsFromUi() { const preference = $("fnfp-preference") ? $("fnfp-preference").value : "Balanced"; const aggregation = $("aggregation-mode") ? $("aggregation-mode").value : "balanced"; return { preference, beta: Number($("beta") ? $("beta").value : 1) || RankingScoring.betaFromPreference(preference), weights: { pixel: Number($("pixel-weight") ? $("pixel-weight").value : 50) || 0, thin: Number($("thin-weight") ? $("thin-weight").value : 0) || 0, structure: Number($("structure-weight") ? $("structure-weight").value : 0) || 0, resource: Number($("resource-weight") ? $("resource-weight").value : 0) || 0 }, aggregation }; }
  function setWeightValues(values) { ["pixel", "thin", "structure", "resource"].forEach((name) => { if ($( `${name}-weight` )) $( `${name}-weight`).value = values[name]; }); }
  function applyPreset(name) { const p = PRESETS[name]; if (!p) return; if ($("fnfp-preference")) $("fnfp-preference").value = p.preference; if ($("beta")) $("beta").value = RankingScoring.betaFromPreference(p.preference); setWeightValues(p); if ($("aggregation-mode")) $("aggregation-mode").value = p.aggregation; updateControlLabels(); renderRanking(); }
  function rebalanceWeights(changed) { const names = ["pixel", "thin", "structure", "resource"]; const changedValue = Math.max(0, Math.min(100, Number($(`${changed}-weight`) ? $(`${changed}-weight`).value : 0) || 0)); const others = names.filter(n => n !== changed); let sumOthers = others.reduce((s, n) => s + (Number($(`${n}-weight`) ? $(`${n}-weight`).value : 0) || 0), 0); if (sumOthers === 0) { others.forEach(n => { if ($(`${n}-weight`)) $(`${n}-weight`).value = Math.floor((100 - changedValue) / others.length); }); } else { const scale = (100 - changedValue) / sumOthers; others.forEach(n => { if ($(`${n}-weight`)) $(`${n}-weight`).value = Math.round((Number($(`${n}-weight`).value) || 0) * scale); }); }
    updateControlLabels(); renderRanking(); }
  function updateControlLabels() { ["pixel", "thin", "structure", "resource"].forEach((n) => { if ($(`${n}-value`) && $(`${n}-weight`)) $(`${n}-value`).textContent = `${$(`${n}-weight`).value}%`; }); const total = ["pixel", "thin", "structure", "resource"].reduce((s, n) => s + (Number($(`${n}-weight`) ? $(`${n}-weight`).value : 0) || 0), 0); if ($("normalized-weights")) { $("normalized-weights").textContent = `Normalized weights: ${total} (will be rescaled to sum 100)`; } }
  function renderRanking(scheduleBootstrap = true) { if (!state.evidence.length) return; const options = optionsFromUi(); state.scored = RankingScoring.scoreModels(state.evidence, options); RankingCharts.scoreBar("score-chart", state.scored.rows); renderRankingTable(); renderFormula(options); renderMetricConsistency(); renderDatasetBreakdown(); renderModelCards(); renderRecommendation(); /* stability UI removed from the page, skip scheduling bootstrap stability */ }
  function renderRankingTable() { const bm = Object.fromEntries(state.bootstrap.map((r) => [r.model, r])); if (!$("ranking-body")) return; $("ranking-body").innerHTML = state.scored.rows.map((row, index) => { const b = bm[row.model]; return `<tr><td>${index + 1}</td><td><strong>${escapeHtml(row.model)}</strong></td><td class="numeric">${fmt(row.finalScore, 2)}</td><td class="numeric">${pct(row.pixel)}</td><td class="numeric">${pct(row.thin)}</td><td class="numeric">${pct(row.structure)}</td><td class="numeric">${b ? pct(b.top1) : 'n/a'}</td><td class="numeric">${b ? `${fmt(b.ci[0],3)}–${fmt(b.ci[1],3)}` : 'n/a'}</td><td class="numeric">${row.coverage || 'n/a'}</td></tr>`; }).join(""); }

  // Restore detailed formula text (previous implementation)
  function renderFormula(options) {
    const w = RankingScoring.normalizeWeights(options.weights);
    if (!$("formula-text")) return;
    $("formula-text").innerHTML = `
      <div>
        <strong>1. Pixel score:</strong> F<sub>β</sub> = (1+β²)·Precision·Sensitivity / (β²·Precision + Sensitivity), where β controls FN–FP preference (higher β favours sensitivity).
      </div>
      <div>
        <strong>2. Thin-vessel score:</strong> TVS = covered GT-thin-skeleton pixels / all GT-thin-skeleton pixels.
      </div>
      <div>
        <strong>3. Structure score:</strong> η·clDice + (1−η)·SF1, where η is the clDice weight shown in Advanced formula controls.
      </div>
      <div>
        <strong>4. Resource score:</strong> mean of per-metric utilities (parameters, GFLOPs, checkpoint size, peak VRAM, training time); missing fields receive neutral utility 0.50.
      </div>
      <div>
        <strong>5. Cross-dataset aggregation:</strong> (1−r)·equal-dataset mean + r·worst dataset, where r is the aggregation risk selected above.
      </div>
      <div>
        <strong>6. Final score:</strong> 100 × (w_pixel·Pixel + w_thin·Thin + w_structure·Structure + w_resource·Resource), where the active weights are normalized to sum to 1.
      </div>
    `;
  }

  function renderMetricConsistency() { const l = state.scored.metricLeaders; const message = `Mean F1 leader: ${l.f1?.model || "n/a"}; IoU leader: ${l.iou?.model || "n/a"}; MCC leader: ${l.mcc?.model || "n/a"}`; if ($("metric-consistency")) $("metric-consistency").textContent = message; }
  function renderRecommendation() { const rec = RankingScoring.recommendShortlist(state.scored.rows, state.bootstrap, state.scored.risk); if (!$("recommendation")) return; if (rec.type === "none") { $("recommendation").innerHTML = `<strong>No recommended shortlist.</strong>`; } else { $("recommendation").innerHTML = `<strong>Top candidate:</strong> ${escapeHtml(rec.model)} — ${escapeHtml(rec.reason)}`; } }
  function errorProfileFor(model) { return state.errorProfiles.find((row) => row.model === model) || null; }
  function dominantErrors(errorRow) { if (!errorRow) return []; return [["Boundary shift", errorRow.boundary_shift_percent], ["Too thin", errorRow.too_thin_percent], ["Missed vessel", errorRow.missed_vessel_percent], ["Extra vessel", errorRow.extra_vessel_percent]].filter(([, v]) => Number.isFinite(v)); }

  // Restore richer model cards (previous implementation)
  function renderModelCards() {
    const c = $("model-cards");
    if (!c) return;
    c.innerHTML = "";
    state.scored.rows.forEach((row, index) => {
      const card = document.createElement("article");
      card.className = `model-card ${index === 0 ? "winner" : ""}`;
      const err = errorProfileFor(row.model);
      const errs = dominantErrors(err).map(([k, v]) => `<li>${escapeHtml(k)}: ${pct(v,1)}</li>`).join("");
      card.innerHTML = `
        <div class="model-card-header">
          <div>
            <span class="rank-chip">${index + 1}</span>
            <h3>${escapeHtml(row.model)}</h3>
          </div>
          <div class="card-score">
            <strong>${fmt(row.finalScore, 2)}</strong>
            <div class="score-breakdown">
              <span>Pixel: ${fmt(row.dimensions?.pixel?.adjusted ?? null,3)}</span>
              <span>Thin: ${fmt(row.dimensions?.thin?.adjusted ?? null,3)}</span>
              <span>Structure: ${fmt(row.dimensions?.structure?.adjusted ?? null,3)}</span>
            </div>
          </div>
        </div>
        <div class="model-summary-grid">
          <div><b>Mean F1</b><div>${fmt(row.summary?.f1)}</div></div>
          <div><b>Worst F1</b><div>${fmt(row.summary?.f1Worst)} <small>${escapeHtml(row.summary?.f1WorstDataset || "")}</small></div></div>
          <div><b>Mean TVS</b><div>${fmt(row.summary?.tvs)}</div></div>
          <div><b>Mean clDice</b><div>${fmt(row.summary?.cldice)}</div></div>
          <div><b>Mean SF1</b><div>${fmt(row.summary?.sf1)}</div></div>
        </div>
        <div class="error-composition" id="error-${index}"></div>
        <p class="small"><strong>Dominant residual error composition:</strong></p>
        <ul>${errs || '<li>n/a</li>'}</ul>
      `;
      c.appendChild(card);
      // render error composition chart
      const container = card.querySelector(`#error-${index}`);
      RankingCharts.errorComposition(container, err);
    });
  }

  function renderDatasetBreakdown() { /* removed from page; keep function unused */ }
  function scheduleStability(options) { /* stability UI removed; noop */ }
  function renderStability() { /* noop */ }
  function bindEvents() {
    document.querySelectorAll("[data-preset]").forEach((b) => b.addEventListener("click", () => applyPreset(b.dataset.preset)));
    // FN–FP preference removed from UI; guard existence
    if ($("fnfp-preference")) $("fnfp-preference").addEventListener("change", () => { renderRanking(); });
    if ($("aggregation-mode")) $("aggregation-mode").addEventListener("change", () => { renderRanking(); });
    ["pixel", "thin", "structure", "resource"].forEach((n) => { if ($(`${n}-weight`)) $(`${n}-weight`).addEventListener("input", () => rebalanceWeights(n)); });
    if ($("beta")) $("beta").addEventListener("change", () => renderRanking());
    if ($("eta")) $("eta").addEventListener("change", () => renderRanking());
    const rerun = $("rerun-stability"); if (rerun) rerun.addEventListener("click", () => { /* noop */ });
  }
  document.addEventListener("DOMContentLoaded", () => { bindEvents(); loadData(); });
})();
