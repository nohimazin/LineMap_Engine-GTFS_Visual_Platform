import asyncio
import zipfile
from contextlib import asynccontextmanager, suppress
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, HttpUrl

from app.gtfs import parse_gtfs_zip
from app.rt import RealtimeVehicleService
from app.storage import DataStore


class DatasetSettingsRequest(BaseModel):
    gtfs_id: str = "default"
    gtfs_rt_url: HttpUrl | None = None
    interval_sec: int = 10
    vehicle_color: str = "#e4572e"


class ActiveDatasetsRequest(BaseModel):
    gtfs_ids: list[str]


store = DataStore()
rt_services: dict[str, RealtimeVehicleService] = {}
rt_tasks: list[asyncio.Task] = []
rt_task_gtfs_ids: set[str] = set()

static_dir = Path(__file__).resolve().parent.parent / "static"


@asynccontextmanager
async def lifespan(_: FastAPI):
    for item in store.list_gtfs():
        data = store.gtfs_data(item["gtfs_id"]) or {}
        config = data.get("gtfs_rt_config", {})
        service = RealtimeVehicleService()
        service.configure(config.get("gtfs_rt_url"), config.get("interval_sec", 10))
        rt_services[item["gtfs_id"]] = service
        rt_tasks.append(asyncio.create_task(service.polling_loop(lambda gid=item["gtfs_id"]: (store.gtfs_data(gid) or {}).get("trip_to_route", {}))))
        rt_task_gtfs_ids.add(item["gtfs_id"])
    try:
        yield
    finally:
        for task in rt_tasks:
            task.cancel()
        for task in rt_tasks:
            with suppress(asyncio.CancelledError):
                await task


app = FastAPI(title="LineMap Engine GTFS Visual Platform", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def disable_cache_for_web_assets(request, call_next):
    response = await call_next(request)
    path = request.url.path
    if path == "/" or path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")


def _namespace_vehicle_route_id(route_id: str, gtfs_id: str) -> str:
    """Keep realtime route IDs consistent with IDs returned by active_map_data."""
    route_id = str(route_id or "")
    if not route_id or route_id.startswith(f"{gtfs_id}:"):
        return route_id
    return f"{gtfs_id}:{route_id}"


@app.get("/")
def index() -> FileResponse:
    return FileResponse(static_dir / "index.html")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/upload")
async def upload_gtfs(
    file: UploadFile = File(...),
    gtfs_id: str = Query("default"),
    gtfs_rt_url: HttpUrl | None = Query(None),
    interval_sec: int = Query(10, ge=5, le=60),
    vehicle_color: str = Query("#e4572e"),
) -> dict[str, int | str]:
    if not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="GTFS ZIPファイルを指定してください。")

    raw_zip = await file.read()
    try:
        parsed = parse_gtfs_zip(raw_zip)
    except (ValueError, zipfile.BadZipFile) as exc:
        detail = str(exc) or "有効なGTFS ZIPファイルを指定してください。"
        raise HTTPException(status_code=400, detail=detail) from exc

    store.update_gtfs(
        routes_geojson=parsed["routes_geojson"],
        stops_geojson=parsed["stops_geojson"],
        stop_connections_geojson=parsed["stop_connections_geojson"],
        trip_to_route=parsed["trip_to_route"],
        route_catalog=parsed["route_catalog"],
        agency_name=parsed["agency_name"],
        gtfs_rt_url=str(gtfs_rt_url) if gtfs_rt_url else None,
        interval_sec=interval_sec,
        vehicle_color=vehicle_color,
        gtfs_id=gtfs_id,
    )
    config = store.gtfs_data(gtfs_id).get("gtfs_rt_config", {})
    service = rt_services.setdefault(gtfs_id, RealtimeVehicleService())
    service.configure(config.get("gtfs_rt_url"), config.get("interval_sec", 10))
    if config.get("gtfs_rt_url"):
        await service.fetch_once(parsed["trip_to_route"])
    if gtfs_id not in rt_task_gtfs_ids:
        rt_tasks.append(asyncio.create_task(service.polling_loop(lambda gid=gtfs_id: (store.gtfs_data(gid) or {}).get("trip_to_route", {}))))
        rt_task_gtfs_ids.add(gtfs_id)

    return {
        "message": "GTFSを登録しました。",
        "gtfs_id": gtfs_id,
        "routes": len(parsed["routes_geojson"]["features"]),
        "stops": len(parsed["stops_geojson"]["features"]),
        "stop_connections": len(parsed["stop_connections_geojson"]["features"]),
    }


@app.get("/routes")
def routes() -> dict:
    return store.active_map_data()["routes"]


@app.get("/route_catalog")
def route_catalog() -> list[dict]:
    return store.active_map_data()["route_catalog"]


@app.get("/stops")
def stops() -> dict:
    return store.active_map_data()["stops"]


@app.get("/stop_connections")
def stop_connections() -> dict:
    return store.active_map_data()["stop_connections"]


@app.get("/agency")
def agency() -> dict[str, str]:
    names = [
        (store.gtfs_data(gtfs_id) or {}).get("agency_name", "")
        for gtfs_id in store.active_gtfs_ids()
    ]
    return {"agency_name": " / ".join(name for name in names if name)}


@app.get("/vehicles")
def vehicles() -> dict:
    features = []
    statuses = {}
    for gid in store.active_gtfs_ids():
        service = rt_services.get(gid)
        if not service:
            continue
        data = store.gtfs_data(gid) or {}
        color = data.get("gtfs_rt_config", {}).get("vehicle_color", "#e4572e")
        for feature in service.vehicles().get("features", []):
            feature = dict(feature)
            properties = {**feature.get("properties", {}), "dataset_id": gid, "vehicle_color": color}
            if properties.get("vehicle_id"):
                properties["vehicle_id"] = f"{gid}:{properties['vehicle_id']}"
            if properties.get("route_id"):
                properties["route_id"] = _namespace_vehicle_route_id(properties["route_id"], gid)
            feature["properties"] = properties
            features.append(feature)
        statuses[gid] = service.status()
    return {
        "vehicles": {"type": "FeatureCollection", "features": features},
        "status": statuses,
    }


@app.get("/gtfs_list")
def gtfs_list() -> dict:
    return {"gtfs_list": store.list_gtfs()}


@app.delete("/gtfs/delete")
def delete_gtfs(gtfs_id: str) -> dict:
    if store.delete_gtfs(gtfs_id):
        return {
            "message": f"GTFS {gtfs_id} を削除しました",
            "list": store.list_gtfs(),
        }
    raise HTTPException(status_code=404, detail=f"GTFS {gtfs_id} が見つかりません")


@app.post("/gtfs/active")
def active_gtfs(payload: ActiveDatasetsRequest) -> dict:
    try:
        store.set_active_gtfs_ids(payload.gtfs_ids)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"active_gtfs_ids": store.active_gtfs_ids()}


@app.post("/settings/dataset")
async def update_dataset_settings(payload: DatasetSettingsRequest) -> dict:
    data = store.gtfs_data(payload.gtfs_id)
    if data is None:
        raise HTTPException(status_code=404, detail=f"GTFS {payload.gtfs_id} が見つかりません")

    service = rt_services.setdefault(payload.gtfs_id, RealtimeVehicleService())
    service.configure(str(payload.gtfs_rt_url) if payload.gtfs_rt_url else None, payload.interval_sec)
    status = service.status()
    store.update_gtfs_rt_config(payload.gtfs_id, status["url"], status["interval_sec"], payload.vehicle_color)
    if payload.gtfs_rt_url:
        await service.fetch_once(data.get("trip_to_route", {}))
    status["vehicle_color"] = payload.vehicle_color
    return {
        "message": "GTFSとGTFS-RT設定を保存しました。",
        "gtfs_id": payload.gtfs_id,
        "status": {**service.status(), "vehicle_color": payload.vehicle_color},
    }


if __name__ == "__main__":
    import uvicorn

    app_dir = Path(__file__).resolve().parent
    project_dir = app_dir.parent
    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
        app_dir=str(app_dir),
        reload_dirs=[str(project_dir)],
    )
