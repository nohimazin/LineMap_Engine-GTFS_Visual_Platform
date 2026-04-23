import json
import sqlite3
import threading
from pathlib import Path
from typing import Any


class DataStore:
    def __init__(self, db_path: str = "data/linemap.db") -> None:
        self._lock = threading.Lock()
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
        self._routes_geojson = self._load_blob("routes_geojson", self._routes_geojson)
        self._stops_geojson = self._load_blob("stops_geojson", self._stops_geojson)
        self._stop_connections_geojson = self._load_blob("stop_connections_geojson", self._stop_connections_geojson)
        self._trip_to_route = self._load_blob("trip_to_route", self._trip_to_route)
        self._route_catalog = self._load_blob("route_catalog", self._route_catalog)

    def update_gtfs(
        self,
        routes_geojson: dict[str, Any],
        stops_geojson: dict[str, Any],
        stop_connections_geojson: dict[str, Any],
        trip_to_route: dict[str, str],
        route_catalog: list[dict[str, Any]],
    ) -> None:
        with self._lock:
            self._routes_geojson = routes_geojson
            self._stops_geojson = stops_geojson
            self._stop_connections_geojson = stop_connections_geojson
            self._trip_to_route = trip_to_route
            self._route_catalog = route_catalog

            self._save_blob("routes_geojson", routes_geojson)
            self._save_blob("stops_geojson", stops_geojson)
            self._save_blob("stop_connections_geojson", stop_connections_geojson)
            self._save_blob("trip_to_route", trip_to_route)
            self._save_blob("route_catalog", route_catalog)

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
