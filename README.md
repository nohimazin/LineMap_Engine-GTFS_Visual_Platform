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
- Base Map: OpenFreeMap (Liberty style)
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

## 運用時チェックリスト

- GTFS ZIP投入前に `routes.txt`, `trips.txt`, `stops.txt` が含まれていることを確認する
- アップロード後に `/routes`, `/stops`, `/stop_connections` の件数が極端に0件でないことを確認する
- 往復統合ON/OFF時に表示件数と色が大きく崩れていないことをデバッグ表示で確認する
- `shape_id` を共有する便を含むデータで停留所連結線が欠落しないことを確認する
- GTFS-RT設定時は `/vehicles` の `status.last_error` が空であることを確認する
- 大規模データ投入時は初回表示とレイヤー切替の体感速度を確認し、問題があればデータを分割して検証する
