# LineMap Engine GTFS Visual Platform

GTFS / GTFS-RT を地図上に可視化する FastAPI + MapLibre ベースのWebアプリです。

## 機能

- GTFS ZIPアップロード
- 路線（GeoJSON）表示、色分け、ON/OFF
- 停留所（GeoJSON）表示
- GTFS-RT 車両位置の定期更新表示
- 路線検索
- 現在の地図表示をPNG保存
- 表示状態と地図位置のローカル保存

## 技術構成

- Backend: FastAPI
- Frontend: MapLibre GL JS
- Data Store: メモリ + SQLite（`data/linemap.db`）
- Data Format: GeoJSON

## セットアップ

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

## 起動

```bash
uvicorn app.main:app --reload
```

起動後、ブラウザで次を開きます。

- http://127.0.0.1:8000

## API

- `POST /upload` または `POST /upload_gtfs`: GTFS ZIPアップロード
- `GET /routes`: 路線GeoJSON
- `GET /route_catalog`: 路線一覧
- `GET /stops`: 停留所GeoJSON
- `GET /vehicles`: 車両位置（GeoJSON + ステータス）
- `POST /settings/gtfs_rt`: GTFS-RT URL/間隔設定

## 注意

- GTFS-RTは protobuf の Vehicle Positions フィードを想定しています。
- 必須GTFSファイルは `routes.txt`, `trips.txt`, `stops.txt` です。`shapes.txt` があれば線形状を描画します。
