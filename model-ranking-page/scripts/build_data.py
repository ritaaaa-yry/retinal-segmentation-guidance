#!/usr/bin/env python3
"""Build the ranking page from the 2026-08-02 Chapter 4-7 evidence package."""
from __future__ import annotations

import csv
import hashlib
import json
import math
import shutil
from collections import defaultdict
from pathlib import Path
from statistics import mean, stdev

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data" / "source"
BUILT = ROOT / "data" / "built"
BUILT.mkdir(parents=True, exist_ok=True)

ALIASES = {"DCP-1024": "DCP_1024", "DCP_1024": "DCP_1024"}
SOURCE_FILES = {
    "compute": "compute/resource_profiles.csv",
    "per_image": "chapter4/per_image_scoring_inputs.csv",
    "scenario_weights": "chapter4/scenario_weights.csv",
    "scenario_rankings": "chapter4/scenario_rankings.csv",
    "pixel_summary": "chapter4/pixel_model_summary.csv",
    "pixel_robustness": "chapter4/pixel_robustness.csv",
    "thin_summary": "chapter4/thin_model_dataset_summary.csv",
    "centerline_summary": "chapter4/centerline_model_dataset_summary.csv",
    "errors": "chapter4/error_model_dataset_counts.csv",
    "dataset_profiles": "chapter5/dataset_profiles.csv",
    "dataset_variability": "chapter5/dataset_variability.csv",
    "dataset_thin": "chapter5/dataset_thin_summary.csv",
    "dataset_centerline": "chapter5/dataset_centerline_summary.csv",
    "boundary_rankings": "chapter6/boundary_exclusion_rankings.csv",
    "oracle_vote_aggregate": "chapter7/oracle_vote_aggregate.csv",
    "oracle_vote_dataset": "chapter7/oracle_vote_dataset.csv",
    "laplacian_aggregate": "chapter7/laplacian_oracle_aggregate.csv",
    "laplacian_dataset": "chapter7/laplacian_oracle_dataset.csv",
}


def norm_model(value: str) -> str:
    clean = str(value).strip()
    return ALIASES.get(clean, clean)


def read_csv(relative: str) -> list[dict[str, str]]:
    with (SOURCE / relative).open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def write_csv(path: Path, rows: list[dict], fields: list[str]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        writer.writerows({field: row.get(field, "") for field in fields} for row in rows)


def number(value):
    if value is None or str(value).strip() == "":
        return None
    result = float(value)
    return result if math.isfinite(result) else None


def safe_mean(values):
    usable = [float(v) for v in values if v is not None and math.isfinite(float(v))]
    return mean(usable) if usable else None


def safe_sd(values):
    usable = [float(v) for v in values if v is not None and math.isfinite(float(v))]
    return stdev(usable) if len(usable) > 1 else (0.0 if usable else None)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def recover_precision_sensitivity(f1: float, f2: float) -> tuple[float, float]:
    """Recover precision and sensitivity from F1 and F2."""
    if f1 <= 0 or f2 <= 0:
        return 0.0, 0.0
    k = f2 / f1
    denominator = 2 * k - 5
    if abs(denominator) < 1e-12:
        raise ValueError("Degenerate F1/F2 pair")
    ratio = (5 - 8 * k) / denominator  # sensitivity / precision
    precision = f1 * (1 + ratio) / (2 * ratio)
    sensitivity = ratio * precision
    if not (-1e-9 <= precision <= 1 + 1e-9 and -1e-9 <= sensitivity <= 1 + 1e-9):
        raise ValueError(f"Recovered values are outside [0,1]: F1={f1}, F2={f2}")
    return min(1.0, max(0.0, precision)), min(1.0, max(0.0, sensitivity))


def main() -> None:
    missing = [path for path in SOURCE_FILES.values() if not (SOURCE / path).exists()]
    if missing:
        raise FileNotFoundError(f"Missing bundled sources: {missing}")

    utilities = read_csv(SOURCE_FILES["per_image"])
    balanced = {
        (norm_model(row["model"]), row["dataset"].strip(), row["image_id"].strip()): row
        for row in utilities
    }
    if len(balanced) != 1220:
        raise ValueError("The compact Chapter 4 scoring input must contain 1,220 unique image keys")

    centerline = {
        (norm_model(row["model"]), row["dataset"].strip()): row
        for row in read_csv(SOURCE_FILES["centerline_summary"])
    }
    evidence = []
    max_reconstruction_error = 0.0
    for model, dataset, image_id in sorted(balanced):
        base = balanced[(model, dataset, image_id)]
        f1 = float(base["f1"])
        f2 = float(base["f2"])
        precision, sensitivity = recover_precision_sensitivity(f1, f2)
        f1_check = 2 * precision * sensitivity / (precision + sensitivity) if precision + sensitivity else 0.0
        f2_check = 5 * precision * sensitivity / (4 * precision + sensitivity) if 4 * precision + sensitivity else 0.0
        max_reconstruction_error = max(max_reconstruction_error, abs(f1-f1_check), abs(f2-f2_check))
        structural = centerline[(model, dataset)]
        evidence.append({
            "model": model,
            "dataset": dataset,
            "image_id": image_id,
            "precision": precision,
            "sensitivity": sensitivity,
            "f1": f1,
            "iou": f1 / (2 - f1) if f1 < 2 else None,
            "mcc": "",
            "tvs": float(base["tvs"]),
            # Dataset macros are repeated per image so equal-dataset aggregation
            # preserves the exact Chapter 4 clDice/SF1 means for any eta.
            "cldice": float(structural["clDice_macro"]),
            "sf1": float(structural["SkeletonF1_r2_macro"]),
        })
    evidence_fields = ["model","dataset","image_id","precision","sensitivity","f1","iou","mcc","tvs","cldice","sf1"]
    write_csv(BUILT / "ranking_evidence_perimage.csv", evidence, evidence_fields)

    grouped = defaultdict(list)
    for row in evidence:
        grouped[(row["model"], row["dataset"])].append(row)
    metrics = ["f1","sensitivity","precision","iou","tvs","cldice","sf1"]
    dataset_rows = []
    for (model, dataset), rows in sorted(grouped.items()):
        out = {"model": model, "dataset": dataset, "n": len(rows)}
        for metric in metrics:
            values = [row[metric] for row in rows]
            out[f"mean_{metric}"] = safe_mean(values)
            out[f"sd_{metric}"] = safe_sd(values)
        dataset_rows.append(out)
    dataset_fields = ["model","dataset","n"] + [name for metric in metrics for name in (f"mean_{metric}", f"sd_{metric}")]
    write_csv(BUILT / "model_dataset_summary.csv", dataset_rows, dataset_fields)

    model_groups = defaultdict(list)
    for row in dataset_rows:
        model_groups[row["model"]].append(row)
    model_rows = []
    for model, rows in sorted(model_groups.items()):
        out = {"model": model, "dataset_count": len(rows), "image_count": sum(int(row["n"]) for row in rows)}
        for metric in metrics:
            values = [row[f"mean_{metric}"] for row in rows]
            out[f"equal_dataset_mean_{metric}"] = safe_mean(values)
            out[f"cross_dataset_sd_{metric}"] = safe_sd(values)
            worst = min(rows, key=lambda row: row[f"mean_{metric}"])
            out[f"worst_{metric}"] = worst[f"mean_{metric}"]
            out[f"worst_{metric}_dataset"] = worst["dataset"]
        model_rows.append(out)
    model_fields = ["model","dataset_count","image_count"] + [
        name for metric in metrics
        for name in (f"equal_dataset_mean_{metric}",f"cross_dataset_sd_{metric}",f"worst_{metric}",f"worst_{metric}_dataset")
    ]
    write_csv(BUILT / "model_summary.csv", model_rows, model_fields)

    error_types = ["Boundary shift","Too thin","Missed vessel","Too thick","Extra vessel"]
    error_dataset_rows = []
    totals = defaultdict(lambda: defaultdict(int))
    for row in read_csv(SOURCE_FILES["errors"]):
        model, dataset = norm_model(row["model"]), row["dataset"].strip()
        out = {"model": model, "dataset": dataset}
        counts = {name: int(float(row[name])) for name in error_types}
        total = sum(counts.values())
        for name, count in counts.items():
            slug = name.lower().replace(" ", "_")
            out[f"{slug}_pixels"] = count
            out[f"{slug}_percent"] = 100 * count / total if total else None
            totals[model][slug] += count
        error_dataset_rows.append(out)
    error_fields = ["model","dataset"] + [
        name for error in error_types
        for name in (f"{error.lower().replace(' ','_')}_pixels",f"{error.lower().replace(' ','_')}_percent")
    ]
    write_csv(BUILT / "error_profiles_model_dataset.csv", error_dataset_rows, error_fields)
    error_model_rows = []
    for model, counts in sorted(totals.items()):
        total = sum(counts.values())
        out = {"model": model, "total_error_pixels": total}
        for error in error_types:
            slug = error.lower().replace(" ", "_")
            out[f"{slug}_pixels"] = counts[slug]
            out[f"{slug}_percent"] = 100 * counts[slug] / total if total else None
        error_model_rows.append(out)
    error_model_fields = ["model","total_error_pixels"] + [
        name for error in error_types
        for name in (f"{error.lower().replace(' ','_')}_pixels",f"{error.lower().replace(' ','_')}_percent")
    ]
    write_csv(BUILT / "error_profiles_model.csv", error_model_rows, error_model_fields)

    passthrough = {
        "compute": "resource_profiles.csv",
        "dataset_profiles": "dataset_profiles.csv",
        "dataset_variability": "dataset_variability.csv",
        "dataset_thin": "dataset_thin_summary.csv",
        "dataset_centerline": "dataset_centerline_summary.csv",
        "boundary_rankings": "boundary_exclusion_rankings.csv",
        "oracle_vote_aggregate": "oracle_vote_aggregate.csv",
        "oracle_vote_dataset": "oracle_vote_dataset.csv",
        "laplacian_aggregate": "laplacian_oracle_aggregate.csv",
        "laplacian_dataset": "laplacian_oracle_dataset.csv",
        "scenario_rankings": "scenario_rankings_reference.csv",
        "scenario_weights": "scenario_weights_reference.csv",
    }
    for source_id, output_name in passthrough.items():
        shutil.copyfile(SOURCE / SOURCE_FILES[source_id], BUILT / output_name)

    pixel_reference = {norm_model(row["Model"]): float(row["Mean F1"]) for row in read_csv(SOURCE_FILES["pixel_summary"])}
    pixel_actual = {row["model"]: row["equal_dataset_mean_f1"] for row in model_rows}
    max_pixel_difference = max(abs(pixel_reference[model] - pixel_actual[model]) for model in pixel_reference)
    checks = [
        {"name": "Compact Chapter 4 F1/F2 image keys are unique", "status": "pass", "rows": len(evidence)},
        {"name": "Precision/sensitivity reconstructed from F1 and F2", "status": "pass" if max_reconstruction_error < 1e-9 else "fail", "max_error": max_reconstruction_error},
        {"name": "Equal-dataset mean F1 matches Chapter 4 Table 4.3", "status": "pass" if max_pixel_difference < 1e-9 else "fail", "max_difference": max_pixel_difference},
        {"name": "All five models cover all six datasets", "status": "pass" if len(dataset_rows) == 30 else "fail", "rows": len(dataset_rows)},
    ]
    quality = {
        "status": "pass" if all(check["status"] == "pass" for check in checks) else "warning",
        "primary_image_rows": len(evidence),
        "models": sorted(model_groups),
        "datasets": sorted({row["dataset"] for row in dataset_rows}),
        "checks": checks,
        "methodological_warning": "Scores are benchmark-relative. Resource fields mix frameworks and input sizes; oracle results are GT-informed upper bounds, not deployable methods.",
    }
    (BUILT / "data_quality.json").write_text(json.dumps(quality, indent=2, ensure_ascii=False), encoding="utf-8")

    roles = {
        "compute": ("scoring", "Six-field training-resource profile used by the optional resource score."),
        "per_image": ("scoring", "Compact Chapter 4 image-level F1/F2, TVS, and structural scoring inputs."),
        "centerline_summary": ("scoring", "Chapter 4 model-dataset clDice and Skeleton F1 macros."),
        "errors": ("risk_context", "Chapter 4 residual structural-error composition."),
        "dataset_profiles": ("context", "Chapter 5 dataset morphology and availability profile."),
        "dataset_variability": ("context", "Chapter 5 cross-model dataset variability."),
        "dataset_thin": ("context", "Chapter 5 dataset-conditioned thin-vessel summary."),
        "dataset_centerline": ("context", "Chapter 5 dataset-conditioned centerline summary."),
        "boundary_rankings": ("sensitivity", "Chapter 6 boundary-exclusion ranking sensitivity."),
        "oracle_vote_aggregate": ("upper_bound", "Chapter 7 GT-informed oracle-vote aggregate."),
        "oracle_vote_dataset": ("upper_bound", "Chapter 7 GT-informed oracle-vote dataset results."),
        "laplacian_aggregate": ("upper_bound", "Chapter 7 GT-informed Laplacian-repair aggregate."),
        "laplacian_dataset": ("upper_bound", "Chapter 7 GT-informed Laplacian-repair dataset results."),
    }
    sources = []
    for source_id, relative in SOURCE_FILES.items():
        path = SOURCE / relative
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            rows = sum(1 for _ in csv.DictReader(handle))
        role, rationale = roles.get(source_id, ("validation", "Reference result retained for audit and consistency checks."))
        sources.append({"id": source_id, "file": f"source/{relative}", "role": role, "rationale": rationale, "rows": rows, "sha256": sha256(path)})
    counts = defaultdict(int)
    for item in sources:
        counts[item["role"]] += 1
    manifest = {
        "title": "Retinal-vessel ranking evidence from the 2026-08-02 refresh",
        "version": "2026-08-02",
        "score_data": "built/ranking_evidence_perimage.csv",
        "model_dataset_summary": "built/model_dataset_summary.csv",
        "model_summary": "built/model_summary.csv",
        "error_model_summary": "built/error_profiles_model.csv",
        "error_model_dataset": "built/error_profiles_model_dataset.csv",
        "quality_report": "built/data_quality.json",
        "source_counts": {**dict(counts), "total": len(sources)},
        "sources": sources,
        "model_aliases": ALIASES,
        "supplemental": {key: f"built/{name}" for key, name in passthrough.items() if key != "compute"},
        "scoring_policy": {
            "pixel": "F_beta from precision and sensitivity reconstructed exactly from Chapter 4 image-level F1 and F2.",
            "thin": "Chapter 4 image-level TVS.",
            "structure": "eta * Chapter 4 model-dataset macro clDice + (1-eta) * macro Skeleton F1.",
            "risk_adjustment": "(1-r) * equal-dataset mean + r * worst dataset.",
            "resource": "Mean of six minimum-cost ratios; missing field utility is 0.50.",
        },
    }
    (BUILT / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Built {len(evidence)} records, {len(dataset_rows)} model-dataset rows, and {len(sources)} source entries.")
    print(f"Data quality: {quality['status']}")


if __name__ == "__main__":
    main()
