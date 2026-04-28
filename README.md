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
- Base Map: OpenFreeMap (Bright default, Liberty / Positron selectable)
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
- `GET /stop_connections`: 停留所連結線GeoJSON
- `GET /vehicles`: 車両位置（GeoJSON + ステータス）
- `POST /settings/gtfs_rt`: GTFS-RT URL/間隔設定
- `GET /health`: ヘルスチェック

## 注意

- GTFS-RTは protobuf の Vehicle Positions フィードを想定しています。
- 必須GTFSファイルは `routes.txt`, `trips.txt`, `stops.txt` です。`shapes.txt` があれば線形状を描画します。

## 使用ガイド

### 1. GTFSデータの入力

1. 「📊 データ入力」セクション > 「GTFSアップロード」から GTFS ZIPファイルを選択
2. 「GTFSを読み込む」ボタンをクリック
3. 読み込み完了後、地図に路線・停留所が表示されます

**確認項目：**
- 路線が地図上に表示されているか
- 停留所が表示されているか
- 左パネルの「🛣️ 路線一覧」に路線が一覧表示されているか

### 2. GTFS-RT（リアルタイム車両位置）の設定

1. 「📊 データ入力」セクション > 「GTFS-RT設定」から以下を入力：
   - **URL**: 車両位置フィードのProtobufエンドポイント
   - **秒**: ポーリング間隔（5～60秒、デフォルト: 10秒）
2. 「RT設定を保存」ボタンをクリック
3. 数秒後に地図上に車両が矢印で表示されます

**確認項目：**
- 車両が地図上に矢印で表示されているか
- 矢印の向き（bearing）が正しいか

### 3. 表示設定

#### 往復路線の統合表示
- 「⚙️ 表示設定」 > 「往復路線の統合」にて、同方向の往復路線を1本の線で表示
- 「統合時カラー」で、小さいroute_idと大きいroute_idのどちらをベースカラーにするか選択

#### 停留所連結線の太さ
- スライダーまたは数値入力で線の太さを調整（1～20）

### 4. レイヤーの表示/非表示

- 「👁️ レイヤー表示」セクションのボタンで各レイヤーの表示切替
  - **停留所 ON/OFF**: 停留所アイコンの表示/非表示
  - **車両 ON/OFF**: 車両矢印の表示/非表示
  - **停留所連結線 ON/OFF**: 停留所間の接続線の表示/非表示

### 5. 画面のエクスポート

1. 地図を見やすい状態に調整
2. 「💾 エクスポート」 > 「現在表示をPNG保存」をクリック
3. 自動的にPNGファイルがダウンロードされます（デバッグ情報は隠蔽）

## トラブルシューティング

### GTFSの読み込みに失敗した
- **原因**: 必須ファイル (`routes.txt`, `trips.txt`, `stops.txt`) が不足している
- **対処**: GTFS ZIPファイルの内容を確認し、必須ファイルが含まれているか確認してください

### 路線が表示されない
- **原因**: `shapes.txt` が不足しているか、読み込みデータの不正
- **対処**: `shapes.txt` を追加するか、データの品質を確認してください
- ただし、`shape_id` がない場合は停留所連結線で表示されます

### 車両が表示されない
- **原因**: GTFS-RT URLが不正、またはポーリング中にエラーが発生している
- **対処**: 
  - URLが正しいか確認（Protobuf形式のエンドポイント）
  - ブラウザコンソール（F12）でエラーメッセージを確認

### 地図が遅い、ハングしている
- **原因**: 大規模GTFSデータの処理
- **対処**:
  - 小規模テストデータから始める
  - 停留所連結線を一度非表示にして動作確認
  - ブラウザのコンソールでパフォーマンス計測: `PerformanceMonitor.measureStopConnectionToggle()`

## パフォーマンス計測

ブラウザのコンソール（F12）で以下コマンドを実行してパフォーマンスを計測：

```javascript
// 停留所連結線の表示/非表示切替時間を計測
PerformanceMonitor.measureStopConnectionToggle()

// 停留所表示の切替時間を計測
PerformanceMonitor.measureStopsToggle()

// ヘルプを表示
PerformanceMonitor.help()
```

## 運用時チェックリスト

- GTFS ZIP投入前に `routes.txt`, `trips.txt`, `stops.txt` が含まれていることを確認する
- アップロード後に `/routes`, `/stops`, `/stop_connections` の件数が極端に0件でないことを確認する
- 往復統合ON/OFF時に表示件数と色が大きく崩れていないことをデバッグ表示で確認する
- `shape_id` を共有する便を含むデータで停留所連結線が欠落しないことを確認する
- GTFS-RT設定時は `/vehicles` の `status.last_error` が空であることを確認する
- 大規模データ投入時は初回表示とレイヤー切替の体感速度を確認し、問題があればデータを分割して検証する
