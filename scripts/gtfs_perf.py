#!/usr/bin/env python3
"""
GTFS parse performance helper

Usage:
    python scripts/gtfs_perf.py path/to/gtfs.zip --runs 3
    python scripts/gtfs_perf.py path/to/extracted_gtfs_dir --runs 3

This script measures the time taken by `app.gtfs.parse_gtfs_zip` to parse GTFS input
and prints counts of generated GeoJSON features.
"""
import argparse
import io
import sys
import time
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.gtfs import parse_gtfs_zip


def load_gtfs_bytes(input_path: Path) -> bytes:
    if input_path.is_file():
        return input_path.read_bytes()

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
        for file_path in sorted(input_path.rglob("*")):
            if not file_path.is_file():
                continue
            archive.write(file_path, arcname=file_path.relative_to(input_path).as_posix())
    return buffer.getvalue()


def run_once(input_path: Path) -> dict:
    raw = load_gtfs_bytes(input_path)
    t0 = time.perf_counter()
    result = parse_gtfs_zip(raw)
    t1 = time.perf_counter()
    elapsed = t1 - t0
    stats = {
        "elapsed_sec": elapsed,
        "routes": len(result.get("routes_geojson", {}).get("features", [])),
        "stops": len(result.get("stops_geojson", {}).get("features", [])),
        "stop_connections": len(result.get("stop_connections_geojson", {}).get("features", [])),
        "route_catalog": len(result.get("route_catalog", [])),
    }
    return stats


def main():
    parser = argparse.ArgumentParser(description="GTFS parse performance helper")
    parser.add_argument("input_path", type=Path, help="Path to GTFS ZIP file or extracted GTFS directory")
    parser.add_argument("--runs", type=int, default=1, help="Number of runs to average")
    args = parser.parse_args()

    if not args.input_path.exists():
        print(f"Error: file not found: {args.input_path}")
        sys.exit(2)

    results = []
    for i in range(args.runs):
        print(f"Run {i+1}/{args.runs}...")
        stats = run_once(args.input_path)
        print(f"  elapsed: {stats['elapsed_sec']:.3f}s, routes={stats['routes']}, stops={stats['stops']}, stop_connections={stats['stop_connections']}")
        results.append(stats)

    avg = sum(r["elapsed_sec"] for r in results) / len(results)
    print("\nSummary:")
    print(f"  runs: {len(results)}")
    print(f"  avg elapsed: {avg:.3f}s")


if __name__ == "__main__":
    main()
