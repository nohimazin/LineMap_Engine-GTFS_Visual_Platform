import csv
import hashlib
import io
import zipfile
from collections import defaultdict
from typing import Any


def _read_csv_from_zip(archive: zipfile.ZipFile, name: str) -> list[dict[str, str]]:
    try:
        with archive.open(name) as raw:
            decoded = io.TextIOWrapper(raw, encoding="utf-8-sig")
            return list(csv.DictReader(decoded))
    except KeyError:
        return []


def _color_from_route_id(route_id: str) -> str:
    seed = hashlib.md5(route_id.encode("utf-8")).hexdigest()[:6]
    return seed.upper()


def _normalize_color(value: str | None, route_id: str) -> str:
    if not value:
        return _color_from_route_id(route_id)
    hex_color = value.strip().lstrip("#")
    if len(hex_color) != 6:
        return _color_from_route_id(route_id)
    try:
        int(hex_color, 16)
        return hex_color.upper()
    except ValueError:
        return _color_from_route_id(route_id)


def parse_gtfs_zip(raw_zip: bytes) -> dict[str, Any]:
    with zipfile.ZipFile(io.BytesIO(raw_zip)) as archive:
        routes_rows = _read_csv_from_zip(archive, "routes.txt")
        trips_rows = _read_csv_from_zip(archive, "trips.txt")
        shapes_rows = _read_csv_from_zip(archive, "shapes.txt")
        stops_rows = _read_csv_from_zip(archive, "stops.txt")

    if not routes_rows or not trips_rows or not stops_rows:
        raise ValueError("GTFS ZIPに必要な routes.txt / trips.txt / stops.txt が不足しています。")

    routes: dict[str, dict[str, str]] = {}
    for row in routes_rows:
        route_id = row.get("route_id", "").strip()
        if not route_id:
            continue
        routes[route_id] = {
            "route_id": route_id,
            "route_short_name": row.get("route_short_name", "").strip(),
            "route_long_name": row.get("route_long_name", "").strip(),
            "route_color": _normalize_color(row.get("route_color"), route_id),
            "route_text_color": row.get("route_text_color", "").strip(),
        }

    trip_to_route: dict[str, str] = {}
    shape_to_route: dict[str, str] = {}
    for row in trips_rows:
        trip_id = row.get("trip_id", "").strip()
        route_id = row.get("route_id", "").strip()
        shape_id = row.get("shape_id", "").strip()
        if trip_id and route_id:
            trip_to_route[trip_id] = route_id
        if shape_id and route_id and shape_id not in shape_to_route:
            shape_to_route[shape_id] = route_id

    shape_points: dict[str, list[tuple[float, float, int]]] = defaultdict(list)
    for row in shapes_rows:
        shape_id = row.get("shape_id", "").strip()
        lat = row.get("shape_pt_lat", "").strip()
        lon = row.get("shape_pt_lon", "").strip()
        seq = row.get("shape_pt_sequence", "").strip()
        if not shape_id or not lat or not lon:
            continue
        try:
            lat_f = float(lat)
            lon_f = float(lon)
            seq_i = int(seq) if seq else 0
        except ValueError:
            continue
        shape_points[shape_id].append((lon_f, lat_f, seq_i))

    route_lines: dict[str, list[list[list[float]]]] = defaultdict(list)
    for shape_id, pts in shape_points.items():
        route_id = shape_to_route.get(shape_id)
        if not route_id:
            continue
        sorted_pts = sorted(pts, key=lambda p: p[2])
        line = [[p[0], p[1]] for p in sorted_pts]
        if len(line) >= 2:
            route_lines[route_id].append(line)

    route_features: list[dict[str, Any]] = []
    route_catalog: list[dict[str, Any]] = []
    for route_id, route in routes.items():
        lines = route_lines.get(route_id, [])
        if lines:
            geometry = {"type": "MultiLineString", "coordinates": lines}
        else:
            geometry = None

        props = {
            "route_id": route_id,
            "route_short_name": route["route_short_name"],
            "route_long_name": route["route_long_name"],
            "route_color": route["route_color"],
            "route_text_color": route["route_text_color"],
            "line_count": len(lines),
        }
        route_catalog.append(props)

        if geometry:
            route_features.append(
                {
                    "type": "Feature",
                    "geometry": geometry,
                    "properties": props,
                }
            )

    stop_features: list[dict[str, Any]] = []
    for row in stops_rows:
        stop_id = row.get("stop_id", "").strip()
        stop_name = row.get("stop_name", "").strip()
        stop_lat = row.get("stop_lat", "").strip()
        stop_lon = row.get("stop_lon", "").strip()
        if not stop_id or not stop_lat or not stop_lon:
            continue
        try:
            lat = float(stop_lat)
            lon = float(stop_lon)
        except ValueError:
            continue

        stop_features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": {
                    "stop_id": stop_id,
                    "stop_name": stop_name,
                    "routes": [],
                    "times": [],
                },
            }
        )

    return {
        "routes_geojson": {"type": "FeatureCollection", "features": route_features},
        "stops_geojson": {"type": "FeatureCollection", "features": stop_features},
        "trip_to_route": trip_to_route,
        "route_catalog": sorted(route_catalog, key=lambda x: x["route_short_name"] or x["route_long_name"]),
    }
