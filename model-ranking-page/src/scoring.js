(function (global) {
  "use strict";

  const EPSILON = 1e-12;
  const RESOURCE_FIELDS = ["parameters_m", "gflops", "checkpoint_mb", "peak_allocated_vram_gb", "total_training_time_s"];

  function finite(value) { return Number.isFinite(value); }
  function mean(values) {
    const usable = values.filter(finite);
    return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
  }
  function sampleSd(values) {
    const usable = values.filter(finite);
    if (usable.length < 2) return usable.length ? 0 : null;
    const avg = mean(usable);
    return Math.sqrt(usable.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (usable.length - 1));
  }
  function betaFromPreference(preference) {
    return {"Low FP": 0.5, Balanced: 1, "Low FN": 2, "Very low FN": 3}[preference] || 1;
  }
  function fBeta(precision, sensitivity, beta) {
    if (!finite(precision) || !finite(sensitivity) || !finite(beta) || beta <= 0) return null;
    const betaSquared = beta * beta;
    const denominator = betaSquared * precision + sensitivity;
    if (Math.abs(denominator) <= EPSILON) return 0;
    return ((1 + betaSquared) * precision * sensitivity) / denominator;
  }
  function structureUtility(cldice, sf1, eta) {
    if (!finite(cldice) || !finite(sf1) || !finite(eta)) return null;
    return eta * cldice + (1 - eta) * sf1;
  }
  function groupBy(records, keyFn) {
    const result = new Map();
    records.forEach((record) => {
      const key = keyFn(record);
      if (!result.has(key)) result.set(key, []);
      result.get(key).push(record);
    });
    return result;
  }
  function aggregateDatasetUtilities(records, beta, eta) {
    const grouped = groupBy(records, (row) => `${row.model}||${row.dataset}`);
    const output = [];
    grouped.forEach((rows) => {
      const first = rows[0];
      const values = {
        pixel: rows.map((row) => fBeta(row.precision, row.sensitivity, beta)),
        thin: rows.map((row) => row.tvs),
        structure: rows.map((row) => structureUtility(row.cldice, row.sf1, eta)),
        f1: rows.map((row) => row.f1), sensitivity: rows.map((row) => row.sensitivity),
        precision: rows.map((row) => row.precision), iou: rows.map((row) => row.iou),
        mcc: rows.map((row) => row.mcc), tvs: rows.map((row) => row.tvs),
        cldice: rows.map((row) => row.cldice), sf1: rows.map((row) => row.sf1),
      };
      const summary = { model: first.model, dataset: first.dataset, n: rows.length };
      Object.entries(values).forEach(([metric, metricValues]) => {
        summary[metric] = mean(metricValues);
        summary[`${metric}Sd`] = sampleSd(metricValues);
        const usable = metricValues.filter(finite);
        summary[`${metric}Min`] = usable.length ? Math.min(...usable) : null;
        summary[`${metric}Max`] = usable.length ? Math.max(...usable) : null;
      });
      output.push(summary);
    });
    return output.sort((a, b) => a.model.localeCompare(b.model) || a.dataset.localeCompare(b.dataset));
  }
  function riskAdjust(values, risk) {
    const usable = values.filter(finite);
    if (!usable.length) return { adjusted: null, mean: null, worst: null, sd: null };
    const avg = mean(usable);
    const worst = Math.min(...usable);
    return { adjusted: (1 - risk) * avg + risk * worst, mean: avg, worst, sd: sampleSd(usable) };
  }
  function normalizeWeights(weights) {
    const cleaned = {
      pixel: Math.max(0, Number(weights.pixel) || 0),
      thin: Math.max(0, Number(weights.thin) || 0),
      structure: Math.max(0, Number(weights.structure) || 0),
      resource: Math.max(0, Number(weights.resource) || 0),
    };
    const total = cleaned.pixel + cleaned.thin + cleaned.structure + cleaned.resource;
    if (total <= 0) return { pixel: 1, thin: 0, structure: 0, resource: 0, total: 1 };
    return { pixel: cleaned.pixel/total, thin: cleaned.thin/total, structure: cleaned.structure/total, resource: cleaned.resource/total, total };
  }
  function computeResourceScores(profiles, missingNeutral = 0.5) {
    const minima = {};
    RESOURCE_FIELDS.forEach((field) => {
      const vals = profiles.map((row) => Number(row[field])).filter((v) => finite(v) && v > 0);
      minima[field] = vals.length ? Math.min(...vals) : null;
    });
    const result = {};
    profiles.forEach((profile) => {
      const utilities = {};
      let available = 0;
      RESOURCE_FIELDS.forEach((field) => {
        const value = Number(profile[field]);
        if (finite(value) && value > 0 && finite(minima[field])) {
          utilities[field] = Math.min(1, minima[field] / value);
          available += 1;
        } else {
          utilities[field] = missingNeutral;
        }
      });
      result[profile.model] = {
        score: mean(Object.values(utilities)),
        completeness: available / RESOURCE_FIELDS.length,
        status: profile.profile_status || (available === RESOURCE_FIELDS.length ? "measured" : "partial"),
        utilities,
        profile,
      };
    });
    return result;
  }
  function scoreDatasetUtilities(datasetUtilities, options) {
    const risk = Math.min(1, Math.max(0, Number(options.risk) || 0));
    const strictMode = options.strictMode !== false;
    const weights = normalizeWeights(options.weights || { pixel: 1, thin: 0, structure: 0, resource: 0 });
    const resourceScores = options.resourceScores || {};
    const models = [...new Set(datasetUtilities.map((row) => row.model))].sort();
    const allDatasets = [...new Set(datasetUtilities.map((row) => row.dataset))].sort();
    const byModel = groupBy(datasetUtilities, (row) => row.model);

    const rows = models.map((model) => {
      const modelRows = byModel.get(model) || [];
      const byDataset = Object.fromEntries(modelRows.map((row) => [row.dataset, row]));
      const active = [["pixel", weights.pixel],["thin", weights.thin],["structure", weights.structure],["resource", weights.resource]].filter(([,w])=>w>0);
      const dimensions = {};
      const missing = [];
      active.forEach(([dimension]) => {
        if (dimension === "resource") {
          const resource = resourceScores[model];
          const value = resource?.score;
          dimensions.resource = { adjusted: finite(value) ? value : null, mean: value, worst: value, sd: 0, coverage: finite(value) ? 1 : 0, evidenceCompleteness: resource?.completeness ?? 0, evidenceStatus: resource?.status || "unavailable" };
          if (!finite(value)) missing.push("resource profile");
          return;
        }
        const values = allDatasets.map((dataset) => byDataset[dataset]?.[dimension]);
        const coverage = values.filter(finite).length / allDatasets.length;
        dimensions[dimension] = { ...riskAdjust(values, risk), coverage };
        if (coverage < 1) missing.push(`${dimension} (${Math.round(coverage * 100)}% datasets)`);
      });
      const requestedWeight = active.reduce((sum,[,w])=>sum+w,0);
      const availableWeight = active.reduce((sum,[dimension,w])=>sum+(finite(dimensions[dimension]?.adjusted)?w:0),0);
      const coverage = requestedWeight ? availableWeight/requestedWeight : 0;
      const strictFailure = strictMode && (coverage < 1 || missing.length > 0);
      const denominator = strictMode ? requestedWeight : availableWeight;
      const numerator = active.reduce((sum,[dimension,w])=>sum+(finite(dimensions[dimension]?.adjusted)?w*dimensions[dimension].adjusted:0),0);
      const finalScore = !strictFailure && denominator > 0 ? 100*numerator/denominator : null;
      const summary = {};
      ["f1","sensitivity","precision","iou","mcc","tvs","cldice","sf1"].forEach((metric)=>{
        const values = allDatasets.map((dataset)=>byDataset[dataset]?.[metric]);
        const adjusted = riskAdjust(values,risk);
        summary[metric]=adjusted.mean; summary[`${metric}Worst`]=adjusted.worst; summary[`${metric}Sd`]=adjusted.sd;
        if (finite(adjusted.worst)) {
          const worstRow=modelRows.reduce((current,candidate)=>!finite(candidate[metric])?current:(!current||candidate[metric]<current[metric]?candidate:current),null);
          summary[`${metric}WorstDataset`]=worstRow?.dataset||"";
        }
      });
      return { model, finalScore, coverage, missing, dimensions, summary, datasetRows:modelRows, resource:resourceScores[model]||null, status: strictFailure?"Insufficient evidence":(coverage<1?"Provisional":"Complete") };
    });
    rows.sort((a,b)=>{ if(!finite(a.finalScore)&&!finite(b.finalScore))return a.model.localeCompare(b.model); if(!finite(a.finalScore))return 1; if(!finite(b.finalScore))return -1; if(Math.abs(b.finalScore-a.finalScore)>EPSILON)return b.finalScore-a.finalScore; return a.model.localeCompare(b.model); });
    return { rows, risk, weights, datasets:allDatasets };
  }
  function metricLeaders(datasetUtilities) {
    const models=[...new Set(datasetUtilities.map((row)=>row.model))]; const byModel=groupBy(datasetUtilities,(row)=>row.model); const metrics=["f1","iou","mcc"]; const leaders={};
    metrics.forEach((metric)=>{ const values=models.map((model)=>({model,value:mean((byModel.get(model)||[]).map((row)=>row[metric]))})).filter((item)=>finite(item.value)); values.sort((a,b)=>b.value-a.value||a.model.localeCompare(b.model)); leaders[metric]=values[0]||null; });
    return leaders;
  }
  function scoreModels(records, options={}) {
    const beta=Number(options.beta)>0?Number(options.beta):betaFromPreference(options.preference); const eta=Math.min(1,Math.max(0,Number(options.eta??0.8)));
    const datasetUtilities=aggregateDatasetUtilities(records,beta,eta); const scored=scoreDatasetUtilities(datasetUtilities,options); const leaders=metricLeaders(datasetUtilities); const leaderNames=new Set(Object.values(leaders).filter(Boolean).map((entry)=>entry.model));
    return {...scored,beta,eta,datasetUtilities,metricLeaders:leaders,metricConsistency:leaderNames.size<=1};
  }
  function recommendShortlist(scoredRows, bootstrapRows, risk) {
    const ranked=scoredRows.filter((row)=>finite(row.finalScore)); if(!ranked.length)return{type:"none",models:[],reason:"No complete score is available."}; if(ranked.length===1)return{type:"single",models:[ranked[0].model],reason:"Only one model has a complete score."};
    const gap=ranked[0].finalScore-ranked[1].finalScore; const bootstrapMap=Object.fromEntries((bootstrapRows||[]).map((row)=>[row.model,row])); const topFrequency=bootstrapMap[ranked[0].model]?.top1Frequency; const unstable=finite(topFrequency)&&topFrequency<0.6;
    if(gap<1||unstable||risk>=0.65){const reasons=[];if(gap<1)reasons.push(`top-score gap is only ${gap.toFixed(2)} points`);if(unstable)reasons.push(`bootstrap top-1 frequency is ${(100*topFrequency).toFixed(1)}%`);if(risk>=0.65)reasons.push("the unknown-domain aggregation is conservative");return{type:"shortlist",models:[ranked[0].model,ranked[1].model],reason:reasons.join("; ")};}
    return{type:"single",models:[ranked[0].model],reason:`top-score gap is ${gap.toFixed(2)} points`};
  }
  const api={mean,sampleSd,betaFromPreference,fBeta,structureUtility,aggregateDatasetUtilities,riskAdjust,normalizeWeights,computeResourceScores,scoreDatasetUtilities,metricLeaders,scoreModels,recommendShortlist,RESOURCE_FIELDS};
  global.RankingScoring=api; if(typeof module!=="undefined")module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
