"""
テストスイート: 往復統合判定ロジックの検証

テストケースは data/route_merge_testcases.json で定義され、
app.js の mergeRoutePair() ロジックと同等の判定を Pythonで実装して検証する。
"""

import json
import re
import sys
from pathlib import Path

import pytest

# プロジェクトルートに移動
project_root = Path(__file__).parent.parent


def load_test_cases() -> list[dict]:
    with (project_root / "data" / "route_merge_testcases.json").open(encoding="utf-8") as file:
        return json.load(file).get("cases", [])


@pytest.mark.parametrize("case", load_test_cases(), ids=lambda case: case.get("id", "case"))
def test_route_merge_case(case: dict) -> None:
    routes = case.get("routes", [])
    assert len(routes) >= 2
    assert should_merge_route_pair(routes[0], routes[1]) == case.get("expect_merge", False)


def normalize_whitespace(text: str) -> str:
    """全角・半角空白を統一して正規化"""
    return re.sub(r'[\s　]+', ' ', text).strip()


def extract_terminals(long_name: str) -> tuple[str, str] | None:
    """
    路線長名から発地と着地を抽出する

    パターン:
    - "発地発着地行き" -> ("発地", "着地")
    - "A -> B" -> ("A", "B")
    """
    long_name_normalized = normalize_whitespace(long_name)
    
    # パターン1: "発/行き" 表記
    # 例: "中央駅発市役所行き"
    # 発地と着地の間の空白を削除してからマッチ
    long_name_for_terminal_extract = long_name_normalized.replace(' ', '')
    match = re.match(r'^(.+)発(.+)行き$', long_name_for_terminal_extract)
    if match:
        return (match.group(1), match.group(2))
    
    # パターン2: 矢印表記
    # 例: "松橋駅 -> 大口" または "松橋駅→大口"
    if ' -> ' in long_name_normalized or '→' in long_name_normalized:
        sep = ' -> ' if ' -> ' in long_name_normalized else '→'
        parts = long_name_normalized.split(sep)
        if len(parts) == 2:
            return (normalize_whitespace(parts[0]), normalize_whitespace(parts[1]))
    
    return None


def should_merge_route_pair(route1: dict, route2: dict) -> bool:
    """
    2つの路線が往復統合対象か判定する

    判定ルール:
    1. 両路線の route_short_name が同じ
    2. route_long_name から発地・着地を抽出可能か、または
       抽出できなければ同一short_nameで統合候補
    3. 同方向（両方とも同じ方向）の重複便は統合しない
    """
    
    # ルール1: route_short_nameが異なる場合は統合しない
    name1 = normalize_whitespace(route1.get('route_short_name', ''))
    name2 = normalize_whitespace(route2.get('route_short_name', ''))
    if name1 != name2 or not name1:
        return False
    
    # ルール2: route_long_name から終点を抽出
    long1 = route1.get('route_long_name', '')
    long2 = route2.get('route_long_name', '')
    
    terminals1 = extract_terminals(long1)
    terminals2 = extract_terminals(long2)
    
    # 両方とも抽出できた場合: 発地・着地が逆転しているか確認
    if terminals1 and terminals2:
        start1, end1 = terminals1
        start2, end2 = terminals2
        # 発地と着地が交差していれば往復ペア
        is_reverse = (start1 == end2 and end1 == start2)
        # 同方向の場合は統合しない
        is_same_direction = (start1 == start2 and end1 == end2)
        return is_reverse and not is_same_direction
    
    # 抽出失敗時: 同一short_nameで統合候補とする
    # （長名の解析に失敗した場合のフォールバック）
    return name1 == name2


def run_tests() -> int:
    """テストを実行してレポート"""
    test_cases_path = project_root / 'data' / 'route_merge_testcases.json'
    
    if not test_cases_path.exists():
        print(f"❌ テストファイルが見つかりません: {test_cases_path}")
        return 1
    
    with open(test_cases_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    test_cases = data.get('cases', [])
    if not test_cases:
        print("⚠️  テストケースが定義されていません")
        return 1
    
    passed = 0
    failed = 0
    
    print("=" * 70)
    print("往復統合判定ロジック テスト実行")
    print("=" * 70)
    
    for i, case in enumerate(test_cases, 1):
        case_id = case.get('id', f'case_{i}')
        reason = case.get('reason', '')
        expected = case.get('expect_merge', False)
        routes = case.get('routes', [])
        
        if len(routes) < 2:
            print(f"\n⚠️  Case {i} ({case_id}): ルート数が不足しています")
            continue
        
        # 判定実行
        route1 = routes[0]
        route2 = routes[1]
        result = should_merge_route_pair(route1, route2)
        
        # 検証
        is_pass = result == expected
        status = "✅ PASS" if is_pass else "❌ FAIL"
        
        if is_pass:
            passed += 1
        else:
            failed += 1
        
        print(f"\n{status} Case {i}: {case_id}")
        print(f"  理由: {reason}")
        print(f"  期待値: {expected}, 実結果: {result}")
        print(f"  ルート1: short_name='{route1.get('route_short_name')}', "
              f"long_name='{route1.get('route_long_name')}'")
        print(f"  ルート2: short_name='{route2.get('route_short_name')}', "
              f"long_name='{route2.get('route_long_name')}'")
    
    print("\n" + "=" * 70)
    print(f"テスト結果: {passed} 成功, {failed} 失敗 (計 {passed + failed})")
    print("=" * 70)
    
    return 0 if failed == 0 else 1


if __name__ == '__main__':
    sys.exit(run_tests())
