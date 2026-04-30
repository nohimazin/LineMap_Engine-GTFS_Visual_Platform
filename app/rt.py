import asyncio
import time
from typing import Any

import httpx
from google.transit import gtfs_realtime_pb2


class RealtimeVehicleService:
    def __init__(self) -> None:
        self._url: str | None = None
        self._interval_sec: int = 10
        self._vehicles: dict[str, Any] = {"type": "FeatureCollection", "features": []}
        self._last_update_unix: int | None = None
        self._last_success_unix: int | None = None
        self._last_error: str | None = None
        self._last_error_unix: int | None = None
        self._last_http_status: int | None = None
        self._consecutive_error_count: int = 0
        self._error_history: list[dict[str, Any]] = []

    def _record_error(self, message: str, http_status: int | None = None) -> None:
        now_unix = int(time.time())
        self._last_error = message
        self._last_error_unix = now_unix
        self._last_http_status = http_status
        self._consecutive_error_count += 1
        self._error_history.append(
            {
                "unix": now_unix,
                "message": message,
                "http_status": http_status,
                "retry_count": self._consecutive_error_count,
            }
        )
        if len(self._error_history) > 5:
            self._error_history = self._error_history[-5:]

    def _record_success(self) -> None:
        now_unix = int(time.time())
        self._last_update_unix = now_unix
        self._last_success_unix = now_unix
        self._last_error = None
        self._last_error_unix = None
        self._last_http_status = None
        self._consecutive_error_count = 0

    def configure(self, url: str | None, interval_sec: int | None = None) -> None:
        self._url = url.strip() if url else None
        if interval_sec is not None:
            self._interval_sec = max(5, min(interval_sec, 60))

    async def fetch_once(self, trip_to_route: dict[str, str]) -> None:
        if not self._url:
            return

        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                response = await client.get(self._url)
                response.raise_for_status()
                self._last_http_status = response.status_code

            feed = gtfs_realtime_pb2.FeedMessage()
            feed.ParseFromString(response.content)

            features: list[dict[str, Any]] = []
            for entity in feed.entity:
                if not entity.HasField("vehicle"):
                    continue
                vehicle = entity.vehicle
                if not vehicle.HasField("position"):
                    continue

                lat = vehicle.position.latitude
                lon = vehicle.position.longitude
                trip_id = vehicle.trip.trip_id if vehicle.HasField("trip") else ""
                route_id = vehicle.trip.route_id if vehicle.HasField("trip") else ""
                if not route_id and trip_id:
                    route_id = trip_to_route.get(trip_id, "")

                vehicle_id = ""
                if vehicle.HasField("vehicle") and vehicle.vehicle.HasField("id"):
                    vehicle_id = vehicle.vehicle.id

                features.append(
                    {
                        "type": "Feature",
                        "geometry": {"type": "Point", "coordinates": [lon, lat]},
                        "properties": {
                            "vehicle_id": vehicle_id,
                            "trip_id": trip_id,
                            "route_id": route_id,
                            "bearing": vehicle.position.bearing if vehicle.position.HasField("bearing") else None,
                            "speed": vehicle.position.speed if vehicle.position.HasField("speed") else None,
                            "timestamp": vehicle.timestamp if vehicle.HasField("timestamp") else None,
                        },
                    }
                )

            self._vehicles = {"type": "FeatureCollection", "features": features}
            self._record_success()
        except Exception as exc:  # noqa: BLE001
            http_status = exc.response.status_code if isinstance(exc, httpx.HTTPStatusError) else None
            self._record_error(str(exc), http_status)

    async def polling_loop(self, trip_to_route_getter) -> None:
        while True:
            try:
                await self.fetch_once(trip_to_route_getter())
            except Exception:  # noqa: BLE001
                pass
            await asyncio.sleep(self._interval_sec)

    def vehicles(self) -> dict[str, Any]:
        return self._vehicles

    def status(self) -> dict[str, Any]:
        return {
            "url": self._url,
            "interval_sec": self._interval_sec,
            "last_update_unix": self._last_update_unix,
            "last_error": self._last_error,
            "last_success_unix": self._last_success_unix,
            "last_error_unix": self._last_error_unix,
            "last_http_status": self._last_http_status,
            "consecutive_error_count": self._consecutive_error_count,
            "error_history": list(self._error_history),
        }
