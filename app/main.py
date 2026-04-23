import asyncio
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, HttpUrl

from app.gtfs import parse_gtfs_zip
from app.rt import RealtimeVehicleService
from app.storage import DataStore


class RtConfigRequest(BaseModel):
    gtfs_rt_url: HttpUrl | None = None
    interval_sec: int = 10


app = FastAPI(title="LineMap Engine GTFS Visual Platform", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

store = DataStore()
rt_service = RealtimeVehicleService()

static_dir = Path(__file__).resolve().parent.parent / "static"
app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")


@app.on_event("startup")
async def on_startup() -> None:
    asyncio.create_task(rt_service.polling_loop(store.trip_to_route))


@app.get("/")
def index() -> FileResponse:
    return FileResponse(static_dir / "index.html")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/upload")
@app.post("/upload_gtfs")
async def upload_gtfs(file: UploadFile = File(...)) -> dict[str, int | str]:
    if not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="GTFS ZIPファイルを指定してください。")

    raw_zip = await file.read()
    try:
        parsed = parse_gtfs_zip(raw_zip)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    store.update_gtfs(
        routes_geojson=parsed["routes_geojson"],
        stops_geojson=parsed["stops_geojson"],
        trip_to_route=parsed["trip_to_route"],
        route_catalog=parsed["route_catalog"],
    )

    return {
        "message": "GTFSを登録しました。",
        "routes": len(parsed["routes_geojson"]["features"]),
        "stops": len(parsed["stops_geojson"]["features"]),
    }


@app.get("/routes")
def routes() -> dict:
    return store.routes_geojson()


@app.get("/route_catalog")
def route_catalog() -> list[dict]:
    return store.route_catalog()


@app.get("/stops")
def stops() -> dict:
    return store.stops_geojson()


@app.get("/vehicles")
def vehicles() -> dict:
    return {
        "vehicles": rt_service.vehicles(),
        "status": rt_service.status(),
    }


@app.post("/settings/gtfs_rt")
def update_gtfs_rt_settings(payload: RtConfigRequest) -> dict:
    rt_service.configure(str(payload.gtfs_rt_url) if payload.gtfs_rt_url else None, payload.interval_sec)
    return {"message": "GTFS-RT設定を更新しました。", "status": rt_service.status()}
