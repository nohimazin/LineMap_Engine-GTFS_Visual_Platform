import json
import sqlite3
import threading
from pathlib import Path
from typing import Any


class DataStore:
    def __init__(self, db_path: str = "data/linemap.db") -> None:
        self._lock = threading.Lock()
        self._gtfs_data: dict[str, dict[str, Any]] = {}
        self._current_gtfs_id: str = "default"
        self._active_gtfs_ids: list[str] = []
        self._agency_name: str = ""
        self._gtfs_rt_config: dict[str, Any] = {"gtfs_rt_url": None, "interval_sec": 10}
        self._routes_geojson: dict[str, Any] = {"type": "FeatureCollection", "features": []}
        self._stops_geojson: dict[str, Any] = {"type": "FeatureCollection", "features": []}
        self._stop_connections_geojson: dict[str, Any] = {"type": "FeatureCollection", "features": []}
        self._trip_to_route: dict[str, str] = {}
        self._route_catalog: list[dict[str, Any]] = []

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
        persisted_current_id = self._load_blob("current_gtfs_id", "default")
        self._current_gtfs_id = persisted_current_id if isinstance(persisted_current_id, str) else "default"
        persisted_active_ids = self._load_blob("active_gtfs_ids", [])
        self._active_gtfs_ids = [gid for gid in persisted_active_ids if gid in self._gtfs_data] if isinstance(persisted_active_ids, list) else []
        if not self._active_gtfs_ids and self._current_gtfs_id in self._gtfs_data:
            self._active_gtfs_ids = [self._current_gtfs_id]
        if self._current_gtfs_id in self._gtfs_data:
            self.select_gtfs(self._current_gtfs_id)

    def list_gtfs(self) -> list[dict[str, Any]]:
        with self._lock:
            return [
                {
                    "gtfs_id": gid,
                    "is_current": gid == self._current_gtfs_id,
                    "route_count": len(self._gtfs_data.get(gid, {}).get("route_catalog", [])),
                    "stop_count": len(self._gtfs_data.get(gid, {}).get("stops_geojson", {}).get("features", [])),
                    "is_active": gid in self._active_gtfs_ids,
                    "gtfs_rt_url": self._gtfs_data.get(gid, {}).get("gtfs_rt_config", {}).get("gtfs_rt_url"),
                    "interval_sec": self._gtfs_data.get(gid, {}).get("gtfs_rt_config", {}).get("interval_sec", 10),
                    "vehicle_color": self._gtfs_data.get(gid, {}).get("gtfs_rt_config", {}).get("vehicle_color", "#e4572e"),
                }
                for gid in sorted(self._gtfs_data.keys())
            ]

    def select_gtfs(self, gtfs_id: str) -> bool:
        with self._lock:
            if gtfs_id not in self._gtfs_data:
                return False
            self._activate_gtfs_unlocked(gtfs_id)
            return True

    def _activate_gtfs_unlocked(self, gtfs_id: str) -> None:
        self._current_gtfs_id = gtfs_id
        data = self._gtfs_data[gtfs_id]
        self._agency_name = data.get("agency_name", "")
        self._routes_geojson = data.get("routes_geojson", {"type": "FeatureCollection", "features": []})
        self._stops_geojson = data.get("stops_geojson", {"type": "FeatureCollection", "features": []})
        self._stop_connections_geojson = data.get("stop_connections_geojson", {"type": "FeatureCollection", "features": []})
        self._trip_to_route = data.get("trip_to_route", {})
        self._route_catalog = data.get("route_catalog", [])
        self._gtfs_rt_config = data.get("gtfs_rt_config", {"gtfs_rt_url": None, "interval_sec": 10, "vehicle_color": "#e4572e"})

    def delete_gtfs(self, gtfs_id: str) -> bool:
        with self._lock:
            if gtfs_id not in self._gtfs_data:
                return False

            del self._gtfs_data[gtfs_id]
            if gtfs_id == self._current_gtfs_id:
                next_gtfs_id = sorted(self._gtfs_data.keys())[0] if self._gtfs_data else None
                if next_gtfs_id:
                    self._activate_gtfs_unlocked(next_gtfs_id)
                else:
                    self._current_gtfs_id = "default"
                    self._agency_name = ""
                    self._routes_geojson = {"type": "FeatureCollection", "features": []}
                    self._stops_geojson = {"type": "FeatureCollection", "features": []}
                    self._stop_connections_geojson = {"type": "FeatureCollection", "features": []}
                    self._trip_to_route = {}
                    self._route_catalog = []
                    self._gtfs_rt_config = {"gtfs_rt_url": None, "interval_sec": 10}

            self._save_blob("gtfs_data", self._gtfs_data)
            self._save_blob("current_gtfs_id", self._current_gtfs_id)
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
        gtfs_id: str = "default",
    ) -> None:
        with self._lock:
            rt_config = {
                "gtfs_rt_url": gtfs_rt_url,
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
            }
            self._gtfs_data[gtfs_id] = data
            self._current_gtfs_id = gtfs_id
            self._agency_name = agency_name
            self._routes_geojson = routes_geojson
            self._stops_geojson = stops_geojson
            self._stop_connections_geojson = stop_connections_geojson
            self._trip_to_route = trip_to_route
            self._route_catalog = route_catalog
            self._gtfs_rt_config = dict(rt_config)

            self._save_blob("gtfs_data", self._gtfs_data)
            self._save_blob("current_gtfs_id", self._current_gtfs_id)
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
            return json.loads(json.dumps(data)) if data else None

    def active_map_data(self) -> dict[str, Any]:
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
                    feature = json.loads(json.dumps(feature))
                    props = feature.setdefault("properties", {})
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
                    target.append(feature)
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

    def routes_geojson(self) -> dict[str, Any]:
        with self._lock:
            return self._routes_geojson

    def stops_geojson(self) -> dict[str, Any]:
        with self._lock:
            return self._stops_geojson

    def stop_connections_geojson(self) -> dict[str, Any]:
        with self._lock:
            return self._stop_connections_geojson

    def trip_to_route(self) -> dict[str, str]:
        with self._lock:
            return self._trip_to_route

    def route_catalog(self) -> list[dict[str, Any]]:
        with self._lock:
            return self._route_catalog

    def agency_name(self) -> str:
        with self._lock:
            return self._agency_name

    def gtfs_rt_config(self) -> dict[str, Any]:
        with self._lock:
            return dict(self._gtfs_rt_config)

    def update_gtfs_rt_config(self, gtfs_rt_url: str | None, interval_sec: int, vehicle_color: str | None = None) -> None:
        with self._lock:
            current_color = vehicle_color or self._gtfs_rt_config.get("vehicle_color", "#e4572e")
            self._gtfs_rt_config = {"gtfs_rt_url": gtfs_rt_url, "interval_sec": interval_sec, "vehicle_color": current_color}
            if self._current_gtfs_id in self._gtfs_data:
                self._gtfs_data[self._current_gtfs_id]["gtfs_rt_config"] = dict(self._gtfs_rt_config)
                self._save_blob("gtfs_data", self._gtfs_data)
