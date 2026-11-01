# REST API 仕様書

最終更新: 2026-11-01

本書は、LineMap Engine GTFS Visual Platform が提供する HTTP REST API のエンドポイント一覧およびリクエスト／レスポンス仕様書です。

ベース URL: `http://127.0.0.1:8000`

---

## 1. エンドポイント一覧

| メソッド | パス | 説明 | 認証 |
|---|---|---|---|
| `GET` | `/` | Web クライアント画面 (`index.html`) を返却 | 不要 |
| `GET` | `/health` | サーバーの死活監視 | 不要 |
| `POST` | `/upload` | GTFS ZIP ファイルをアップロードして登録 | 不要 |
| `GET` | `/gtfs_list` | 登録済み GTFS データセットの一覧を取得 | 不要 |
| `POST` | `/gtfs/active` | 同時表示するアクティブな GTFS ID リストを更新 | 不要 |
| `DELETE` | `/gtfs/delete` | 指定した GTFS データセットを削除 | 不要 |
| `POST` | `/settings/dataset` | 指定 GTFS の GTFS-RT URL、取得間隔、車両色を更新 | 不要 |
| `GET` | `/routes` | アクティブな GTFS の統合路線 GeoJSON を取得 | 不要 |
| `GET` | `/route_catalog` | アクティブな GTFS の統合路線カタログ一覧を取得 | 不要 |
| `GET` | `/stops` | アクティブな GTFS の統合停留所 GeoJSON を取得 | 不要 |
| `GET` | `/stop_connections` | アクティブな GTFS の統合停留所連結線 GeoJSON を取得 | 不要 |
| `GET` | `/agency` | アクティブな GTFS の事業者名一覧を取得 | 不要 |
| `GET` | `/vehicles` | アクティブな GTFS の GTFS-RT 車両位置 GeoJSON と状態を取得 | 不要 |

---

## 2. エンドポイント詳細仕様

### 2.1 ヘルスチェック

#### `GET /health`

サーバーが稼働中か確認します。

- **リクエスト**: パラメータなし
- **レスポンス例 (200 OK)**:
  ```json
  {
    "status": "ok"
  }
  ```

---

### 2.2 GTFS アップロード・登録

#### `POST /upload`

GTFS ZIP ファイルをアップロードして解析・保存します。

- **Content-Type**: `multipart/form-data`
- **クエリパラメータ**:
  | パラメータ | 型 | 必須 | 既定値 | 説明 |
  |---|---|---|---|---|
  | `gtfs_id` | `string` | 任意 | `"default"` | 登録・上書き対象の GTFS データセット ID |
  | `gtfs_rt_url` | `string (HttpUrl)` | 任意 | `null` | GTFS-RT Vehicle Positions のエンドポイント URL |
  | `interval_sec` | `integer` | 任意 | `10` | GTFS-RT 取得間隔秒数（5〜60秒） |
  | `vehicle_color` | `string` | 任意 | `"#e4572e"` | 車両マーカーのカラーコード |
- **フォームデータ (Body)**:
  | フィールド | 型 | 必須 | 説明 |
  |---|---|---|---|
  | `file` | `UploadFile` | 必須 | `.zip` 形式の GTFS ファイル |
- **レスポンス例 (200 OK)**:
  ```json
  {
    "message": "GTFSを登録しました。",
    "gtfs_id": "sankobus",
    "routes": 24,
    "stops": 1380,
    "stop_connections": 1850
  }
  ```
- **エラーレスポンス (400 Bad Request)**:
  - ファイル拡張子が `.zip` でない場合
  - ZIP 内に必須ファイル (`routes.txt`, `trips.txt`, `stops.txt`) が存在しない場合

---

### 2.3 GTFS データセット管理

#### `GET /gtfs_list`

現在登録されている全 GTFS データセットのメタ情報一覧を返します。

- **リクエスト**: パラメータなし
- **レスポンス例 (200 OK)**:
  ```json
  {
    "gtfs_list": [
      {
        "gtfs_id": "city_bus",
        "route_count": 12,
        "stop_count": 350,
        "is_active": true,
        "gtfs_rt_url": "https://api.example.com/gtfs-rt/city_bus/vehiclePositions.pb",
        "interval_sec": 10,
        "vehicle_color": "#007acc"
      },
      {
        "gtfs_id": "sankobus",
        "route_count": 48,
        "stop_count": 1420,
        "is_active": false,
        "gtfs_rt_url": null,
        "interval_sec": 10,
        "vehicle_color": "#e4572e"
      }
    ]
  }
  ```

#### `POST /gtfs/active`

地図上に同時表示する GTFS データセットのリストを設定します。

- **Content-Type**: `application/json`
- **リクエストボディ**:
  ```json
  {
    "gtfs_ids": ["city_bus", "sankobus"]
  }
  ```
- **レスポンス例 (200 OK)**:
  ```json
  {
    "active_gtfs_ids": ["city_bus", "sankobus"]
  }
  ```
- **エラーレスポンス (400 Bad Request)**:
  - 存在しない `gtfs_id` が含まれている場合、または空配列の場合

#### `DELETE /gtfs/delete`

登録済みの GTFS データセットを削除します。

- **クエリパラメータ**:
  | パラメータ | 型 | 必須 | 説明 |
  |---|---|---|---|
  | `gtfs_id` | `string` | 必須 | 削除対象の GTFS ID |
- **レスポンス例 (200 OK)**:
  ```json
  {
    "message": "GTFS sankobus を削除しました",
    "list": [
      {
        "gtfs_id": "city_bus",
        "route_count": 12,
        "stop_count": 350,
        "is_active": true,
        "gtfs_rt_url": "...",
        "interval_sec": 10,
        "vehicle_color": "#007acc"
      }
    ]
  }
  ```
- **エラーレスポンス (404 Not Found)**: 指定した GTFS ID が存在しない場合

#### `POST /settings/dataset`

データセット単位の GTFS-RT URL、ポーリング間隔、車両色を更新します。

- **Content-Type**: `application/json`
- **リクエストボディ**:
  ```json
  {
    "gtfs_id": "city_bus",
    "gtfs_rt_url": "https://api.example.com/gtfs-rt/vehiclePositions.pb",
    "interval_sec": 15,
    "vehicle_color": "#33aa33"
  }
  ```
- **レスポンス例 (200 OK)**:
  ```json
  {
    "message": "GTFSとGTFS-RT設定を保存しました。",
    "gtfs_id": "city_bus",
    "status": {
      "url": "https://api.example.com/gtfs-rt/vehiclePositions.pb",
      "interval_sec": 15,
      "last_success": "2026-11-01T21:00:00Z",
      "last_error": null,
      "last_status_code": 200,
      "consecutive_failures": 0,
      "error_history": [],
      "vehicle_count": 14,
      "vehicle_color": "#33aa33"
    }
  }
  ```

---

### 2.4 静的地図データ取得 (アクティブ GTFS 統合)

> [!NOTE]
> 複数 GTFS がアクティブな場合、各 GeoJSON のプロパティ（`route_id`, `stop_id` など）には自動的に `{gtfs_id}:` プレフィックスが付与されます。

#### `GET /routes`

アクティブな全 GTFS の路線形状（LineString / MultiLineString）を含む GeoJSON FeatureCollection を返します。

- **レスポンス例 (200 OK)**:
  ```json
  {
    "type": "FeatureCollection",
    "features": [
      {
        "type": "Feature",
        "properties": {
          "route_id": "city_bus:R01",
          "route_short_name": "1号線",
          "route_long_name": "中央駅発市役所行き",
          "route_color": "#0055AA",
          "dataset_id": "city_bus"
        },
        "geometry": {
          "type": "MultiLineString",
          "coordinates": [[[139.7, 35.6], [139.71, 35.62]]]
        }
      }
    ]
  }
  ```

#### `GET /route_catalog`

路線一覧サイドバー描画用のカタログリストを返します。

- **レスポンス例 (200 OK)**:
  ```json
  [
    {
      "route_id": "city_bus:R01",
      "route_short_name": "1号線",
      "route_long_name": "中央駅発市役所行き",
      "route_color": "#0055AA",
      "dataset_id": "city_bus"
    }
  ]
  ```

#### `GET /stops`

アクティブな全 GTFS の停留所（Point）を含む GeoJSON FeatureCollection を返します。

- **レスポンス例 (200 OK)**:
  ```json
  {
    "type": "FeatureCollection",
    "features": [
      {
        "type": "Feature",
        "properties": {
          "stop_id": "city_bus:S01",
          "stop_name": "市役所前",
          "routes": ["city_bus:R01"],
          "routes_all": ["city_bus:R01", "city_bus:R02"],
          "today_date": "20261101",
          "today_weekday": "日",
          "times_today": ["08:30:00", "09:00:00"],
          "dataset_id": "city_bus"
        },
        "geometry": {
          "type": "Point",
          "coordinates": [139.71, 35.62]
        }
      }
    ]
  }
  ```

#### `GET /stop_connections`

停留所間を接続する線分（LineString）を含む GeoJSON FeatureCollection を返します。

- **レスポンス例 (200 OK)**:
  ```json
  {
    "type": "FeatureCollection",
    "features": [
      {
        "type": "Feature",
        "properties": {
          "route_id": "city_bus:R01",
          "route_color": "#0055AA",
          "from_stop": "city_bus:S01",
          "to_stop": "city_bus:S02",
          "from_name": "中央駅",
          "to_name": "市役所前",
          "dataset_id": "city_bus"
        },
        "geometry": {
          "type": "LineString",
          "coordinates": [[139.7, 35.6], [139.71, 35.62]]
        }
      }
    ]
  }
  ```

#### `GET /agency`

アクティブな GTFS の事業者名をスラッシュ区切りで返します。

- **レスポンス例 (200 OK)**:
  ```json
  {
    "agency_name": "中央バス / 産交バス"
  }
  ```

---

### 2.5 リアルタイム車両位置取得

#### `GET /vehicles`

アクティブな GTFS の車両位置 GeoJSON および各データセットの通信状態を返します。

- **レスポンス例 (200 OK)**:
  ```json
  {
    "vehicles": {
      "type": "FeatureCollection",
      "features": [
        {
          "type": "Feature",
          "geometry": {
            "type": "Point",
            "coordinates": [139.705, 35.61]
          },
          "properties": {
            "vehicle_id": "city_bus:V101",
            "vehicle_label": "101号車",
            "trip_id": "T0101",
            "route_id": "city_bus:R01",
            "bearing": 45.0,
            "speed": 6.5,
            "timestamp": 1793529600,
            "dataset_id": "city_bus",
            "vehicle_color": "#007acc"
          }
        }
      ]
    },
    "status": {
      "city_bus": {
        "url": "https://api.example.com/gtfs-rt/vehiclePositions.pb",
        "interval_sec": 10,
        "last_success": "2026-11-01T21:00:00Z",
        "last_error": null,
        "last_status_code": 200,
        "consecutive_failures": 0,
        "error_history": [],
        "vehicle_count": 1
      }
    }
  }
  ```

