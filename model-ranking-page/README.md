# Retinal Vessel Segmentation Model Ranking Page

A complete static GitHub Pages site that ranks retinal-vessel segmentation models from benchmark CSV evidence bundled in this folder.

Visitors do **not** upload CSV files. The site loads the built-in evidence automatically.

## Visible page structure

1. Bundled evidence overview.
2. Task presets and editable decision weights.
3. Task-conditioned model ranking with transparent formulas.
4. Model profiles and residual-error interpretation.

The following extended sections were intentionally removed from the visible page to keep it concise:

- Top-candidate breakdown across six datasets.
- Ranking stability.
- GPU and training-resource profile table.
- Data integrity and source roles.
- What the score means—and what it does not mean.

The underlying CSVs, resource profiles, build script, and scoring tests remain bundled for reproducibility.

## Task presets

- Balanced multi-objective.
- Pixel level comparison.
- Low FN / thin vessels.
- Structural fidelity.
- Unknown-domain robustness.
- Low GPU / compute cost.

The former **Low FP** preset button was removed. Low-FP behaviour remains available manually through the FN–FP preference selector, which sets `beta = 0.5`.

## Task weights

The four visible task weights always sum to 100%:

```text
Pixel + Thin vessel + Structure + Resource = 100%
```

Cross-dataset aggregation is selected separately:

- Mean only.
- Balanced: 70% mean + 30% worst.
- Robust: 30% mean + 70% worst.

## Score formulas

### Pixel

```text
F_beta = (1 + beta^2) * Precision * Sensitivity
         / (beta^2 * Precision + Sensitivity)
```

### Thin vessel

```text
Thin = TVS
```

### Structure

```text
Structure = eta * clDice + (1 - eta) * SF1
```

### Resource

The provisional resource utility uses parameters, GFLOPs, checkpoint size, peak allocated VRAM, and total training time:

```text
utility_j(model) = min observed cost_j / model cost_j
Resource = mean(metric utilities)
```

Missing resource fields receive neutral utility `0.50`. This is training-resource evidence from different frameworks and input sizes, not an identical-hardware deployment benchmark.

### Cross-dataset aggregation

```text
Adjusted(X) = (1 - r) * equal-dataset mean(X)
              + r * worst dataset(X)
```

### Final score

```text
FinalScore = 100 * (
  w_pixel * Adjusted(Pixel)
  + w_thin * Adjusted(Thin)
  + w_structure * Adjusted(Structure)
  + w_resource * Resource
)
```

No model-relative min–max scaling is used.

## Bundled evidence

- 20 source CSV files under `data/source/`.
- 1,220 merged image-level records under `data/built/ranking_evidence_perimage.csv`.
- Pixel, TVS, clDice/SF1, error-profile, validation, and provenance evidence.
- `data/built/resource_profiles.csv` for the optional compute-efficiency dimension.

## Run locally

From the repository root:

```bash
python -m http.server 8000
```

Open:

```text
http://localhost:8000/model-ranking-page/
```

Do not double-click `index.html`, because browsers normally block local `fetch()` requests.

## Tests

```bash
node model-ranking-page/tests/scoring.test.js
```

Expected output:

```text
scoring tests passed
```

## Update evidence later

1. Replace the relevant source files under `data/source/`.
2. Run:

```bash
python model-ranking-page/scripts/build_data.py
node model-ranking-page/tests/scoring.test.js
```

3. Commit the regenerated `data/built/` outputs together with the source changes.

## Interpretation limit

This page is a benchmark-relative decision aid based on six datasets. Labelled validation on the real target domain should override the displayed ranking.
