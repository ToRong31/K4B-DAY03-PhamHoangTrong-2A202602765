"""Student Housing ReAct orchestrator, CLI runner, guardrails and trace export."""
from __future__ import annotations

import argparse
import copy
import json
import os
import re
import sys
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, List

sys.path.insert(0, str(Path(__file__).resolve().parent))
if getattr(sys.stdout, "encoding", "").lower() != "utf-8":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, OSError):
        pass
from mcp_server import MCPHousingServer
from prompts import MAX_ITERATIONS, MAX_TOOL_CALLS, REACT_AGENT_SYSTEM_PROMPT, RUN_DEADLINE_SECONDS
from providers import BaseLLMProvider, get_llm_provider
from tools import FIXTURE_VERSION, ROOMS, SCHOOLS, _normalize_school_name, _resolve_school, get_mock_bookings, reset_mock_bookings, validate_tool_arguments

ROOT = Path(__file__).resolve().parent.parent
REFERENCE_NOW = datetime.fromisoformat("2026-09-13T10:00:00+07:00")
TERMINAL = {"COMPLETED", "NEEDS_INPUT", "BLOCKED", "FAILED", "LIMIT_REACHED", "ACTION_STATUS_UNKNOWN"}


@dataclass
class SessionState:
    session_id: str = field(default_factory=lambda: f"sess-{uuid.uuid4().hex[:10]}")
    messages: List[Dict[str, Any]] = field(default_factory=list)
    pending_criteria: Dict[str, Any] = field(default_factory=dict)
    pending_observations: Dict[str, Any] = field(default_factory=dict)


def sanitize(value: Any) -> Any:
    if isinstance(value, str):
        masked = re.sub(r"(?<!\d)0\d{9}(?!\d)", "09*****678", value)
        masked = re.sub(r"\bSV\d{7}\b", "SV***001", masked)
        return re.sub(r"(AIzaSy[A-Za-z0-9_-]{33}|sk-proj-[A-Za-z0-9_-]{20,})", "[REDACTED_API_KEY]", masked)
    if isinstance(value, list):
        return [sanitize(x) for x in value]
    if isinstance(value, dict):
        return {k: ("[REDACTED]" if k in {"student_phone", "phone"} and isinstance(v, str) else sanitize(v)) for k, v in value.items()}
    return value


class TraceRecorder:
    def __init__(self, run_id: str, session_id: str, provider: BaseLLMProvider, test_case_id: str | None = None, callback: Callable[[Dict[str, Any]], None] | None = None) -> None:
        self.run_id, self.session_id, self.provider, self.test_case_id, self.callback = run_id, session_id, provider, test_case_id, callback
        self.events: List[Dict[str, Any]] = []
        self.seq = 0

    def add(self, event_type: str, step: int, payload: Dict[str, Any], tool_call_id: str | None = None, duration_ms: float = 0.0, parent_event_id: str | None = None) -> Dict[str, Any]:
        self.seq += 1
        event = {
            "event_id": f"evt-{uuid.uuid4().hex[:12]}",
            "seq": self.seq,
            "session_id": self.session_id,
            "run_id": self.run_id,
            "step": step,
            "timestamp": datetime.now().astimezone().isoformat(timespec="milliseconds"),
            "duration_ms": round(duration_ms, 3),
            "event_type": event_type,
            "llm_mode": self.provider.mode,
            "provider": self.provider.provider_name,
            "model": self.provider.model_name,
            "parent_event_id": parent_event_id,
            "tool_call_id": tool_call_id,
            "test_case": self.test_case_id,
            "payload": copy.deepcopy(payload),
        }
        clean = sanitize(event)
        self.events.append(clean)
        if self.callback:
            self.callback(clean)
        return clean


def parse_constraints(text: str) -> Dict[str, Any]:
    lower, result = text.lower(), {}
    money = re.search(r"(?:không quá|tối đa|giá)[^\d]{0,20}(\d+(?:[,.]\d+)?)\s*(triệu|tr|nghìn|ngàn)", text, re.I)
    if money: result["max_price"] = round(float(money.group(1).replace(",", ".")) * (1_000_000 if money.group(2).lower() in {"triệu", "tr"} else 1_000))
    distance = re.search(r"(?:không quá|trong|cách trường)[^\d]{0,20}(\d+(?:[,.]\d+)?)\s*(km|mét|m)\b", text, re.I)
    if distance:
        value = float(distance.group(1).replace(",", ".")); result["max_distance_km"] = value / 1000 if distance.group(2).lower() in {"m", "mét"} else value
    if "điều hòa" in lower or "máy lạnh" in lower: result["amenities"] = ["air_conditioning"]
    
    words = text.strip().split()
    if 1 <= len(words) <= 6 and not any(k in lower for k in ["tìm", "phòng", "đặt", "giá", "triệu", "bus", "km", "tiền"]):
        resolved = _resolve_school(text)
        if resolved:
            result["school_name"] = resolved["name"]
        else:
            result["school_name"] = text.strip()

    if "school_name" not in result:
        school_patterns = [
            r"(?:tôi\s+)?học\s+(?:ở\s+|tại\s+)?(?:trường\s+)?(.+?)(?=\s*(?:,|\.|\bthì\b|\bvà\b|\bmuốn\b|\bcần\b|\bhãy\b|\btìm\b)|$)",
            r"(?:gần|quanh)\s+trường\s+(.+?)(?=\s*(?:,|\.|\bgiá\b|\bcó\b|\bkhông\b|\bvà\b)|$)",
        ]
        for pattern in school_patterns:
            school_match = re.search(pattern, text, re.I)
            if school_match and school_match.group(1).strip():
                candidate = school_match.group(1).strip()
                if candidate.casefold().startswith(("nhất", "không quá", "bao nhiêu", "nếu")): continue
                cand_res = _resolve_school(candidate)
                result["school_name"] = cand_res["name"] if cand_res else candidate
                break

    if "school_name" not in result:
        acronyms = re.findall(r"\b(BKU|HUST|VINUNI|UIT|FPT|FTU|VNU|HCMUT|ĐHBK)\b", text)
        for acr in acronyms:
            cand_res = _resolve_school(acr)
            if cand_res:
                result["school_name"] = cand_res["name"]
                break

    if "school_name" not in result:
        wanted_text = _normalize_school_name(text)
        for school in SCHOOLS.values():
            candidates = sorted([school["name"], school["school_id"], *school.get("aliases", [])], key=len, reverse=True)
            for candidate in candidates:
                cand_norm = _normalize_school_name(candidate)
                if cand_norm in {"neu", "xyz", "abc", "vin", "bk"}:
                    pat = r"(?:\btrường\s+|\bđh\s+|\bđại học\s+)" + re.escape(cand_norm) + r"(?:\b|$)"
                    if re.search(pat, wanted_text):
                        result["school_name"] = school["name"]
                        break
                    continue
                pattern = r"(?:\b|^)" + re.escape(cand_norm) + r"(?:\b|$)"
                if re.search(pattern, wanted_text):
                    result["school_name"] = school["name"]
                    break
            if "school_name" in result:
                break
    rating = re.search(r"rating\s*(?:từ|ít nhất|>=?)?\s*(\d+(?:[,.]\d+)?)", lower)
    if rating: result["min_rating"] = float(rating.group(1).replace(",", "."))
    reviews = re.search(r"(?:tối thiểu|ít nhất)\s*(\d+)\s*(?:lượt|đánh giá)", lower)
    if reviews: result["min_reviews"] = int(reviews.group(1))
    if "rating" in lower or "đánh giá" in lower: result["require_rating"] = True
    if "bus" in lower or "xe buýt" in lower:
        result["require_bus"] = True
        radius = re.search(r"bus[^\d]{0,30}(\d+)\s*m", lower); result["bus_radius_m"] = int(radius.group(1)) if radius else 500
    if "tìm" in lower and "phòng" in lower: result["wants_search"] = True
    if "đặt lịch" in lower: result["wants_booking"] = True
    room_match = re.search(r"\bP\d{3}\b", text, re.I); student_match = re.search(r"\bSV\d{7}\b", text, re.I); phone_match = re.search(r"(?<!\d)0\d{9}(?!\d)", text)
    time_match = re.search(r"(\d{1,2}):(\d{2})\s+ngày\s+(\d{1,2})/(\d{1,2})/(\d{4})", text, re.I)
    if room_match and not result.get("wants_search"): result["authorized_room_id"] = room_match.group(0).upper()
    if student_match: result["student_id"] = student_match.group(0).upper()
    if phone_match: result["student_phone"] = phone_match.group(0)
    if time_match:
        hour, minute, day, month, year = map(int, time_match.groups())
        try: result["viewing_time"] = datetime(year, month, day, hour, minute).strftime("%Y-%m-%dT%H:%M:%S+07:00")
        except ValueError: pass
    return result


def _model_context_snapshot(messages: List[Dict[str, Any]], tools_schema: List[Dict[str, Any]], criteria: Dict[str, Any], evidence: List[str]) -> Dict[str, Any]:
    """Record inspectable model inputs, not private chain-of-thought."""
    return {
        "system_instruction": REACT_AGENT_SYSTEM_PROMPT,
        "messages": copy.deepcopy(messages),
        "tool_schemas": copy.deepcopy(tools_schema),
        "application_guard_context": {
            "normalized_criteria": copy.deepcopy(criteria),
            "evidence_refs_available": list(evidence),
            "note": "Tiêu chí guardrail do ứng dụng giữ; không phải suy nghĩ nội bộ của model.",
        },
    }


def _eligible_rooms(search: Dict[str, Any], ratings: Dict[str, Any], buses: Dict[str, Any], criteria: Dict[str, Any]) -> list[Dict[str, Any]]:
    result = []
    for room in search.get("rooms", []):
        if room["price_vnd"] > criteria.get("max_price", room["price_vnd"]) or room["distance_to_school_km"] > criteria.get("max_distance_km", room["distance_to_school_km"]): continue
        if not set(criteria.get("amenities", [])).issubset(room.get("amenities", [])): continue
        rid, rating, bus = room["room_id"], ratings.get(room["room_id"]), buses.get(room["room_id"])
        if criteria.get("require_rating") and (not rating or rating.get("status") != "SUCCESS" or rating.get("entity_match") != "verified" or rating.get("rating", -1) < criteria.get("min_rating", 0) or rating.get("review_count", -1) < criteria.get("min_reviews", 0)): continue
        if criteria.get("require_bus"):
            radius = criteria.get("bus_radius_m", 500)
            if not bus or bus.get("status") != "SUCCESS" or bus.get("coverage") != "supported" or not any(s.get("distance_m", radius + 1) <= radius and s.get("routes") for s in bus.get("stops", [])): continue
        result.append(room)
    return sorted(result, key=lambda r: (r["distance_to_school_km"], r["price_vnd"], r["room_id"]))


def _guard_tool(name: str, args: Dict[str, Any], criteria: Dict[str, Any], observations: Dict[str, Any], repeated: bool) -> tuple[str, str, str]:
    if repeated: return "G08", "block", "Tool và arguments đã lặp với cùng trạng thái quan sát."
    invalid = validate_tool_arguments(name, args)
    if invalid:
        missing = invalid["error"]["message"].startswith("Thiếu")
        return "G01", "needs_input" if missing and name in {"book_room_viewing", "ask_user"} else "block", invalid["error"]["message"]
    if name == "ask_user":
        return "G01/G18", "allow", "Hỏi lại người dùng để làm rõ thông tin cần thiết."
    if name == "get_school_coordinates":
        return "G01/G02/G08", "allow", "Tool nằm trong allowlist, arguments hợp lệ và còn ngân sách."
    if name == "search_rental_rooms":
        if criteria.get("max_distance_km") is not None and (args.get("lat") is None or args.get("lon") is None):
            return "G04/G18", "needs_input", "Cần xác định tọa độ GPS của trường học (gọi get_school_coordinates) trước khi tìm kiếm theo khoảng cách."
        return "G01/G02/G08", "allow", "Tool nằm trong allowlist, arguments hợp lệ và còn ngân sách."
    if name in {"get_property_ratings", "get_nearby_bus_routes"}:
        return "G01/G02/G08", "allow", "Tool nằm trong allowlist, arguments hợp lệ và còn ngân sách."
    if not criteria.get("wants_booking"): return "G03", "block", "Người dùng chưa cho phép đặt lịch."
    for key in ("student_id", "student_phone", "viewing_time"):
        if criteria.get(key) and args.get(key) != criteria[key]: return "G03/G05", "block", f"{key} không khớp phạm vi người dùng đã cung cấp."
    if criteria.get("authorized_room_id") and args.get("room_id") != criteria["authorized_room_id"]: return "G03/G04", "block", "room_id không khớp phòng người dùng chỉ định."
    search = observations.get("search")
    if criteria.get("wants_search"):
        if not search: return "G04", "block", "Phải quan sát search trước khi đặt phòng đã chọn."
        ratings, buses = observations.get("ratings", {}), observations.get("buses", {})
        eligible = _eligible_rooms(search, ratings, buses, criteria)
        if not eligible: return "G04/G17", "block", "Không có ứng viên đủ mọi tiêu chí đã kiểm chứng."
        if args.get("room_id") != eligible[0]["room_id"]: return "G04/G17", "block", "Phòng đề xuất không phải ứng viên đứng đầu theo tiêu chí người dùng."
    return "G03/G04/G05/G06/G12/G17", "allow", "Có quyền đặt, đủ evidence và backend sẽ kiểm tra thời gian/trùng lịch."


def _room_cards(observations: Dict[str, Any], selected_id: str | None) -> list[Dict[str, Any]]:
    cards = []
    for room in observations.get("search", {}).get("rooms", []):
        rid, rating_obs, bus_obs = room["room_id"], observations.get("ratings", {}).get(room["room_id"]), observations.get("buses", {}).get(room["room_id"])
        rating = None
        if rating_obs and rating_obs.get("status") == "SUCCESS" and rating_obs.get("entity_match") == "verified":
            rating = {"value": rating_obs["rating"], "scale": rating_obs["rating_scale"], "review_count": rating_obs["review_count"], "entity_type": rating_obs["rated_entity_type"], "source": rating_obs["source_provider"]}
        bus = {"status": "unknown", "nearest_stop_name": None, "distance_m": None, "distance_type": None, "routes": [], "source": None}
        if bus_obs and bus_obs.get("status") == "SUCCESS" and bus_obs.get("coverage") == "supported":
            stops = bus_obs.get("stops", [])
            if stops:
                stop = min(stops, key=lambda s: s["distance_m"]); bus = {"status": "verified", "nearest_stop_name": stop["name"], "distance_m": stop["distance_m"], "distance_type": stop["distance_type"], "routes": [r["route_name"] for r in stop.get("routes", [])], "source": bus_obs["source_provider"]}
            else: bus = {"status": "none", "nearest_stop_name": None, "distance_m": None, "distance_type": None, "routes": [], "source": bus_obs["source_provider"]}
        cards.append({"room_id": rid, "name": room["name"], "price_vnd": room["price_vnd"], "distance_to_school_km": room["distance_to_school_km"], "amenities": room["amenities"], "rating": rating, "bus": bus, "selected": rid == selected_id, "selection_reason": "Đạt điều kiện cứng và đứng đầu theo khoảng cách, giá, mã phòng." if rid == selected_id else None, "data_source": "fixture"})
    return cards


def _safe_final(model_text: str, observations: Dict[str, Any], criteria: Dict[str, Any]) -> tuple[str, str | None, list[str]]:
    ask = observations.get("ask_user")
    if ask and ask.get("question"):
        return ask["question"], None, [f"Cần người dùng bổ sung: {ask.get('missing_field', 'thông tin')}"]
    booking = observations.get("booking")
    if booking and booking.get("status") == "SUCCESS":
        rid = booking["room_id"]; room = next((x for x in observations.get("search", {}).get("rooms", []) if x["room_id"] == rid), ROOMS.get(rid))
        parts = [f"Đã đặt lịch xem phòng {rid} trong hệ thống mô phỏng vào {booking['viewing_time']}. Mã lịch: {booking['booking_id']}."]
        if room:
            parts.append(f"Phòng có giá {room['price_vnd']:,} VNĐ/tháng.")
            if "distance_to_school_km" in room:
                school_name = observations.get("school_coords", {}).get("name") or observations.get("search", {}).get("school", {}).get("name", "trường đã chọn")
                parts.append(f"Khoảng cách GPS đường thẳng tới {school_name}: {room['distance_to_school_km']} km.")
        rating = observations.get("ratings", {}).get(rid)
        if rating and rating.get("status") == "SUCCESS": parts.append(f"Rating mô phỏng {rating['rating']}/{rating['rating_scale']} từ {rating['review_count']} lượt.")
        bus = observations.get("buses", {}).get(rid)
        if bus and bus.get("stops"):
            stop = min(bus["stops"], key=lambda s: s["distance_m"]); parts.append(f"Trạm gần nhất {stop['name']} cách {stop['distance_m']} m đường thẳng, tuyến: {', '.join(r['route_name'] for r in stop['routes'])}.")
        return " ".join(parts), rid, []
    search = observations.get("search")
    if search and search.get("status") == "SUCCESS":
        rooms = search.get("rooms", [])
        if not rooms: return "Không tìm thấy phòng thỏa các tiêu chí trong dữ liệu mô phỏng. Bạn có thể tăng ngân sách hoặc mở rộng khoảng cách.", None, []
        eligible = _eligible_rooms(search, observations.get("ratings", {}), observations.get("buses", {}), criteria)
        if (criteria.get("require_rating") or criteria.get("require_bus")) and not eligible:
            return "Chưa có phòng nào trong shortlist đạt đầy đủ điều kiện rating/bus đã kiểm chứng; không đặt lịch.", None, ["Rating hoặc bus UNKNOWN không được tính là đạt."]
        school_name = observations.get("school_coords", {}).get("name") or search.get("school", {}).get("name", "trường đã chọn")
        lines = [f"{r['room_id']}: {r['price_vnd']:,} VNĐ/tháng, {r['distance_to_school_km']} km" for r in rooms]
        return f"Kết quả dữ liệu mô phỏng quanh {school_name} (khoảng cách GPS đường thẳng): " + "; ".join(lines) + ".", None, []
    # If school coordinates error occurred
    school_obs = observations.get("school_coords")
    if school_obs and school_obs.get("status") == "ERROR":
        msg = school_obs.get("error", {}).get("message", "Không tìm thấy trường.")
        msg_formatted = msg[0].lower() + msg[1:] if msg else "không tìm thấy trường."
        return f"Rất tiếc, {msg_formatted} Bạn vui lòng kiểm tra lại tên trường nhé!", None, []

    # If the LLM already returned a polite, natural explanation, prioritize it
    if model_text and model_text.strip() and not any(fake in model_text.lower() for fake in ["đã đặt lịch xem phòng", "mã lịch:"]) and (not criteria.get("wants_booking") or observations.get("booking", {}).get("status") != "SUCCESS"):
        return model_text.strip(), None, []

    if observations.get("last_error"):
        err = observations["last_error"]
        if "Chưa có observation booking SUCCESS" in err or "Chưa có phòng thỏa mãn" in err:
            if not observations.get("school_coords"):
                return "Chưa thể đặt lịch vì chưa xác định được trường học để tính khoảng cách phòng trọ. Bạn vui lòng cho mình biết tên trường bạn đang theo học nhé!", None, []
            elif not search or not search.get("rooms"):
                return "Không thể đặt lịch vì chưa tìm thấy phòng trọ nào phù hợp với các tiêu chí của bạn. Bạn vui lòng điều chỉnh lại tiêu chí (khoảng cách, giá phòng) nhé!", None, []
            else:
                return "Chưa thể tiến hành đặt lịch vì chưa có phòng nào đạt đầy đủ các điều kiện ràng buộc đã kiểm chứng (rating hoặc trạm bus). Bạn vui lòng điều chỉnh lại tiêu chí nhé!", None, []
        elif "Người dùng chưa cho phép đặt lịch" in err:
            return "Hệ thống chưa nhận được sự đồng thuận đặt lịch từ bạn. Bạn có muốn mình đặt lịch xem phòng này không?", None, []
        elif "Đã đạt giới hạn" in err:
            return "Hệ thống đã thực hiện nhiều bước tra cứu nhưng chưa thể đưa ra kết luận dứt khoát. Bạn vui lòng thử lại với yêu cầu ngắn gọn hơn nhé!", None, []
        return f"Chưa thể hoàn tất: {err}.", None, []

    return "Mình chưa có đủ dữ liệu để trả lời yêu cầu này. Bạn vui lòng cung cấp thêm thông tin (tên trường, mức giá, khu vực) để mình hỗ trợ nhé!", None, []


def run_react_agent(user_query: str, provider: BaseLLMProvider, mcp_server: MCPHousingServer | None = None, *, session: SessionState | None = None, test_case_id: str | None = None, reference_now: datetime | None = None, event_callback: Callable[[Dict[str, Any]], None] | None = None, run_id: str | None = None) -> Dict[str, Any]:
    if not isinstance(user_query, str) or not (1 <= len(user_query) <= 8000): raise ValueError("message phải dài 1–8000 ký tự")
    session, server, run_id = session or SessionState(), mcp_server or MCPHousingServer(), run_id or f"run-{uuid.uuid4().hex[:12]}"
    trace, started = TraceRecorder(run_id, session.session_id, provider, test_case_id, event_callback), time.perf_counter()
    criteria = {**session.pending_criteria, **parse_constraints(user_query)}
    observations = copy.deepcopy(session.pending_observations) if session.pending_observations else {"ratings": {}, "buses": {}}
    observations.setdefault("ratings", {}); observations.setdefault("buses", {})
    observations.pop("ask_user", None)
    session.messages.append({"role": "user", "content": user_query})
    trace.add("RUN_STARTED", 0, {"input": user_query, "criteria": criteria, "policy_version": "housing-v1", "fixture_version": FIXTURE_VERSION, "reference_time": (reference_now or datetime.now().astimezone()).isoformat()})
    proposed = executed = successful = blocked = 0; seen, evidence, usage = set(), [], None
    status, model_text = "FAILED", ""
    for step in range(1, MAX_ITERATIONS + 1):
        if time.perf_counter() - started > RUN_DEADLINE_SECONDS or executed >= MAX_TOOL_CALLS:
            status = "LIMIT_REACHED"; observations["last_error"] = "Đã đạt giới hạn thực thi"; break
        tools_schema = server.list_tools()
        model_context = _model_context_snapshot(session.messages, tools_schema, criteria, evidence)
        llm_start = time.perf_counter(); response = provider.generate_with_tools(session.messages, tools_schema, REACT_AGENT_SYSTEM_PROMPT); llm_ms = (time.perf_counter() - llm_start) * 1000
        usage = response.get("usage") or usage
        if response.get("type") == "error":
            error = response["error"]; trace.add("ERROR", step, {"code": error["code"], "stage": "provider", "message": error["message"], "retryable": error.get("retryable", False)}, duration_ms=llm_ms)
            observations["last_error"] = error["message"]; status = "FAILED"; break
        decision = "tool_calls" if response.get("type") == "tool_calls" else "final"
        trace.add("MODEL_DECISION", step, {"decision_summary": response.get("decision_summary", "Không có tóm tắt quyết định."), "summary_source": "application", "decision": decision, "evidence_refs": evidence, "model_context": model_context}, duration_ms=llm_ms)
        if decision == "final":
            session.messages.append(response.get("assistant_message", {"role": "assistant", "content": response.get("content", "")})); model_text = response.get("content", ""); status = "COMPLETED"; break
        session.messages.append(response.get("assistant_message", {"role": "assistant", "content": None, "tool_calls": []}))
        for call in response.get("tool_calls", []):
            proposed += 1; name, args, call_id = call.get("name", ""), call.get("arguments", {}), call.get("id") or f"call-{uuid.uuid4().hex[:10]}"
            proposal = trace.add("TOOL_PROPOSED", step, {"tool": name, "arguments": args}, call_id)
            signature = json.dumps([name, args], sort_keys=True, ensure_ascii=False, default=str)
            rule, verdict, reason = _guard_tool(name, args, criteria, observations, signature in seen)
            guard = trace.add("GUARDRAIL_CHECK", step, {"rule_id": rule, "verdict": verdict, "reason": reason, "evidence_refs": evidence}, call_id, parent_event_id=proposal["event_id"])
            if verdict != "allow":
                blocked += 1; error_code = "DEPENDENCY_REQUIRED" if rule in {"G04", "G04/G17"} else "NOT_AUTHORIZED" if rule == "G03" else "INVALID_ARGUMENT"
                obs = {"status": "ERROR", "error": {"code": error_code, "message": reason, "retryable": False}}
                session.messages.append({"role": "tool", "tool_call_id": call_id, "name": name, "content": json.dumps(obs, ensure_ascii=False)})
                result_evt = trace.add("TOOL_RESULT", step, {"status": "ERROR", "observation": obs, "retryable": False}, call_id, 0.0, guard["event_id"]); evidence.append(result_evt["event_id"])
                observations["last_error"] = reason; status = "NEEDS_INPUT" if verdict == "needs_input" else "LIMIT_REACHED" if rule == "G08" else "BLOCKED"
                break
            seen.add(signature); executed += 1
            started_event = trace.add("TOOL_STARTED", step, {"tool": name, "arguments": args, "attempt": 1}, call_id, parent_event_id=guard["event_id"])
            tool_start = time.perf_counter(); context = {"now": reference_now, "idempotency_key": f"{session.session_id}:{signature}"}; envelope = server.call_tool(name, args, context); tool_ms = (time.perf_counter() - tool_start) * 1000
            obs = envelope.get("result", {}); valid_obs = isinstance(obs, dict) and obs.get("status") in {"SUCCESS", "UNKNOWN", "ERROR", "NEEDS_INPUT"}
            if not valid_obs: obs = {"status": "ERROR", "error": {"code": "INTERNAL_ERROR", "message": "Observation không đúng schema.", "retryable": False}}
            result_evt = trace.add("TOOL_RESULT", step, {"status": obs["status"], "observation": obs, "retryable": obs.get("error", {}).get("retryable", False)}, call_id, tool_ms, started_event["event_id"]); evidence.append(result_evt["event_id"])
            session.messages.append({"role": "tool", "tool_call_id": call_id, "name": name, "content": json.dumps(obs, ensure_ascii=False)})
            if obs["status"] == "SUCCESS": successful += 1
            if name == "get_school_coordinates": observations["school_coords"] = obs
            elif name == "search_rental_rooms": observations["search"] = obs
            elif name == "get_property_ratings": observations["ratings"][args.get("room_id")] = obs
            elif name == "get_nearby_bus_routes": observations["buses"][args.get("room_id")] = obs
            elif name == "book_room_viewing": observations["booking"] = obs
            elif name == "ask_user":
                observations["ask_user"] = obs
                status = "NEEDS_INPUT"
                break
            if obs["status"] == "ERROR": observations["last_error"] = obs["error"]["message"]
        if status in {"BLOCKED", "NEEDS_INPUT", "LIMIT_REACHED"}: break
    else:
        status, observations["last_error"] = "LIMIT_REACHED", "Đã đạt giới hạn vòng lặp"

    if status == "COMPLETED" and criteria.get("wants_booking") and observations.get("booking", {}).get("status") != "SUCCESS":
        status = "NEEDS_INPUT" if not observations.get("school_coords") else "BLOCKED"
        if not observations.get("last_error"):
            observations["last_error"] = "Chưa có phòng thỏa mãn đủ điều kiện để đặt lịch"
    if status == "COMPLETED" and criteria.get("wants_search") and observations.get("search", {}).get("status") == "ERROR":
        error_code = observations["search"].get("error", {}).get("code")
        status = "NEEDS_INPUT" if error_code == "NOT_FOUND" else "FAILED"
    final_start = time.perf_counter(); answer, selected_id, warnings = _safe_final(model_text, observations, criteria); final_ms = (time.perf_counter() - final_start) * 1000
    if status == "COMPLETED" and observations.get("booking", {}).get("status") != "SUCCESS" and criteria.get("wants_booking") and observations.get("last_error"): status = "BLOCKED"
    final_guard = trace.add("GUARDRAIL_CHECK", min(MAX_ITERATIONS, step), {"rule_id": "G09/G10", "verdict": "allow", "reason": "Final được dựng/đối chiếu từ observation cấu trúc và đã che PII.", "evidence_refs": evidence})
    trace.add("FINAL_ANSWER", min(MAX_ITERATIONS, step), {"content": answer, "outcome": status, "evidence_refs": evidence}, duration_ms=final_ms, parent_event_id=final_guard["event_id"])
    total_ms = (time.perf_counter() - started) * 1000
    trace.add("RUN_FINISHED", min(MAX_ITERATIONS, step), {"status": status, "total_duration_ms": round(total_ms, 3), "proposed_calls": proposed, "executed_calls": executed, "successful_calls": successful, "blocked_calls": blocked, "usage": usage}, duration_ms=total_ms)
    if status == "NEEDS_INPUT":
        session.pending_criteria, session.pending_observations = copy.deepcopy(criteria), copy.deepcopy(observations)
    else:
        session.pending_criteria, session.pending_observations = {}, {}
    booking_obs = observations.get("booking"); booking = None
    if booking_obs and booking_obs.get("status") == "SUCCESS": booking = {k: booking_obs[k] for k in ("booking_id", "room_id", "viewing_time", "status", "data_source")}
    return {"run_id": run_id, "session_id": session.session_id, "status": status, "events": trace.events, "result": {"answer": answer, "rooms": _room_cards(observations, selected_id), "booking": booking, "warnings": ["Dữ liệu mô phỏng", *warnings], "llm_mode": provider.mode, "data_mode": "fixture"}, "error": None if status in {"COMPLETED", "NEEDS_INPUT", "BLOCKED", "LIMIT_REACHED"} else {"code": "RUN_FAILED", "message": sanitize(observations.get("last_error", "Run thất bại."))}, "_observations": observations}


def load_test_cases() -> List[Dict[str, Any]]:
    with (ROOT / "config" / "test_cases.json").open(encoding="utf-8") as handle: return json.load(handle)


def save_waterfall_trace(events: List[Dict[str, Any]]) -> Path:
    path = ROOT / "docs" / "trace_waterfall.json"
    start = time.perf_counter(); path.write_text(json.dumps(sanitize(events), ensure_ascii=False, indent=2), encoding="utf-8")
    _ = time.perf_counter() - start
    return path


def _assert_case(case_id: str, run: Dict[str, Any]) -> tuple[bool, str]:
    names = [e["payload"].get("tool") for e in run["events"] if e["event_type"] == "TOOL_STARTED"]
    obs, booking = run["_observations"], run["result"]["booking"]
    if case_id == "TC01": ok = not names and run["status"] == "COMPLETED"
    elif case_id == "TC02": ok = names == ["get_school_coordinates", "search_rental_rooms"] and [r["room_id"] for r in obs.get("search", {}).get("rooms", [])] == ["P101", "P103"] and not booking
    elif case_id == "TC03": ok = names == ["book_room_viewing"] and booking and booking["room_id"] == "P101" and len(get_mock_bookings()) == 1
    elif case_id == "TC04": ok = names[:2] == ["get_school_coordinates", "search_rental_rooms"] and "get_property_ratings" in names and "get_nearby_bus_routes" in names and names[-1] == "book_room_viewing" and booking and booking["room_id"] == "P103" and len(get_mock_bookings()) == 1
    elif case_id == "TC05": ok = names == ["get_school_coordinates", "search_rental_rooms"] and obs.get("search", {}).get("count") == 0 and not booking
    else: ok = False
    return bool(ok), "PASS" if ok else f"FAIL tools={names}, status={run['status']}, booking={booking}"


def run_suite(provider: BaseLLMProvider) -> int:
    tests = load_test_cases()
    if len(tests) != 5: raise RuntimeError(f"Bộ chính phải đúng 5 test cases, hiện có {len(tests)}")
    all_events, passed = [], 0
    for test in tests:
        reset_mock_bookings(); run = run_react_agent(test["question"], provider, test_case_id=test["id"], reference_now=REFERENCE_NOW)
        ok, detail = _assert_case(test["id"], run); passed += int(ok); all_events.extend(run["events"])
        print(f"[{test['id']}] {detail}")
    path = save_waterfall_trace(all_events); print(f"Kết quả: {passed}/5 PASS | Trace: {path}")
    return 0 if passed == 5 else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Student Housing ReAct Agent")
    group = parser.add_mutually_exclusive_group(); group.add_argument("--all", action="store_true"); group.add_argument("--interactive", action="store_true")
    parser.add_argument("--mode", choices=["mock", "openai"], default="mock", help="Chọn tường minh mock fixture hoặc OpenAI live")
    args = parser.parse_args()
    try: provider = get_llm_provider(args.mode)
    except Exception as exc: print(f"Không thể khởi tạo provider: {sanitize(str(exc))}"); return 2
    print(f"Chế độ LLM: {provider.mode} | Dữ liệu: fixture (mô phỏng)")
    if args.all: return run_suite(provider)
    if args.interactive:
        session, server = SessionState(), MCPHousingServer()
        while True:
            try: text = input("Bạn: ").strip()
            except (EOFError, KeyboardInterrupt): print(); break
            if text.lower() in {"exit", "quit"}: break
            if not text: continue
            run = run_react_agent(text, provider, server, session=session); print(f"Agent: {run['result']['answer']}\nTrạng thái: {run['status']}")
        return 0
    parser.print_help(); return 0


if __name__ == "__main__": raise SystemExit(main())
