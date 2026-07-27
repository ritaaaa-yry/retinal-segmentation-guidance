# Retinal Vessel Segmentation Model Ranking Page

A complete static GitHub Pages site that ranks retinal-vessel segmentation models from the benchmark CSV evidence bundled in this folder.

Visitors do **not** upload CSV files. The site loads the built-in evidence automatically.

## What is included

- 20 source CSV files under `data/source/`.
- 1,220 merged image-level model records under `data/built/ranking_evidence_perimage.csv`.
- Pixel, thin-vessel, clDice/SF1, error-profile, and consistency evidence.
- Task presets and editable task weights.
- FN–FP control through `F_beta`.
- Mean–worst cross-dataset risk adjustment.
- Proper paired image-level bootstrap.
- Weight-sensitivity analysis.
- Error-profile explanations that are not incorrectly added to the score.
- Automated data-integrity checks.
- No hardcoded model ranking or winner.

## Source-role policy

The 20 CSV files are not counted as 20 independent metrics.

### Scoring evidence

1. `009__perimage(1).csv`
   - image-level Sensitivity, Precision, F1, IoU, and MCC;
   - used to calculate the pixel `F_beta` utility.
2. `013__source_thin_vessel_perimage(1).csv`
   - image-level thin-vessel sensitivity proxy (TVS);
   - used as the thin-vessel utility.
3. `017__source_centerline_perimage_cldice_sf1(1).csv`
   - image-level clDice and SkeletonF1_r2;
   - used as the structure utility.

### Risk context

Error-composition CSV files are shown in model cards but are not added to the score. A percentage such as `missed vessel / total classified errors` does not measure absolute FN burden.

### Validation and provenance

Summary, figure-source, inventory, task-reference, and legacy duplicate files are used to verify that the merged evidence agrees with the published intermediate outputs. They are not double-counted.

See `data/built/manifest.json` and the Audit section of the page for the complete mapping.

## Score

### Pixel utility

For each image:

```text
F_beta = (1 + beta^2) * Precision * Sensitivity
         / (beta^2 * Precision + Sensitivity)
```

Preset mapping:

- Low FP: `beta = 0.5`
- Balanced: `beta = 1`
- Low FN: `beta = 2`
- Very low FN: `beta = 3`

### Thin-vessel utility

```text
Thin = TVS
```

Overall Sensitivity is not added again because recall is already represented in `F_beta`.

### Structure utility

```text
Structure = eta * clDice + (1 - eta) * SF1
```

Default: `eta = 0.8`.

### Equal-dataset aggregation and domain-risk adjustment

Image-level utilities are averaged within each model–dataset pair first. The six datasets then receive equal weight.

```text
Adjusted(X) = (1 - r) * equal_dataset_mean(X)
              + r * worst_dataset(X)
```

- `r = 0`: mean only
- `r = 1`: worst dataset only

### Final score

```text
FinalScore = 100 * (
  normalized_pixel_weight * Adjusted(Pixel)
  + normalized_thin_weight * Adjusted(Thin)
  + normalized_structure_weight * Adjusted(Structure)
)
```

No model-relative min–max scaling is used. The score retains the original metric meaning and does not change merely because another model is added or removed.

## Stability

### Paired bootstrap

The site resamples image identities within each dataset. The same sampled images are applied to every model, preserving paired comparison. It reports:

- score median;
- score 95% interval;
- top-1 frequency;
- top-2 frequency.

### Weight sensitivity

Active task weights are independently varied by ±20% and renormalized. The resulting top-1 frequency measures sensitivity to user preferences. It is not a statistical probability of model superiority.

## Data-integrity checks

Run:

```bash
python scripts/build_data.py
```

The script:

- normalizes model aliases;
- joins all three image-level evidence sources by model, dataset, and image;
- verifies all 1,220 keys align;
- rebuilds model–dataset and model summaries;
- checks them against the supplied summary CSV files;
- checks current and legacy structure per-image files agree;
- checks mask inventory counts;
- writes `data/built/data_quality.json`.

Current bundled checks pass.

### Threshold warning

The current source rows report:

```text
diagnostic_test_set_scan_equal_dataset_macro_F1
```

The site displays this warning. These results must not be described as validation-selected thresholds unless the source files are replaced with validation-selected outputs.

## Run locally

Do not double-click `index.html`, because browsers normally block local `fetch()` requests.

From this folder run:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## Tests

```bash
node tests/scoring.test.js
```

Expected output:

```text
scoring tests passed
```

## Deploy to GitHub Pages

See `DEPLOY_TO_GITHUB.txt` for step-by-step instructions.

## Update the evidence later

1. Replace the relevant CSV files in `data/source/` without changing the filenames expected by `scripts/build_data.py`.
2. Run:

```bash
python scripts/build_data.py
node tests/scoring.test.js
```

3. Commit both the source files and regenerated `data/built/` files.
4. Push to GitHub. GitHub Pages will update automatically.

## Important interpretation limit

This page is a decision aid based on six benchmark datasets. It does not prove that the first-ranked model will remain first on an unseen target domain. Labelled target-domain validation should override the benchmark-relative ranking.
