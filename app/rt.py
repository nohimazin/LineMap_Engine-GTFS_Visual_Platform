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
        self._last_error: str | None = None

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
            self._last_update_unix = int(time.time())
            self._last_error = None
        except Exception as exc:  # noqa: BLE001
            self._last_error = str(exc)

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
        }
