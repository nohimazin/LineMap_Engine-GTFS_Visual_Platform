import asyncio
import gzip
from unittest.mock import AsyncMock, patch

from google.transit import gtfs_realtime_pb2

from app.rt import RealtimeVehicleService


class FakeResponse:
    status_code = 200

    def __init__(self, content: bytes) -> None:
        self.content = content

    def raise_for_status(self) -> None:
        return None


async def fetch_feed(payload: bytes, trip_to_route: dict[str, str]) -> RealtimeVehicleService:
    response = FakeResponse(payload)
    client = AsyncMock()
    client.__aenter__.return_value.get = AsyncMock(return_value=response)
    service = RealtimeVehicleService()
    service.configure("https://example.test/vehicle.pb", 10)
    with patch("httpx.AsyncClient", return_value=client):
        await service.fetch_once(trip_to_route)
    return service


def test_fetch_gzipped_vehicle_positions() -> None:
    feed = gtfs_realtime_pb2.FeedMessage()
    feed.header.gtfs_realtime_version = "2.0"
    entity = feed.entity.add()
    entity.id = "entity-1"
    entity.vehicle.position.latitude = 35.0
    entity.vehicle.position.longitude = 139.0
    entity.vehicle.vehicle.id = "bus-1"
    entity.vehicle.trip.trip_id = "trip-1"

    service = asyncio.run(fetch_feed(gzip.compress(feed.SerializeToString()), {"trip-1": "route-1"}))

    assert service.status()["last_error"] is None
    assert service.vehicles()["features"][0]["properties"] == {
        "vehicle_id": "bus-1",
        "trip_id": "trip-1",
        "route_id": "route-1",
        "bearing": None,
        "speed": None,
        "timestamp": None,
    }
