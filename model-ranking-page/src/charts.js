(function (global) {
  function pct(value) {
    return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "n/a";
  }

  function renderBars(container, rows, key, label) {
    container.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "bars";
    rows.forEach((row) => {
      const value = row[key];
      const item = document.createElement("div");
      item.className = "bar-row";
      item.innerHTML = `<span>${row.model}</span><div class="bar-track"><div class="bar-fill" style="width:${Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0}%"></div></div><b>${Number.isFinite(value) ? value.toFixed(2) : "n/a"}</b>`;
      wrap.appendChild(item);
    });
    const title = document.createElement("h3");
    title.textContent = label;
    container.append(title, wrap);
  }

  function renderFrequency(container, rows) {
    container.innerHTML = "";
    rows.forEach((row) => {
      const item = document.createElement("div");
      item.className = "freq";
      item.innerHTML = `<span>${row.model}</span><strong>${pct(row.frequency)}</strong>`;
      container.appendChild(item);
    });
  }

  global.RankingCharts = { renderBars, renderFrequency };
})(typeof window !== "undefined" ? window : globalThis);
