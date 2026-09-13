"""Schemas and in-process fixture tools for the Student Housing agent."""
from __future__ import annotations

import copy
import json
import math
import re
import threading
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Iterable

AMENITIES = {"air_conditioning", "loft", "flexible_hours", "private_bathroom", "parking"}
ROOM_ID_RE = re.compile(r"^P[0-9]{3}$")
STUDENT_ID_RE = re.compile(r"^SV[0-9]{7}$")
PHONE_RE = re.compile(r"^0[0-9]{9}$")


def _object_schema(properties: Dict[str, Any], required: Iterable[str] = ()) -> Dict[str, Any]:
    return {"type": "object", "properties": properties, "required": list(required), "additionalProperties": False}


TOOLS_SCHEMA = [
    {"name": "get_school_coordinates", "description": "Tra cứu tọa độ GPS (vĩ độ lat, kinh độ lon) của trường đại học từ danh mục dữ liệu trường học.", "parameters": _object_schema({
        "school_name": {"type": "string", "minLength": 1, "maxLength": 200, "description": "Tên hoặc viết tắt của trường đại học (ví dụ: 'VinUni', 'Trường mẫu của bài lab', 'Đại học Bách Khoa')."},
    }, ["school_name"])},
    {"name": "search_rental_rooms", "description": "Tìm phòng trọ còn trống theo tọa độ GPS trung tâm và khoảng cách tính động theo công thức Haversine.", "parameters": _object_schema({
        "lat": {"type": "number", "minimum": -90, "maximum": 90, "description": "Vĩ độ GPS trung tâm (lấy từ get_school_coordinates)."},
        "lon": {"type": "number", "minimum": -180, "maximum": 180, "description": "Kinh độ GPS trung tâm (lấy từ get_school_coordinates)."},
        "max_distance_km": {"type": "number", "exclusiveMinimum": 0, "description": "Khoảng cách tối đa từ tọa độ trung tâm (km). Bắt buộc cần lat và lon khi dùng tham số này."},
        "max_price": {"type": "integer", "minimum": 1, "description": "Giá tối đa VNĐ/tháng."},
        "amenities": {"type": "array", "items": {"type": "string", "enum": sorted(AMENITIES)}, "uniqueItems": True},
        "school_name": {"type": "string", "minLength": 1, "maxLength": 200, "description": "Tên trường tùy chọn để gắn nhãn kết quả tìm kiếm."},
    })},
    {"name": "get_property_ratings", "description": "Lấy rating mô phỏng đã đối chiếu đúng bất động sản.", "parameters": _object_schema({"room_id": {"type": "string", "pattern": "^P[0-9]{3}$"}}, ["room_id"])},
    {"name": "get_nearby_bus_routes", "description": "Lấy trạm và tuyến bus mô phỏng gần phòng.", "parameters": _object_schema({
        "room_id": {"type": "string", "pattern": "^P[0-9]{3}$"},
        "radius_m": {"type": "integer", "minimum": 1, "maximum": 2000, "default": 500},
        "destination_school_id": {"type": "string"}, "departure_time": {"type": "string", "format": "date-time"},
    }, ["room_id"])},
    {"name": "book_room_viewing", "description": "Đặt lịch xem phòng trong hệ thống mô phỏng sau khi người dùng cho phép.", "parameters": _object_schema({
        "room_id": {"type": "string", "pattern": "^P[0-9]{3}$"},
        "student_id": {"type": "string", "pattern": "^SV[0-9]{7}$"},
        "viewing_time": {"type": "string", "format": "date-time"},
        "student_phone": {"type": "string", "pattern": "^0[0-9]{9}$"},
    }, ["room_id", "student_id", "viewing_time", "student_phone"])},
    {"name": "ask_user", "description": "Hỏi lại người dùng để làm rõ hoặc thu thập thông tin còn thiếu (như tên trường khi cần tính khoảng cách, thông tin đặt lịch, v.v.) trước khi tiếp tục.", "parameters": _object_schema({
        "question": {"type": "string", "minLength": 5, "maxLength": 500, "description": "Câu hỏi lịch sự gửi đến người dùng."},
        "missing_field": {"type": "string", "enum": ["school_name", "viewing_time", "student_id", "student_phone", "other"], "description": "Trường thông tin cụ thể còn thiếu."},
    }, ["question", "missing_field"])},
]

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def _load_fixture(filename: str) -> Dict[str, Any]:
    """Load a required fixture explicitly; malformed/missing data fails loudly."""
    path = DATA_DIR / filename
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Không thể nạp fixture bắt buộc: data/{filename}") from exc
    if not isinstance(payload, dict) or payload.get("data_source") != "fixture":
        raise RuntimeError(f"Fixture không đúng contract: data/{filename}")
    return payload


_ROOMS_FIXTURE = _load_fixture("rooms.json")
_RATINGS_FIXTURE = _load_fixture("ratings.json")
_TRANSIT_FIXTURE = _load_fixture("transit.json")
_SCHOOLS_FIXTURE = _load_fixture("schools.json")
FIXTURE_VERSION = _ROOMS_FIXTURE["fixture_version"]
ROOMS = {room["room_id"]: room for room in _ROOMS_FIXTURE["rooms"]}
RATINGS = _RATINGS_FIXTURE["ratings"]
TRANSIT = _TRANSIT_FIXTURE["transit"]
SCHOOLS = {school["school_id"]: school for school in _SCHOOLS_FIXTURE["schools"]}
_BOOKINGS: Dict[str, Dict[str, Any]] = {}
_IDEMPOTENCY: Dict[str, str] = {}
_BOOKING_LOCK = threading.Lock()


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def _error(code: str, message: str, retryable: bool = False) -> Dict[str, Any]:
    return {"status": "ERROR", "error": {"code": code, "message": message, "retryable": retryable}}


def _valid_number(value: Any, integer: bool = False, minimum: float | None = None, maximum: float | None = None) -> bool:
    valid_type = isinstance(value, int) if integer else isinstance(value, (int, float))
    return bool(valid_type and not isinstance(value, bool) and math.isfinite(float(value)) and (minimum is None or value >= minimum) and (maximum is None or value <= maximum))


def validate_tool_arguments(tool_name: str, arguments: Any) -> Dict[str, Any] | None:
    schema = next((item["parameters"] for item in TOOLS_SCHEMA if item["name"] == tool_name), None)
    if schema is None:
        return _error("UNKNOWN_TOOL", "Công cụ không nằm trong allowlist.")
    if not isinstance(arguments, dict):
        return _error("INVALID_ARGUMENT", "Arguments phải là một object JSON.")
    if len(json.dumps(arguments, ensure_ascii=False, default=str).encode("utf-8")) > 4096:
        return _error("INVALID_ARGUMENT", "Arguments vượt giới hạn 4 KB.")
    if set(arguments) - set(schema["properties"]):
        return _error("INVALID_ARGUMENT", "Arguments chứa trường không được phép.")
    if set(schema.get("required", [])) - set(arguments):
        return _error("INVALID_ARGUMENT", "Thiếu tham số bắt buộc.")
    if tool_name == "get_school_coordinates":
        if not isinstance(arguments.get("school_name"), str) or not arguments["school_name"].strip() or len(arguments["school_name"]) > 200:
            return _error("INVALID_ARGUMENT", "school_name phải là chuỗi 1–200 ký tự.")
    elif tool_name == "search_rental_rooms":
        if "lat" in arguments and not _valid_number(arguments["lat"], False, -90.0, 90.0):
            return _error("INVALID_ARGUMENT", "lat phải là số thực từ -90 đến 90.")
        if "lon" in arguments and not _valid_number(arguments["lon"], False, -180.0, 180.0):
            return _error("INVALID_ARGUMENT", "lon phải là số thực từ -180 đến 180.")
        if "school_name" in arguments and (not isinstance(arguments["school_name"], str) or not arguments["school_name"].strip() or len(arguments["school_name"]) > 200):
            return _error("INVALID_ARGUMENT", "school_name phải là chuỗi 1–200 ký tự.")
        if "max_price" in arguments and not _valid_number(arguments["max_price"], True, 1):
            return _error("INVALID_ARGUMENT", "max_price phải là số nguyên dương.")
        if "max_distance_km" in arguments and not _valid_number(arguments["max_distance_km"], False, 0.000001):
            return _error("INVALID_ARGUMENT", "max_distance_km phải là số hữu hạn dương.")
        amenities = arguments.get("amenities", [])
        if not isinstance(amenities, list) or any(not isinstance(x, str) or x not in AMENITIES for x in amenities) or len(amenities) != len(set(amenities)):
            return _error("INVALID_ARGUMENT", "amenities chứa giá trị lạ hoặc bị trùng.")
    elif tool_name == "ask_user":
        if not isinstance(arguments.get("question"), str) or not arguments["question"].strip() or len(arguments["question"]) > 500:
            return _error("INVALID_ARGUMENT", "question phải là chuỗi từ 5 đến 500 ký tự.")
        if arguments.get("missing_field") not in {"school_name", "viewing_time", "student_id", "student_phone", "other"}:
            return _error("INVALID_ARGUMENT", "missing_field không hợp lệ.")
    else:
        if not isinstance(arguments.get("room_id"), str) or not ROOM_ID_RE.fullmatch(arguments["room_id"]):
            return _error("INVALID_ARGUMENT", "room_id không đúng định dạng.")
        if tool_name == "get_nearby_bus_routes" and not _valid_number(arguments.get("radius_m", 500), True, 1, 2000):
            return _error("INVALID_ARGUMENT", "radius_m phải là số nguyên từ 1 đến 2000.")
        if tool_name == "book_room_viewing":
            if not isinstance(arguments.get("student_id"), str) or not STUDENT_ID_RE.fullmatch(arguments["student_id"]):
                return _error("INVALID_ARGUMENT", "student_id không đúng định dạng lab.")
            if not isinstance(arguments.get("student_phone"), str) or not PHONE_RE.fullmatch(arguments["student_phone"]):
                return _error("INVALID_ARGUMENT", "student_phone không đúng định dạng lab.")
            if not isinstance(arguments.get("viewing_time"), str):
                return _error("INVALID_ARGUMENT", "viewing_time phải là chuỗi ISO 8601.")
    return None


def _normalize_school_name(value: str) -> str:
    value = unicodedata.normalize("NFD", value.casefold().replace("đ", "d"))
    return " ".join("".join(ch for ch in value if unicodedata.category(ch) != "Mn").split())


def _resolve_school(school_name: str | None) -> Dict[str, Any] | None:
    if not school_name:
        return None
    raw = school_name.strip()
    if raw.lower() in {"nếu", "neu"} and not raw.isupper():
        return None
    wanted = _normalize_school_name(raw)

    # Priority 1: Exact normalized candidate match
    for school in SCHOOLS.values():
        candidates = [school["name"], school["school_id"], *school.get("aliases", [])]
        cand_norms = {_normalize_school_name(c) for c in candidates}
        if wanted in cand_norms:
            if school["school_id"] == "NEU" and "nếu" in raw.lower() and not raw.isupper():
                continue
            return school

    # Priority 2: Match after stripping fillers ("truong dai hoc", "dai hoc", "truong", "dh", "hoc tai", "o", "tai", "gan")
    cleaned_wanted = re.sub(r"^(?:truong\s+)?(?:dai\s+hoc|dh)\s+", "", wanted)
    cleaned_wanted = re.sub(r"^(?:hoc\s+(?:tai|o)\s+|tai\s+|o\s+|gan\s+)", "", cleaned_wanted).strip()
    if cleaned_wanted and cleaned_wanted != wanted:
        for school in SCHOOLS.values():
            candidates = [school["name"], school["school_id"], *school.get("aliases", [])]
            for c in candidates:
                c_norm = _normalize_school_name(c)
                c_cleaned = re.sub(r"^(?:truong\s+)?(?:dai\s+hoc|dh)\s+", "", c_norm).strip()
                if cleaned_wanted == c_norm or (c_cleaned and cleaned_wanted == c_cleaned):
                    return school

    # Priority 3: Word boundary / token matching
    for school in SCHOOLS.values():
        candidates = [school["name"], school["school_id"], *school.get("aliases", [])]
        for c in candidates:
            c_norm = _normalize_school_name(c)
            if c_norm in {"neu"} and "nếu" in raw.lower():
                continue
            if len(c_norm) < 3:
                continue
            pattern = r"(?:\b|^)" + re.escape(c_norm) + r"(?:\b|$)"
            if re.search(pattern, wanted):
                return school
            if len(cleaned_wanted) >= 4 and cleaned_wanted in c_norm:
                return school

    return None


def execute_get_school_coordinates(school_name: str) -> Dict[str, Any]:
    school = _resolve_school(school_name)
    if not school:
        supported = ", ".join(f"{s['name']} ({s['school_id']})" for s in SCHOOLS.values())
        return _error("NOT_FOUND", f"Không tìm thấy trường '{school_name}' trong dữ liệu GPS mô phỏng. Các trường khả dụng: {supported}.")
    return {
        "status": "SUCCESS",
        "school_id": school["school_id"],
        "name": school["name"],
        "lat": school["lat"],
        "lon": school["lon"],
        "source": "fixture-schools",
        "observed_at": _now_iso(),
    }


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    from math import asin, cos, radians, sin, sqrt
    dlat, dlon = radians(lat2 - lat1), radians(lon2 - lon1)
    value = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 6371.0088 * 2 * asin(sqrt(value))


def execute_search_rental_rooms(lat: float | None = None, lon: float | None = None, max_price: int | None = None, max_distance_km: float | None = None, amenities: list[str] | None = None, school_name: str | None = None) -> Dict[str, Any]:
    center_lat, center_lon = lat, lon
    school_info = None
    if center_lat is None or center_lon is None:
        if school_name:
            school = _resolve_school(school_name)
            if school:
                center_lat, center_lon = school["lat"], school["lon"]
                school_info = {"school_id": school["school_id"], "name": school["name"], "lat": school["lat"], "lon": school["lon"]}
    elif school_name:
        school = _resolve_school(school_name)
        if school:
            school_info = {"school_id": school["school_id"], "name": school["name"], "lat": school["lat"], "lon": school["lon"]}

    if max_distance_km is not None and (center_lat is None or center_lon is None):
        return _error("MISSING_COORDINATES", "Cần cung cấp tọa độ GPS (lat, lon) để lọc phòng theo khoảng cách; hãy gọi get_school_coordinates trước.")

    requested, rooms = set(amenities or []), []
    for room in ROOMS.values():
        distance = None
        if center_lat is not None and center_lon is not None:
            distance = round(_haversine_km(center_lat, center_lon, room["lat"], room["lon"]), 3)
            if max_distance_km is not None and distance > max_distance_km:
                continue
        if not room["available"] or (max_price is not None and room["price_vnd"] > max_price) or not requested.issubset(room["amenities"]):
            continue
        item = {k: copy.deepcopy(v) for k, v in room.items() if k != "available"}
        if distance is not None:
            item["distance_to_school_km"] = distance
            item["distance_type"] = "straight_line"
        rooms.append(item)
    if center_lat is not None and center_lon is not None:
        rooms.sort(key=lambda r: (r.get("distance_to_school_km", 9999), r["price_vnd"], r["room_id"]))
    else:
        rooms.sort(key=lambda r: (r["price_vnd"], r["room_id"]))

    result: Dict[str, Any] = {
        "status": "SUCCESS",
        "rooms": rooms,
        "count": len(rooms),
        "data_source": "fixture",
        "observed_at": _now_iso(),
    }
    if center_lat is not None and center_lon is not None:
        result["center"] = {"lat": center_lat, "lon": center_lon}
        result["distance_calculation"] = "haversine_straight_line"
    if school_info:
        result["school"] = school_info
        result["school_id"] = school_info["school_id"]
    return result


def execute_get_property_ratings(room_id: str) -> Dict[str, Any]:
    room = ROOMS.get(room_id)
    if not room:
        return _error("NOT_FOUND", "Không tìm thấy phòng.")
    base = {"room_id": room_id, "property_id": room["property_id"], "source_provider": "fixture-ratings", "retrieved_at": _now_iso(), "source_updated_at": None, "freshness": "fresh", "cache_hit": False, "data_source": "fixture", "coverage": "supported", "rated_entity_type": "property"}
    value = RATINGS.get(room_id)
    if value is None:
        return {"status": "UNKNOWN", **base, "entity_match": "not_found", "rating": None, "rating_scale": None, "review_count": None}
    return {"status": "SUCCESS", **base, "provider_place_id": f"PLACE-{room_id}", "entity_match": "verified", "rating": value["rating"], "rating_scale": value["rating_scale"], "review_count": value["review_count"]}


def execute_get_nearby_bus_routes(room_id: str, radius_m: int = 500, destination_school_id: str | None = None, departure_time: str | None = None) -> Dict[str, Any]:
    if room_id not in ROOMS:
        return _error("NOT_FOUND", "Không tìm thấy phòng.")
    item = TRANSIT.get(room_id, {"coverage": "unknown"})
    base = {"room_id": room_id, "radius_m": radius_m, "coverage": item["coverage"], "source_provider": "fixture-transit", "retrieved_at": _now_iso(), "source_updated_at": None, "freshness": "fresh", "cache_hit": False, "data_source": "fixture", "journey_to_school": None}
    if item["coverage"] != "supported":
        return {"status": "UNKNOWN", **base, "stops": []}
    stops = []
    if item["distance_m"] <= radius_m:
        stops = [{"stop_id": item["stop_id"], "name": item["name"], "distance_m": item["distance_m"], "distance_type": "straight_line", "routes": [{"route_id": route, "route_name": route, "direction": None, "service_status": "active"} for route in item["routes"]]}]
    return {"status": "SUCCESS", **base, "stops": stops}


def _parse_viewing_time(value: str, now: datetime) -> tuple[datetime | None, Dict[str, Any] | None]:
    try:
        parsed = datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return None, _error("INVALID_ARGUMENT", "viewing_time phải là ISO 8601 hợp lệ.")
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        return None, _error("INVALID_ARGUMENT", "viewing_time phải có UTC offset.")
    if parsed.astimezone(timezone.utc) <= now.astimezone(timezone.utc):
        return None, _error("PAST_TIME", "Lịch xem phải ở tương lai.")
    if parsed.minute not in (0, 30) or parsed.second or parsed.microsecond:
        return None, _error("INVALID_ARGUMENT", "Lịch xem phải bắt đầu vào phút 00 hoặc 30.")
    if parsed.hour < 8 or parsed.hour > 17:
        return None, _error("OUTSIDE_VIEWING_HOURS", "Giờ xem hợp lệ là 08:00–17:30.")
    return parsed, None


def execute_book_room_viewing(room_id: str, student_id: str, viewing_time: str, student_phone: str, *, _now: datetime | None = None, _idempotency_key: str | None = None) -> Dict[str, Any]:
    room = ROOMS.get(room_id)
    if not room:
        return _error("NOT_FOUND", "Không tìm thấy phòng.")
    if not room["available"]:
        return _error("ROOM_UNAVAILABLE", "Phòng hiện không còn trống.")
    parsed, invalid = _parse_viewing_time(viewing_time, _now or datetime.now(timezone.utc))
    if invalid:
        return invalid
    normalized = parsed.astimezone(timezone.utc).isoformat(timespec="seconds")
    fingerprint, idem_key = f"{room_id}|{student_id}|{normalized}", _idempotency_key or f"{room_id}|{student_id}|{normalized}"
    with _BOOKING_LOCK:
        previous_id = _IDEMPOTENCY.get(idem_key)
        if previous_id:
            previous = _BOOKINGS[previous_id]
            if previous["fingerprint"] != fingerprint:
                return _error("INVALID_ARGUMENT", "Idempotency key đã được dùng cho nội dung khác.")
            return {**previous["result"], "replayed": True}
        for stored in _BOOKINGS.values():
            if stored["normalized_time"] == normalized and (stored["room_id"] == room_id or stored["student_id"] == student_id):
                return _error("SLOT_CONFLICT", "Phòng hoặc sinh viên đã có lịch trùng slot.")
        booking_id = f"DEMO-BK-{len(_BOOKINGS) + 1:03d}"
        result = {"status": "SUCCESS", "booking_id": booking_id, "room_id": room_id, "viewing_time": parsed.isoformat(timespec="seconds"), "replayed": False, "data_source": "fixture"}
        _BOOKINGS[booking_id] = {"room_id": room_id, "student_id": student_id, "normalized_time": normalized, "fingerprint": fingerprint, "result": result}
        _IDEMPOTENCY[idem_key] = booking_id
        return copy.deepcopy(result)


def execute_ask_user(question: str, missing_field: str = "other") -> Dict[str, Any]:
    return {"status": "NEEDS_INPUT", "missing_field": missing_field, "question": question, "data_source": "system", "observed_at": _now_iso()}


TOOL_ROUTER: Dict[str, Callable[..., Dict[str, Any]]] = {
    "get_school_coordinates": execute_get_school_coordinates,
    "search_rental_rooms": execute_search_rental_rooms,
    "get_property_ratings": execute_get_property_ratings,
    "get_nearby_bus_routes": execute_get_nearby_bus_routes,
    "book_room_viewing": execute_book_room_viewing,
    "ask_user": execute_ask_user,
}


def dispatch_tool_call(tool_name: str, arguments: Dict[str, Any], execution_context: Dict[str, Any] | None = None) -> str:
    validation_error = validate_tool_arguments(tool_name, arguments)
    if validation_error:
        return json.dumps(validation_error, ensure_ascii=False)
    try:
        kwargs = dict(arguments)
        if tool_name == "book_room_viewing" and execution_context:
            kwargs.update(_now=execution_context.get("now"), _idempotency_key=execution_context.get("idempotency_key"))
        result = TOOL_ROUTER[tool_name](**kwargs)
    except Exception:
        result = _error("INTERNAL_ERROR", "Công cụ gặp lỗi nội bộ đã được che.")
    return json.dumps(result, ensure_ascii=False)


def reset_mock_bookings() -> None:
    with _BOOKING_LOCK:
        _BOOKINGS.clear(); _IDEMPOTENCY.clear()


def get_mock_bookings() -> list[Dict[str, Any]]:
    with _BOOKING_LOCK:
        return [copy.deepcopy(item["result"]) for item in _BOOKINGS.values()]
