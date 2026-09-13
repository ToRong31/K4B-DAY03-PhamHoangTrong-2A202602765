"""Explicit mock and OpenAI providers with native multi-turn tool calling."""
from __future__ import annotations
import json, os, re, uuid
from datetime import datetime
from typing import Any, Dict, List
from dotenv import load_dotenv
from tools import SCHOOLS, _normalize_school_name, _resolve_school
load_dotenv()


def _active_user_index(messages: List[Dict[str, Any]]) -> int:
    user_indexes = [i for i, message in enumerate(messages) if message.get("role") == "user"]
    if not user_indexes: return -1
    latest = str(messages[user_indexes[-1]].get("content", "")).lower()
    if not any(word in latest for word in ("tìm", "phòng", "đặt lịch")) and len(user_indexes) > 1: return user_indexes[-2]
    return user_indexes[-1]


def _latest_user(messages: List[Dict[str, Any]]) -> str:
    start = _active_user_index(messages)
    return " ".join(str(message.get("content", "")) for message in messages[start:] if message.get("role") == "user") if start >= 0 else ""


def _observations(messages: List[Dict[str, Any]]) -> list[tuple[str, Dict[str, Any]]]:
    result = []
    active_user = _active_user_index(messages)
    for message in messages[active_user + 1:]:
        if message.get("role") == "tool":
            try: result.append((message.get("name", ""), json.loads(message.get("content", "{}"))))
            except (TypeError, json.JSONDecodeError): pass
    return result


def _money(text: str) -> int | None:
    match = re.search(r"(?:không quá|tối đa|giá)[^\d]{0,20}(\d+(?:[,.]\d+)?)\s*(triệu|tr|nghìn|ngàn)", text, re.I)
    if not match: return None
    return round(float(match.group(1).replace(",", ".")) * (1_000_000 if match.group(2).lower() in {"triệu", "tr"} else 1_000))


def _distance_km(text: str) -> float | None:
    match = re.search(r"(?:không quá|trong|cách trường)[^\d]{0,20}(\d+(?:[,.]\d+)?)\s*(km|mét|m)\b", text, re.I)
    if not match: return None
    value = float(match.group(1).replace(",", "."))
    return value / 1000 if match.group(2).lower() in {"m", "mét"} else value


def _viewing_time(text: str) -> str | None:
    match = re.search(r"(\d{1,2}):(\d{2})\s+ngày\s+(\d{1,2})/(\d{1,2})/(\d{4})", text, re.I)
    if not match: return None
    hour, minute, day, month, year = map(int, match.groups())
    try: return datetime(year, month, day, hour, minute).strftime("%Y-%m-%dT%H:%M:%S+07:00")
    except ValueError: return None


def _school_name(text: str) -> str | None:
    words = text.strip().split()
    if 1 <= len(words) <= 6 and not any(k in text.lower() for k in ["tìm", "phòng", "đặt", "giá", "triệu", "bus", "km"]):
        res = _resolve_school(text)
        if res: return res["name"]

    patterns = [
        r"(?:tôi\s+)?học\s+(?:ở\s+|tại\s+)?(?:trường\s+)?(.+?)(?=\s*(?:,|\.|\bthì\b|\bvà\b|\bmuốn\b|\bcần\b|\bhãy\b|\btìm\b)|$)",
        r"(?:gần|quanh)\s+trường\s+(.+?)(?=\s*(?:,|\.|\bgiá\b|\bcó\b|\bkhông\b|\bvà\b)|$)",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.I)
        if match and match.group(1).strip():
            candidate = match.group(1).strip()
            if candidate.casefold().startswith(("nhất", "không quá", "bao nhiêu", "nếu")): continue
            cand_res = _resolve_school(candidate)
            return cand_res["name"] if cand_res else candidate

    acronyms = re.findall(r"\b(BKU|HUST|VINUNI|UIT|FPT|FTU|VNU|HCMUT|ĐHBK)\b", text)
    for acr in acronyms:
        cand_res = _resolve_school(acr)
        if cand_res: return cand_res["name"]

    wanted_text = _normalize_school_name(text)
    for school in SCHOOLS.values():
        candidates = sorted([school["name"], school["school_id"], *school.get("aliases", [])], key=len, reverse=True)
        for candidate in candidates:
            cand_norm = _normalize_school_name(candidate)
            if cand_norm in {"neu", "xyz", "abc", "vin", "bk"}:
                pat = r"(?:\btrường\s+|\bđh\s+|\bđại học\s+)" + re.escape(cand_norm) + r"(?:\b|$)"
                if re.search(pat, wanted_text):
                    return school["name"]
                continue
            pattern = r"(?:\b|^)" + re.escape(cand_norm) + r"(?:\b|$)"
            if re.search(pattern, wanted_text):
                return school["name"]

    # Check words from the end of the query (e.g. "BKU" or "Harvard" appended in multi-turn)
    for n in range(min(5, len(words)), 0, -1):
        sub = " ".join(words[-n:]).strip(".,?!")
        cand_res = _resolve_school(sub)
        if cand_res:
            return cand_res["name"]
    if len(words) > 1 and words[-1][0].isupper() and not any(k in words[-1].lower() for k in ["nam", "vnd", "km", "m"]):
        return words[-1].strip(".,?!")
    return None


def _call(name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
    return {"id": f"call-{uuid.uuid4().hex[:10]}", "name": name, "arguments": arguments}


def _openai_call(call: Dict[str, Any]) -> Dict[str, Any]:
    return {"id": call["id"], "type": "function", "function": {"name": call["name"], "arguments": json.dumps(call["arguments"], ensure_ascii=False)}}


class BaseLLMProvider:
    mode = provider_name = model_name = "unknown"
    def generate_with_tools(self, messages: List[Dict[str, Any]], tools_schema: List[Dict[str, Any]], system_prompt: str = "") -> Dict[str, Any]: raise NotImplementedError


class MockOfflineProvider(BaseLLMProvider):
    """Deterministic provider stub that consumes the complete tool history."""
    mode, provider_name, model_name = "mock", "mock", "housing-fixture-planner-v1"

    def generate_with_tools(self, messages: List[Dict[str, Any]], tools_schema: List[Dict[str, Any]], system_prompt: str = "") -> Dict[str, Any]:
        user, observations = _latest_user(messages), _observations(messages)
        lower = user.lower()
        school_coords_obs = next((obs for name, obs in observations if name == "get_school_coordinates" and obs.get("status") == "SUCCESS"), None)
        school_coords_failed = next((obs for name, obs in observations if name == "get_school_coordinates" and obs.get("status") != "SUCCESS"), None)
        searches = [obs for name, obs in observations if name == "search_rental_rooms"]
        ratings = {obs.get("room_id"): obs for name, obs in observations if name == "get_property_ratings"}
        buses = {obs.get("room_id"): obs for name, obs in observations if name == "get_nearby_bus_routes"}
        bookings = [obs for name, obs in observations if name == "book_room_viewing" and obs.get("status") == "SUCCESS"]
        wants_search, wants_book = "tìm" in lower and "phòng" in lower, "đặt lịch" in lower
        needs_rating, needs_bus = "rating" in lower or "đánh giá" in lower, "bus" in lower or "xe buýt" in lower

        if wants_search and not searches:
            school = _school_name(user)
            distance = _distance_km(user)
            if distance is not None and not school and not school_coords_obs:
                call = _call("ask_user", {
                    "question": "Bạn đang học trường đại học nào (ví dụ: VinUni, Bách Khoa - BKU, Kinh tế Quốc dân - NEU, Ngoại thương - FTU, CNTT - UIT...)? Vui lòng cho mình biết tên trường để tính khoảng cách chính xác từ phòng trọ đến trường nhé.",
                    "missing_field": "school_name"
                })
                return {"type": "tool_calls", "tool_calls": [call], "decision_summary": "Người dùng yêu cầu khoảng cách đến trường nhưng chưa cung cấp tên trường. Cần gọi ask_user để hỏi lại.", "assistant_message": {"role": "assistant", "content": None, "tool_calls": [_openai_call(call)]}}

            if school and not school_coords_obs:
                if school_coords_failed:
                    err_msg = school_coords_failed.get("error", {}).get("message", f"Không tìm thấy trường '{school}'.")
                    content = f"Rất tiếc, {err_msg} Bạn vui lòng chọn một trường trong danh mục trên hoặc cung cấp tên trường chuẩn để mình hỗ trợ tìm phòng nhé!"
                    return {"type": "text", "content": content, "decision_summary": "Không tìm thấy trường trong dữ liệu GPS.", "assistant_message": {"role": "assistant", "content": content}}
                call = _call("get_school_coordinates", {"school_name": school})
                return {"type": "tool_calls", "tool_calls": [call], "decision_summary": f"Cần tra cứu tọa độ GPS của trường '{school}' trước khi tìm kiếm phòng theo khoảng cách.", "assistant_message": {"role": "assistant", "content": None, "tool_calls": [_openai_call(call)]}}

            args: Dict[str, Any] = {}
            if school_coords_obs:
                args["lat"] = school_coords_obs.get("lat")
                args["lon"] = school_coords_obs.get("lon")
                args["school_name"] = school_coords_obs.get("name") or school
            elif school:
                args["school_name"] = school
            if (price := _money(user)) is not None: args["max_price"] = price
            if distance is not None: args["max_distance_km"] = distance
            if "điều hòa" in lower or "máy lạnh" in lower: args["amenities"] = ["air_conditioning"]
            call = _call("search_rental_rooms", args)
            return {"type": "tool_calls", "tool_calls": [call], "decision_summary": "Cần lấy danh sách phòng thỏa các ràng buộc đã nêu theo tọa độ trường.", "assistant_message": {"role": "assistant", "content": None, "tool_calls": [_openai_call(call)]}}

        if searches and searches[-1].get("status") == "SUCCESS" and (needs_rating or needs_bus):
            calls = []
            for room in searches[-1].get("rooms", [])[:3]:
                rid = room["room_id"]
                if needs_rating and rid not in ratings: calls.append(_call("get_property_ratings", {"room_id": rid}))
                if needs_bus and rid not in buses:
                    radius_match = re.search(r"bus[^\d]{0,30}(\d+)\s*m", lower)
                    calls.append(_call("get_nearby_bus_routes", {"room_id": rid, "radius_m": int(radius_match.group(1)) if radius_match else 500}))
            if calls:
                return {"type": "tool_calls", "tool_calls": calls, "decision_summary": "Cần kiểm tra rating và giao thông cho từng ứng viên trong shortlist.", "assistant_message": {"role": "assistant", "content": None, "tool_calls": [_openai_call(c) for c in calls]}}

        if wants_book and not bookings:
            room_id = None
            direct = re.search(r"\bP\d{3}\b", user, re.I)
            if direct and not wants_search: room_id = direct.group(0).upper()
            elif searches:
                candidates = list(searches[-1].get("rooms", []))
                rating_match = re.search(r"rating\s*(?:từ|ít nhất|>=?)?\s*(\d+(?:[,.]\d+)?)", lower)
                min_rating = float(rating_match.group(1).replace(",", ".")) if rating_match else None
                review_match = re.search(r"(?:tối thiểu|ít nhất)\s*(\d+)\s*(?:lượt|đánh giá)", lower)
                min_reviews = int(review_match.group(1)) if review_match else None
                radius_match = re.search(r"bus[^\d]{0,30}(\d+)\s*m", lower); radius = int(radius_match.group(1)) if radius_match else 500
                eligible = []
                for room in candidates:
                    rid, rating, bus = room["room_id"], ratings.get(room["room_id"]), buses.get(room["room_id"])
                    if needs_rating and (not rating or rating.get("status") != "SUCCESS" or rating.get("entity_match") != "verified" or (min_rating is not None and rating.get("rating", -1) < min_rating) or (min_reviews is not None and rating.get("review_count", -1) < min_reviews)): continue
                    if needs_bus and (not bus or bus.get("status") != "SUCCESS" or bus.get("coverage") != "supported" or not any(stop.get("distance_m", radius + 1) <= radius and stop.get("routes") for stop in bus.get("stops", []))): continue
                    eligible.append(room)
                if eligible: room_id = min(eligible, key=lambda r: (r.get("distance_to_school_km", 9999), r["price_vnd"], r["room_id"]))["room_id"]
            student, phone, when = re.search(r"\bSV\d{7}\b", user, re.I), re.search(r"(?<!\d)0\d{9}(?!\d)", user), _viewing_time(user)
            args = {"room_id": room_id, "student_id": student.group(0).upper() if student else None, "viewing_time": when, "student_phone": phone.group(0) if phone else None}
            call = _call("book_room_viewing", {k: v for k, v in args.items() if v is not None})
            return {"type": "tool_calls", "tool_calls": [call], "decision_summary": "Đã có ứng viên phù hợp; đề xuất đặt lịch theo phạm vi người dùng cho phép.", "assistant_message": {"role": "assistant", "content": None, "tool_calls": [_openai_call(call)]}}

        if searches and not searches[-1].get("rooms"):
            content = "Không tìm thấy phòng thỏa các tiêu chí trong dữ liệu mô phỏng. Bạn có thể tăng ngân sách hoặc mở rộng khoảng cách."
        elif not wants_search and not wants_book:
            content = "Khi thuê phòng, nên xác nhận tiền điện, nước, internet, gửi xe, phí dịch vụ; thỏa thuận đặt cọc cần ghi rõ số tiền, điều kiện hoàn/trừ cọc, thời hạn và chữ ký các bên."
        elif wants_book and not bookings:
            content = "Chưa thể tiến hành đặt lịch vì chưa có phòng nào đạt đầy đủ các điều kiện ràng buộc đã kiểm chứng (rating tối thiểu hoặc trạm bus). Bạn vui lòng điều chỉnh lại tiêu chí nhé!"
        else:
            content = "Đã hoàn tất tra cứu từ dữ liệu mô phỏng và sẽ chỉ xác nhận lịch khi công cụ đặt lịch thành công."
        return {"type": "text", "content": content, "decision_summary": "Đủ dữ liệu để trả lời mà không cần thêm công cụ.", "assistant_message": {"role": "assistant", "content": content}}


class OpenAIProvider(BaseLLMProvider):
    mode, provider_name = "openai", "openai"
    def __init__(self, api_key: str | None = None, model: str | None = None) -> None:
        self.api_key, self.model_name = api_key or os.getenv("OPENAI_API_KEY"), model or os.getenv("LLM_MODEL") or "gpt-4o-mini"
        if not self.api_key or self.api_key == "your_openai_api_key_here": raise RuntimeError("OPENAI_API_KEY chưa được cấu hình hợp lệ cho chế độ openai.")
        from openai import OpenAI
        self.client = OpenAI(api_key=self.api_key)

    def generate_with_tools(self, messages: List[Dict[str, Any]], tools_schema: List[Dict[str, Any]], system_prompt: str = "") -> Dict[str, Any]:
        api_messages = ([{"role": "system", "content": system_prompt}] if system_prompt else []) + messages
        tools = [{"type": "function", "function": {"name": t["name"], "description": t.get("description", ""), "parameters": t["parameters"]}} for t in tools_schema]
        try:
            request: Dict[str, Any] = {"model": self.model_name, "messages": api_messages, "tools": tools, "tool_choice": "auto", "temperature": 0.1}
            if self.model_name.startswith(("gpt-5", "gpt-6")):
                request["reasoning_effort"] = "none"
            response = self.client.chat.completions.create(**request)
            message, assistant_message = response.choices[0].message, response.choices[0].message.model_dump(exclude_none=True)
            usage = response.usage.model_dump() if response.usage else None
            if message.tool_calls:
                calls = []
                for item in message.tool_calls:
                    try: arguments = json.loads(item.function.arguments or "{}")
                    except json.JSONDecodeError: arguments = {"__invalid_json__": True}
                    calls.append({"id": item.id, "name": item.function.name, "arguments": arguments})
                return {"type": "tool_calls", "tool_calls": calls, "decision_summary": f"Model đề xuất {', '.join(c['name'] for c in calls)}.", "assistant_message": assistant_message, "usage": usage}
            return {"type": "text", "content": message.content or "", "decision_summary": "Model đề xuất trả lời dựa trên lịch sử và observations hiện có.", "assistant_message": assistant_message, "usage": usage}
        except Exception as exc:
            return {"type": "error", "error": {"code": "PROVIDER_ERROR", "message": f"OpenAI request thất bại: {type(exc).__name__}", "retryable": False}}


def get_llm_provider(mode: str = "mock") -> BaseLLMProvider:
    if mode == "mock": return MockOfflineProvider()
    if mode == "openai": return OpenAIProvider()
    raise ValueError("LLM mode phải là 'mock' hoặc 'openai'; không có fallback tự động.")
