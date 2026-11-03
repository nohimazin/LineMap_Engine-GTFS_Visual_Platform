import json
import sqlite3
import threading
from pathlib import Path
from typing import Any


class DataStore:
    def __init__(self, db_path: str = "data/linemap.db") -> None:
        self._lock = threading.Lock()
        self._gtfs_data: dict[str, dict[str, Any]] = {}
        self._active_gtfs_ids: list[str] = []

        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()
        self._load_from_db()

    def _init_db(self) -> None:
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS blobs (
                    key TEXT PRIMARY KEY,
                    payload TEXT NOT NULL
                )
                """
            )
            conn.commit()

    def _load_blob(self, key: str, default: Any) -> Any:
        with sqlite3.connect(self.db_path) as conn:
            row = conn.execute("SELECT payload FROM blobs WHERE key = ?", (key,)).fetchone()
        if not row:
            return default
        return json.loads(row[0])

    def _save_blob(self, key: str, payload: Any) -> None:
        data = json.dumps(payload, ensure_ascii=False)
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """
                INSERT INTO blobs(key, payload)
                VALUES(?, ?)
                ON CONFLICT(key) DO UPDATE SET payload = excluded.payload
                """,
                (key, data),
            )
            conn.commit()

    def _load_from_db(self) -> None:
        persisted_gtfs_data = self._load_blob("gtfs_data", {})
        self._gtfs_data = persisted_gtfs_data if isinstance(persisted_gtfs_data, dict) else {}
        persisted_active_ids = self._load_blob("active_gtfs_ids", [])
        self._active_gtfs_ids = [gid for gid in persisted_active_ids if gid in self._gtfs_data] if isinstance(persisted_active_ids, list) else []
        if not self._active_gtfs_ids and self._gtfs_data:
            self._active_gtfs_ids = [sorted(self._gtfs_data)[0]]
            self._save_blob("active_gtfs_ids", self._active_gtfs_ids)

    def list_gtfs(self) -> list[dict[str, Any]]:
        with self._lock:
            return [
                {
                    "gtfs_id": gid,
                    "route_count": len(self._gtfs_data.get(gid, {}).get("route_catalog", [])),
                    "stop_count": len(self._gtfs_data.get(gid, {}).get("stops_geojson", {}).get("features", [])),
                    "is_active": gid in self._active_gtfs_ids,
                    "gtfs_rt_url": self._gtfs_data.get(gid, {}).get("gtfs_rt_config", {}).get("gtfs_rt_url"),
                    "gtfs_trip_update_url": self._gtfs_data.get(gid, {}).get("gtfs_rt_config", {}).get("gtfs_trip_update_url"),
                    "interval_sec": self._gtfs_data.get(gid, {}).get("gtfs_rt_config", {}).get("interval_sec", 10),
                    "vehicle_color": self._gtfs_data.get(gid, {}).get("gtfs_rt_config", {}).get("vehicle_color", "#e4572e"),
                }
                for gid in sorted(self._gtfs_data.keys())
            ]

    def delete_gtfs(self, gtfs_id: str) -> bool:
        with self._lock:
            if gtfs_id not in self._gtfs_data:
                return False

            del self._gtfs_data[gtfs_id]
            self._save_blob("gtfs_data", self._gtfs_data)
            self._active_gtfs_ids = [gid for gid in self._active_gtfs_ids if gid != gtfs_id]
            self._save_blob("active_gtfs_ids", self._active_gtfs_ids)
            return True

    def update_gtfs(
        self,
        routes_geojson: dict[str, Any],
        stops_geojson: dict[str, Any],
        stop_connections_geojson: dict[str, Any],
        trip_to_route: dict[str, str],
        route_catalog: list[dict[str, Any]],
        agency_name: str = "",
        gtfs_rt_url: str | None = None,
        interval_sec: int = 10,
        vehicle_color: str = "#e4572e",
        gtfs_trip_update_url: str | None = None,
        gtfs_id: str = "default",
        service_date: str | None = None,
        source_zip_base64: str | None = None,
    ) -> None:
        with self._lock:
            rt_config = {
                "gtfs_rt_url": gtfs_rt_url,
                "gtfs_trip_update_url": gtfs_trip_update_url,
                "interval_sec": max(5, min(interval_sec, 60)),
                "vehicle_color": vehicle_color or "#e4572e",
            }
            data = {
                "agency_name": agency_name,
                "routes_geojson": routes_geojson,
                "stops_geojson": stops_geojson,
                "stop_connections_geojson": stop_connections_geojson,
                "trip_to_route": trip_to_route,
                "route_catalog": route_catalog,
                "gtfs_rt_config": rt_config,
                "service_date": service_date,
                "source_zip_base64": source_zip_base64,
            }
            self._gtfs_data[gtfs_id] = data
            self._save_blob("gtfs_data", self._gtfs_data)
            if gtfs_id not in self._active_gtfs_ids:
                self._active_gtfs_ids.append(gtfs_id)
            self._save_blob("active_gtfs_ids", self._active_gtfs_ids)

    def active_gtfs_ids(self) -> list[str]:
        with self._lock:
            return list(self._active_gtfs_ids)

    def set_active_gtfs_ids(self, gtfs_ids: list[str]) -> None:
        with self._lock:
            invalid = [gid for gid in gtfs_ids if gid not in self._gtfs_data]
            if invalid or not gtfs_ids:
                raise ValueError("有効なGTFSを1つ以上指定してください。")
            self._active_gtfs_ids = list(dict.fromkeys(gtfs_ids))
            self._save_blob("active_gtfs_ids", self._active_gtfs_ids)

    def gtfs_data(self, gtfs_id: str) -> dict[str, Any] | None:
        with self._lock:
            data = self._gtfs_data.get(gtfs_id)
            if not data:
                return None
            return {
                "agency_name": data.get("agency_name", ""),
                "routes_geojson": data.get("routes_geojson", {}),
                "stops_geojson": data.get("stops_geojson", {}),
                "stop_connections_geojson": data.get("stop_connections_geojson", {}),
                "trip_to_route": dict(data.get("trip_to_route", {})),
                "route_catalog": [dict(item) for item in data.get("route_catalog", [])],
                "gtfs_rt_config": dict(data.get("gtfs_rt_config", {})),
                "service_date": data.get("service_date"),
                "source_zip_base64": data.get("source_zip_base64"),
            }

    def active_map_data(self) -> dict[str, Any]:
        with self._lock:
            routes, stops, connections, catalog = [], [], [], []
            for gid in self._active_gtfs_ids:
                data = self._gtfs_data.get(gid, {})
                prefix = f"{gid}:"
                for collection, target in (
                    (data.get("routes_geojson", {}), routes),
                    (data.get("stops_geojson", {}), stops),
                    (data.get("stop_connections_geojson", {}), connections),
                ):
                    for feature in collection.get("features", []):
                        props = dict(feature.get("properties", {}))
                        if props.get("stop_id"):
                            props["stop_id"] = prefix + str(props["stop_id"])
                        for key in ("route_id",):
                            if props.get(key):
                                props[key] = prefix + str(props[key])
                        if props.get("routes"):
                            props["routes"] = [prefix + str(value) for value in props["routes"]]
                        if props.get("routes_all"):
                            props["routes_all"] = [prefix + str(value) for value in props["routes_all"]]
                        props["dataset_id"] = gid
                        target.append({
                            "type": feature.get("type", "Feature"),
                            "geometry": feature.get("geometry"),
                            "properties": props,
                        })
                for item in data.get("route_catalog", []):
                    item = dict(item)
                    item["route_id"] = prefix + str(item["route_id"])
                    item["dataset_id"] = gid
                    catalog.append(item)
            return {
                "routes": {"type": "FeatureCollection", "features": routes},
                "stops": {"type": "FeatureCollection", "features": stops},
                "stop_connections": {"type": "FeatureCollection", "features": connections},
                "route_catalog": catalog,
                "active_gtfs_ids": list(self._active_gtfs_ids),
            }

    def update_gtfs_rt_config(self, gtfs_id: str, gtfs_rt_url: str | None, interval_sec: int, vehicle_color: str, gtfs_trip_update_url: str | None = None) -> None:
        with self._lock:
            if gtfs_id not in self._gtfs_data:
                raise ValueError(f"GTFS {gtfs_id} が見つかりません")
            self._gtfs_data[gtfs_id]["gtfs_rt_config"] = {
                "gtfs_rt_url": gtfs_rt_url,
                "gtfs_trip_update_url": gtfs_trip_update_url,
                "interval_sec": max(5, min(interval_sec, 60)),
                "vehicle_color": vehicle_color,
            }
            self._save_blob("gtfs_data", self._gtfs_data)
