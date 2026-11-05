import asyncio
import gzip
import math
import time
from typing import Any

import httpx
from google.transit import gtfs_realtime_pb2

MAX_GZIP_PAYLOAD_SIZE = 25 * 1024 * 1024  # 25MB limit to prevent decompression bombs


class RealtimeVehicleService:
    def __init__(self) -> None:
        self._url: str | None = None
        self._trip_update_url: str | None = None
        self._interval_sec: int = 10
        self._vehicles: dict[str, Any] = {"type": "FeatureCollection", "features": []}
        self._last_update_unix: int | None = None
        self._last_success_unix: int | None = None
        self._last_error: str | None = None
        self._last_error_unix: int | None = None
        self._last_http_status: int | None = None
        self._consecutive_error_count: int = 0
        self._error_history: list[dict[str, Any]] = []
        # 車両の移動方向推測用
        self._vehicle_bearing_base: dict[str, tuple[float, float]] = {}   # 方位計算の基準位置
        self._vehicle_estimated_bearing: dict[str, float] = {}            # 最新の推測方位
        self._vehicle_last_ts: dict[str, int] = {}                        # 最終測位時刻 (unix)
        self._vehicle_last_seen_poll: dict[str, int] = {}                  # 最終検出ポーリング番号
        self._poll_index: int = 0

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

    @staticmethod
    def _compute_heading(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        """2点間の移動方向を方位角（度, 0=北, 時計回り）で返す。"""
        import math
        dlat = math.radians(lat2 - lat1)
        dlon = math.radians(lon2 - lon1)
        lat1r = math.radians(lat1)
        lat2r = math.radians(lat2)
        x = math.sin(dlon) * math.cos(lat2r)
        y = math.cos(lat1r) * math.sin(lat2r) - math.sin(lat1r) * math.cos(lat2r) * math.cos(dlon)
        bearing = math.degrees(math.atan2(x, y))
        return (bearing + 360.0) % 360.0

    @staticmethod
    def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        """2点間の距離をメートルで返す（Haversine formula）。"""
        import math
        r = 6371000.0
        phi1 = math.radians(lat1)
        phi2 = math.radians(lat2)
        dphi = math.radians(lat2 - lat1)
        dlmb = math.radians(lon2 - lon1)
        a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlmb / 2) ** 2
        return 2 * r * math.asin(math.sqrt(a))

    def configure(self, url: str | None, interval_sec: int | None = None, trip_update_url: str | None = None) -> None:
        new_url = url.strip() if url else None
        self._trip_update_url = trip_update_url.strip() if trip_update_url else None
        if new_url != self._url:
            self._url = new_url
            self._last_error = None
            self._last_error_unix = None
            self._last_http_status = None
            self._consecutive_error_count = 0
            self._error_history = []
            self._vehicle_prev_pos = {}
            self._vehicle_estimated_bearing = {}
        if interval_sec is not None:
            self._interval_sec = max(5, min(interval_sec, 60))
        self._vehicles = {"type": "FeatureCollection", "features": []}
        self._last_update_unix = None
        self._last_success_unix = None

    async def fetch_once(self, trip_to_route: dict[str, str]) -> None:
        if not self._url:
            return

        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                response = await client.get(self._url)
                response.raise_for_status()
                self._last_http_status = response.status_code
                vehicle_payload = response.content
                trip_payload = None
                if self._trip_update_url:
                    trip_response = await client.get(self._trip_update_url)
                    trip_response.raise_for_status()
                    trip_payload = trip_response.content

            def parse_feed(payload: bytes) -> gtfs_realtime_pb2.FeedMessage:
                if payload[:2] == b"\x1f\x8b":
                    if len(payload) > MAX_GZIP_PAYLOAD_SIZE:
                        raise ValueError("GTFS-RT payload exceeds maximum allowed size.")
                    payload = gzip.decompress(payload)
                result = gtfs_realtime_pb2.FeedMessage()
                result.ParseFromString(payload)
                return result

            feed = parse_feed(vehicle_payload)
            trip_update_feed = parse_feed(trip_payload) if trip_payload else feed

            trip_delays: dict[str, dict[int, int]] = {}
            for entity in trip_update_feed.entity:
                if not entity.HasField("trip_update") or not entity.trip_update.HasField("trip"):
                    continue
                trip_id = entity.trip_update.trip.trip_id
                if not trip_id:
                    continue
                delays: dict[int, int] = {}
                for stop_update in entity.trip_update.stop_time_update:
                    delay = None
                    if stop_update.HasField("departure") and stop_update.departure.HasField("delay"):
                        delay = stop_update.departure.delay
                    elif stop_update.HasField("arrival") and stop_update.arrival.HasField("delay"):
                        delay = stop_update.arrival.delay
                    if delay is None:
                        continue
                    delays[stop_update.stop_sequence] = delay
                if delays:
                    trip_delays[trip_id] = delays

            self._poll_index += 1
            features: list[dict[str, Any]] = []
            current_vehicle_ids: set[str] = set()
            for entity in feed.entity:
                if not entity.HasField("vehicle"):
                    continue
                vehicle = entity.vehicle
                if not vehicle.HasField("position"):
                    continue

                lat = vehicle.position.latitude
                lon = vehicle.position.longitude
                if not math.isfinite(lat) or not math.isfinite(lon):
                    continue
                if not -90 <= lat <= 90 or not -180 <= lon <= 180:
                    continue
                trip_id = vehicle.trip.trip_id if vehicle.HasField("trip") else ""
                route_id = vehicle.trip.route_id if vehicle.HasField("trip") else ""
                if not route_id and trip_id:
                    route_id = trip_to_route.get(trip_id, "")

                vehicle_id = ""
                vehicle_label = ""
                if vehicle.HasField("vehicle") and vehicle.vehicle.HasField("id"):
                    vehicle_id = vehicle.vehicle.id
                if vehicle.HasField("vehicle") and vehicle.vehicle.HasField("label"):
                    vehicle_label = vehicle.vehicle.label

                feed_has_bearing = vehicle.position.HasField("bearing")
                bearing = vehicle.position.bearing if feed_has_bearing else 0.0
                speed = vehicle.position.speed if vehicle.position.HasField("speed") else 0.0
                delay_seconds = None
                delays = trip_delays.get(trip_id)
                if delays:
                    current_stop_sequence = vehicle.current_stop_sequence if vehicle.HasField("current_stop_sequence") else None
                    if current_stop_sequence in delays:
                        delay_seconds = delays[current_stop_sequence]
                    else:
                        delay_seconds = next(iter(delays.values()))

                # 移動方向の推測（Haversine でメートル換算 + 移動距離の累積）
                estimated_bearing: float | None = None
                track_key = None
                vehicle_key_type = "v" if vehicle_id else None
                if vehicle_id:
                    track_key = ("v", vehicle_id)
                elif vehicle.HasField("trip") and vehicle.trip.trip_id:
                    trip = vehicle.trip
                    start_date = trip.start_date if trip.HasField("start_date") else ""
                    start_time = trip.start_time if trip.HasField("start_time") else ""
                    track_key = ("t", trip.trip_id, start_date, start_time)
                elif entity.id:
                    track_key = ("e", entity.id)

                # 測位時刻の鮮度チェック（90秒より古いデータは推定に使わない）
                ts = vehicle.timestamp if vehicle.HasField("timestamp") else None
                # VehiclePosition には timestamp が無い場合もあるので position.timestamp を優先
                if ts is None and vehicle.HasField("timestamp"):
                    ts = vehicle.timestamp
                stale = False
                now_unix = int(time.time())
                if ts is not None and (now_unix - int(ts)) > 90:
                    stale = True

                if track_key is not None:
                    current_vehicle_ids.add(track_key)
                    self._vehicle_last_seen_poll[track_key] = self._poll_index
                    base = self._vehicle_bearing_base.get(track_key)
                    last_ts = self._vehicle_last_ts.get(track_key)
                    # GPS 飛び検出用の速度チェック
                    if base is None:
                        self._vehicle_bearing_base[track_key] = (lat, lon)
                        if ts is not None:
                            self._vehicle_last_ts[track_key] = int(ts)
                        estimated_bearing = self._vehicle_estimated_bearing.get(track_key)
                    else:
                        dist_m = self._haversine_m(base[0], base[1], lat, lon)
                        # 速度チェック: タイムスタンプがある場合は異常速度を除外
                        speed_ok = True
                        if ts is not None and last_ts is not None and (int(ts) - last_ts) > 0:
                            dt = int(ts) - last_ts
                            speed_ms = dist_m / dt
                            if speed_ms > 55.6:  # 200 km/h 超は GPS 飛びとみなす
                                speed_ok = False
                        if (not stale) and speed_ok and dist_m >= 1.0:
                            estimated_bearing = self._compute_heading(base[0], base[1], lat, lon)
                            self._vehicle_estimated_bearing[track_key] = estimated_bearing
                            self._vehicle_bearing_base[track_key] = (lat, lon)
                            if ts is not None:
                                self._vehicle_last_ts[track_key] = int(ts)
                        else:
                            estimated_bearing = self._vehicle_estimated_bearing.get(track_key)
                            if ts is not None and last_ts is None:
                                self._vehicle_last_ts[track_key] = int(ts)


                features.append(
                    {
                        "type": "Feature",
                        "geometry": {"type": "Point", "coordinates": [lon, lat]},
                        "properties": {
                            "vehicle_id": vehicle_id,
                            "vehicle_label": vehicle_label,
                            "trip_id": trip_id,
                            "route_id": route_id,
                            "bearing": bearing,
                            "has_bearing": feed_has_bearing,
                            "estimated_bearing": estimated_bearing,
                            "has_direction": bool(feed_has_bearing or (estimated_bearing is not None)),
                            "speed": speed,
                            "timestamp": vehicle.timestamp if vehicle.HasField("timestamp") else None,
                            "delay_seconds": delay_seconds,
                        },
                    }
                )

            # 消えた車両の履歴を整理
            # 消えた車両の履歴を猶予期間（3ポーリング）後に整理
            gone = [k for k, seen in self._vehicle_last_seen_poll.items()
                    if (self._poll_index - seen) > 3]
            for k in gone:
                self._vehicle_bearing_base.pop(k, None)
                self._vehicle_estimated_bearing.pop(k, None)
                self._vehicle_last_ts.pop(k, None)
                self._vehicle_last_seen_poll.pop(k, None)

            self._vehicles = {"type": "FeatureCollection", "features": features}
            self._record_success()
        except Exception as exc:  # noqa: BLE001
            http_status = exc.response.status_code if isinstance(exc, httpx.HTTPStatusError) else None
            self._record_error(str(exc), http_status)

    async def polling_loop(self, trip_to_route_getter) -> None:
        while True:
            try:
                if self._url:
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
            "vehicle_count": len(self._vehicles.get("features", [])),
            "error_history": list(self._error_history),
        }
