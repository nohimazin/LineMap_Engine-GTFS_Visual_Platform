import asyncio
from contextlib import asynccontextmanager, suppress
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, HttpUrl

try:
    from app.gtfs import parse_gtfs_zip
    from app.rt import RealtimeVehicleService
    from app.storage import DataStore
except ModuleNotFoundError:
    # Supports direct execution like: python app/main.py
    from gtfs import parse_gtfs_zip
    from rt import RealtimeVehicleService
    from storage import DataStore


class RtConfigRequest(BaseModel):
    gtfs_rt_url: HttpUrl | None = None
    interval_sec: int = 10


store = DataStore()
rt_service = RealtimeVehicleService()

static_dir = Path(__file__).resolve().parent.parent / "static"


@asynccontextmanager
async def lifespan(_: FastAPI):
    polling_task = asyncio.create_task(rt_service.polling_loop(store.trip_to_route))
    try:
        yield
    finally:
        polling_task.cancel()
        with suppress(asyncio.CancelledError):
            await polling_task


app = FastAPI(title="LineMap Engine GTFS Visual Platform", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")


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
        stop_connections_geojson=parsed["stop_connections_geojson"],
        trip_to_route=parsed["trip_to_route"],
        route_catalog=parsed["route_catalog"],
    )

    return {
        "message": "GTFSを登録しました。",
        "routes": len(parsed["routes_geojson"]["features"]),
        "stops": len(parsed["stops_geojson"]["features"]),
        "stop_connections": len(parsed["stop_connections_geojson"]["features"]),
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


@app.get("/stop_connections")
def stop_connections() -> dict:
    return store.stop_connections_geojson()


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
