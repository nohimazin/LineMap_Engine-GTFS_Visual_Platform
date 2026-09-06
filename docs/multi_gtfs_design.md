# 複数GTFS同時読み込み対応 - 設計ドキュメント

## 概要

複数の GTFS データセットを同時にメモリに保持し、UI から選択・切り替えして表示できるようにする機能の設計。

## 現在の状態

- バックエンド：`DataStore` クラスで 1 つの GTFS のみ保持
- API：`/routes`, `/stops`, `/stop_connections` が固定データを返す
- UI：マップに 1 つのデータセットのみ表示
- DB：単一 GTFS の データを保存

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

_current_gtfs_id: str  # 現在表示中のGTFS ID
```

#### API の拡張
```
GET /routes?gtfs_id=xxx
GET /stops?gtfs_id=xxx
GET /stop_connections?gtfs_id=xxx
GET /route_catalog?gtfs_id=xxx

GET /gtfs_list  # 登録済み GTFS 一覧
POST /gtfs/select?id=xxx  # 表示する GTFS を切り替え
```

### 実装フェーズ

#### Phase 1：バックエンド基盤（優先度：高）
- [x] `DataStore` を複数 GTFS 対応に拡張
- [x] `/gtfs_list` エンドポイント追加
- [x] `/gtfs/select` エンドポイント追加
- [ ] DB スキーマに `gtfs_id` カラムを追加

#### Phase 2：フロントエンド UI（優先度：中）
- [x] 左パネルに GTFS 選択ドロップダウン追加
- [x] 選択時に `POST /gtfs/select` を呼び出し
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

### 2. API の互換性
- 既存 API を破壊しないようにデフォルト値を用意
  - `gtfs_id` が指定されない場合 → 最後にアップロードされた GTFS を使用

### 3. アップロード時の挙動
- オプション1：新規アップロードで前のデータを置き換え（現在の動作）
- オプション2：複数データを保持し、新規アップロードは別として扱う
- **推奨**：オプション2 で複数保持、UI で選択可能

## ステップバイステップ実装

### Step 1: DB スキーマの拡張
```sql
ALTER TABLE blobs ADD COLUMN gtfs_id TEXT DEFAULT 'default';
ALTER TABLE blobs DROP CONSTRAINT PRIMARY KEY;
ALTER TABLE blobs ADD PRIMARY KEY (gtfs_id, key);
```

### Step 2: DataStore の拡張
```python
def __init__(self):
    self._gtfs_data: dict[str, dict] = {}
    self._current_gtfs_id: str = 'default'

def add_gtfs(self, gtfs_id: str, parsed_data: dict) -> None:
    # 新しい GTFS を追加
    
def select_gtfs(self, gtfs_id: str) -> bool:
    # 表示対象の GTFS を変更
    
def list_gtfs(self) -> list[dict]:
    # 登録済み GTFS 一覧を返す
```

### Step 3: API エンドポイント
```python
@app.get("/gtfs_list")
def gtfs_list() -> dict:
    return store.list_gtfs()

@app.post("/gtfs/select")
def gtfs_select(gtfs_id: str) -> dict:
    if store.select_gtfs(gtfs_id):
        return {"message": f"GTFS {gtfs_id} を選択しました"}
    else:
        raise HTTPException(status_code=404, detail=f"GTFS {gtfs_id} が見つかりません")
```

### Step 4: フロントエンド UI
- 左パネルの上部に GTFS 選択ドロップダウンを追加
- 選択時に `/gtfs/select` を POST
- 成功時にマップを再読み込み

## リスクと対策

| リスク | 対策 |
|--------|------|
| メモリ枯渇 | 大規模 GTFS × 多数個の場合は今後改善、ひとまず複数保持に限定 |
| API の互換性 | デフォルト値を用意、既存 API はそのまま動作 |
| DB 容量 | アップロード制限は別途検討 |
| UI の複雑さ増加 | ドロップダウン 1 つに限定 |

## まとめ

最小実装では Phase 1 のみを先行し、UI は Phase 2 で段階的に実装。API の互換性を保ちながら、複数 GTFS 同時保持を実現。
