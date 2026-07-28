(function () {
  "use strict";

  const state = {
    evidence: [],
    modelSummary: [],
    errorProfiles: [],
    resourceProfiles: [],
    resourceScores: {},
    manifest: null,
    quality: null,
    scored: null,
  };

  const PRESETS = {
    balanced: {
      preference: "Balanced",
      pixel: 50,
      thin: 15,
      structure: 20,
      resource: 15,
      aggregation: "balanced",
      label: "Balanced multi-objective",
    },
    overall: {
      preference: "Balanced",
      pixel: 100,
      thin: 0,
      structure: 0,
      resource: 0,
      aggregation: "mean",
      label: "Pixel level comparison",
    },
    unknown: {
      preference: "Balanced",
      pixel: 100,
      thin: 0,
      structure: 0,
      resource: 0,
      aggregation: "robust",
      label: "Unknown-domain robustness",
    },
    lowfn: {
      preference: "Low FN",
      pixel: 50,
      thin: 50,
      structure: 0,
      resource: 0,
      aggregation: "balanced",
      label: "Low FN / thin vessels",
    },
    structure: {
      preference: "Balanced",
      pixel: 0,
      thin: 0,
      structure: 100,
      resource: 0,
      aggregation: "balanced",
      label: "Structural fidelity",
    },
    resource: {
      preference: "Balanced",
      pixel: 30,
      thin: 0,
      structure: 0,
      resource: 70,
      aggregation: "balanced",
      label: "Low GPU / compute cost",
    },
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
        RankingCsv.fetchJson("data/built/manifest.json"),
        RankingCsv.fetchJson("data/built/data_quality.json"),
      ]);
      const [evidence, modelSummary, errorProfiles, resourceProfiles] = await Promise.all([
        RankingCsv.fetchCsv(`data/${manifest.score_data}`, RankingCsv.typedEvidenceRow),
        RankingCsv.fetchCsv(`data/${manifest.model_summary}`, RankingCsv.typedGenericRow),
        RankingCsv.fetchCsv(`data/${manifest.error_model_summary}`, RankingCsv.typedGenericRow),
        RankingCsv.fetchCsv("data/built/resource_profiles.csv", RankingCsv.typedGenericRow),
      ]);

      state.manifest = manifest;
      state.quality = quality;
      state.evidence = evidence;
      state.modelSummary = modelSummary;
      state.errorProfiles = errorProfiles;
      state.resourceProfiles = resourceProfiles;
      state.resourceScores = RankingScoring.computeResourceScores(resourceProfiles, 0.5);

      renderDataOverview();
      renderQualitySummary();
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

  function renderQualitySummary() {
    const quality = state.quality;
    const status = quality.status === "pass" ? "Passed" : "Review required";
    $("quality-status").innerHTML = `<span class="status-badge ${quality.status}">${status}</span>`;
    $("threshold-warning").hidden = !quality.methodological_warning;
    $("threshold-warning").textContent = quality.methodological_warning || "";
  }

  function optionsFromUi() {
    const preference = $("fnfp-preference").value;
    const aggregation = $("aggregation-mode").value;
    return {
      preference,
      beta: Number($("beta").value) || RankingScoring.betaFromPreference(preference),
      eta: Number($("eta").value),
      risk: AGGREGATION_RISK[aggregation] ?? 0.3,
      aggregation,
      weights: {
        pixel: Number($("pixel-weight").value),
        thin: Number($("thin-weight").value),
        structure: Number($("structure-weight").value),
        resource: Number($("resource-weight").value),
      },
      resourceScores: state.resourceScores,
      strictMode: true,
    };
  }

  function setWeightValues(values) {
    ["pixel", "thin", "structure", "resource"].forEach((name) => {
      $(`${name}-weight`).value = values[name];
    });
  }

  function applyPreset(name) {
    const preset = PRESETS[name];
    if (!preset) return;
    $("fnfp-preference").value = preset.preference;
    $("beta").value = RankingScoring.betaFromPreference(preset.preference);
    setWeightValues(preset);
    $("aggregation-mode").value = preset.aggregation;
    document.querySelectorAll("[data-preset]").forEach((button) => {
      button.classList.toggle("active", button.dataset.preset === name);
    });
    updateControlLabels();
    renderRanking();
  }

  function rebalanceWeights(changed) {
    const names = ["pixel", "thin", "structure", "resource"];
    const changedValue = Math.max(0, Math.min(100, Number($(`${changed}-weight`).value) || 0));
    const others = names.filter((name) => name !== changed);
    const remaining = 100 - changedValue;
    const oldTotal = others.reduce((sum, name) => sum + (Number($(`${name}-weight`).value) || 0), 0);
    const allocations = {};

    if (oldTotal <= 0) {
      others.forEach((name, index) => { allocations[name] = index === 0 ? remaining : 0; });
    } else {
      let used = 0;
      others.forEach((name, index) => {
        const value = index === others.length - 1
          ? remaining - used
          : Math.round(remaining * (Number($(`${name}-weight`).value) || 0) / oldTotal);
        allocations[name] = Math.max(0, value);
        used += allocations[name];
      });
    }

    $(`${changed}-weight`).value = changedValue;
    others.forEach((name) => { $(`${name}-weight`).value = allocations[name]; });
  }

  function updateControlLabels() {
    ["pixel", "thin", "structure", "resource"].forEach((name) => {
      $(`${name}-value`).textContent = `${$(`${name}-weight`).value}%`;
    });
    const total = ["pixel", "thin", "structure", "resource"]
      .reduce((sum, name) => sum + Number($(`${name}-weight`).value), 0);
    $("normalized-weights").textContent = `Active task weights: pixel ${$("pixel-weight").value}%, thin ${$("thin-weight").value}%, structure ${$("structure-weight").value}%, resource ${$("resource-weight").value}% — total ${total}%. Cross-dataset aggregation is selected separately.`;
  }

  function renderRanking() {
    if (!state.evidence.length) return;
    const options = optionsFromUi();
    state.scored = RankingScoring.scoreModels(state.evidence, options);
    RankingCharts.scoreBars($("score-chart"), state.scored.rows);
    renderRankingTable();
    renderFormula(options);
    renderMetricConsistency();
    renderModelCards();
    renderRecommendation();
  }

  function renderRankingTable() {
    $("ranking-body").innerHTML = state.scored.rows.map((row, index) => `
      <tr class="${index === 0 ? "top-row" : ""}">
        <td><span class="rank-number">${Number.isFinite(row.finalScore) ? index + 1 : "—"}</span></td>
        <td><strong>${escapeHtml(row.model)}</strong><br><span class="small muted">${escapeHtml(row.status)}</span></td>
        <td class="numeric final-score">${fmt(row.finalScore, 2)}</td>
        <td class="numeric">${fmt(row.dimensions.pixel?.adjusted, 3)}</td>
        <td class="numeric">${fmt(row.dimensions.thin?.adjusted, 3)}</td>
        <td class="numeric">${fmt(row.dimensions.structure?.adjusted, 3)}</td>
        <td class="numeric">${fmt(row.dimensions.resource?.adjusted, 3)}</td>
      </tr>
    `).join("");
  }

  function renderFormula(options) {
    const weights = RankingScoring.normalizeWeights(options.weights);
    $("formula-text").innerHTML = `
      <div><strong>1. Pixel score:</strong> F<sub>β</sub>=(1+β²)·Precision·Sensitivity/(β²·Precision+Sensitivity), β=${options.beta.toFixed(2)}</div>
      <div><strong>2. Thin score:</strong> TVS=covered GT-thin-skeleton pixels / all GT-thin-skeleton pixels</div>
      <div><strong>3. Structure score:</strong> ${options.eta.toFixed(2)}·clDice + ${(1 - options.eta).toFixed(2)}·SF1</div>
      <div><strong>4. Resource score:</strong> mean(best observed cost / model cost); missing fields receive neutral utility 0.50</div>
      <div><strong>5. Cross-dataset aggregation:</strong> ${(1 - options.risk).toFixed(2)}·equal-dataset mean + ${options.risk.toFixed(2)}·worst dataset</div>
      <div><strong>6. Final score:</strong> 100·(${weights.pixel.toFixed(2)}·Pixel + ${weights.thin.toFixed(2)}·Thin + ${weights.structure.toFixed(2)}·Structure + ${weights.resource.toFixed(2)}·Resource)</div>
    `;
  }

  function renderMetricConsistency() {
    const leaders = state.scored.metricLeaders;
    const message = `Mean F1 leader: ${leaders.f1?.model || "n/a"}; IoU leader: ${leaders.iou?.model || "n/a"}; MCC leader: ${leaders.mcc?.model || "n/a"}.`;
    $("metric-consistency").className = state.scored.metricConsistency ? "notice success" : "notice warning";
    $("metric-consistency").innerHTML = `<strong>${state.scored.metricConsistency ? "Cross-metric consistency" : "Cross-metric inconsistency"}</strong><span>${escapeHtml(message)} IoU and MCC are checks, not counted again.</span>`;
  }

  function renderRecommendation() {
    const recommendation = RankingScoring.recommendShortlist(state.scored.rows, [], state.scored.risk);
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
    ].filter(([, value]) => Number.isFinite(value))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2);
  }

  function renderModelCards() {
    const container = $("model-cards");
    container.innerHTML = "";
    state.scored.rows.forEach((row, index) => {
      const card = document.createElement("article");
      card.className = `model-card ${index === 0 ? "winner-card" : ""}`;
      const errors = errorProfileFor(row.model);
      const dominant = dominantErrors(errors)
        .map(([name, value]) => `${name} ${value.toFixed(1)}%`)
        .join("; ");
      const resource = row.resource;
      card.innerHTML = `
        <div class="model-card-header">
          <div><span class="rank-chip">${index + 1}</span><h3>${escapeHtml(row.model)}</h3></div>
          <strong class="card-score">${fmt(row.finalScore, 2)}</strong>
        </div>
        <div class="metric-grid">
          <span><b>Mean F1</b>${fmt(row.summary.f1)}</span>
          <span><b>Worst F1</b>${fmt(row.summary.f1Worst)} <small>${escapeHtml(row.summary.f1WorstDataset)}</small></span>
          <span><b>Mean TVS</b>${fmt(row.summary.tvs)}</span>
          <span><b>Mean clDice</b>${fmt(row.summary.cldice)}</span>
          <span><b>Mean SF1</b>${fmt(row.summary.sf1)}</span>
          <span><b>Mean sensitivity</b>${fmt(row.summary.sensitivity)}</span>
          <span><b>Mean precision</b>${fmt(row.summary.precision)}</span>
          <span><b>Resource utility</b>${fmt(resource?.score, 3)} <small>${pct(resource?.completeness, 0)} fields measured</small></span>
        </div>
        <div class="error-chart" id="error-${index}"></div>
        <p class="small"><strong>Dominant residual error composition:</strong> ${dominant || "n/a"}.</p>
        <p class="small muted">Error share = category error pixels / all structural-error pixels. It explains failure type and is not added to the score.</p>
      `;
      container.appendChild(card);
      RankingCharts.errorComposition(card.querySelector(`#error-${index}`), errors);
    });
  }

  function bindEvents() {
    document.querySelectorAll("[data-preset]").forEach((button) => {
      button.addEventListener("click", () => applyPreset(button.dataset.preset));
    });

    $("fnfp-preference").addEventListener("change", () => {
      $("beta").value = RankingScoring.betaFromPreference($("fnfp-preference").value);
      document.querySelectorAll("[data-preset]").forEach((button) => button.classList.remove("active"));
      updateControlLabels();
      renderRanking();
    });

    ["pixel", "thin", "structure", "resource"].forEach((name) => {
      $(`${name}-weight`).addEventListener("input", () => {
        rebalanceWeights(name);
        document.querySelectorAll("[data-preset]").forEach((button) => button.classList.remove("active"));
        updateControlLabels();
        renderRanking();
      });
    });

    ["aggregation-mode", "beta", "eta"].forEach((id) => {
      $(id).addEventListener("input", () => {
        document.querySelectorAll("[data-preset]").forEach((button) => button.classList.remove("active"));
        updateControlLabels();
        renderRanking();
      });
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindEvents();
    loadData();
  });
})();
