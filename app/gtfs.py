import csv
import hashlib
import io
import zipfile
from collections import defaultdict
from typing import Any


def _read_csv_from_zip(archive: zipfile.ZipFile, name: str) -> list[dict[str, str]]:
    target = name.lower()
    member_name = None
    for info in archive.infolist():
        if info.is_dir():
            continue
        base_name = info.filename.replace("\\", "/").split("/")[-1].lower()
        if base_name == target:
            member_name = info.filename
            break

    if member_name is None:
        return []

    try:
        with archive.open(member_name) as raw:
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


def _distance(a: list[float] | tuple[float, float], b: list[float] | tuple[float, float]) -> float:
    return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5


def _lerp_point(
    start: list[float] | tuple[float, float],
    end: list[float] | tuple[float, float],
    ratio: float,
) -> list[float]:
    return [start[0] + (end[0] - start[0]) * ratio, start[1] + (end[1] - start[1]) * ratio]


def _project_point_to_segment(
    point: list[float] | tuple[float, float],
    start: list[float] | tuple[float, float],
    end: list[float] | tuple[float, float],
) -> tuple[float, list[float], float]:
    segment_length = _distance(start, end)
    if segment_length == 0:
        return _distance(point, start), [float(start[0]), float(start[1])], 0.0

    raw_ratio = ((point[0] - start[0]) * (end[0] - start[0]) + (point[1] - start[1]) * (end[1] - start[1])) / (segment_length**2)
    ratio = max(0.0, min(1.0, raw_ratio))
    projected = _lerp_point(start, end, ratio)
    return _distance(point, projected), projected, ratio


def _project_point_to_polyline(
    point: list[float] | tuple[float, float],
    polyline: list[list[float]],
) -> tuple[float, list[float]]:
    best_distance = float("inf")
    best_along = 0.0
    best_point = polyline[0]
    cumulative = 0.0

    for index in range(len(polyline) - 1):
        start = polyline[index]
        end = polyline[index + 1]
        segment_length = _distance(start, end)
        if segment_length == 0:
            continue

        projected_distance, projected_point, ratio = _project_point_to_segment(point, start, end)
        along = cumulative + segment_length * ratio
        if projected_distance < best_distance:
            best_distance = projected_distance
            best_along = along
            best_point = projected_point

        cumulative += segment_length

    return best_along, best_point


def _polyline_cumulative_lengths(polyline: list[list[float]]) -> list[float]:
    lengths = [0.0]
    for index in range(len(polyline) - 1):
        lengths.append(lengths[-1] + _distance(polyline[index], polyline[index + 1]))
    return lengths


def _point_at_distance(polyline: list[list[float]], distance_value: float) -> list[float]:
    if len(polyline) < 2:
        return polyline[0]

    cumulative = _polyline_cumulative_lengths(polyline)
    if distance_value <= 0:
        return polyline[0]
    if distance_value >= cumulative[-1]:
        return polyline[-1]

    for index in range(len(polyline) - 1):
        segment_start = cumulative[index]
        segment_end = cumulative[index + 1]
        if distance_value > segment_end:
            continue

        segment_length = segment_end - segment_start
        if segment_length == 0:
            return polyline[index]
        ratio = (distance_value - segment_start) / segment_length
        return _lerp_point(polyline[index], polyline[index + 1], ratio)

    return polyline[-1]


def _extract_polyline_between(polyline: list[list[float]], start_distance: float, end_distance: float) -> list[list[float]]:
    if len(polyline) < 2:
        return []

    reverse = False
    if start_distance > end_distance:
        start_distance, end_distance = end_distance, start_distance
        reverse = True

    cumulative = _polyline_cumulative_lengths(polyline)
    result: list[list[float]] = []

    for index in range(len(polyline) - 1):
        segment_start = cumulative[index]
        segment_end = cumulative[index + 1]
        if segment_end < start_distance or segment_start > end_distance:
            continue

        if not result:
            result.append(_point_at_distance(polyline, start_distance))

        if segment_end <= end_distance:
            if result[-1] != polyline[index + 1]:
                result.append(polyline[index + 1])
        else:
            result.append(_point_at_distance(polyline, end_distance))
            break

    if reverse:
        result.reverse()

    return result


def parse_gtfs_zip(raw_zip: bytes) -> dict[str, Any]:
    with zipfile.ZipFile(io.BytesIO(raw_zip)) as archive:
        routes_rows = _read_csv_from_zip(archive, "routes.txt")
        trips_rows = _read_csv_from_zip(archive, "trips.txt")
        shapes_rows = _read_csv_from_zip(archive, "shapes.txt")
        stops_rows = _read_csv_from_zip(archive, "stops.txt")
        stop_times_rows = _read_csv_from_zip(archive, "stop_times.txt")

    if not routes_rows or not trips_rows or not stops_rows:
        raise ValueError("GTFS ZIPに必要な routes.txt / trips.txt / stops.txt が不足しています。")

    stop_coords: dict[str, list[float]] = {}
    stop_names: dict[str, str] = {}
    for row in stops_rows:
        stop_id = row.get("stop_id", "").strip()
        stop_lat = row.get("stop_lat", "").strip()
        stop_lon = row.get("stop_lon", "").strip()
        if not stop_id or not stop_lat or not stop_lon:
            continue
        try:
            lat = float(stop_lat)
            lon = float(stop_lon)
        except ValueError:
            continue
        stop_coords[stop_id] = [lon, lat]
        stop_names[stop_id] = row.get("stop_name", "").strip()

    routes: dict[str, dict[str, str]] = {}
    trip_to_shape: dict[str, str] = {}
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
        if trip_id and shape_id:
            trip_to_shape[trip_id] = shape_id
        if shape_id and route_id and shape_id not in shape_to_route:
            shape_to_route[shape_id] = route_id

    trip_stop_times: dict[str, list[tuple[int, str]]] = defaultdict(list)
    for row in stop_times_rows:
        trip_id = row.get("trip_id", "").strip()
        stop_id = row.get("stop_id", "").strip()
        stop_sequence = row.get("stop_sequence", "").strip()
        if not trip_id or not stop_id:
            continue
        try:
            sequence_value = int(stop_sequence) if stop_sequence else 0
        except ValueError:
            sequence_value = 0
        trip_stop_times[trip_id].append((sequence_value, stop_id))

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

    stop_connection_features: list[dict[str, Any]] = []
    generated_connection_keys: set[tuple[str, str, tuple[str, ...]]] = set()
    trip_stop_items = sorted(trip_stop_times.items(), key=lambda item: item[0])
    for trip_id, stop_items in trip_stop_items:
        route_id = trip_to_route.get(trip_id, "")
        shape_id = trip_to_shape.get(trip_id, "")
        if not route_id:
            continue

        shape_line = [[lon, lat] for lon, lat, _ in sorted(shape_points.get(shape_id, []), key=lambda p: p[2])] if shape_id else []

        ordered_stops = []
        for sequence_value, stop_id in sorted(stop_items, key=lambda item: item[0]):
            coord = stop_coords.get(stop_id)
            if not coord:
                continue
            ordered_stops.append((sequence_value, stop_id, coord))

        if len(ordered_stops) < 2:
            continue

        stop_id_sequence = tuple(stop_id for _, stop_id, _ in ordered_stops)
        dedup_shape_key = shape_id if shape_id else f"trip:{trip_id}"
        connection_key = (route_id, dedup_shape_key, stop_id_sequence)
        if connection_key in generated_connection_keys:
            continue

        connection_coordinates: list[list[float]] = []
        if len(shape_line) >= 2:
            projected_points: list[tuple[int, float, list[float]]] = []
            for sequence_value, stop_id, coord in ordered_stops:
                along, projected_point = _project_point_to_polyline(coord, shape_line)
                projected_points.append((sequence_value, along, projected_point))

            projected_points.sort(key=lambda item: item[0])
            for index in range(len(projected_points) - 1):
                start_along = projected_points[index][1]
                end_along = projected_points[index + 1][1]
                segment = _extract_polyline_between(shape_line, start_along, end_along)
                if len(segment) < 2:
                    segment = [projected_points[index][2], projected_points[index + 1][2]]

                if not connection_coordinates:
                    connection_coordinates.extend(segment)
                else:
                    connection_coordinates.extend(segment[1:] if connection_coordinates[-1] == segment[0] else segment)
        else:
            connection_coordinates = [coord for _, _, coord in ordered_stops]

        if len(connection_coordinates) < 2:
            continue

        stop_connection_features.append(
            {
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": connection_coordinates,
                },
                "properties": {
                    "route_id": route_id,
                    "route_color": routes.get(route_id, {}).get("route_color", _color_from_route_id(route_id)),
                    "trip_id": trip_id,
                    "shape_id": shape_id,
                    "stop_count": len(ordered_stops),
                },
            }
        )
        generated_connection_keys.add(connection_key)

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
    for stop_id, coord in stop_coords.items():
        stop_features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": coord},
                "properties": {
                    "stop_id": stop_id,
                    "stop_name": stop_names.get(stop_id, ""),
                    "routes": [],
                    "times": [],
                },
            }
        )

    return {
        "routes_geojson": {"type": "FeatureCollection", "features": route_features},
        "stops_geojson": {"type": "FeatureCollection", "features": stop_features},
        "stop_connections_geojson": {"type": "FeatureCollection", "features": stop_connection_features},
        "trip_to_route": trip_to_route,
        "route_catalog": sorted(route_catalog, key=lambda x: x["route_short_name"] or x["route_long_name"]),
    }
