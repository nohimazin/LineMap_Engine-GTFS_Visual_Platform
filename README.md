# LineMap Engine GTFS Visual Platform

GTFS と GTFS-RT を読み込み、路線・停留所・停留所連結線・リアルタイム車両を地図上に表示する Web アプリケーションです。

バックエンドは FastAPI、フロントエンドの地図描画は MapLibre GL JS、ベースマップは OpenFreeMap を使用します。

## 主な機能

- GTFS ZIP のアップロードと解析
- ZIP 内のサブフォルダーに配置された GTFS ファイルの読み込み
- UTF-8 / CP932 / Shift_JIS の GTFS テキストに対応
- 路線、停留所、停留所連結線の GeoJSON 生成
- `shapes.txt` を利用した路線形状の描画
- 路線形状が取得できない場合の停留所連結線ベースのフォールバック描画
- `route_color` による路線色設定と、未設定時の自動色生成
- 路線一覧の検索と路線ごとの表示切替
- 停留所名検索と検索結果からの地図移動
- 往復路線の統合表示と統合時カラーの選択
- 停留所、車両、停留所連結線の表示切替
- 停留所連結線の線幅変更（1～20）
- GTFS-RT Vehicle Positions の定期取得と車両表示
- 車両の方位、速度、路線などのポップアップ表示
- OpenFreeMap の Liberty / Bright / Positron 切替
- 現在の地図表示の PNG 保存
- 表示設定と地図位置のブラウザ内保存（localStorage）
- GTFS 読み込み中の進捗表示
- 複数GTFSの登録・切替（SQLiteへ保存）

## 技術構成

- Backend: Python / FastAPI
- Frontend: HTML / CSS / JavaScript
- Map: MapLibre GL JS 4.7.1
- Base map: OpenFreeMap
- Static data format: GeoJSON
- Realtime data: GTFS-RT Vehicle Positions（Protocol Buffers）
- Storage: SQLite による現在データの保存と、メモリ上の複数GTFS管理

## 動作環境

- Python 3.11 以降を推奨
- インターネット接続（OpenFreeMapの地図タイルを利用する場合）
- GTFS ZIP ファイル
- GTFS-RT を利用する場合は、Vehicle Positions のURL

## セットアップ

PowerShell の例です。

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

仮想環境の有効化が制限されている場合は、以下のように仮想環境のPythonを直接使用できます。

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

## 起動

プロジェクトルートで実行します。

```powershell
uvicorn app.main:app --reload
```

起動後、ブラウザで http://127.0.0.1:8000 を開きます。

別のポートを使う場合は、例えば次のように指定します。

```powershell
uvicorn app.main:app --reload --port 8001
```

`python app/main.py` でも起動できます。

## 使い方

### GTFSを読み込む

1. 「GTFSアップロード」で `.zip` ファイルを選択します。
2. 「GTFSを読み込む」を押します。
3. 読み込み完了後、路線・停留所・停留所連結線が地図に表示されます。

最低限、次のファイルが必要です。

- `routes.txt`
- `trips.txt`
- `stops.txt`

次のファイルは、存在する場合に利用されます。

- `shapes.txt`: 路線の詳細形状
- `stop_times.txt`: 停留所の順序と簡易時刻情報

`shapes.txt` がない、または路線形状を生成できない場合は、`stop_times.txt` と停留所位置から停留所連結線を生成して路線表示に利用します。

### 複数GTFSを切り替える

アップロード画面で `GTFS ID` を指定すると、複数のGTFSを登録できます。画面のGTFS選択欄から登録済みデータを切り替えます。

```powershell
curl.exe -F "file=@sample.zip" "http://127.0.0.1:8000/upload?gtfs_id=sample"
```

登録済みGTFSのGeoJSONと選択状態は `data/linemap.db` に保存され、アプリ再起動後も一覧と切替状態を復元します。

### GTFS-RTを設定する

1. 「GTFS-RT設定」のURLに Vehicle Positions の protobuf エンドポイントを入力します。
2. 更新間隔を5～60秒で指定します。
3. 「RT設定を保存」を押します。
4. RT再接続が必要な場合は「RT再接続」を押します。

画面には最終更新時刻、最終成功時刻、更新間隔、接続状態、連続エラー回数などが表示されます。

### 表示を調整する

- 路線一覧: 路線の検索と個別表示切替
- 停留所検索: 停留所名で検索し、結果を選択して地図上へ移動
- 往復路線の統合: 対応する往復路線を統合表示
- 統合時カラー: route_id が小さい側または大きい側を採用
- 停留所連結線: 表示切替と線幅変更
- レイヤー表示: 停留所、車両、停留所連結線を個別に切替
- 地図スタイル: Liberty、Bright、Positronを切替

表示設定と地図位置はブラウザのlocalStorageに保存されます。

## API

### ヘルスチェック

```http
GET /health
```

### GTFS

```http
POST /upload?gtfs_id=default
POST /upload_gtfs?gtfs_id=default
GET  /gtfs_list
POST /gtfs/select?gtfs_id=default
GET  /routes
GET  /route_catalog
GET  /stops
GET  /stop_connections
```

アップロードAPIのレスポンスには、`gtfs_id`、路線数、停留所数、停留所連結線数が含まれます。

### GTFS-RT

```http
GET  /vehicles
POST /settings/gtfs_rt
```

設定リクエストの例:

```json
{
  "gtfs_rt_url": "https://example.com/vehiclePositions.pb",
  "interval_sec": 10
}
```

`GET /vehicles` は車両GeoJSON相当のデータと、取得状態をまとめて返します。

## テストと検証

依存関係をインストールした仮想環境で実行します。

```powershell
.\.venv\Scripts\python.exe -m pytest
```

往復路線統合の判定テストだけを実行する場合:

```powershell
.\.venv\Scripts\python.exe tests\test_route_merge.py
```

ブラウザ上の表示切替性能を確認する場合は、開発者ツールのコンソールで次を実行できます。

```javascript
PerformanceMonitor.measureStopConnectionToggle()
PerformanceMonitor.measureStopsToggle()
PerformanceMonitor.help()
```

## トラブルシューティング

### 起動できない

- 仮想環境が有効か確認します。
- `pip install -r requirements.txt` を再実行します。
- ポート8000が使用中の場合は別ポートを指定します。

### GTFSを読み込めない

- ZIP内に `routes.txt`、`trips.txt`、`stops.txt` があるか確認します。
- ZIP直下でなくサブフォルダーに配置されていても読み込めますが、ファイル名は正確である必要があります。
- `stop_id`、緯度、経度が欠損した停留所は表示対象から除外されます。

### 路線が表示されない

- アップロード結果の `routes` が0になっていないか確認します。
- `shapes.txt` と `stop_times.txt` の `shape_id`、`trip_id`、`route_id` の対応を確認します。
- 路線形状がない場合は、停留所連結線を生成できるだけの停留所順序が必要です。
- 路線一覧で対象路線が表示ONになっているか確認します。

### レイヤーの切替が反映されない

- ブラウザをハードリロードします。
- 開発者ツールのコンソールでJavaScriptエラーを確認します。
- GTFS読み込み完了後に操作します。
- 停留所連結線は、往復路線の統合表示中は仕様上非表示になります。

### 車両が表示されない

- URLがGTFS-RT Vehicle Positions のprotobufフィードか確認します。
- `/vehicles` の `status.last_error` とHTTPステータスを確認します。
- フィードに位置情報、`trip_id`、または車両IDが含まれているか確認します。

### 大きなGTFSで遅い

- まず停留所連結線を非表示にして描画負荷を確認します。
- `PerformanceMonitor` でレイヤー切替時間を計測します。
- 路線数・停留所数・連結線数をアップロード結果とAPIレスポンスで確認します。

## ディレクトリ構成

```text
app/
  main.py       FastAPIアプリとAPI
  gtfs.py       GTFS ZIP解析とGeoJSON生成
  rt.py         GTFS-RT取得・車両状態管理
  storage.py    SQLiteとメモリ上のデータ管理
static/
  index.html    画面構造
  app.js        地図、API連携、表示設定
  styles.css    画面スタイル
  performance-monitor.js  表示切替性能計測
data/
  linemap.db    現在データの保存先
tests/
  test_route_merge.py     往復統合判定テスト
  test_stop_search.html   停留所検索のブラウザテスト
```

## 既知の制約

- GTFSの表記ゆれが大きい場合、往復路線の統合判定が意図と異なることがあります。
- 統合表示の中間線は形状の近似処理を含むため、実道路上の経路と完全には一致しない場合があります。
- GTFS-RTはVehicle Positionsを対象としており、Trip UpdatesやService Alertsは対象外です。
- 複数GTFSの登録一覧は現在メモリ管理で、アプリ再起動後も保持する管理機能は未実装です。
- OpenFreeMapの表示には外部タイルサービスへの接続が必要です。

## 関連ドキュメント

- [システム構成図](システム構成図.md)
- [複数GTFS設計](docs/multi_gtfs_design.md)
- [停留所検索設計](docs/stop_search_design.md)
- [計画と課題](まとめる.md)
