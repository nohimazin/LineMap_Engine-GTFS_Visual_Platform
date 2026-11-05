import json
import re
import sys
from pathlib import Path

import pytest

project_root = Path(__file__).parent.parent


def load_test_cases() -> list[dict]:
    test_cases_path = project_root / "data" / "route_merge_testcases.json"
    if not test_cases_path.exists():
        return []
    with test_cases_path.open(encoding="utf-8") as file:
        return json.load(file).get("cases", [])


@pytest.mark.parametrize("case", load_test_cases(), ids=lambda case: case.get("id", "case"))
def test_route_merge_case(case: dict) -> None:
    routes = case.get("routes", [])
    assert len(routes) >= 2
    assert should_merge_route_pair(routes[0], routes[1]) == case.get("expect_merge", False)


def normalize_whitespace(text: str) -> str:
    """全角・半角空白を統一して正規化"""
    return re.sub(r"[\s　]+", " ", text).strip()


def extract_terminals(long_name: str) -> tuple[str, str] | None:
    """路線長名から発地と着地を抽出する"""
    long_name_normalized = normalize_whitespace(long_name)

    # パターン1: "発/行き" 表記 (例: "中央駅発市役所行き")
    long_name_for_terminal_extract = long_name_normalized.replace(" ", "")
    match = re.match(r"^(.+)発(.+)行き$", long_name_for_terminal_extract)
    if match:
        return (match.group(1), match.group(2))

    # パターン2: 矢印表記 (例: "松橋駅 -> 大口" または "松橋駅→大口")
    if " -> " in long_name_normalized or "→" in long_name_normalized:
        sep = " -> " if " -> " in long_name_normalized else "→"
        parts = long_name_normalized.split(sep)
        if len(parts) == 2:
            return (normalize_whitespace(parts[0]), normalize_whitespace(parts[1]))

    return None


def should_merge_route_pair(route1: dict, route2: dict) -> bool:
    """2つの路線が往復統合対象か判定する"""
    name1 = normalize_whitespace(route1.get("route_short_name", ""))
    name2 = normalize_whitespace(route2.get("route_short_name", ""))
    if name1 != name2 or not name1:
        return False

    long1 = route1.get("route_long_name", "")
    long2 = route2.get("route_long_name", "")

    terminals1 = extract_terminals(long1)
    terminals2 = extract_terminals(long2)

    if terminals1 and terminals2:
        start1, end1 = terminals1
        start2, end2 = terminals2
        is_reverse = (start1 == end2 and end1 == start2)
        is_same_direction = (start1 == start2 and end1 == end2)
        return is_reverse and not is_same_direction

    return name1 == name2


def run_tests() -> int:
    test_cases = load_test_cases()
    if not test_cases:
        print("⚠️ テストケースが定義されていません")
        return 1

    passed = 0
    failed = 0
    for i, case in enumerate(test_cases, 1):
        case_id = case.get("id", f"case_{i}")
        expected = case.get("expect_merge", False)
        routes = case.get("routes", [])
        if len(routes) < 2:
            continue
        result = should_merge_route_pair(routes[0], routes[1])
        if result == expected:
            passed += 1
        else:
            failed += 1
            print(f"FAIL: {case_id} (expected {expected}, got {result})")

    print(f"結果: {passed} passed, {failed} failed")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(run_tests())
