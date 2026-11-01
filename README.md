# LineMap Engine GTFS Visual Platform

GTFS（静的データ）と GTFS-RT（リアルタイム車両位置）を読み込み、路線・停留所・停留所連結線・車両を地図上に表示する Web 可視化プラットフォームです。

バックエンドは **FastAPI**、フロントエンドの地図描画は **MapLibre GL JS**、ベースマップは **OpenFreeMap** を使用します。

---

## 主な機能

- **GTFS ZIP 解析 & 描画**:
  - ZIP 内のサブフォルダーに配置された GTFS ファイルの自動探索
  - UTF-8 / UTF-8 BOM / CP932 / Shift_JIS エンコーディングに自動対応
  - 路線形状（`shapes.txt`）の描画、および shape が存在しない場合の停留所連結線フォールバック
  - `route_color` による路線色設定と、未設定時の自動色決定
- **複数 GTFS の同時登録・表示**:
  - `gtfs_id` 単位でのデータセット登録・同時表示切替・削除
  - SQLite (`data/linemap.db`) への状態保存と、アプリ再起動時の自動復元
  - 名前空間プレフィックス（`gtfs_id:`）による路線・停留所・車両 ID の衝突防止
  - データセット別の車両マーカー色設定
- **GTFS-RT リアルタイム車両追跡**:
  - Vehicle Positions（Protocol Buffers / gzip 圧縮対応）の定期取得
  - 車両の位置、方位、速度、系統名、遅延状況のポップアップ表示
  - データセット単位の取得間隔（5〜60秒）設定と通信エラー履歴管理
- **高度な表示制御 & 検索**:
  - **路線一覧検索**: 路線名でのインクリメンタル検索と個別表示 ON/OFF
  - **停留所検索**: 停留所名・停留所 ID でのリアルタイム検索、該当位置へのズーム & ポップアップ表示
  - **往復路線統合**: 往路・復路の路線を判定して中心線で統合表示、統合時カラーの選択
  - **長距離便フィルタ**: 高速バスなどの長距離路線を判定し、連結線・通過停留所・車両を非表示化
  - **運行日絞り込み**: `calendar.txt` / `calendar_dates.txt` を解析し、今日運行される便のみに連結線や時刻を絞り込み
  - **同一地点統合**: 複数事業者の停留所が同一地点にある場合、1 つのポップアップにまとめて表示
- **地図 & エクスポート**:
  - OpenFreeMap スタイル切替（Liberty / Bright / Positron）
  - 地図キャンバスの PNG 画像保存
  - 表示設定・カメラ位置のブラウザ保存（localStorage）

---

## 技術構成

- **Backend**: Python 3.11+ / FastAPI / Uvicorn
- **Frontend**: HTML5 / CSS3 / JavaScript (ES6+)
- **Map Library**: MapLibre GL JS 4.7.1
- **Base Map**: OpenFreeMap (Liberty / Bright / Positron)
- **Data Format**: GeoJSON / Protocol Buffers (GTFS-RT)
- **Storage**: SQLite 3 (`data/linemap.db` による Key-Value JSON Blob 保存)

---

## ディレクトリ構成

```text
LineMap_Engine-GTFS_Visual_Platform/
├─ app/                         # バックエンドアプリケーション
│  ├─ main.py                   # FastAPI アプリ、API 定義、ライフサイクル管理
│  ├─ gtfs.py                   # GTFS ZIP 解析、GeoJSON 生成、運行日判定
│  ├─ rt.py                     # GTFS-RT 車両位置取得・状態管理
│  ├─ storage.py                # DataStore (SQLite 永続化 & メモリ管理)
│  └─ __init__.py
├─ static/                      # フロントエンド静的ファイル
│  ├─ index.html                # メイン画面 HTML
│  ├─ app.js                    # 地図制御、API 連携、イベント処理
│  ├─ styles.css                # スタイルシート
│  └─ performance-monitor.js    # レイヤー描画性能計測ツール
├─ data/                        # データディレクトリ
│  └─ linemap.db                # 実行時生成 SQLite データベース
├─ docs/                        # ドキュメント集
│  ├─ architecture.md           # システム構成・アーキテクチャ詳細
│  ├─ api.md                    # REST API 仕様書
│  ├─ multi_gtfs_design.md      # 複数 GTFS 管理機能仕様
│  ├─ stop_search_design.md     # 停留所検索機能仕様
│  └─ project_status.md         # 実装状況・技術課題・ロードマップ
├─ scripts/                     # 開発・検証用スクリプト
│  ├─ gtfs_perf.py              # GTFS 解析処理性能測定
│  └─ rt_validate.py            # GTFS-RT 車両データ検証
├─ tests/                       # テストコード
│  ├─ test_rt.py                # GTFS-RT gzip 展開 / パーステスト
│  ├─ test_vehicle_route_ids.py # 車両 route_id 名前空間テスト
│  ├─ test_route_merge.py       # 往復路線統合判定テスト
│  └─ test_stop_search.html     # 停留所検索のブラウザ手動検証ページ
├─ requirements.txt             # Python パッケージ依存関係
└─ README.md                    # 本書
```

---

## セットアップ

### 1. 依存ライブラリのインストール

Python 3.11 以降の環境を用意します。

PowerShell での実行例:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

仮想環境のスクリプト実行が制限されている場合:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

---

## 起動

プロジェクトルートで実行します。

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

ブラウザで `http://127.0.0.1:8000` を開きます。
別のポートを使用する場合は `--port 8001` などを指定してください。

---

## 使い方

### 1. GTFS データの登録
1. 画面左パネルの「GTFSアップロード」をクリックします。
2. GTFS の `.zip` ファイルを選択し、データセット名（`GTFS ID`）を入力します。
3. （任意）GTFS-RT Vehicle Positions の URL、更新間隔、車両マーカー色を指定します。
4. 「アップロード」を実行すると、解析処理完了後に自動で地図へ描画されます。

### 2. 複数 GTFS の表示と切替
- 左パネル「GTFS / GTFS-RT設定」の一覧から、チェックボックスで同時表示対象を切り替えられます。
- 各 GTFS の歯車アイコンから、GTFS-RT の URL 変更、車両色変更、またはデータセットの削除が行えます。

### 3. 路線と停留所の操作
- **路線一覧**: 路線名で絞り込み、チェックボックスで個別路線の表示/非表示を切り替えられます。
- **停留所検索**: 停留所名や ID を入力するとリアルタイムで候補を表示。候補クリックで該当位置へスムーズにズームし、時刻表ポップアップを開きます。
- **往復路線の統合**: 「往復路線を統合」を有効にすると、対になる路線を中心線でまとめてスッキリ表示します。

---

## REST API 概要

主要なエンドポイントは以下の通りです。詳細は [docs/api.md](docs/api.md) を参照してください。

| メソッド | パス | 説明 |
|---|---|---|
| `GET` | `/health` | ヘルスチェック |
| `POST` | `/upload` | GTFS ZIP のアップロードと登録 |
| `GET` | `/gtfs_list` | 登録済み GTFS データセット一覧の取得 |
| `POST` | `/gtfs/active` | 同時表示する GTFS ID リストの設定 |
| `DELETE` | `/gtfs/delete` | 指定した GTFS データセットの削除 |
| `POST` | `/settings/dataset` | データセットごとの GTFS-RT 設定・車両色更新 |
| `GET` | `/routes` | アクティブな GTFS の統合路線 GeoJSON |
| `GET` | `/route_catalog` | アクティブな GTFS の統合路線カタログ |
| `GET` | `/stops` | アクティブな GTFS の統合停留所 GeoJSON |
| `GET` | `/stop_connections` | アクティブな GTFS の統合停留所連結線 GeoJSON |
| `GET` | `/agency` | アクティブな GTFS の事業者名一覧 |
| `GET` | `/vehicles` | GTFS-RT 車両位置 GeoJSON と各サービスの通信状態 |

---

## テストの実行

仮想環境の `pytest` を使用してユニットテストを実行します。

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_rt.py tests/test_vehicle_route_ids.py
```

ブラウザ上のレイヤー切替描画性能を測定する場合は、ブラウザ開発者ツールのコンソールで以下を実行できます。

```javascript
PerformanceMonitor.measureStopConnectionToggle();
PerformanceMonitor.measureStopsToggle();
PerformanceMonitor.help();
```

---

## ドキュメント一覧

詳細な技術資料は `docs/` ディレクトリに集約されています。

- [システム構成・アーキテクチャ詳細](docs/architecture.md): 全体構成図、データフロー、モジュール責務、DB 仕様
- [REST API 仕様書](docs/api.md): 各エンドポイントの詳細なパラメータ、レスポンス形式
- [複数 GTFS 管理機能 設計書](docs/multi_gtfs_design.md): 複数データセットの管理モデル、名前空間仕様
- [停留所検索機能 設計書](docs/stop_search_design.md): インクリメンタル検索、正規化、ズーム仕様
- [プロジェクト現況・課題・ロードマップ](docs/project_status.md): 現在の実装状況、技術的課題、今後の展望
