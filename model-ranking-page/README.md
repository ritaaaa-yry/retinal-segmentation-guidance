# Retinal Vessel Model Ranking Page

This folder contains a static, CSV-driven model selection page for retinal vessel segmentation experiments. It is designed as a task-conditioned decision utility rather than a general leaderboard.

## Data Source

The bundled current dataset is `data/results_current_from_local.csv`. It is a 30-row model-by-dataset summary aggregated from 1,220 refreshed local per-image rows in the six-module experiment output folder.

The page can also load user-supplied per-image or per-dataset CSV files through the upload controls. The code does not hardcode model names, rankings, scores, or recommendations; all displayed rankings are computed from the loaded CSV.

## Files

- `index.html` - static app entry point.
- `styles.css` - page styling.
- `src/csv.js` - CSV parser and numeric conversion helpers.
- `src/validation.js` - schema, value-range, duplicate, and protocol checks.
- `src/aggregation.js` - equal-dataset aggregation and risk adjustment.
- `src/scoring.js` - hard-constraint filtering and task-conditioned scoring.
- `src/bootstrap.js` - deterministic weight-sensitivity summary and bootstrap status.
- `src/charts.js` - compact SVG charts.
- `data/results_current_from_local.csv` - current local measured results.
- `data/model_metadata_current_from_local.csv` - metadata shell for current models.
- `data/results_template.csv` - upload template.
- `data/model_metadata_template.csv` - optional deployment metadata template.
- `data/dataset_features_template.csv` - optional dataset metadata template.
- `data/synthetic_demo_results.csv` - clearly labeled synthetic demo CSV.
- `tests/scoring.test.js` - scoring and aggregation sanity tests.

## Scoring Method

For every model, image-level or dataset-level rows are aggregated within each dataset first, then across datasets with equal dataset weight.

Pixel utility uses `F_beta`:

`F_beta = (1 + beta^2) * Precision * Sensitivity / (beta^2 * Precision + Sensitivity)`

The preset mapping is:

- Low FP: `beta = 0.5`
- Balanced: `beta = 1`
- Low FN: `beta = 2`
- Very low FN: `beta = 3`

Thin-vessel utility uses `TVS` only. Structure utility uses:

`Structure = eta * clDice + (1 - eta) * SF1`

Unknown-domain risk adjustment uses:

`AdjustedScore = (1 - r) * mean_across_datasets + r * worst_dataset`

Final score is the weighted average of active utilities, scaled to 0-100. The app does not normalize scores by model after aggregation, so score magnitudes keep their metric meaning.

## Missing Data

Strict mode excludes an active utility from receiving a score when its required evidence is missing. Provisional mode computes from available active utilities and flags missing dimensions.

Deployment scoring is intentionally unavailable until complete and comparable profiling data are supplied for all relevant models under the same hardware protocol.

## Local Test

Run from this folder:

```bash
node tests/scoring.test.js
```

Expected output:

```text
scoring tests passed
```
