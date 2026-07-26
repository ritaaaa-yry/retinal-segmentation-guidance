(function () {
  const state = { results: [], metadata: [], validation: null };
  const $ = (id) => document.getElementById(id);

  function optionsFromUi() {
    const preset = $("fnfp").value;
    const thinWeight = Number($("thin").value) / 100;
    const structureWeight = Number($("structure").value) / 100;
    const risk = Number($("risk").value) / 100;
    const deploy = Number($("deploy").value) / 100;
    return {
      fnfpPreference: preset,
      beta: Number($("beta").value) || RankingScoring.betaFromPreference(preset),
      eta: Number($("eta").value),
      risk,
      pixelWeight: Math.max(0.1, 1 - 0.25 * thinWeight - 0.25 * structureWeight),
      thinWeight,
      structureWeight,
      deploymentWeight: deploy,
      strictMode: $("strict").checked,
      constraints: {
        requireCode: $("require-code").checked,
        requireWeights: $("require-weights").checked,
        maxParams: $("max-params").value,
        maxLatency: $("max-latency").value,
        maxVram: $("max-vram").value,
        minFps: $("min-fps").value,
      },
    };
  }

  function renderValidation() {
    const box = $("validation");
    const v = state.validation;
    if (!v) return;
    box.innerHTML = [
      `<strong>${v.errors.length ? "Fatal errors" : "Validation passed"}</strong>`,
      ...v.errors.map((e) => `<p class="error">${e}</p>`),
      ...v.warnings.map((w) => `<p class="warning">${w}</p>`),
      `<p>Rows: ${state.results.length}. Threshold protocols: ${v.thresholdSources.join(", ") || "not reported"}.</p>`,
    ].join("");
  }

  function render() {
    if (!state.results.length) return;
    const options = optionsFromUi();
    const result = RankingScoring.scoreModels(state.results, state.metadata, options);
    $("formula").textContent = `beta=${result.beta}, eta=${result.eta}, r=${result.risk.toFixed(2)}, weights pixel/thin/structure/deployment=${result.weights.pixel.toFixed(2)}/${result.weights.thin.toFixed(2)}/${result.weights.structure.toFixed(2)}/${result.weights.deployment.toFixed(2)}. Default aggregation uses equal dataset weighting.`;
    const tbody = $("ranking-body");
    tbody.innerHTML = "";
    result.rows.forEach((row, i) => {
      const tr = document.createElement("tr");
      const score = row.finalScore === null ? "n/a" : row.finalScore.toFixed(2);
      tr.innerHTML = `<td>${row.finalScore === null ? "-" : i + 1}</td><td>${row.model}</td><td>${score}</td><td>${fmt(row.pixel)}</td><td>${fmt(row.thin)}</td><td>${fmt(row.structure)}</td><td>n/a</td><td>${(row.coverage * 100).toFixed(0)}%</td><td>${row.feasibility}</td>`;
      tbody.appendChild(tr);
    });
    renderCards(result.rows);
    RankingCharts.renderBars($("score-chart"), result.rows, "finalScore", "FinalScore");
    const freq = RankingBootstrap.weightSensitivity(state.results, state.metadata, options, 500);
    RankingCharts.renderFrequency($("stability"), freq);
    $("bootstrap-note").textContent = `${RankingBootstrap.bootstrapStatus(state.results).message} Weight-stability frequency reflects sensitivity to user preference settings, not statistical model superiority.`;
  }

  function fmt(value) {
    return Number.isFinite(value) ? value.toFixed(3) : "n/a";
  }

  function renderCards(rows) {
    const cards = $("cards");
    cards.innerHTML = "";
    rows.forEach((row) => {
      const div = document.createElement("article");
      div.className = "model-card";
      div.innerHTML = `<h3>${row.model}</h3><p><b>Why ranked here:</b> current task utilities give pixel=${fmt(row.pixel)}, thin=${fmt(row.thin)}, structure=${fmt(row.structure)}.</p><p><b>Main trade-off:</b> ${row.missing.length ? `missing ${row.missing.join(", ")}` : "all active benchmark metric dimensions available"}.</p><p><b>Worst observed pixel utility:</b> ${fmt(row.worstPixel)}.</p><p><b>Feasibility:</b> ${row.feasibility}${row.reasons.length ? ` (${row.reasons.join("; ")})` : ""}.</p>`;
      cards.appendChild(div);
    });
  }

  async function loadBundled() {
    const [results, metadata] = await Promise.all([
      fetch("data/results_current_from_local.csv").then((r) => r.text()).then(RankingCsv.parseCsv),
      fetch("data/model_metadata_current_from_local.csv").then((r) => r.text()).then(RankingCsv.parseCsv),
    ]);
    setData(results, metadata);
  }

  async function loadUploaded() {
    const resultsFile = $("results-file").files[0];
    const metadataFile = $("metadata-file").files[0];
    if (!resultsFile) return;
    const results = RankingCsv.parseCsv(await RankingCsv.readFile(resultsFile));
    const metadata = metadataFile ? RankingCsv.parseCsv(await RankingCsv.readFile(metadataFile)) : [];
    setData(results, metadata);
  }

  function setData(results, metadata) {
    state.results = results;
    state.metadata = metadata || [];
    state.validation = RankingValidation.validateResults(results);
    renderValidation();
    if (!state.validation.errors.length) render();
  }

  function updateLabels() {
    ["thin", "structure", "risk", "deploy"].forEach((id) => ($(id + "-value").textContent = $("" + id).value));
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("load-bundled").addEventListener("click", loadBundled);
    $("load-uploaded").addEventListener("click", loadUploaded);
    $("fnfp").addEventListener("change", () => {
      $("beta").value = RankingScoring.betaFromPreference($("fnfp").value);
      updateLabels();
      render();
    });
    document.querySelectorAll("input, select").forEach((el) => {
      if (el.id === "fnfp") return;
      el.addEventListener("input", () => { updateLabels(); render(); });
    });
    updateLabels();
    loadBundled();
  });
})();
