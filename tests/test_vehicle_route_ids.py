from app.main import _namespace_vehicle_route_id


def test_namespace_vehicle_route_id_matches_map_route_ids() -> None:
    assert _namespace_vehicle_route_id("route-1", "default") == "default:route-1"
    assert _namespace_vehicle_route_id("default:route-1", "default") == "default:route-1"
    assert _namespace_vehicle_route_id("", "default") == ""
