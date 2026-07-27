(function () {
  "use strict";

  const state = {
    evidence: [],
    modelSummary: [],
    errorProfiles: [],
    manifest: null,
    quality: null,
    scored: null,
    bootstrap: [],
    sensitivity: [],
    bootstrapTimer: null,
    calculationToken: 0,
  };

  const PRESETS = {
    balanced: { preference: "Balanced", pixel: 60, thin: 15, structure: 25, risk: 30, label: "Balanced multi-objective" },
    overall: { preference: "Balanced", pixel: 80, thin: 5, structure: 15, risk: 30, label: "Overall quality" },
    lowfn: { preference: "Low FN", pixel: 45, thin: 45, structure: 10, risk: 30, label: "Low FN / thin vessels" },
    lowfp: { preference: "Low FP", pixel: 80, thin: 0, structure: 20, risk: 30, label: "Low FP" },
    structure: { preference: "Balanced", pixel: 20, thin: 10, structure: 70, risk: 30, label: "Structural fidelity" },
    unknown: { preference: "Balanced", pixel: 55, thin: 15, structure: 30, risk: 70, label: "Unknown-domain balanced" },
  };

  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => RankingCharts.escapeHtml(value);
  const fmt = (value, digits = 3) => Number.isFinite(value) ? value.toFixed(digits) : "n/a";
  const pct = (value, digits = 1) => Number.isFinite(value) ? `${(100 * value).toFixed(digits)}%` : "n/a";

  async function loadData() {
    setLoading("Loading bundled benchmark evidence…");
    try {
      const [manifest, quality] = await Promise.all([
        RankingCsv.fetchJson("data/built/manifest.json"),
        RankingCsv.fetchJson("data/built/data_quality.json"),
      ]);
      const [evidence, modelSummary, errorProfiles] = await Promise.all([
        RankingCsv.fetchCsv(`data/${manifest.score_data}`, RankingCsv.typedEvidenceRow),
        RankingCsv.fetchCsv(`data/${manifest.model_summary}`, RankingCsv.typedGenericRow),
        RankingCsv.fetchCsv(`data/${manifest.error_model_summary}`, RankingCsv.typedGenericRow),
      ]);
      state.manifest = manifest;
      state.quality = quality;
      state.evidence = evidence;
      state.modelSummary = modelSummary;
      state.errorProfiles = errorProfiles;
      renderDataOverview();
      renderQuality();
      renderSourceManifest();
      applyPreset("balanced");
      setLoading("");
    } catch (error) {
      setLoading("");
      $("fatal-error").hidden = false;
      $("fatal-error").textContent = `The bundled data could not be loaded. Open the page through GitHub Pages or a local HTTP server rather than double-clicking index.html. Details: ${error.message}`;
    }
  }

  function setLoading(message) {
    $("loading-status").textContent = message;
    $("loading-status").hidden = !message;
  }

  function renderDataOverview() {
    const counts = state.manifest.source_counts;
    const quality = state.quality;
    $("data-overview").innerHTML = `
      <div class="kpi"><strong>${quality.models.length}</strong><span>models</span></div>
      <div class="kpi"><strong>${quality.datasets.length}</strong><span>datasets</span></div>
      <div class="kpi"><strong>${quality.primary_image_rows.toLocaleString()}</strong><span>model-image evaluations</span></div>
      <div class="kpi"><strong>${counts.total}</strong><span>bundled source CSVs</span></div>
    `;
    $("data-role-summary").innerHTML = `
      <span class="role-pill scoring">${counts.scoring} scoring sources</span>
      <span class="role-pill context">${counts.risk_context} risk-context sources</span>
      <span class="role-pill validation">${counts.validation} validation/provenance sources</span>
    `;
    $("data-version").textContent = state.manifest.version;
  }

  function renderQuality() {
    const quality = state.quality;
    const status = quality.status === "pass" ? "Passed" : "Review required";
    const checks = quality.checks.map((check) => `
      <li class="quality-${check.status}">
        <strong>${check.status.toUpperCase()}</strong> ${escapeHtml(check.name)}
        ${check.mismatch_count ? `<span>(${check.mismatch_count} mismatches)</span>` : ""}
      </li>
    `).join("");
    $("quality-status").innerHTML = `<span class="status-badge ${quality.status}">${status}</span>`;
    $("quality-checks").innerHTML = checks;
    $("threshold-warning").hidden = !quality.methodological_warning;
    $("threshold-warning").textContent = quality.methodological_warning || "";
    $("sd-note").textContent = quality.sd_convention_note || "";
  }

  function renderSourceManifest() {
    const body = $("source-body");
    body.innerHTML = state.manifest.sources.map((source) => `
      <tr>
        <td>${escapeHtml(source.file.replace("source/", ""))}</td>
        <td><span class="role-pill ${source.role === "scoring" ? "scoring" : source.role === "risk_context" ? "context" : "validation"}">${escapeHtml(source.role)}</span></td>
        <td>${Number(source.rows).toLocaleString()}</td>
        <td>${escapeHtml(source.rationale)}</td>
      </tr>
    `).join("");
  }

  function optionsFromUi() {
    const preference = $("fnfp-preference").value;
    return {
      preference,
      beta: Number($("beta").value) || RankingScoring.betaFromPreference(preference),
      eta: Number($("eta").value),
      risk: Number($("risk-weight").value) / 100,
      weights: {
        pixel: Number($("pixel-weight").value),
        thin: Number($("thin-weight").value),
        structure: Number($("structure-weight").value),
      },
      strictMode: true,
    };
  }

  function applyPreset(name) {
    const preset = PRESETS[name];
    if (!preset) return;
    $("fnfp-preference").value = preset.preference;
    $("beta").value = RankingScoring.betaFromPreference(preset.preference);
    $("pixel-weight").value = preset.pixel;
    $("thin-weight").value = preset.thin;
    $("structure-weight").value = preset.structure;
    $("risk-weight").value = preset.risk;
    document.querySelectorAll("[data-preset]").forEach((button) => {
      button.classList.toggle("active", button.dataset.preset === name);
    });
    updateControlLabels();
    renderRanking(true);
  }

  function updateControlLabels() {
    ["pixel", "thin", "structure", "risk"].forEach((name) => {
      const inputId = name === "risk" ? "risk-weight" : `${name}-weight`;
      $(`${name}-value`).textContent = `${$(inputId).value}%`;
    });
    const normalized = RankingScoring.normalizeWeights(optionsFromUi().weights);
    $("normalized-weights").textContent = `Normalized weights: pixel ${(100 * normalized.pixel).toFixed(1)}%, thin ${(100 * normalized.thin).toFixed(1)}%, structure ${(100 * normalized.structure).toFixed(1)}%.`;
  }

  function renderRanking(scheduleBootstrap = true) {
    if (!state.evidence.length) return;
    const options = optionsFromUi();
    state.scored = RankingScoring.scoreModels(state.evidence, options);
    RankingCharts.scoreBars($("score-chart"), state.scored.rows);
    renderRankingTable();
    renderFormula(options);
    renderMetricConsistency();
    renderDatasetBreakdown();
    renderModelCards();
    renderRecommendation();
    if (scheduleBootstrap) scheduleStability(options);
  }

  function renderRankingTable() {
    const bootstrapMap = Object.fromEntries(state.bootstrap.map((row) => [row.model, row]));
    $("ranking-body").innerHTML = state.scored.rows.map((row, index) => {
      const bootstrap = bootstrapMap[row.model];
      return `
        <tr class="${index === 0 ? "top-row" : ""}">
          <td><span class="rank-number">${Number.isFinite(row.finalScore) ? index + 1 : "—"}</span></td>
          <td><strong>${escapeHtml(row.model)}</strong><br><span class="small muted">${escapeHtml(row.status)}</span></td>
          <td class="numeric final-score">${fmt(row.finalScore, 2)}</td>
          <td class="numeric">${fmt(row.dimensions.pixel?.adjusted, 3)}</td>
          <td class="numeric">${fmt(row.dimensions.thin?.adjusted, 3)}</td>
          <td class="numeric">${fmt(row.dimensions.structure?.adjusted, 3)}</td>
          <td class="numeric">${bootstrap ? pct(bootstrap.top1Frequency) : "calculating…"}</td>
          <td class="numeric">${bootstrap ? `${fmt(bootstrap.scoreCiLow, 2)}–${fmt(bootstrap.scoreCiHigh, 2)}` : "calculating…"}</td>
          <td class="numeric">${pct(row.coverage, 0)}</td>
        </tr>
      `;
    }).join("");
  }

  function renderFormula(options) {
    const weights = RankingScoring.normalizeWeights(options.weights);
    $("formula-text").innerHTML = `
      <div><strong>Pixel:</strong> F<sub>β</sub>(Precision, Sensitivity), β=${options.beta.toFixed(2)}</div>
      <div><strong>Thin:</strong> TVS</div>
      <div><strong>Structure:</strong> ${options.eta.toFixed(2)}·clDice + ${(1 - options.eta).toFixed(2)}·SF1</div>
      <div><strong>Risk adjustment:</strong> ${(1 - options.risk).toFixed(2)}·equal-dataset mean + ${options.risk.toFixed(2)}·worst dataset</div>
      <div><strong>Final:</strong> 100·(${weights.pixel.toFixed(3)}·Pixel + ${weights.thin.toFixed(3)}·Thin + ${weights.structure.toFixed(3)}·Structure)</div>
    `;
  }

  function renderMetricConsistency() {
    const leaders = state.scored.metricLeaders;
    const message = `Mean F1 leader: ${leaders.f1?.model || "n/a"}; IoU leader: ${leaders.iou?.model || "n/a"}; MCC leader: ${leaders.mcc?.model || "n/a"}.`;
    $("metric-consistency").className = state.scored.metricConsistency ? "notice success" : "notice warning";
    $("metric-consistency").innerHTML = `<strong>${state.scored.metricConsistency ? "Cross-metric consistency" : "Cross-metric inconsistency"}</strong><span>${escapeHtml(message)} IoU and MCC are reported as checks, not counted again in the score.</span>`;
  }

  function renderRecommendation() {
    const recommendation = RankingScoring.recommendShortlist(state.scored.rows, state.bootstrap, state.scored.risk);
    if (recommendation.type === "none") {
      $("recommendation").innerHTML = `<strong>No recommendation</strong><span>${escapeHtml(recommendation.reason)}</span>`;
      return;
    }
    const title = recommendation.type === "shortlist" ? "Two-model shortlist" : "Recommended model";
    $("recommendation").innerHTML = `
      <strong>${title}: ${recommendation.models.map(escapeHtml).join(" + ")}</strong>
      <span>${escapeHtml(recommendation.reason)}. This is benchmark-relative evidence, not a guarantee for a new target domain.</span>
    `;
  }

  function errorProfileFor(model) {
    return state.errorProfiles.find((row) => row.model === model) || null;
  }

  function dominantErrors(errorRow) {
    if (!errorRow) return [];
    return [
      ["Boundary shift", errorRow.boundary_shift_percent],
      ["Too thin", errorRow.too_thin_percent],
      ["Missed vessel", errorRow.missed_vessel_percent],
      ["Too thick", errorRow.too_thick_percent],
      ["Extra vessel", errorRow.extra_vessel_percent],
    ].filter(([, value]) => Number.isFinite(value)).sort((a, b) => b[1] - a[1]).slice(0, 2);
  }

  function renderModelCards() {
    const container = $("model-cards");
    container.innerHTML = "";
    state.scored.rows.forEach((row, index) => {
      const card = document.createElement("article");
      card.className = `model-card ${index === 0 ? "winner-card" : ""}`;
      const errors = errorProfileFor(row.model);
      const dominant = dominantErrors(errors).map(([name, value]) => `${name} ${value.toFixed(1)}%`).join("; ");
      card.innerHTML = `
        <div class="model-card-header">
          <div><span class="rank-chip">${index + 1}</span><h3>${escapeHtml(row.model)}</h3></div>
          <strong class="card-score">${fmt(row.finalScore, 2)}</strong>
        </div>
        <div class="metric-grid">
          <span><b>Mean F1</b>${fmt(row.summary.f1)}</span>
          <span><b>Worst F1</b>${fmt(row.summary.f1Worst)} <small>${escapeHtml(row.summary.f1WorstDataset)}</small></span>
          <span><b>Mean TVS</b>${fmt(row.summary.tvs)}</span>
          <span><b>Worst TVS</b>${fmt(row.summary.tvsWorst)} <small>${escapeHtml(row.summary.tvsWorstDataset)}</small></span>
          <span><b>Mean clDice</b>${fmt(row.summary.cldice)}</span>
          <span><b>Mean SF1</b>${fmt(row.summary.sf1)}</span>
          <span><b>Mean sensitivity</b>${fmt(row.summary.sensitivity)}</span>
          <span><b>Mean precision</b>${fmt(row.summary.precision)}</span>
        </div>
        <div class="error-chart" id="error-${index}"></div>
        <p class="small"><strong>Dominant residual error composition:</strong> ${dominant || "n/a"}.</p>
        <p class="small muted">Error composition is explanatory only. It is not added to the score because a conditional share does not measure absolute FN or FP burden.</p>
      `;
      container.appendChild(card);
      RankingCharts.errorComposition(card.querySelector(`#error-${index}`), errors);
    });
  }

  function renderDatasetBreakdown() {
    const topModels = state.scored.rows.filter((row) => Number.isFinite(row.finalScore)).slice(0, 2).map((row) => row.model);
    const weights = state.scored.weights;
    const datasets = state.scored.datasets;
    const lookup = Object.fromEntries(state.scored.datasetUtilities.map((row) => [`${row.model}||${row.dataset}`, row]));
    const header = [`<th>Dataset</th>`, ...topModels.map((model) => `<th>${escapeHtml(model)} utility</th>`), ...topModels.map((model) => `<th>${escapeHtml(model)} F1</th>`)].join("");
    $("dataset-head").innerHTML = `<tr>${header}</tr>`;
    $("dataset-body").innerHTML = datasets.map((dataset) => {
      const utilities = topModels.map((model) => {
        const row = lookup[`${model}||${dataset}`];
        if (!row) return null;
        return 100 * (weights.pixel * row.pixel + weights.thin * row.thin + weights.structure * row.structure);
      });
      const f1s = topModels.map((model) => lookup[`${model}||${dataset}`]?.f1);
      return `<tr><td><strong>${escapeHtml(dataset)}</strong></td>${utilities.map((value) => `<td class="numeric">${fmt(value, 2)}</td>`).join("")}${f1s.map((value) => `<td class="numeric">${fmt(value, 3)}</td>`).join("")}</tr>`;
    }).join("");
  }

  function scheduleStability(options) {
    clearTimeout(state.bootstrapTimer);
    const token = ++state.calculationToken;
    $("stability-status").textContent = "Calculating paired image-level bootstrap and preference sensitivity…";
    state.bootstrapTimer = setTimeout(() => {
      try {
        const bootstrap = RankingBootstrap.pairedBootstrap(state.evidence, options, 400);
        const sensitivity = RankingBootstrap.weightSensitivity(state.evidence, options, 500);
        if (token !== state.calculationToken) return;
        state.bootstrap = bootstrap;
        state.sensitivity = sensitivity;
        renderStability();
        renderRankingTable();
        renderRecommendation();
      } catch (error) {
        $("stability-status").textContent = `Stability calculation failed: ${error.message}`;
      }
    }, 250);
  }

  function renderStability() {
    $("stability-status").textContent = "Paired bootstrap: 400 repetitions. Weight sensitivity: 500 repetitions with active weights varied independently by ±20%.";
    RankingCharts.frequencyBars($("bootstrap-chart"), state.bootstrap, "top1Frequency", "Paired bootstrap top-1 frequency");
    RankingCharts.frequencyBars($("weight-chart"), state.sensitivity, "top1Frequency", "Weight-sensitivity top-1 frequency");
    $("bootstrap-table-body").innerHTML = state.bootstrap.map((row) => `
      <tr>
        <td><strong>${escapeHtml(row.model)}</strong></td>
        <td class="numeric">${pct(row.top1Frequency)}</td>
        <td class="numeric">${pct(row.top2Frequency)}</td>
        <td class="numeric">${fmt(row.scoreMedian, 2)}</td>
        <td class="numeric">${fmt(row.scoreCiLow, 2)}–${fmt(row.scoreCiHigh, 2)}</td>
      </tr>
    `).join("");
  }

  function bindEvents() {
    document.querySelectorAll("[data-preset]").forEach((button) => {
      button.addEventListener("click", () => applyPreset(button.dataset.preset));
    });
    $("fnfp-preference").addEventListener("change", () => {
      $("beta").value = RankingScoring.betaFromPreference($("fnfp-preference").value);
      document.querySelectorAll("[data-preset]").forEach((button) => button.classList.remove("active"));
      updateControlLabels();
      renderRanking(true);
    });
    ["pixel-weight", "thin-weight", "structure-weight", "risk-weight", "beta", "eta"].forEach((id) => {
      $(id).addEventListener("input", () => {
        document.querySelectorAll("[data-preset]").forEach((button) => button.classList.remove("active"));
        updateControlLabels();
        renderRanking(true);
      });
    });
    $("rerun-stability").addEventListener("click", () => scheduleStability(optionsFromUi()));
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindEvents();
    loadData();
  });
})();
