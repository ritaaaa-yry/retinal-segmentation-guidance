#!/usr/bin/env python3
"""Build the bundled ranking evidence from the source CSV files.

This script deliberately separates:
- primary image-level evidence used in the score;
- error-profile evidence used only for explanation;
- summary/legacy files used for provenance and consistency checks.

No model ranking is hardcoded here.
"""
from __future__ import annotations

import csv
import hashlib
import json
import math
import shutil
from collections import defaultdict
from pathlib import Path
from statistics import mean, stdev, pstdev
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data" / "source"
BUILT = ROOT / "data" / "built"
BUILT.mkdir(parents=True, exist_ok=True)

ALIASES = {
    "DCP_1024": "DCP_1024",
    "FRUnet": "FR-UNet",
    "FR-UNet": "FR-UNet",
    "FSG-Net-HRF": "FSG-Net",
    "FSG-Net": "FSG-Net",
    "GAVE": "GAVE",
    "SA-UNnetv2": "SA-UNetv2",
    "SA-UNetv2": "SA-UNetv2",
}

FILES = {
    "pixel_perimage": "009__perimage(1).csv",
    "pixel_dataset_summary": "009__source_metrics(1).csv",
    "error_model_dataset": "009__source_error_classes(1).csv",
    "task_reference": "010__source(1).csv",
    "model_centered_f1": "011__source(1).csv",
    "pixel_distribution_summary": "011_012__source_metrics(1).csv",
    "pixel_model_summary": "012__source(1).csv",
    "thin_dataset_summary": "013__source(1).csv",
    "thin_perimage": "013__source_thin_vessel_perimage(1).csv",
    "structure_dataset_duplicate_a": "02_per_dataset_macro_cldice_skeleton_fidelity(2).csv",
    "structure_figure_source": "015__figure_source(2).csv",
    "structure_dataset_duplicate_b": "015__source(2).csv",
    "structure_perimage_legacy": "015__source_centerline_perimage(2).csv",
    "structure_perimage": "017__source_centerline_perimage_cldice_sf1(1).csv",
    "mask_inventory": "017__source_latest_mask_inventory(1).csv",
    "structure_model_summary": "017__source_model_summary_cldice_skeleton_fidelity(1).csv",
    "structure_dataset_summary": "017__source_per_dataset_macro_cldice_skeleton_fidelity(1).csv",
    "error_global": "018__source(2).csv",
    "error_fn_reference": "019__Figure 8__source(2).csv",
    "error_fp_reference": "020__Figure 9__source(2).csv",
}

SOURCE_ROLES = {
    "pixel_perimage": ("scoring", "Image-level pixel metrics used to compute F_beta and consistency summaries."),
    "thin_perimage": ("scoring", "Image-level TVS used as the thin-vessel utility."),
    "structure_perimage": ("scoring", "Image-level clDice and SF1 used as the structure utility."),
    "error_model_dataset": ("risk_context", "Model-dataset error counts used to explain residual failure profiles; not added to the score."),
    "error_global": ("risk_context", "Global error composition reference; not added to the score."),
    "error_fn_reference": ("risk_context", "FN-oriented figure source used for explanatory cross-checks; not added to the score."),
    "error_fp_reference": ("risk_context", "FP-oriented figure source used for explanatory cross-checks; not added to the score."),
}
for key in FILES:
    SOURCE_ROLES.setdefault(key, ("validation", "Summary, inventory, recommendation-reference, or legacy duplicate used for provenance and consistency checks only."))


def read_csv(name: str) -> list[dict[str, str]]:
    path = SOURCE / name
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def write_csv(path: Path, rows: Iterable[dict[str, Any]], fieldnames: list[str]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: row.get(key, "") for key in fieldnames})


def norm_model(value: str) -> str:
    clean = str(value or "").strip()
    if clean not in ALIASES:
        raise ValueError(f"Unknown model label: {clean!r}")
    return ALIASES[clean]


def number(value: Any) -> float | None:
    if value is None or str(value).strip() == "":
        return None
    result = float(value)
    if not math.isfinite(result):
        return None
    return result


def integer(value: Any) -> int | None:
    num = number(value)
    return None if num is None else int(num)


def key(row: dict[str, str]) -> tuple[str, str, str]:
    return norm_model(row["Model"]), row["Dataset"].strip(), row["Image"].strip()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def safe_sd(values: list[float]) -> float:
    return stdev(values) if len(values) > 1 else 0.0


def close(a: float | None, b: float | None, tol: float = 1e-10) -> bool:
    if a is None or b is None:
        return a is None and b is None
    return abs(a - b) <= tol


def check_summary(
    check_name: str,
    derived: dict[tuple[str, str], dict[str, float]],
    source_rows: list[dict[str, str]],
    mapping: dict[str, str],
    tolerance: float = 1e-9,
) -> dict[str, Any]:
    mismatches: list[dict[str, Any]] = []
    for row in source_rows:
        k = (norm_model(row["Model"]), row["Dataset"].strip())
        if k not in derived:
            mismatches.append({"key": list(k), "problem": "missing derived row"})
            continue
        for source_col, derived_col in mapping.items():
            expected = number(row.get(source_col))
            actual = derived[k].get(derived_col)
            if not close(expected, actual, tolerance):
                mismatches.append({
                    "key": list(k),
                    "field": source_col,
                    "source": expected,
                    "derived": actual,
                    "difference": None if expected is None or actual is None else actual - expected,
                })
    return {
        "name": check_name,
        "status": "pass" if not mismatches else "fail",
        "tolerance": tolerance,
        "mismatch_count": len(mismatches),
        "mismatches": mismatches[:20],
    }


def main() -> None:
    missing = [filename for filename in FILES.values() if not (SOURCE / filename).exists()]
    if missing:
        raise FileNotFoundError(f"Missing source CSV files: {missing}")

    pixel_rows = read_csv(FILES["pixel_perimage"])
    thin_rows = read_csv(FILES["thin_perimage"])
    structure_rows = read_csv(FILES["structure_perimage"])

    pixel = {key(row): row for row in pixel_rows}
    thin = {key(row): row for row in thin_rows}
    structure = {key(row): row for row in structure_rows}

    key_sets = {"pixel": set(pixel), "thin": set(thin), "structure": set(structure)}
    union_keys = set().union(*key_sets.values())
    key_report = {
        name: {
            "rows": len(keys),
            "missing_from_this_source": len(union_keys - keys),
            "sample_missing": [list(x) for x in sorted(union_keys - keys)[:10]],
        }
        for name, keys in key_sets.items()
    }
    if any(union_keys - keys for keys in key_sets.values()):
        raise ValueError(f"Primary image-level sources do not share identical keys: {key_report}")

    merged: list[dict[str, Any]] = []
    for model, dataset, image in sorted(union_keys):
        p = pixel[(model, dataset, image)]
        t = thin[(model, dataset, image)]
        s = structure[(model, dataset, image)]
        thresholds = {str(p.get("Threshold", "")).strip(), str(t.get("Threshold", "")).strip()}
        thresholds.discard("")
        threshold_sources = {str(p.get("threshold_source", "")).strip(), str(t.get("threshold_source", "")).strip()}
        threshold_sources.discard("")
        if len(thresholds) > 1:
            raise ValueError(f"Threshold mismatch for {(model, dataset, image)}: {thresholds}")
        if len(threshold_sources) > 1:
            raise ValueError(f"Threshold source mismatch for {(model, dataset, image)}: {threshold_sources}")
        merged.append({
            "model": model,
            "dataset": dataset,
            "image_id": image,
            "threshold": next(iter(thresholds), ""),
            "threshold_source": next(iter(threshold_sources), ""),
            "tp": integer(p.get("TP")),
            "fp": integer(p.get("FP")),
            "fn": integer(p.get("FN")),
            "tn": integer(p.get("TN")),
            "sensitivity": number(p.get("Sensitivity")),
            "precision": number(p.get("Precision")),
            "f1": number(p.get("F1")),
            "iou": number(p.get("IoU")),
            "mcc": number(p.get("MCC")),
            "tvs": number(t.get("thin_vessel_sensitivity_proxy")),
            "cldice": number(s.get("clDice")),
            "sf1": number(s.get("SkeletonF1_r2")),
            "thin_gt_pixels": integer(t.get("thin_gt_pixels_proxy")),
            "thin_tp_pixels": integer(t.get("thin_tp_pixels")),
            "prediction_skeleton_pixels": integer(s.get("PredictionSkeletonPixels")),
            "gt_skeleton_pixels": integer(s.get("GTSkeletonPixels")),
        })

    evidence_fields = [
        "model", "dataset", "image_id", "threshold", "threshold_source",
        "tp", "fp", "fn", "tn", "sensitivity", "precision", "f1", "iou", "mcc",
        "tvs", "cldice", "sf1", "thin_gt_pixels", "thin_tp_pixels",
        "prediction_skeleton_pixels", "gt_skeleton_pixels",
    ]
    write_csv(BUILT / "ranking_evidence_perimage.csv", merged, evidence_fields)

    grouped: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in merged:
        grouped[(row["model"], row["dataset"])].append(row)

    metric_names = ["f1", "sensitivity", "precision", "iou", "mcc", "tvs", "cldice", "sf1"]
    dataset_summary_rows: list[dict[str, Any]] = []
    derived_dataset: dict[tuple[str, str], dict[str, float]] = {}
    for (model, dataset), records in sorted(grouped.items()):
        out: dict[str, Any] = {"model": model, "dataset": dataset, "n": len(records)}
        for metric in metric_names:
            values = [float(row[metric]) for row in records if row[metric] is not None]
            out[f"mean_{metric}"] = mean(values) if values else None
            out[f"sd_{metric}"] = safe_sd(values) if values else None
            out[f"population_sd_{metric}"] = pstdev(values) if values else None
            out[f"min_{metric}"] = min(values) if values else None
            out[f"max_{metric}"] = max(values) if values else None
        thresholds = sorted({str(row["threshold"]) for row in records if str(row["threshold"]).strip()})
        threshold_sources = sorted({str(row["threshold_source"]) for row in records if str(row["threshold_source"]).strip()})
        out["threshold"] = ";".join(thresholds)
        out["threshold_source"] = ";".join(threshold_sources)
        dataset_summary_rows.append(out)
        derived_dataset[(model, dataset)] = out

    dataset_fields = ["model", "dataset", "n", "threshold", "threshold_source"]
    for metric in metric_names:
        dataset_fields.extend([f"mean_{metric}", f"sd_{metric}", f"population_sd_{metric}", f"min_{metric}", f"max_{metric}"])
    write_csv(BUILT / "model_dataset_summary.csv", dataset_summary_rows, dataset_fields)

    by_model_dataset: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in dataset_summary_rows:
        by_model_dataset[row["model"]].append(row)

    model_summary_rows: list[dict[str, Any]] = []
    for model, records in sorted(by_model_dataset.items()):
        out: dict[str, Any] = {"model": model, "dataset_count": len(records), "image_count": sum(int(r["n"]) for r in records)}
        for metric in metric_names:
            values = [float(r[f"mean_{metric}"]) for r in records if r[f"mean_{metric}"] is not None]
            out[f"equal_dataset_mean_{metric}"] = mean(values) if values else None
            out[f"cross_dataset_sd_{metric}"] = safe_sd(values) if values else None
            if values:
                worst_row = min(records, key=lambda r: float(r[f"mean_{metric}"]))
                out[f"worst_{metric}"] = worst_row[f"mean_{metric}"]
                out[f"worst_{metric}_dataset"] = worst_row["dataset"]
            else:
                out[f"worst_{metric}"] = None
                out[f"worst_{metric}_dataset"] = ""
        model_summary_rows.append(out)

    model_fields = ["model", "dataset_count", "image_count"]
    for metric in metric_names:
        model_fields.extend([
            f"equal_dataset_mean_{metric}", f"cross_dataset_sd_{metric}",
            f"worst_{metric}", f"worst_{metric}_dataset",
        ])
    write_csv(BUILT / "model_summary.csv", model_summary_rows, model_fields)

    error_rows = read_csv(FILES["error_model_dataset"])
    error_dataset_rows: list[dict[str, Any]] = []
    error_counts_by_model: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    error_types = ["Boundary shift", "Too thin", "Missed vessel", "Too thick", "Extra vessel"]
    for row in error_rows:
        model = norm_model(row["Model"])
        out: dict[str, Any] = {"model": model, "dataset": row["Dataset"].strip()}
        for error_type in error_types:
            slug = error_type.lower().replace(" ", "_")
            count = integer(row.get(error_type)) or 0
            percent = number(row.get(f"{error_type}_percent"))
            out[f"{slug}_pixels"] = count
            out[f"{slug}_percent"] = percent
            error_counts_by_model[model][slug] += count
        error_dataset_rows.append(out)

    error_dataset_fields = ["model", "dataset"]
    for error_type in error_types:
        slug = error_type.lower().replace(" ", "_")
        error_dataset_fields.extend([f"{slug}_pixels", f"{slug}_percent"])
    write_csv(BUILT / "error_profiles_model_dataset.csv", error_dataset_rows, error_dataset_fields)

    error_model_rows: list[dict[str, Any]] = []
    for model, counts in sorted(error_counts_by_model.items()):
        total = sum(counts.values())
        out: dict[str, Any] = {"model": model, "total_error_pixels": total}
        for error_type in error_types:
            slug = error_type.lower().replace(" ", "_")
            count = counts[slug]
            out[f"{slug}_pixels"] = count
            out[f"{slug}_percent"] = 100.0 * count / total if total else None
        error_model_rows.append(out)
    error_model_fields = ["model", "total_error_pixels"]
    for error_type in error_types:
        slug = error_type.lower().replace(" ", "_")
        error_model_fields.extend([f"{slug}_pixels", f"{slug}_percent"])
    write_csv(BUILT / "error_profiles_model.csv", error_model_rows, error_model_fields)

    checks: list[dict[str, Any]] = []
    checks.append(check_summary(
        "pixel dataset summary matches 009__source_metrics",
        derived_dataset,
        read_csv(FILES["pixel_dataset_summary"]),
        {
            "Mean F1": "mean_f1",
            "Mean Sensitivity": "mean_sensitivity",
            "Mean Precision": "mean_precision",
            "Mean MCC": "mean_mcc",
            "Mean IoU": "mean_iou",
        },
    ))
    checks.append(check_summary(
        "thin-vessel dataset summary matches 013__source",
        derived_dataset,
        read_csv(FILES["thin_dataset_summary"]),
        {"mean_thin_vessel_sensitivity_proxy": "mean_tvs", "sd_thin_vessel_sensitivity_proxy": "population_sd_tvs"},
    ))
    checks.append(check_summary(
        "structure dataset summary matches 017__source_per_dataset",
        derived_dataset,
        read_csv(FILES["structure_dataset_summary"]),
        {
            "Macro_clDice": "mean_cldice",
            "SD_clDice": "sd_cldice",
            "Macro_SkeletonF1_r2": "mean_sf1",
            "SD_SkeletonF1_r2": "sd_sf1",
        },
    ))

    legacy_rows = read_csv(FILES["structure_perimage_legacy"])
    legacy = {key(row): row for row in legacy_rows}
    legacy_mismatches = []
    for k, row in structure.items():
        other = legacy.get(k)
        if other is None or not close(number(row.get("clDice")), number(other.get("clDice")), 1e-12) or not close(number(row.get("SkeletonF1_r2")), number(other.get("SkeletonF1_r2")), 1e-12):
            legacy_mismatches.append(list(k))
    checks.append({
        "name": "legacy and current structure per-image files are numerically identical after model-name normalization",
        "status": "pass" if not legacy_mismatches and len(legacy) == len(structure) else "fail",
        "mismatch_count": len(legacy_mismatches) + abs(len(legacy) - len(structure)),
        "mismatches": legacy_mismatches[:20],
    })

    inventory_rows = read_csv(FILES["mask_inventory"])
    inventory_mismatches = []
    counts = {(model, dataset): len(rows) for (model, dataset), rows in grouped.items()}
    for row in inventory_rows:
        k = (norm_model(row["Model"]), row["Dataset"].strip())
        expected = integer(row.get("Matched_count"))
        actual = counts.get(k)
        if expected != actual:
            inventory_mismatches.append({"key": list(k), "inventory": expected, "merged": actual})
    checks.append({
        "name": "mask inventory matched counts agree with merged evidence",
        "status": "pass" if not inventory_mismatches else "fail",
        "mismatch_count": len(inventory_mismatches),
        "mismatches": inventory_mismatches[:20],
    })

    protocols = sorted({str(row["threshold_source"]).strip() for row in merged if str(row["threshold_source"]).strip()})
    thresholds_by_model: dict[str, list[str]] = defaultdict(list)
    for row in merged:
        value = str(row["threshold"]).strip()
        if value and value not in thresholds_by_model[row["model"]]:
            thresholds_by_model[row["model"]].append(value)

    manifest_sources = []
    for key_name, filename in FILES.items():
        role, rationale = SOURCE_ROLES[key_name]
        path = SOURCE / filename
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            row_count = sum(1 for _ in csv.DictReader(handle))
        manifest_sources.append({
            "id": key_name,
            "file": f"source/{filename}",
            "role": role,
            "rationale": rationale,
            "rows": row_count,
            "sha256": sha256(path),
        })

    quality = {
        "status": "pass" if all(check["status"] == "pass" for check in checks) else "warning",
        "generated_from_source_files": len(FILES),
        "primary_image_rows": len(merged),
        "models": sorted({row["model"] for row in merged}),
        "datasets": sorted({row["dataset"] for row in merged}),
        "images_per_model": {model: sum(1 for row in merged if row["model"] == model) for model in sorted({row["model"] for row in merged})},
        "key_alignment": key_report,
        "threshold_protocols": protocols,
        "thresholds_by_model": {model: sorted(values) for model, values in sorted(thresholds_by_model.items())},
        "checks": checks,
        "sd_convention_note": "The thin-vessel source summary uses population SD (ddof=0), while the pixel and structure summaries use sample SD (ddof=1). Both are retained explicitly in the derived dataset summary.",
        "methodological_warning": (
            "The bundled threshold_source is diagnostic_test_set_scan_equal_dataset_macro_F1. "
            "The page reports this explicitly and must not describe these thresholds as validation-selected."
            if any("diagnostic_test_set" in p for p in protocols)
            else ""
        ),
    }
    (BUILT / "data_quality.json").write_text(json.dumps(quality, indent=2, ensure_ascii=False), encoding="utf-8")

    manifest = {
        "title": "Bundled retinal-vessel model-ranking evidence",
        "version": "2026-07-27",
        "score_data": "built/ranking_evidence_perimage.csv",
        "model_dataset_summary": "built/model_dataset_summary.csv",
        "model_summary": "built/model_summary.csv",
        "error_model_summary": "built/error_profiles_model.csv",
        "error_model_dataset": "built/error_profiles_model_dataset.csv",
        "quality_report": "built/data_quality.json",
        "source_counts": {
            "scoring": sum(1 for item in manifest_sources if item["role"] == "scoring"),
            "risk_context": sum(1 for item in manifest_sources if item["role"] == "risk_context"),
            "validation": sum(1 for item in manifest_sources if item["role"] == "validation"),
            "total": len(manifest_sources),
        },
        "sources": manifest_sources,
        "model_aliases": ALIASES,
        "scoring_policy": {
            "pixel": "Image-level F_beta from precision and sensitivity, averaged within dataset.",
            "thin": "Image-level TVS, averaged within dataset.",
            "structure": "eta * clDice + (1-eta) * SF1, averaged within dataset.",
            "risk_adjustment": "(1-r) * equal-dataset mean + r * worst dataset.",
            "final": "100 * weighted average of active utilities; no model-relative min-max normalization.",
            "error_profiles": "Displayed as diagnostic context only and never added to the score.",
        },
    }
    (BUILT / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"Built {len(merged)} image-level model records from {len(FILES)} source CSV files.")
    print(f"Data quality status: {quality['status']}")
    for check in checks:
        print(f"- {check['status'].upper()}: {check['name']} ({check.get('mismatch_count', 0)} mismatches)")


if __name__ == "__main__":
    main()
