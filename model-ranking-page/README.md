# Retinal Vessel Segmentation Model Ranking Page

A complete static GitHub Pages site that ranks retinal-vessel segmentation models from benchmark CSV evidence bundled in this folder.

Visitors do **not** upload CSV files. The site loads the built-in evidence automatically.

## Visible page structure

1. Bundled evidence overview.
2. Task presets and editable decision weights.
3. Task-conditioned model ranking with transparent formulas.
4. Model profiles and residual-error interpretation.
5. Latest local computing-cost evidence.
6. Chapter 5 dataset fingerprints.
7. Chapter 6 boundary-exclusion sensitivity.
8. Chapter 7 GT-informed oracle upper bounds.

The ranking remains concise, while the latest Chapter 5-7 evidence is shown in compact tables. Every displayed value is bundled as CSV under `data/source/` and regenerated into `data/built/`.

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

The provisional resource utility uses parameters, GFLOPs, checkpoint size, peak allocated VRAM, total training time, and epoch time:

```text
utility_j(model) = min observed cost_j / model cost_j
Resource = mean(metric utilities)
```

Missing resource fields receive neutral utility `0.50`. SA-UNetv2's locally recorded 1028 × 1028 FIVES run now contributes 260,521 parameters, 78.179 GFLOPs, a 3.236 MiB checkpoint, 13.182 GB peak allocated GPU memory, 1,010.708 s total training time, and 13.450 s mean logged epoch time (75 completed epochs; 150 configured). This is heterogeneous training-resource evidence from different frameworks and input sizes, not an identical-hardware deployment benchmark.

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

- 18 source CSV files under `data/source/`.
- 1,220 image-level records under `data/built/ranking_evidence_perimage.csv`.
- Chapter 4 pixel, TVS, clDice/SF1, error-profile, and scenario evidence.
- Chapter 5 dataset fingerprints, Chapter 6 boundary sensitivity, and Chapter 7 oracle upper bounds.
- `data/built/resource_profiles.csv` generated from the local `training_monitor/outputs` evidence.

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

The builder verifies the 1,220 image keys, reconstructs precision and sensitivity exactly from Chapter 4 image-level F1/F2, reconciles equal-dataset mean F1 to Table 4.3, and requires all 30 model-dataset combinations.

## Interpretation limit

This page is a benchmark-relative decision aid based on six datasets. Labelled validation on the real target domain should override the displayed ranking. Oracle vote and Laplacian repair are GT-informed upper bounds and must not be described as deployable methods.
