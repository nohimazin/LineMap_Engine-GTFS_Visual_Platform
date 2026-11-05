# 複数 GTFS 管理機能 - 仕様・設計書

最終更新: 2026-11-01

## 1. 概要

本システムでは、複数の GTFS データセットを同時に登録・永続化・管理し、Web UI から任意のデータセットを複数選択して地図上へ同時に重畳描画できます。
また、GTFS ごとに個別の GTFS-RT エンドポイント、更新間隔、車両マーカー色を設定可能です。

---

## 2. 実装状況と設計概要

初期設計で計画されていた各フェーズの機能は、現行コードベースで実装が完了しています。

| 項目 | 計画時 | 現在の実装状況 |
|---|---|---|
| データ構造 | `_gtfs_data: dict[str, dict]` | 実装済み (`DataStore._gtfs_data`) |
| 選択状態 | `_active_gtfs_ids: list[str]` | 実装済み (`DataStore._active_gtfs_ids`) |
| DB 永続化 | `blobs` テーブルの JSON 管理 | 実装済み (`gtfs_data` と `active_gtfs_ids` を保存) |
| API | `/gtfs_list`, `/gtfs/active` | 実装済み |
| 削除 API | GTFS データセット削除 | 実装済み (`DELETE /gtfs/delete?gtfs_id=...`) |
| UI 複数選択 | チェックボックスによる同時表示 | 実装済み (左パネル「GTFS / GTFS-RT設定」) |
| 個別設定 | GTFSごとのRT/色/削除モーダル | 実装済み (設定ボタンからダイアログ起動) |

---

## 3. データ構造とストレージ仕様

### 3.1 DataStore クラスの管理モデル (`app/storage.py`)

- **スレッドセーフ**: 全データ操作は `threading.Lock` で保護。
- **インメモリキャッシュ**:
  - `self._gtfs_data`: `dict[gtfs_id, dict]`
    - `agency_name`: 事業者名
    - `routes_geojson`: 路線 GeoJSON (FeatureCollection)
    - `stops_geojson`: 停留所 GeoJSON (FeatureCollection)
    - `stop_connections_geojson`: 停留所連結線 GeoJSON (FeatureCollection)
    - `trip_to_route`: `trip_id` から `route_id` への対応マップ
    - `route_catalog`: 路線メタ情報一覧
    - `gtfs_rt_config`: RT URL, 更新間隔, 車両色
  - `self._active_gtfs_ids`: `list[str]` (表示対象 GTFS ID)

### 3.2 永続化 (`data/linemap.db`)

SQLite の `blobs(key TEXT PRIMARY KEY, payload TEXT)` テーブルを利用。
- キー `gtfs_data`: 全データセットの辞書を JSON 文字列としてシリアライズ保存。
- キー `active_gtfs_ids`: アクティブな ID リストを JSON 配列として保存。
- サーバー再起動時に `_load_from_db()` が呼び出され、前回の選択状態が復元されます。

---

## 4. 名前空間の分離と ID 衝突防止

異なる GTFS データセット間で同一の `route_id` や `stop_id` が存在した場合の衝突を防ぐため、`DataStore.active_map_data()` がデータを統合して配信する際に、プレフィックスを自動付与します。

```text
元の stop_id : "stop_001"
データセットID: "sankobus"
    ↓
統合後の stop_id: "sankobus:stop_001"
```

### 影響を受ける属性:
- `properties.stop_id`
- `properties.route_id`
- `properties.routes` (配列の全要素)
- `properties.routes_all` (配列の全要素)
- `properties.dataset_id` (データセット識別子)
- 車両位置 (`/vehicles`): `properties.vehicle_id`, `properties.route_id`

---

## 5. UI とインタラクション仕様

1. **GTFS 一覧と表示切替**:
   - 左側サイドパネル「GTFS / GTFS-RT設定」内に登録済み GTFS 一覧が表示されます。
   - チェックボックスを ON/OFF することで即座に `POST /gtfs/active` が送信され、マップ上の GeoJSON ソースが更新されます。
2. **新規 GTFS の追加**:
   - 「GTFSアップロード」モーダルにて、ファイル選択、`gtfs_id` の入力、任意の GTFS-RT URL、間隔、車両色を指定して登録。
3. **個別設定モーダル**:
   - 各 GTFS の歯車アイコンをクリックすると個別設定モーダルが開きます。
   - 車両マーカー色、GTFS-RT URL、更新間隔の変更と保存 (`POST /settings/dataset`)。
   - 「このGTFSを削除」ボタンによるデータセット削除 (`DELETE /gtfs/delete`)。
4. **停留所重複時のポップアップ統合**:
   - 複数事業者の停留所が同一地点または近接して重なっている場合、MapLibre のクリックイベントで重なる全 Feature を収集。
   - 1 つのポップアップ内に事業者ごとの路線・時刻表をタブやセクションでまとめて表示します。

---

## 6. 今後の改善検討事項

- **SQLite 保存形式の最適化**:
  - 現在は JSON Blob による一括シリアライズ方式を採用しているため、GTFS 数やサイズが増加した際にメモリと I/O 負荷が高くなります。
  - 大規模化に応じて、テーブルを正規化（stops, routes テーブル等）するか、データセットごとにファイルを分割管理するキャッシュ方式への移行を検討します。
- **データセット単位のアップロード検証**:
  - `gtfs_id` の文字種制限（英数字・ハイフン・アンダースコア推奨）やサイズ上限バリデーションの導入。
- **日付変更後の時刻表更新**:
  - アップロード元のGTFS ZIPと時刻表の生成日を保存し、日付変更後の地図データ取得時に当日分を再解析します。
- **車両遅延表示**:
  - GTFS-RTのTripUpdateを車両のtrip_id・現在停留所順序に紐付け、車両ポップアップへ遅延分数を表示します。
