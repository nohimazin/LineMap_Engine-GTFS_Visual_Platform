# プロジェクト現況・技術課題・ロードマップ

最終更新: 2026-11-01

本書は、LineMap Engine GTFS Visual Platform の最新の実装状況、アーキテクチャ上の技術課題、および今後の開発ロードマップをまとめたドキュメントです。

---

## 1. エグゼクティブサマリ

- **基本機能**: GTFS ZIP 解析、GeoJSON 生成、MapLibre GL JS による地図可視化、GTFS-RT Vehicle Positions の定期取得・車両位置表示は安定稼働。
- **複数 GTFS 管理**: `gtfs_id` によるデータセット単位の登録・選択・個別設定・削除機能、SQLite (`data/linemap.db`) への状態復元、名前空間プレフィックスによる ID 衝突防止を実装済み。
- **表示・操作性**: 路線一覧検索、停留所名/IDリアルタイム検索、往復路線統合（中心線近似計算・カラー選択）、長距離便（高速バス等）フィルタ、今日の運行便時刻表示、PNG エクスポート、ベースマップスタイル切替（Liberty / Bright / Positron）を実装済み。
- **テスト基盤**: `pytest` による GTFS-RT gzip 展開パーステストおよび名前空間プレフィックス単体テストが整備済み。

---

## 2. 実装状況詳細

### 2.1 バックエンド (`app/`)

- **GTFS 静的解析 (`app/gtfs.py`)**:
  - ZIP 内の階層フォルダー探索、UTF-8 / UTF-8 BOM / CP932 / Shift_JIS エンコーディング自動判別。
  - `agency.txt`、`routes.txt`、`trips.txt`、`stops.txt`、`shapes.txt`、`stop_times.txt`、`calendar.txt`、`calendar_dates.txt` の解析。
  - `shapes.txt` がない場合の停留所直線連結フォールバック。
  - 路線色の自動補完、`parent_station` による停留所名解決。
  - 本日の日付・曜日に運行される便の時刻判定（`calendar.txt` / `calendar_dates.txt` 基準）。
- **複数 GTFS & 永続化 (`app/storage.py`)**:
  - `DataStore` によるインメモリ保持 + SQLite `blobs` テーブル永続化。
  - `active_map_data()` によるアクティブ GTFS の GeoJSON 統合と `{gtfs_id}:` プレフィックス付与。
  - GTFS-RT 設定（URL, 間隔, 車両マーカー色）のデータセット別保持。
  - GTFS 削除 (`delete_gtfs`) によるデータとアクティブ状態の整合性維持。
- **リアルタイム車両位置 (`app/rt.py`)**:
  - `httpx.AsyncClient` による非同期 HTTP 取得（タイムアウト 8 秒）。
  - gzip 展開対応、Protocol Buffers 解析。
  - 緯度経度の妥当性・有限値検証。
  - 静的 GTFS の `trip_to_route` マップを用いた `route_id` 補完。
  - 通信状態、最終成功日時、連続エラー回数、直近 5 件のエラー履歴保持。

### 2.2 フロントエンド (`static/`)

- **地図基盤**: MapLibre GL JS 4.7.1 + OpenFreeMap スタイル。
- **路線・停留所・連結線レイヤー**:
  - 路線ごとの個別表示 ON/OFF、往復路線統合とカラー選択。
  - 停留所連結線の全便 / 今日運行便絞り込み、線幅変更（1〜20）。
  - 今日運行便のない停留所アイコンの非表示トグル。
  - 長距離便（高速バス等）の最大停留所間隔しきい値設定と、連結線・通過停留所・車両の非表示フィルタ。
- **検索 & インタラクション**:
  - 路線一覧インクリメンタル検索。
  - 停留所名・IDインクリメンタル検索（最大 30 件、ズーム & ポップアップ自動表示）。
  - 同一地点の複数事業者停留所統合ポップアップ。
  - 車両ポップアップ（速度、方位、系統、遅延）。
- **UI 管理 & その他**:
  - GTFS-RT / データセット個別設定モーダル。
  - 地図キャンバス PNG エクスポート。
  - 表示設定・カメラ位置の localStorage 永続化。
  - レイヤー切替レンダリング性能計測 (`performance-monitor.js`)。

---

## 3. テストと検証環境

| テストファイル | 実行方式 | 内容 | 状態 |
|---|---|---|---|
| `tests/test_rt.py` | `pytest` | gzip 展開・protobuf パース・車両 GeoJSON 変換テスト | 正常パス |
| `tests/test_vehicle_route_ids.py` | `pytest` | 車両 route_id の名前空間プレフィックス整合性テスト | 正常パス |
| `tests/test_route_merge.py` | `pytest` | 往復路線統合判定ロジック検証（※入力JSONデータ要整備） | 検証用コード |
| `tests/test_stop_search.html` | ブラウザ | 停留所検索の入力・フィルタリング・DOM描画の独立検証 | 動作確認用 |
| `scripts/gtfs_perf.py` | Python スクリプト | GTFS ZIP 解析速度と生成件数のプロファイリング | 稼働中 |
| `scripts/rt_validate.py` | Python スクリプト | 外部 GTFS-RT URL と静的データの突合検証 | 稼働中 |

---

## 4. 技術的課題と検討事項

### 4.1 ストレージとメモリ管理
- **課題**: 現在の SQLite 保存方式は `blobs` テーブルに JSON 文字列全体を保存する Key-Value 方式です。
- **影響**: GTFS データセット数やデータ容量（stop_times が数十万件規模）が増加すると、JSON シリアライズ／デシリアライズ時のメモリおよび I/O 負荷が高くなります。
- **対策案**:
  - 大規模データセット向けにテーブルを正規化（`stops`, `routes`, `shapes` など）するか、データセット単位のファイルキャッシュ分離を検討。

### 4.2 路線統合アルゴリズムの精度
- **課題**: 往復路線の統合は `route_short_name` および `route_long_name` のターミナル文字列解析、ならびに幾何学的中心線の近似補間に依存しています。
- **影響**: 環状線、ラケット型路線、往路と復路で経由地が大幅に異なる路線では中心線が道路から外れる場合があります。
- **対策案**:
  - 将来的なマップマッチングアルゴリズムの導入、またはユーザーによる往復ペアの手動指定・修正機能の検討。

### 4.3 GTFS-RT の対応範囲
- **課題**: 現在は Vehicle Positions（車両位置）のみに対応。
- **対策案**: Trip Updates（遅延・時刻変更）や Service Alerts（運休・迂回情報）への拡張検討。

---

## 5. ロードマップ

```mermaid
flowchart LR
    Phase1["完了: コア機能\n・GTFS解析/GeoJSON\n・GTFS-RTポーリング\n・MapLibre可視化"] --> Phase2["完了: 複数GTFS & UI強化\n・複数データセット管理\n・停留所検索\n・長距離便フィルタ\n・往復統合"]
    Phase2 --> Phase3["進行中: 品質・運用強化\n・ドキュメント体系化\n・テストカバレッジ拡充\n・大規模データ性能測定"]
    Phase3 --> Phase4["将来構想\n・Trip Updates対応\n・テーブル正規化DB\n・路線編集/手動ペアリング"]
```

### 直近の優先タスク
1. **テストカバレッジの拡充**: FastAPI エンドポイント（`/upload`, `/gtfs_list`, `/gtfs/active`, `/gtfs/delete`）の統合テスト追加。
2. **大規模 GTFS 性能検証**: 大規模 GTFS データ（全国規模や主要都市圏）での解析時間とブラウザ描画フレームレートの測定。
3. **バリデーション強化**: アップロード時のファイルサイズ制限、GTFS ID の命名規約チェック。

