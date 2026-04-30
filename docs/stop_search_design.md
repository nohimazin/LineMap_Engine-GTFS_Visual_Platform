# 停留所検索機能 - 設計ドキュメント

## 概要

UI に停留所検索ボックスを追加し、停留所名で検索・フィルタリングして、マップ上の該当停留所に自動ズームできる機能。

## 要件

### 機能要件
1. 左パネルに「停留所検索」セクションを追加
2. 検索ボックスに停留所名を入力
3. リアルタイムで一致する停留所を絞り込み表示
4. 検索結果をクリックすると、マップ上の停留所にズーム
5. 停留所の詳細情報（停留所ID、路線数など）を表示

### 非機能要件
- 大規模停留所データ（4000+ 件）でも応答性を損なわないこと
- 路線一覧検索と同じような UI/UX を提供

## 実装方針

### フェーズ 1（MVP）
- [ ] HTML に停留所検索セクションを追加
- [ ] 停留所一覧コンテナを追加
- [ ] JavaScript で検索ロジックを実装
- [ ] 検索結果への UI インタラクション（ズーム）を実装

### フェーズ 2（拡張）
- [ ] 検索の全文検索化（ローマ字入力対応など）
- [ ] 最近検索した停留所の記憶
- [ ] 停留所の絞り込み結果を地図上にハイライト

## 詳細設計

### HTML 構造
```html
<section class="card">
  <h2>🛑 停留所検索</h2>
  <input id="stopSearchInput" placeholder="停留所名検索" />
  <div id="stopSearchList" class="stop-search-list"></div>
</section>
```

### JavaScript ロジック

#### 1. 検索実行関数
```javascript
function performStopSearch(query) {
  if (!query.trim()) {
    // 空の場合は全件を表示（オプション）
    return state.stops.features;
  }
  
  const normalizedQuery = normalizeDisplayText(query);
  return state.stops.features.filter(feature => {
    const stopName = normalizeDisplayText(feature.properties.stop_name || "");
    return stopName.includes(normalizedQuery);
  });
}
```

#### 2. 結果表示関数
```javascript
function renderStopSearchResults(results) {
  const container = document.getElementById("stopSearchList");
  container.innerHTML = "";
  
  results.slice(0, 30).forEach(feature => {
    const item = document.createElement("div");
    item.className = "stop-search-item";
    item.textContent = feature.properties.stop_name;
    item.addEventListener("click", () => {
      zoomToStop(feature.geometry.coordinates);
    });
    container.appendChild(item);
  });
  
  if (results.length > 30) {
    const moreInfo = document.createElement("div");
    moreInfo.textContent = `他 ${results.length - 30} 件`;
    moreInfo.className = "hint";
    container.appendChild(moreInfo);
  }
}
```

#### 3. ズーム関数
```javascript
function zoomToStop(coordinates) {
  map.easeTo({
    center: [coordinates[0], coordinates[1]],
    zoom: 15,
    duration: 800,
  });
}
```

### CSS スタイル
```css
.stop-search-list {
  max-height: 200px;
  overflow-y: auto;
  border: 1px solid #ddd;
  border-radius: 4px;
  margin-top: 6px;
}

.stop-search-item {
  padding: 6px 8px;
  border-bottom: 1px solid #eee;
  cursor: pointer;
  user-select: none;
}

.stop-search-item:hover {
  background-color: #f0f0f0;
}

.stop-search-item:last-child {
  border-bottom: none;
}
```

### イベント連携
- 入力欄に `input` イベントリスナーを設定
- リアルタイムで `performStopSearch()` を呼び出し
- 結果を `renderStopSearchResults()` で表示

## 優先度

- **MVP**: 検索ボックス + 基本的なフィルタリング + ズーム
- **拡張**: 全文検索、ハイライト表示

## 制限事項

- 現在は最大 30 件の結果を表示（パフォーマンス考慮）
- ローマ字対応は Phase 2 以降

## テスト項目

1. 1文字入力で部分一致フィルタリング
2. 大文字小文字区別なし
3. 空白含みの入力（「central station」）
4. 全角・半角混在
5. 検索結果が 0 件の場合
