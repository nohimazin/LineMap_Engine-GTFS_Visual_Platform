#!/usr/bin/env python3
"""
Validate a GTFS-RT feed against a local GTFS dataset.

Usage:
  python scripts/rt_validate.py C:/Users/user/Downloads/sankobus https://km.bus-vision.jp/realtime/sankobus_vpos_update.bin
"""
import argparse
import asyncio
import io
import json
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.gtfs import parse_gtfs_zip
from app.rt import RealtimeVehicleService


def load_gtfs_bytes(input_path: Path) -> bytes:
    if input_path.is_file():
        return input_path.read_bytes()

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
        for file_path in sorted(input_path.rglob("*")):
            if file_path.is_file():
                archive.write(file_path, arcname=file_path.relative_to(input_path).as_posix())
    return buffer.getvalue()


async def validate(gtfs_path: Path, rt_url: str) -> dict:
    parsed = parse_gtfs_zip(load_gtfs_bytes(gtfs_path))
    service = RealtimeVehicleService()
    service.configure(rt_url, 10)
    await service.fetch_once(parsed["trip_to_route"])

    vehicles = service.vehicles()["features"]
    return {
        "vehicle_count": len(vehicles),
        "sample_vehicle": vehicles[0]["properties"] if vehicles else None,
        "status": service.status(),
        "route_catalog_count": len(parsed["route_catalog"]),
        "stop_count": len(parsed["stops_geojson"]["features"]),
        "stop_connection_count": len(parsed["stop_connections_geojson"]["features"]),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate a GTFS-RT feed against a local GTFS dataset")
    parser.add_argument("gtfs_path", type=Path, help="GTFS ZIP file or extracted GTFS directory")
    parser.add_argument("rt_url", help="GTFS-RT feed URL")
    args = parser.parse_args()

    result = asyncio.run(validate(args.gtfs_path, args.rt_url))
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
