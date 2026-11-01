# 複数GTFS同時読み込み対応 - 設計ドキュメント

## 概要

複数の GTFS データセットを同時にメモリに保持し、UI から選択・切り替えして表示できるようにする機能の設計。

## 現在の状態

- バックエンド：`DataStore` クラスで 1 つの GTFS のみ保持
- API：`/routes`, `/stops`, `/stop_connections` が固定データを返す
- UI：マップに 1 つのデータセットのみ表示
- DB：複数 GTFS のデータを保存

## 設計案

### データ構造の変更

#### バックエンド (DataStore)
```python
_gtfs_data: dict[str, {
    "routes_geojson": {...},
    "stops_geojson": {...},
    "stop_connections_geojson": {...},
    "trip_to_route": {...},
    "route_catalog": [...]
}]

_active_gtfs_ids: list[str]  # 同時表示するGTFS ID
```

#### API の拡張
```
GET /routes
GET /stops
GET /stop_connections
GET /route_catalog

GET /gtfs_list  # 登録済み GTFS 一覧
POST /gtfs/active         # 同時表示する GTFS ID を設定
```

### 実装フェーズ

#### Phase 1：バックエンド基盤（優先度：高）
- [x] `DataStore` を複数 GTFS 対応に拡張
- [x] `/gtfs_list` エンドポイント追加
- [x] `/gtfs/active` エンドポイント追加
- [ ] DB スキーマに `gtfs_id` カラムを追加

#### Phase 2：フロントエンド UI（優先度：中）
- [x] 左パネルに GTFS 複数選択UI追加
- [x] 選択時に `POST /gtfs/active` を呼び出し
- [x] マップを再読み込み
- [x] route_catalog を更新

#### Phase 3：管理機能（優先度：低）
- [ ] GTFS 削除機能
- [ ] GTFS 名前変更機能
- [ ] メタ情報の表示（アップロード時刻、停留所数など）

## 実装の考慮点

### 1. メモリ管理
- 複数 GTFS のメモリ使用量が増加
- 大規模 GTFS × 複数個でメモリ圧迫の可能性
- 将来的には DB キャッシュ層の導入を検討

### 2. API 方針
- アクティブGTFS集合を受け取り、統合データを返すAPIを正規のインターフェースとする
  - `gtfs_id` が指定されない場合 → 最後にアップロードされた GTFS を使用

### 3. アップロード時の挙動
- オプション1：新規アップロードで前のデータを置き換え（現在の動作）
- オプション2：複数データを保持し、新規アップロードは別として扱う
- **推奨**：オプション2 で複数保持、UI で選択可能

## ステップバイステップ実装

### Step 1: 保存形式
```sql
blobs(key TEXT PRIMARY KEY, payload TEXT NOT NULL)
gtfs_data = { gtfs_id: parsed_data }
active_gtfs_ids = [gtfs_id, ...]
```

### Step 2: DataStore の拡張
```python
def __init__(self):
    self._gtfs_data: dict[str, dict] = {}
    self._active_gtfs_ids: list[str] = []

def add_gtfs(self, gtfs_id: str, parsed_data: dict) -> None:
    # 新しい GTFS を追加
    
def set_active_gtfs_ids(self, gtfs_ids: list[str]) -> None:
    # 表示対象の GTFS を変更
    
def list_gtfs(self) -> list[dict]:
    # 登録済み GTFS 一覧を返す
```

### Step 3: API エンドポイント
```python
@app.get("/gtfs_list")
def gtfs_list() -> dict:
    return store.list_gtfs()

@app.post("/gtfs/active")
def active_gtfs(payload: ActiveDatasetsRequest) -> dict:
    store.set_active_gtfs_ids(payload.gtfs_ids)
    return {"active_gtfs_ids": store.active_gtfs_ids()}
```

### Step 4: フロントエンド UI
- GTFS一覧にチェックボックスと個別設定ボタンを追加
- 選択時に `/gtfs/active` を POST
- 成功時にマップを再読み込み

## リスクと対策

| リスク | 対策 |
|--------|------|
| メモリ枯渇 | 大規模 GTFS × 多数個の場合は今後改善、ひとまず複数保持に限定 |
| API 方針 | 複数GTFSを前提としたAPIを使用する |
| DB 容量 | アップロード制限は別途検討 |
| UI の複雑さ増加 | GTFS一覧をチェックボックスと個別設定画面に分離 |

## まとめ

複数GTFSのアクティブ集合を保存し、統合GeoJSONとGTFS-RT車両を同時に返す。

同一地点に複数GTFSの停留所が重なる場合は、地図クリック時に対象フィーチャーを
1つのポップアップへ統合し、GTFSごとの停留所ID・路線・時刻をまとめて表示する。
