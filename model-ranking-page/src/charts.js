(function (global) {
  "use strict";

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function scoreBars(container, rows) {
    container.innerHTML = "";
    const usable = rows.filter((row) => Number.isFinite(row.finalScore));
    if (!usable.length) {
      container.innerHTML = '<p class="muted">No complete score is available.</p>';
      return;
    }
    const wrapper = document.createElement("div");
    wrapper.className = "score-bars";
    usable.forEach((row, index) => {
      const item = document.createElement("div");
      item.className = "score-bar-row";
      item.innerHTML = `
        <div class="score-label"><span class="rank-chip">${index + 1}</span><strong>${escapeHtml(row.model)}</strong></div>
        <div class="score-track"><div class="score-fill" style="width:${Math.max(0, Math.min(100, row.finalScore))}%"></div></div>
        <div class="score-value">${row.finalScore.toFixed(2)}</div>
      `;
      wrapper.appendChild(item);
    });
    container.appendChild(wrapper);
  }

  function frequencyBars(container, rows, key, label) {
    container.innerHTML = "";
    const wrapper = document.createElement("div");
    wrapper.className = "frequency-list";
    rows.forEach((row) => {
      const value = Number(row[key]);
      const percent = Number.isFinite(value) ? 100 * value : 0;
      const item = document.createElement("div");
      item.className = "frequency-row";
      item.innerHTML = `
        <span>${escapeHtml(row.model)}</span>
        <div class="frequency-track"><div class="frequency-fill" style="width:${Math.max(0, Math.min(100, percent))}%"></div></div>
        <strong>${Number.isFinite(value) ? percent.toFixed(1) + "%" : "n/a"}</strong>
      `;
      wrapper.appendChild(item);
    });
    const title = document.createElement("h3");
    title.textContent = label;
    container.append(title, wrapper);
  }

  function errorComposition(container, errorRow) {
    container.innerHTML = "";
    if (!errorRow) {
      container.innerHTML = '<p class="muted">No error-profile data.</p>';
      return;
    }
    const parts = [
      ["Boundary shift", errorRow.boundary_shift_percent, "error-shift"],
      ["Too thin", errorRow.too_thin_percent, "error-thin"],
      ["Missed vessel", errorRow.missed_vessel_percent, "error-missed"],
      ["Too thick", errorRow.too_thick_percent, "error-thick"],
      ["Extra vessel", errorRow.extra_vessel_percent, "error-extra"],
    ];
    const bar = document.createElement("div");
    bar.className = "stacked-bar";
    parts.forEach(([label, value, className]) => {
      if (!Number.isFinite(value)) return;
      const segment = document.createElement("span");
      segment.className = `stack-segment ${className}`;
      segment.style.width = `${Math.max(0, value)}%`;
      segment.title = `${label}: ${value.toFixed(1)}%`;
      bar.appendChild(segment);
    });
    const legend = document.createElement("div");
    legend.className = "error-legend";
    parts.forEach(([label, value, className]) => {
      const item = document.createElement("span");
      item.innerHTML = `<i class="legend-dot ${className}"></i>${escapeHtml(label)} ${Number.isFinite(value) ? value.toFixed(1) + "%" : "n/a"}`;
      legend.appendChild(item);
    });
    container.append(bar, legend);
  }

  const api = { escapeHtml, scoreBars, frequencyBars, errorComposition };
  global.RankingCharts = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
