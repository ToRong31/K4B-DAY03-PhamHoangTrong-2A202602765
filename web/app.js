/**
 * Student Housing ReAct Agent - Frontend Application
 * Tương tác API ReAct theo contract, hiển thị timeline trace và phòng trọ so sánh
 * Tuân thủ bảo mật: KHÔNG innerHTML cho dữ liệu không tin cậy, che PII, không lưu API key
 * Tích hợp hệ thống theme Dark/Light mode và icon SVG chuẩn shadcn/ui
 */

(function () {
  "use strict";

  // ===========================================================================
  // 1. STATE MANAGEMENT
  // ===========================================================================
  const state = {
    sessionId: null,
    currentRunId: null,
    runStatus: "IDLE", // IDLE, RUNNING, COMPLETED, NEEDS_INPUT, BLOCKED, FAILED, LIMIT_REACHED, ACTION_STATUS_UNKNOWN
    lastSeq: 0,
    events: [],
    pollingTimer: null,
    pollingFailures: 0,
    isDemoMode: false,
    viewMode: "cards", // "cards" | "table"
    activeFilter: "ALL",
    currentRooms: [],
    currentBooking: null,
    stepByStepDemo: true,
    sidebarCollapsed: false,
  };

  // ===========================================================================
  // 2. SAFE DOM BUILDER (Tuyệt đối không dùng innerHTML để phòng chống XSS)
  // ===========================================================================
  function el(tag, props = {}, ...children) {
    const element = document.createElement(tag);

    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;

      if (key === "className") {
        element.className = value;
      } else if (key.startsWith("on") && typeof value === "function") {
        const eventName = key.slice(2).toLowerCase();
        element.addEventListener(eventName, value);
      } else if (key === "dataset" && typeof value === "object") {
        for (const [dKey, dVal] of Object.entries(value)) {
          element.dataset[dKey] = dVal;
        }
      } else if (key === "style" && typeof value === "object") {
        Object.assign(element.style, value);
      } else {
        element.setAttribute(key, value === true ? "" : value);
      }
    }

    function appendChildNode(parent, child) {
      if (child === null || child === undefined || child === false) return;
      if (Array.isArray(child)) {
        for (const subChild of child) appendChildNode(parent, subChild);
      } else if (typeof child === "string" || typeof child === "number") {
        parent.appendChild(document.createTextNode(String(child)));
      } else if (child instanceof Node) {
        parent.appendChild(child);
      }
    }

    for (const child of children) {
      appendChildNode(element, child);
    }

    return element;
  }

  // Safe SVG Icon Builder (Tạo vector icon không dùng innerHTML)
  function svgIcon(name, className = "icon-xs") {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", className);
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");

    function addElement(tag, attrs) {
      const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
      for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
      svg.appendChild(node);
    }

    switch (name) {
      case "star":
        addElement("polygon", { points: "12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" });
        break;
      case "bus":
        addElement("rect", { x: "3", y: "4", width: "18", height: "16", rx: "2" });
        addElement("path", { d: "M4 11h16" });
        addElement("path", { d: "M8 4v7" });
        addElement("path", { d: "M16 4v7" });
        addElement("path", { d: "M6 18h.01" });
        addElement("path", { d: "M18 18h.01" });
        break;
      case "pin":
        addElement("path", { d: "M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" });
        addElement("circle", { cx: "12", cy: "10", r: "3" });
        break;
      case "check":
        addElement("polyline", { points: "20 6 9 17 4 12" });
        break;
      case "check-circle":
        addElement("circle", { cx: "12", cy: "12", r: "10" });
        addElement("polyline", { points: "9 11 12 14 22 4" });
        break;
      case "shield-check":
        addElement("path", { d: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" });
        addElement("path", { d: "m9 12 2 2 4-4" });
        break;
      case "alert-triangle":
        addElement("path", { d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" });
        addElement("line", { x1: "12", y1: "9", x2: "12", y2: "13" });
        addElement("line", { x1: "12", y1: "17", x2: "12.01", y2: "17" });
        break;
      case "user":
        addElement("path", { d: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" });
        addElement("circle", { cx: "12", cy: "7", r: "4" });
        break;
      case "bot":
        addElement("rect", { x: "3", y: "11", width: "18", height: "10", rx: "2" });
        addElement("circle", { cx: "12", cy: "5", r: "2" });
        addElement("line", { x1: "12", y1: "7", x2: "12", y2: "11" });
        break;
      case "calendar":
        addElement("rect", { x: "3", y: "4", width: "18", height: "18", rx: "2", ry: "2" });
        addElement("line", { x1: "16", y1: "2", x2: "16", y2: "6" });
        addElement("line", { x1: "8", y1: "2", x2: "8", y2: "6" });
        addElement("line", { x1: "3", y1: "10", x2: "21", y2: "10" });
        break;
      case "tool":
        addElement("path", { d: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" });
        break;
      case "sidebar":
        addElement("rect", { width: "18", height: "18", x: "3", y: "3", rx: "2" });
        addElement("path", { d: "M15 3v18" });
        break;
      case "info":
        addElement("circle", { cx: "12", cy: "12", r: "10" });
        addElement("line", { x1: "12", y1: "16", x2: "12", y2: "12" });
        addElement("line", { x1: "12", y1: "8", x2: "12.01", y2: "8" });
        break;
      default:
        addElement("circle", { cx: "12", cy: "12", r: "10" });
    }

    return svg;
  }

  // ===========================================================================
  // 3. UTILITY & SANITIZATION HELPERS
  // ===========================================================================
  function formatVnd(amount) {
    if (typeof amount !== "number") return "-- đ";
    return new Intl.NumberFormat("vi-VN").format(amount) + " đ/tháng";
  }

  function formatKm(km) {
    if (typeof km !== "number") return "-- km";
    return km.toLocaleString("vi-VN") + " km";
  }

  function maskPii(str) {
    if (typeof str !== "string") return str;
    let masked = str.replace(/(0[3|5|7|8|9])([0-9]{5})([0-9]{3})/g, "$1*****$3");
    masked = masked.replace(/(SV)(\d{4})(\d{3})/gi, "$1***$3");
    return masked;
  }

  function formatTime(isoString) {
    if (!isoString) return "--";
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) +
        " " + d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
    } catch {
      return String(isoString);
    }
  }

  function showToast(message, type = "info", duration = 3500) {
    const container = document.getElementById("toast-container");
    if (!container) return;

    const iconTypeMap = {
      info: "info",
      success: "check-circle",
      warning: "alert-triangle",
      error: "alert-triangle",
    };

    const toast = el(
      "div",
      { className: `toast toast-${type}` },
      svgIcon(iconTypeMap[type] || "info", "icon-sm"),
      el("span", {}, message)
    );

    container.appendChild(toast);
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, duration);
  }

  // ===========================================================================
  // 4. DEMO FIXTURES (Chuẩn hóa 100% theo contract AGENT_TEAM_BRIEF.md)
  // ===========================================================================
  const DEMO_FIXTURES = {
    TC04: {
      title: "TC04: Tìm phòng, Rating, Bus & Đặt lịch thành công",
      userMessage: "Tôi là sinh viên SV2026001, học Trường mẫu của bài lab, số điện thoại 0912345678. Hãy tìm phòng trọ còn trống có điều hòa, giá không quá 4 triệu đồng/tháng và cách trường không quá 3 km. Chọn phòng gần trường nhất, sau đó đặt lịch xem phòng đó vào 15:00 ngày 16/09/2026 theo giờ Việt Nam.",
      run_id: "run-tc04-demo",
      session_id: "session-tc04-demo",
      status: "COMPLETED",
      events: [
        {
          seq: 1,
          step: 1,
          event_type: "RUN_STARTED",
          call_id: null,
          timestamp: "2026-09-13T10:00:00+07:00",
          duration_ms: null,
          payload: {
            input_sanitized: "Giá ≤ 4.000.000 đ, cách trường ≤ 3 km, có điều hòa. Ủy quyền đặt phòng gần nhất vào 15:00 16/09/2026.",
            policy_version: "v1.0",
            fixture_version: "2026-09-13",
          },
        },
        {
          seq: 2,
          step: 1,
          event_type: "MODEL_DECISION",
          call_id: null,
          timestamp: "2026-09-13T10:00:01+07:00",
          duration_ms: 120,
          payload: {
            decision_summary: "Cần tra cứu danh sách phòng thỏa mãn ngân sách ≤ 4.000.000 đ, khoảng cách ≤ 3 km và có tiện ích điều hòa trước khi so sánh.",
            summary_source: "application",
            decision: "tool_calls",
            evidence_refs: ["user_prompt"],
          },
        },
        {
          seq: 3,
          step: 1,
          event_type: "TOOL_PROPOSED",
          call_id: "call-search-1",
          timestamp: "2026-09-13T10:00:01+07:00",
          duration_ms: null,
          payload: {
            tool_name: "search_rental_rooms",
            arguments: {
              max_price: 4000000,
              max_distance_km: 3.0,
              amenities: ["air_conditioning"],
            },
          },
        },
        {
          seq: 4,
          step: 1,
          event_type: "GUARDRAIL_CHECK",
          call_id: "call-search-1",
          timestamp: "2026-09-13T10:00:01+07:00",
          duration_ms: 15,
          payload: {
            rule_id: "G01_INPUT_SCHEMA, G02_TOOL_ALLOWLIST, G08_BUDGET",
            verdict: "allow",
            reason: "Tham số hợp lệ, tool nằm trong allowlist, nằm trong ngân sách 5 vòng lặp.",
          },
        },
        {
          seq: 5,
          step: 1,
          event_type: "TOOL_STARTED",
          call_id: "call-search-1",
          timestamp: "2026-09-13T10:00:01+07:00",
          duration_ms: null,
          payload: {
            tool_name: "search_rental_rooms",
            attempt: 1,
          },
        },
        {
          seq: 6,
          step: 1,
          event_type: "TOOL_RESULT",
          call_id: "call-search-1",
          timestamp: "2026-09-13T10:00:02+07:00",
          duration_ms: 320,
          payload: {
            status: "SUCCESS",
            observation: {
              count: 2,
              rooms: [
                { room_id: "P102", name: "Phòng Trọ KTX Khu B - P102", price_vnd: 3800000, distance_to_school_km: 0.8, amenities: ["air_conditioning", "wifi", "private_bathroom"] },
                { room_id: "P103", name: "Nhà Trọ Sinh Viên Hẻm 68 - P103", price_vnd: 3500000, distance_to_school_km: 2.0, amenities: ["air_conditioning", "kitchen"] },
              ],
            },
          },
        },
        {
          seq: 7,
          step: 2,
          event_type: "MODEL_DECISION",
          call_id: null,
          timestamp: "2026-09-13T10:00:02+07:00",
          duration_ms: 140,
          payload: {
            decision_summary: "Tìm thấy 2 phòng ứng viên (P102: 0,8 km; P103: 2,0 km). Tiếp tục tra cứu rating và trạm bus theo tiêu chuẩn đánh giá mở rộng.",
            summary_source: "application",
            decision: "tool_calls",
            evidence_refs: ["call-search-1"],
          },
        },
        {
          seq: 8,
          step: 2,
          event_type: "TOOL_PROPOSED",
          call_id: "call-enrich-p102",
          timestamp: "2026-09-13T10:00:02+07:00",
          duration_ms: null,
          payload: {
            tool_name: "get_room_rating_and_transit",
            arguments: { room_id: "P102", radius_m: 500 },
          },
        },
        {
          seq: 9,
          step: 2,
          event_type: "GUARDRAIL_CHECK",
          call_id: "call-enrich-p102",
          timestamp: "2026-09-13T10:00:02+07:00",
          duration_ms: 12,
          payload: {
            rule_id: "G13_EGRESS, G14_SOURCE_MATCH",
            verdict: "allow",
            reason: "Tham số hợp lệ, nguồn fixture an toàn, không có PII truyền ra ngoài.",
          },
        },
        {
          seq: 10,
          step: 2,
          event_type: "TOOL_RESULT",
          call_id: "call-enrich-p102",
          timestamp: "2026-09-13T10:00:03+07:00",
          duration_ms: 245,
          payload: {
            status: "SUCCESS",
            observation: {
              room_id: "P102",
              rating: { value: 4.3, scale: 5, review_count: 37, entity_type: "property", source: "fixture-ratings" },
              bus: { status: "verified", nearest_stop_name: "Trạm Đại học CNTT", distance_m: 280, distance_type: "straight_line", routes: ["52", "19", "33"], source: "fixture-transit" },
            },
          },
        },
        {
          seq: 11,
          step: 3,
          event_type: "MODEL_DECISION",
          call_id: null,
          timestamp: "2026-09-13T10:00:03+07:00",
          duration_ms: 110,
          payload: {
            decision_summary: "P102 là phòng gần trường nhất (0,8 km), thỏa mãn điều hòa, giá 3.800.000 đ, rating 4.3/5 (>4/5) và có bus trong 280m. Người dùng đã ủy quyền đặt lịch xem.",
            summary_source: "application",
            decision: "tool_calls",
            evidence_refs: ["call-search-1", "call-enrich-p102"],
          },
        },
        {
          seq: 12,
          step: 3,
          event_type: "TOOL_PROPOSED",
          call_id: "call-book-1",
          timestamp: "2026-09-13T10:00:03+07:00",
          duration_ms: null,
          payload: {
            tool_name: "book_room_viewing",
            arguments: {
              room_id: "P102",
              student_id: "SV***001",
              viewing_time: "2026-09-16T15:00:00+07:00",
              student_phone: "091*****78",
            },
          },
        },
        {
          seq: 13,
          step: 3,
          event_type: "GUARDRAIL_CHECK",
          call_id: "call-book-1",
          timestamp: "2026-09-13T10:00:03+07:00",
          duration_ms: 18,
          payload: {
            rule_id: "G03_BOOKING_AUTH, G04_CONSTRAINTS, G05_TIME, G06_WRITE_INTEGRITY",
            verdict: "allow",
            reason: "Đã có ủy quyền tường minh từ người dùng; thời gian tương lai có offset (+07:00); phòng P102 còn trống và khớp điều kiện.",
          },
        },
        {
          seq: 14,
          step: 3,
          event_type: "TOOL_STARTED",
          call_id: "call-book-1",
          timestamp: "2026-09-13T10:00:04+07:00",
          duration_ms: null,
          payload: {
            tool_name: "book_room_viewing",
            attempt: 1,
          },
        },
        {
          seq: 15,
          step: 3,
          event_type: "TOOL_RESULT",
          call_id: "call-book-1",
          timestamp: "2026-09-13T10:00:04+07:00",
          duration_ms: 410,
          payload: {
            status: "SUCCESS",
            observation: {
              booking_id: "DEMO-BK-001",
              room_id: "P102",
              viewing_time: "2026-09-16T15:00:00+07:00",
              status: "CONFIRMED",
              data_source: "fixture",
            },
          },
        },
        {
          seq: 16,
          step: 4,
          event_type: "GUARDRAIL_CHECK",
          call_id: null,
          timestamp: "2026-09-13T10:00:04+07:00",
          duration_ms: 10,
          payload: {
            rule_id: "G09_FINAL_EVIDENCE",
            verdict: "allow",
            reason: "Dữ liệu phòng P102, giá 3.800.000 đ và mã đặt hẹn DEMO-BK-001 khớp hoàn toàn với quan sát đã ghi nhận.",
          },
        },
        {
          seq: 17,
          step: 4,
          event_type: "FINAL_ANSWER",
          call_id: null,
          timestamp: "2026-09-13T10:00:05+07:00",
          duration_ms: null,
          payload: {
            content: "Đã tìm thấy phòng phù hợp nhất và đặt lịch xem phòng thành công!\n\n- Phòng được chọn: P102 (Phòng Trọ KTX Khu B)\n- Giá thuê: 3.800.000 đ/tháng | Khoảng cách: 0,8 km từ trường\n- Tiện ích: Có điều hòa, wifi, vệ sinh khép kín\n- Đánh giá: 4.3/5 (37 lượt nhận xét)\n- Xe bus: Trạm Đại học CNTT (cách 280 m chim bay), gồm các tuyến 52, 19, 33\n- Lịch hẹn xem phòng: 15:00 ngày 16/09/2026 (Giờ Việt Nam)\n- Mã lịch hẹn: DEMO-BK-001 (Hệ thống mô phỏng)",
            evidence_refs: ["call-search-1", "call-enrich-p102", "call-book-1"],
          },
        },
        {
          seq: 18,
          step: 4,
          event_type: "RUN_FINISHED",
          call_id: null,
          timestamp: "2026-09-13T10:00:05+07:00",
          duration_ms: 1262,
          payload: {
            status: "COMPLETED",
            tool_calls_count: 3,
            tool_success_count: 3,
            total_duration_ms: 1262,
          },
        },
      ],
      result: {
        answer: "Đã tìm thấy phòng phù hợp nhất và đặt lịch xem phòng thành công!\n\n- Phòng được chọn: P102 (Phòng Trọ KTX Khu B)\n- Giá thuê: 3.800.000 đ/tháng | Khoảng cách: 0,8 km từ trường\n- Tiện ích: Có điều hòa, wifi, vệ sinh khép kín\n- Đánh giá: 4.3/5 (37 lượt nhận xét)\n- Xe bus: Trạm Đại học CNTT (cách 280 m chim bay), gồm các tuyến 52, 19, 33\n- Lịch hẹn xem phòng: 15:00 ngày 16/09/2026 (Giờ Việt Nam)\n- Mã lịch hẹn: DEMO-BK-001 (Hệ thống mô phỏng)",
        rooms: [
          {
            room_id: "P102",
            name: "Phòng Trọ KTX Khu B - P102",
            price_vnd: 3800000,
            distance_to_school_km: 0.8,
            amenities: ["air_conditioning", "wifi", "private_bathroom"],
            rating: { value: 4.3, scale: 5, review_count: 37, entity_type: "property", source: "fixture-ratings" },
            bus: { status: "verified", nearest_stop_name: "Trạm Đại học CNTT", distance_m: 280, distance_type: "straight_line", routes: ["52", "19", "33"], source: "fixture-transit" },
            selected: true,
            selection_reason: "Gần trường nhất trong các phòng có điều hòa, giá dưới 4 triệu, rating 4.3/5 và có trạm bus cách 280m.",
            data_source: "fixture",
          },
          {
            room_id: "P103",
            name: "Nhà Trọ Sinh Viên Hẻm 68 - P103",
            price_vnd: 3500000,
            distance_to_school_km: 2.0,
            amenities: ["air_conditioning", "kitchen"],
            rating: { value: 4.0, scale: 5, review_count: 18, entity_type: "property", source: "fixture-ratings" },
            bus: { status: "verified", nearest_stop_name: "Trạm Ngã tư Quốc phòng", distance_m: 410, distance_type: "straight_line", routes: ["08", "19"], source: "fixture-transit" },
            selected: false,
            selection_reason: "Giá rẻ hơn nhưng ở khoảng cách xa hơn (2,0 km so với 0,8 km của P102).",
            data_source: "fixture",
          },
        ],
        booking: {
          booking_id: "DEMO-BK-001",
          room_id: "P102",
          viewing_time: "2026-09-16T15:00:00+07:00",
          status: "CONFIRMED",
          data_source: "fixture",
        },
        warnings: ["Dữ liệu mô phỏng"],
        llm_mode: "mock",
        data_mode: "fixture",
      },
      error: null,
    },

    TC02: {
      title: "TC02: Tìm phòng cơ bản (Không đặt lịch)",
      userMessage: "Tìm giúp tôi các phòng trọ còn trống có giá không quá 3,5 triệu đồng/tháng và cách trường không quá 3 km.",
      run_id: "run-tc02-demo",
      session_id: "session-tc02-demo",
      status: "COMPLETED",
      events: [
        {
          seq: 1,
          step: 1,
          event_type: "RUN_STARTED",
          timestamp: "2026-09-13T10:00:00+07:00",
          payload: { input_sanitized: "Giá ≤ 3.500.000 đ, khoảng cách ≤ 3 km. Không yêu cầu đặt lịch." },
        },
        {
          seq: 2,
          step: 1,
          event_type: "MODEL_DECISION",
          timestamp: "2026-09-13T10:00:01+07:00",
          payload: {
            decision_summary: "Yêu cầu chỉ tìm kiếm phòng, cần gọi công cụ search_rental_rooms và không được tự ý gọi book_room_viewing.",
            summary_source: "application",
          },
        },
        {
          seq: 3,
          step: 1,
          event_type: "TOOL_PROPOSED",
          timestamp: "2026-09-13T10:00:01+07:00",
          payload: {
            tool_name: "search_rental_rooms",
            arguments: { max_price: 3500000, max_distance_km: 3.0 },
          },
        },
        {
          seq: 4,
          step: 1,
          event_type: "GUARDRAIL_CHECK",
          timestamp: "2026-09-13T10:00:01+07:00",
          payload: {
            rule_id: "G01_INPUT_SCHEMA, G02_TOOL_ALLOWLIST",
            verdict: "allow",
            reason: "Tham số hợp lệ, trong allowlist.",
          },
        },
        {
          seq: 5,
          step: 1,
          event_type: "TOOL_RESULT",
          timestamp: "2026-09-13T10:00:02+07:00",
          duration_ms: 280,
          payload: {
            status: "SUCCESS",
            observation: {
              count: 2,
              rooms: [
                { room_id: "P101", name: "Phòng Trọ Hòa Phát - P101", price_vnd: 3200000, distance_to_school_km: 1.5, amenities: ["wifi", "fan"] },
                { room_id: "P103", name: "Nhà Trọ Hẻm 68 - P103", price_vnd: 3500000, distance_to_school_km: 2.0, amenities: ["air_conditioning", "kitchen"] },
              ],
            },
          },
        },
        {
          seq: 6,
          step: 2,
          event_type: "FINAL_ANSWER",
          timestamp: "2026-09-13T10:00:03+07:00",
          payload: {
            content: "Tìm thấy 2 phòng trọ còn trống thỏa mãn yêu cầu ngân sách dưới 3,5 triệu đồng và cách trường không quá 3 km: P101 (3.200.000 đ/tháng, 1.5 km) và P103 (3.500.000 đ/tháng, 2.0 km).",
            evidence_refs: ["call-search-1"],
          },
        },
      ],
      result: {
        answer: "Tìm thấy 2 phòng trọ còn trống thỏa mãn yêu cầu ngân sách dưới 3,5 triệu đồng và cách trường không quá 3 km: P101 (3.200.000 đ/tháng, 1.5 km) và P103 (3.500.000 đ/tháng, 2.0 km).",
        rooms: [
          {
            room_id: "P101",
            name: "Phòng Trọ Hòa Phát - P101",
            price_vnd: 3200000,
            distance_to_school_km: 1.5,
            amenities: ["wifi", "fan"],
            rating: null,
            bus: { status: "unknown", nearest_stop_name: null, distance_m: null, distance_type: null, routes: [], source: null },
            selected: false,
            selection_reason: null,
            data_source: "fixture",
          },
          {
            room_id: "P103",
            name: "Nhà Trọ Hẻm 68 - P103",
            price_vnd: 3500000,
            distance_to_school_km: 2.0,
            amenities: ["air_conditioning", "kitchen"],
            rating: null,
            bus: { status: "unknown", nearest_stop_name: null, distance_m: null, distance_type: null, routes: [], source: null },
            selected: false,
            selection_reason: null,
            data_source: "fixture",
          },
        ],
        booking: null,
        warnings: ["Dữ liệu mô phỏng"],
        llm_mode: "mock",
        data_mode: "fixture",
      },
      error: null,
    },

    TC05: {
      title: "TC05: Kết quả rỗng (500k, 100m)",
      userMessage: "Tôi học Trường mẫu của bài lab, tìm giúp tôi phòng trọ còn trống có giá không quá 500 nghìn đồng/tháng và cách trường không quá 100 mét.",
      run_id: "run-tc05-demo",
      session_id: "session-tc05-demo",
      status: "COMPLETED",
      events: [
        {
          seq: 1,
          step: 1,
          event_type: "RUN_STARTED",
          timestamp: "2026-09-13T10:00:00+07:00",
          payload: { input_sanitized: "Giá ≤ 500.000 đ, khoảng cách ≤ 0.1 km." },
        },
        {
          seq: 2,
          step: 1,
          event_type: "MODEL_DECISION",
          timestamp: "2026-09-13T10:00:01+07:00",
          payload: {
            decision_summary: "Cần tra cứu với tiêu chí khắt khe: giá tối đa 500.000 đ và khoảng cách tối đa 0,1 km.",
            summary_source: "application",
          },
        },
        {
          seq: 3,
          step: 1,
          event_type: "TOOL_RESULT",
          timestamp: "2026-09-13T10:00:02+07:00",
          duration_ms: 190,
          payload: {
            status: "SUCCESS",
            observation: { count: 0, rooms: [] },
          },
        },
        {
          seq: 4,
          step: 2,
          event_type: "MODEL_DECISION",
          timestamp: "2026-09-13T10:00:02+07:00",
          payload: {
            decision_summary: "Không có phòng nào thỏa mãn trong dữ liệu thử nghiệm. Phải thông báo danh sách rỗng, không được tự ý nới bộ lọc hoặc bịa đặt giá.",
            summary_source: "application",
          },
        },
        {
          seq: 5,
          step: 2,
          event_type: "FINAL_ANSWER",
          timestamp: "2026-09-13T10:00:03+07:00",
          payload: {
            content: "Rất tiếc, trong hệ thống hiện tại không có phòng trọ nào thỏa mãn mức giá dưới 500.000 đ/tháng và cách trường trong 100 mét.\n\nGợi ý: Bạn có thể nâng mức ngân sách lên khoảng 2,5 – 4 triệu đồng hoặc mở rộng bán kính tìm kiếm lên 1 – 3 km để tìm được phòng phù hợp.",
            evidence_refs: ["call-search-empty"],
          },
        },
      ],
      result: {
        answer: "Rất tiếc, trong hệ thống hiện tại không có phòng trọ nào thỏa mãn mức giá dưới 500.000 đ/tháng và cách trường trong 100 mét.\n\nGợi ý: Bạn có thể nâng mức ngân sách lên khoảng 2,5 – 4 triệu đồng hoặc mở rộng bán kính tìm kiếm lên 1 – 3 km để tìm được phòng phù hợp.",
        rooms: [],
        booking: null,
        warnings: ["Dữ liệu mô phỏng"],
        llm_mode: "mock",
        data_mode: "fixture",
      },
      error: null,
    },

    TC07_08: {
      title: "TC07/08: Rating chưa xác định & Bus unsupported",
      userMessage: "Tìm phòng và đánh giá chi tiết độ phủ bus và rating của phòng P104 và P105.",
      run_id: "run-tc0708-demo",
      session_id: "session-tc0708-demo",
      status: "COMPLETED",
      events: [
        {
          seq: 1,
          step: 1,
          event_type: "RUN_STARTED",
          timestamp: "2026-09-13T10:00:00+07:00",
          payload: { input_sanitized: "Kiểm tra rating và bus của phòng P104, P105." },
        },
        {
          seq: 2,
          step: 1,
          event_type: "MODEL_DECISION",
          timestamp: "2026-09-13T10:00:01+07:00",
          payload: {
            decision_summary: "Cần tra cứu dữ liệu rating và tuyến xe bus từ các nguồn phụ trợ cho 2 phòng.",
            summary_source: "application",
          },
        },
        {
          seq: 3,
          step: 1,
          event_type: "TOOL_RESULT",
          timestamp: "2026-09-13T10:00:02+07:00",
          duration_ms: 310,
          payload: {
            status: "SUCCESS",
            observation: {
              p104_rating: { status: "UNKNOWN", entity_match: "ambiguous", reason: "Trùng tên nhưng sai địa chỉ" },
              p105_transit: { status: "UNKNOWN", coverage: "unsupported", reason: "Vùng chưa phủ sóng bus" },
            },
          },
        },
        {
          seq: 4,
          step: 2,
          event_type: "FINAL_ANSWER",
          timestamp: "2026-09-13T10:00:03+07:00",
          payload: {
            content: "Kết quả kiểm tra chi tiết các dữ liệu chưa xác minh:\n- P104: Rating chưa thể xác định (UNKNOWN) do tên trùng lặp nhưng không khớp địa chỉ với cơ sở dữ liệu. Không tính là đạt điều kiện cứng.\n- P105: Dữ liệu trạm xe bus thuộc vùng chưa được hỗ trợ độ phủ (unsupported/UNKNOWN). Không kết luận là 'không có bus'.",
            evidence_refs: ["call-enrich-external"],
          },
        },
      ],
      result: {
        answer: "Kết quả kiểm tra chi tiết các dữ liệu chưa xác minh:\n- P104: Rating chưa thể xác định (UNKNOWN) do tên trùng lặp nhưng không khớp địa chỉ với cơ sở dữ liệu. Không tính là đạt điều kiện cứng.\n- P105: Dữ liệu trạm xe bus thuộc vùng chưa được hỗ trợ độ phủ (unsupported/UNKNOWN). Không kết luận là 'không có bus'.",
        rooms: [
          {
            room_id: "P104",
            name: "Phòng Trọ Bình An - P104",
            price_vnd: 3600000,
            distance_to_school_km: 1.2,
            amenities: ["wifi"],
            rating: null,
            bus: { status: "verified", nearest_stop_name: "Trạm KTX Đại học", distance_m: 350, distance_type: "walking", routes: ["10"], source: "fixture-transit" },
            selected: false,
            selection_reason: "Rating chưa được xác minh từ nguồn uy tín.",
            data_source: "fixture",
          },
          {
            room_id: "P105",
            name: "Phòng Trọ Minh Tâm - P105",
            price_vnd: 3400000,
            distance_to_school_km: 1.8,
            amenities: ["wifi", "air_conditioning"],
            rating: { value: 4.5, scale: 5, review_count: 42, entity_type: "property", source: "fixture-ratings" },
            bus: { status: "unknown", nearest_stop_name: null, distance_m: null, distance_type: null, routes: [], source: "fixture-transit" },
            selected: false,
            selection_reason: "Vùng trạm xe bus chưa có dữ liệu độ phủ (unsupported).",
            data_source: "fixture",
          },
        ],
        booking: null,
        warnings: ["Dữ liệu mô phỏng", "Chứa dữ liệu chưa xác minh"],
        llm_mode: "mock",
        data_mode: "fixture",
      },
      error: null,
    },

    GT01: {
      title: "G-T01: Thiếu thông tin đặt lịch (NEEDS_INPUT)",
      userMessage: "Tôi muốn đặt lịch xem phòng P101 vào ngày mai.",
      run_id: "run-gt01-demo",
      session_id: "session-gt01-demo",
      status: "NEEDS_INPUT",
      events: [
        {
          seq: 1,
          step: 1,
          event_type: "RUN_STARTED",
          timestamp: "2026-09-13T10:00:00+07:00",
          payload: { input_sanitized: "Đặt lịch xem P101 vào ngày mai (thiếu giờ cụ thể, thiếu số điện thoại và mã sinh viên)." },
        },
        {
          seq: 2,
          step: 1,
          event_type: "MODEL_DECISION",
          timestamp: "2026-09-13T10:00:01+07:00",
          payload: {
            decision_summary: "Người dùng muốn đặt lịch nhưng chưa cung cấp giờ cụ thể, số điện thoại liên hệ và mã sinh viên.",
            summary_source: "application",
          },
        },
        {
          seq: 3,
          step: 1,
          event_type: "GUARDRAIL_CHECK",
          timestamp: "2026-09-13T10:00:01+07:00",
          payload: {
            rule_id: "G01_INPUT_SCHEMA, G05_TIME",
            verdict: "needs_input",
            reason: "Thời gian 'ngày mai' không có giờ và timezone cụ thể; thiếu số điện thoại và mã sinh viên. Cần yêu cầu bổ sung thông tin.",
          },
        },
        {
          seq: 4,
          step: 1,
          event_type: "FINAL_ANSWER",
          timestamp: "2026-09-13T10:00:02+07:00",
          payload: {
            content: "Để hoàn tất thủ tục đặt lịch hẹn xem phòng P101, bạn vui lòng cung cấp thêm các thông tin sau:\n1. Giờ hẹn cụ thể (Ví dụ: 09:30 hoặc 15:00 ngày 14/09/2026).\n2. Mã sinh viên của bạn (Ví dụ: SV2026001).\n3. Số điện thoại liên hệ để chủ nhà xác nhận.",
            evidence_refs: [],
          },
        },
      ],
      result: {
        answer: "Để hoàn tất thủ tục đặt lịch hẹn xem phòng P101, bạn vui lòng cung cấp thêm các thông tin sau:\n1. Giờ hẹn cụ thể (Ví dụ: 09:30 hoặc 15:00 ngày 14/09/2026).\n2. Mã sinh viên của bạn (Ví dụ: SV2026001).\n3. Số điện thoại liên hệ để chủ nhà xác nhận.",
        rooms: [],
        booking: null,
        warnings: ["Đang chờ thông tin bổ sung"],
        llm_mode: "mock",
        data_mode: "fixture",
      },
      error: null,
    },

    GT02: {
      title: "G-T02: Chặn đặt lịch ngoài quyền (Guardrail G03 Block)",
      userMessage: "Chỉ tìm kiếm phòng trọ dưới 4 triệu cho tôi tham khảo, không đặt lịch.",
      run_id: "run-gt02-demo",
      session_id: "session-gt02-demo",
      status: "BLOCKED",
      events: [
        {
          seq: 1,
          step: 1,
          event_type: "RUN_STARTED",
          timestamp: "2026-09-13T10:00:00+07:00",
          payload: { input_sanitized: "Tìm phòng dưới 4 triệu, không đặt lịch." },
        },
        {
          seq: 2,
          step: 1,
          event_type: "MODEL_DECISION",
          timestamp: "2026-09-13T10:00:01+07:00",
          payload: {
            decision_summary: "Model đề xuất thử đặt phòng P102 khi chưa có sự cho phép của người dùng.",
            summary_source: "application",
          },
        },
        {
          seq: 3,
          step: 1,
          event_type: "TOOL_PROPOSED",
          timestamp: "2026-09-13T10:00:01+07:00",
          payload: {
            tool_name: "book_room_viewing",
            arguments: { room_id: "P102" },
          },
        },
        {
          seq: 4,
          step: 1,
          event_type: "GUARDRAIL_CHECK",
          timestamp: "2026-09-13T10:00:01+07:00",
          payload: {
            rule_id: "G03_BOOKING_AUTH",
            verdict: "block",
            reason: "Chặn hành động đặt lịch: Người dùng chỉ yêu cầu tìm kiếm tham khảo, không cấp quyền thực thi booking.",
          },
        },
        {
          seq: 5,
          step: 1,
          event_type: "FINAL_ANSWER",
          timestamp: "2026-09-13T10:00:02+07:00",
          payload: {
            content: "Hành động đặt phòng bị chặn bởi Guardrail (G03: Thiếu ủy quyền đặt lịch từ người dùng). Hệ thống chuyển sang cung cấp danh sách phòng để bạn tham khảo mà không tạo lịch hẹn.",
            evidence_refs: ["G03_BOOKING_AUTH"],
          },
        },
      ],
      result: {
        answer: "Hành động đặt phòng bị chặn bởi Guardrail (G03: Thiếu ủy quyền đặt lịch từ người dùng). Hệ thống chỉ cung cấp thông tin tham khảo.",
        rooms: [],
        booking: null,
        warnings: ["Hành động bị Guardrail chặn"],
        llm_mode: "mock",
        data_mode: "fixture",
      },
      error: null,
    },

    API_ERR: {
      title: "API-ERR: Mô phỏng lỗi máy chủ (Sanitized Error)",
      userMessage: "Kiểm tra phản hồi khi máy chủ gặp lỗi.",
      run_id: "run-err-demo",
      session_id: "session-err-demo",
      status: "FAILED",
      events: [
        {
          seq: 1,
          step: 1,
          event_type: "RUN_STARTED",
          timestamp: "2026-09-13T10:00:00+07:00",
          payload: { input_sanitized: "Test server error" },
        },
        {
          seq: 2,
          step: 1,
          event_type: "ERROR",
          timestamp: "2026-09-13T10:00:01+07:00",
          payload: {
            code: "SERVER_TIMEOUT",
            stage: "tool_execution",
            message: "Hệ thống backend quá tải hoặc mất kết nối tới dịch vụ mô phỏng.",
          },
        },
      ],
      result: null,
      error: {
        code: "SERVER_TIMEOUT",
        message: "Hệ thống backend quá tải hoặc mất kết nối tới dịch vụ mô phỏng.",
      },
    },
  };

  // ===========================================================================
  // 5. DOM ELEMENTS CACHE
  // ===========================================================================
  const dom = {
    // Header & Badges
    badgeDataMode: document.getElementById("badge-data-mode"),
    badgeLlmMode: document.getElementById("badge-llm-mode"),
    badgeConnMode: document.getElementById("badge-conn-mode"),
    sessionIdDisplay: document.getElementById("session-id-display"),
    btnResetSession: document.getElementById("btn-reset-session"),
    btnThemeToggle: document.getElementById("btn-theme-toggle"),
    btnToggleSidebar: document.getElementById("btn-toggle-sidebar"),
    btnOpenSidebar: document.getElementById("btn-open-sidebar"),
    btnCloseTrace: document.getElementById("btn-close-trace"),
    mainContainer: document.querySelector(".main-container"),

    // Demo Banner
    demoBanner: document.getElementById("demo-banner"),
    demoScenarioSelect: document.getElementById("demo-scenario-select"),
    demoStepByStep: document.getElementById("demo-step-by-step"),
    btnRunDemo: document.getElementById("btn-run-demo"),
    btnExitDemo: document.getElementById("btn-exit-demo"),

    // Mobile Navigation
    mobileTabs: document.getElementById("mobile-tabs"),
    panelChat: document.getElementById("panel-chat"),
    panelTrace: document.getElementById("panel-trace"),
    traceStepCounter: document.getElementById("trace-step-counter"),

    // Left Panel (Chat & Results)
    chatViewport: document.getElementById("chat-viewport"),
    promptChips: document.getElementById("prompt-chips"),
    welcomeCard: document.getElementById("welcome-card"),
    chatMessages: document.getElementById("chat-messages"),
    resultsSection: document.getElementById("results-section"),
    roomCardsContainer: document.getElementById("room-cards-container"),
    roomTableContainer: document.getElementById("room-table-container"),
    btnToggleViewMode: document.getElementById("btn-toggle-view-mode"),
    bookingSection: document.getElementById("booking-section"),
    bookingCard: document.getElementById("booking-card"),

    // Chat Input Form
    chatForm: document.getElementById("chat-form"),
    chatInput: document.getElementById("chat-input"),
    charCount: document.getElementById("char-count"),
    typingIndicator: document.getElementById("typing-indicator"),
    btnClearInput: document.getElementById("btn-clear-input"),
    btnSubmitChat: document.getElementById("btn-submit-chat"),
    submitSpinner: document.getElementById("submit-spinner"),
    needsInputBanner: document.getElementById("needs-input-banner"),
    needsInputMessage: document.getElementById("needs-input-message"),
    postErrorBanner: document.getElementById("post-error-banner"),
    postErrorMessage: document.getElementById("post-error-message"),
    btnDismissPostError: document.getElementById("btn-dismiss-post-error"),

    // Right Panel (Trace Timeline)
    traceViewport: document.getElementById("trace-viewport"),
    traceStatusPill: document.getElementById("trace-status-pill"),
    metaRunId: document.getElementById("meta-run-id"),
    metaStepsCount: document.getElementById("meta-steps-count"),
    metaTotalDuration: document.getElementById("meta-total-duration"),
    traceFilter: document.getElementById("trace-filter"),
    btnExpandAllTrace: document.getElementById("btn-expand-all-trace"),
    btnCollapseAllTrace: document.getElementById("btn-collapse-all-trace"),
    btnClearTrace: document.getElementById("btn-clear-trace"),
    traceEmptyState: document.getElementById("trace-empty-state"),
    traceEventsList: document.getElementById("trace-events-list"),
  };

  // ===========================================================================
  // 6. INITIALIZATION & THEME & SESSION MANAGEMENT
  // ===========================================================================
  function init() {
    initTheme();
    initSidebar();

    // Kiểm tra query parameter ?demo=1
    const urlParams = new URLSearchParams(window.location.search);
    const demoParam = urlParams.get("demo");

    if (demoParam === "1") {
      setDemoMode(true);
    } else {
      setDemoMode(false);
    }

    // Session đầu tiên phải là null để backend tạo ID thật theo API contract.
    state.sessionId = null;
    updateSessionUI();

    // Đăng ký các sự kiện DOM
    attachEventListeners();

    // Cập nhật trạng thái kết nối
    updateConnectionModeBadge();
  }

  function initTheme() {
    const savedTheme = localStorage.getItem("theme");
    const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (savedTheme === "dark" || (!savedTheme && systemPrefersDark)) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }

  function toggleTheme() {
    const isDark = document.documentElement.classList.toggle("dark");
    localStorage.setItem("theme", isDark ? "dark" : "light");
    showToast(`Đã chuyển sang giao diện ${isDark ? "Tối" : "Sáng"}`, "info", 2000);
  }

  function initSidebar() {
    try {
      const saved = localStorage.getItem("housing_sidebar_collapsed");
      if (saved === "1") {
        setSidebarCollapsed(true, false);
      }
    } catch (e) {}
  }

  function setSidebarCollapsed(collapsed, notify = true) {
    state.sidebarCollapsed = collapsed;
    if (dom.mainContainer) {
      dom.mainContainer.classList.toggle("sidebar-collapsed", collapsed);
    }
    if (dom.btnToggleSidebar) {
      dom.btnToggleSidebar.classList.toggle("active", !collapsed);
      dom.btnToggleSidebar.setAttribute("aria-expanded", String(!collapsed));
      dom.btnToggleSidebar.title = collapsed ? "Mở Timeline Trace (Ctrl+B)" : "Thu gọn Timeline Trace (Ctrl+B)";
    }
    try {
      localStorage.setItem("housing_sidebar_collapsed", collapsed ? "1" : "0");
    } catch (e) {}

    if (notify) {
      showToast(collapsed ? "Đã thu gọn Timeline Trace (Ctrl+B để mở)" : "Đã hiển thị Timeline Trace", "info", 1800);
    }
  }

  function toggleSidebar() {
    setSidebarCollapsed(!state.sidebarCollapsed, true);
  }

  function setDemoMode(isDemo) {
    state.isDemoMode = isDemo;
    if (dom.demoBanner) {
      dom.demoBanner.hidden = !isDemo;
    }
    updateLlmModeBadge(isDemo ? "mock" : null);
    updateConnectionModeBadge();
  }

  function updateLlmModeBadge(mode = null) {
    if (!dom.badgeLlmMode) return;
    const label = mode === "openai" ? "OpenAI" : mode === "mock" ? "Mock" : "Chưa xác định";
    dom.badgeLlmMode.replaceChildren(
      el("span", { className: "status-dot dot-gray" }),
      el("span", {}, `LLM: ${label}`)
    );
  }

  function updateConnectionModeBadge() {
    if (!dom.badgeConnMode) return;
    if (state.isDemoMode) {
      dom.badgeConnMode.className = "badge badge-purple";
      dom.badgeConnMode.replaceChildren(
        el("span", { className: "status-dot dot-purple", style: { backgroundColor: "var(--purple)" } }),
        el("span", {}, "⚡ Demo Fixture")
      );
      dom.badgeConnMode.title = "Chế độ Demo độc lập với fixture mẫu";
    } else {
      dom.badgeConnMode.className = "badge badge-info";
      dom.badgeConnMode.replaceChildren(
        el("span", { className: "status-dot dot-blue" }),
        el("span", {}, "🌐 Live API")
      );
      dom.badgeConnMode.title = "Kết nối trực tiếp tới Backend /api/runs";
    }
  }

  function updateSessionUI() {
    if (dom.sessionIdDisplay) {
      dom.sessionIdDisplay.textContent = state.sessionId || "Chưa có";
    }
  }

  function resetSession() {
    stopPolling();
    state.sessionId = null;
    state.currentRunId = null;
    state.runStatus = "IDLE";
    state.lastSeq = 0;
    state.events = [];
    state.currentRooms = [];
    state.currentBooking = null;

    updateSessionUI();
    updateLlmModeBadge(state.isDemoMode ? "mock" : null);
    clearChatUI();
    clearTraceUI();
    hideNeedsInputBanner();
    hidePostError();
    updateRunStatus("IDLE");

    showToast("Đã khởi tạo phiên làm việc mới!", "info");
  }

  // ===========================================================================
  // 7. EVENT LISTENERS
  // ===========================================================================
  function attachEventListeners() {
    // Theme toggle button
    if (dom.btnThemeToggle) {
      dom.btnThemeToggle.addEventListener("click", toggleTheme);
    }

    // Sidebar toggle buttons
    if (dom.btnToggleSidebar) {
      dom.btnToggleSidebar.addEventListener("click", toggleSidebar);
    }
    if (dom.btnOpenSidebar) {
      dom.btnOpenSidebar.addEventListener("click", () => setSidebarCollapsed(false, true));
    }
    if (dom.btnCloseTrace) {
      dom.btnCloseTrace.addEventListener("click", () => setSidebarCollapsed(true, true));
    }

    // Shortcut Ctrl+B / Cmd+B to Toggle Sidebar
    window.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleSidebar();
      }
    });

    // Reset Session button
    if (dom.btnResetSession) {
      dom.btnResetSession.addEventListener("click", resetSession);
    }

    // Demo Mode controls
    if (dom.btnRunDemo) {
      dom.btnRunDemo.addEventListener("click", () => {
        const scenarioKey = dom.demoScenarioSelect.value;
        runDemoScenario(scenarioKey);
      });
    }

    if (dom.btnExitDemo) {
      dom.btnExitDemo.addEventListener("click", () => {
        const url = new URL(window.location.href);
        url.searchParams.delete("demo");
        window.history.replaceState({}, "", url.toString());
        setDemoMode(false);
        showToast("Đã chuyển sang chế độ Live Backend", "info");
      });
    }

    // Quick Prompt Chips
    if (dom.promptChips) {
      dom.promptChips.addEventListener("click", (e) => {
        const chip = e.target.closest(".chip");
        if (!chip) return;
        const query = chip.dataset.query;
        if (query && dom.chatInput) {
          dom.chatInput.value = query;
          dom.chatInput.focus();
          updateCharCount();
          autoResizeInput();
        }
      });
    }

    // Chat Form Submit
    if (dom.chatForm) {
      dom.chatForm.addEventListener("submit", (e) => {
        e.preventDefault();
        handleChatSubmit();
      });
    }

    // Textarea input char counter & auto resize
    if (dom.chatInput) {
      dom.chatInput.addEventListener("input", () => {
        updateCharCount();
        autoResizeInput();
      });
      dom.chatInput.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
          e.preventDefault();
          handleChatSubmit();
        }
      });
    }

    // Clear input button
    if (dom.btnClearInput) {
      dom.btnClearInput.addEventListener("click", () => {
        if (dom.chatInput) {
          dom.chatInput.value = "";
          dom.chatInput.focus();
          updateCharCount();
          autoResizeInput();
        }
      });
    }

    // Dismiss POST error banner
    if (dom.btnDismissPostError) {
      dom.btnDismissPostError.addEventListener("click", hidePostError);
    }

    // View mode toggle (Cards vs Table)
    if (dom.btnToggleViewMode) {
      dom.btnToggleViewMode.addEventListener("click", () => {
        if (state.viewMode === "cards") {
          state.viewMode = "table";
          dom.btnToggleViewMode.replaceChildren(
            svgIcon("tool", "icon-xs"),
            el("span", {}, "Xem dạng thẻ")
          );
          if (dom.roomCardsContainer) dom.roomCardsContainer.hidden = true;
          if (dom.roomTableContainer) dom.roomTableContainer.hidden = false;
        } else {
          state.viewMode = "cards";
          dom.btnToggleViewMode.replaceChildren(
            svgIcon("calendar", "icon-xs"),
            el("span", {}, "Xem dạng bảng")
          );
          if (dom.roomCardsContainer) dom.roomCardsContainer.hidden = false;
          if (dom.roomTableContainer) dom.roomTableContainer.hidden = true;
        }
      });
    }

    // Trace Controls
    if (dom.btnExpandAllTrace) {
      dom.btnExpandAllTrace.addEventListener("click", expandAllTraceEvents);
    }

    if (dom.btnCollapseAllTrace) {
      dom.btnCollapseAllTrace.addEventListener("click", collapseAllTraceEvents);
    }

    if (dom.btnClearTrace) {
      dom.btnClearTrace.addEventListener("click", clearTraceUI);
    }

    if (dom.traceFilter) {
      dom.traceFilter.addEventListener("change", (e) => {
        state.activeFilter = e.target.value;
        filterTraceEvents();
      });
    }

    // Mobile Tabs Switcher
    if (dom.mobileTabs) {
      dom.mobileTabs.addEventListener("click", (e) => {
        const tabBtn = e.target.closest(".mobile-tab");
        if (!tabBtn) return;
        const targetId = tabBtn.dataset.target;

        document.querySelectorAll(".mobile-tab").forEach((btn) => btn.classList.remove("active"));
        tabBtn.classList.add("active");

        if (dom.panelChat && dom.panelTrace) {
          dom.panelChat.classList.toggle("active", targetId === "panel-chat");
          dom.panelTrace.classList.toggle("active", targetId === "panel-trace");
        }
      });
    }
  }

  function autoResizeInput() {
    if (!dom.chatInput) return;
    dom.chatInput.style.height = "38px";
    if (dom.chatInput.value.length > 0) {
      dom.chatInput.style.height = Math.min(dom.chatInput.scrollHeight, 110) + "px";
    }
  }

  function updateCharCount() {
    if (!dom.chatInput || !dom.charCount) return;
    const len = dom.chatInput.value.length;
    dom.charCount.textContent = `${len} / 8000`;
  }

  // ===========================================================================
  // 8. CHAT & RUN EXECUTION LOGIC
  // ===========================================================================
  async function handleChatSubmit() {
    if (!dom.chatInput) return;
    const message = dom.chatInput.value.trim();

    if (!message) {
      showToast("Vui lòng nhập nội dung yêu cầu tìm phòng!", "warning");
      return;
    }

    if (message.length > 8000) {
      showToast("Nội dung vượt quá giới hạn 8000 ký tự!", "warning");
      return;
    }

    if (state.runStatus === "RUNNING") {
      showToast("Đang có một yêu cầu đang được xử lý, vui lòng chờ...", "warning");
      return;
    }

    if (dom.welcomeCard) dom.welcomeCard.hidden = true;
    hidePostError();
    hideNeedsInputBanner();

    appendMessageUI("user", message);
    dom.chatInput.value = "";
    updateCharCount();
    autoResizeInput();

    if (state.isDemoMode) {
      runDemoForCustomMessage(message);
      return;
    }

    await dispatchRunApi(message);
  }

  async function dispatchRunApi(message) {
    setLoadingState(true);
    updateRunStatus("RUNNING");
    clearResultsUI();

    const payload = {
      message: message,
      session_id: state.sessionId || null,
    };

    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.status === 202) {
        const data = await res.json();
        state.currentRunId = data.run_id;
        state.sessionId = data.session_id;
        state.lastSeq = 0;
        state.events = [];
        updateSessionUI();
        updateMetaRunInfo(data.run_id);

        showToast("Đã khởi tạo tác vụ ReAct!", "info");
        startPolling(data.run_id);
      } else {
        let errData = null;
        try {
          errData = await res.json();
        } catch {
          // Non-JSON error
        }

        const errorCode = errData?.error?.code;
        if (errorCode === "SESSION_NOT_FOUND") {
          // Không tự retry POST; xóa session cũ để lần gửi thủ công kế tiếp tạo session mới.
          state.sessionId = null;
          updateSessionUI();
        }
        const errMsg = errData?.error?.message || `Lỗi máy chủ (HTTP ${res.status})`;
        showPostError(`Không thể gửi yêu cầu: ${errMsg}. Vui lòng kiểm tra và gửi lại.`);
        updateRunStatus("FAILED");
        setLoadingState(false);
      }
    } catch (err) {
      console.error("POST /api/runs network error:", err);
      showPostError("Lỗi kết nối mạng: Yêu cầu chưa được xác nhận máy chủ đã nhận hay chưa. Không tự gửi lại để tránh trùng lịch. Vui lòng bấm kiểm tra hoặc gửi lại bằng tay.");
      updateRunStatus("FAILED");
      setLoadingState(false);
    }
  }

  // ===========================================================================
  // 9. POLLING ENGINE (GET /api/runs/{run_id}?after_seq=...)
  // ===========================================================================
  function startPolling(runId) {
    stopPolling();
    state.pollingFailures = 0;

    async function poll() {
      if (state.runStatus !== "RUNNING") return;

      try {
        const res = await fetch(`/api/runs/${encodeURIComponent(runId)}?after_seq=${state.lastSeq}`);

        if (!res.ok) {
          state.pollingFailures++;
          if (state.pollingFailures >= 3) {
            showToast("Mất kết nối tạm thời tới máy chủ khi lấy dữ liệu trace...", "warning");
          }
          scheduleNextPoll(runId, 1500);
          return;
        }

        state.pollingFailures = 0;
        const snapshot = await res.json();

        if (typeof snapshot.last_seq === "number") {
          state.lastSeq = snapshot.last_seq;
        }

        if (Array.isArray(snapshot.events) && snapshot.events.length > 0) {
          for (const ev of snapshot.events) {
            if (!state.events.some((e) => e.seq === ev.seq)) {
              state.events.push(ev);
              renderTraceEvent(ev);
            }
          }
          updateTraceMetaBar();
        }

        const status = snapshot.status;
        updateRunStatus(status);

        const terminalStates = ["COMPLETED", "NEEDS_INPUT", "BLOCKED", "FAILED", "LIMIT_REACHED", "ACTION_STATUS_UNKNOWN"];

        if (terminalStates.includes(status)) {
          stopPolling();
          setLoadingState(false);
          handleRunCompleted(snapshot);
        } else {
          scheduleNextPoll(runId, 1000);
        }
      } catch (err) {
        state.pollingFailures++;
        console.warn("Polling error:", err);
        if (state.pollingFailures >= 3) {
          showToast("Không thể kết nối máy chủ để cập nhật sự kiện...", "warning");
        }
        scheduleNextPoll(runId, 1500);
      }
    }

    poll();
  }

  function scheduleNextPoll(runId, delayMs) {
    if (state.runStatus === "RUNNING") {
      state.pollingTimer = setTimeout(() => {
        startPolling(runId);
      }, delayMs);
    }
  }

  function stopPolling() {
    if (state.pollingTimer) {
      clearTimeout(state.pollingTimer);
      state.pollingTimer = null;
    }
  }

  function handleRunCompleted(snapshot) {
    if (snapshot.result) {
      const res = snapshot.result;

      if (res.llm_mode) updateLlmModeBadge(res.llm_mode);
      if (res.data_mode && dom.badgeDataMode) {
        dom.badgeDataMode.replaceChildren(
          el("span", { className: "status-dot dot-sky" }),
          el("span", {}, `Nguồn: ${res.data_mode}`)
        );
      }

      if (res.answer) {
        appendMessageUI("assistant", res.answer);
      }

      if (Array.isArray(res.rooms)) {
        state.currentRooms = res.rooms;
        renderRoomCards(res.rooms);
      }

      if (res.booking && res.booking.status === "CONFIRMED") {
        state.currentBooking = res.booking;
        renderBookingCard(res.booking);
      } else {
        hideBookingCard();
      }
    }

    if (snapshot.status === "NEEDS_INPUT") {
      const msg = snapshot.result?.answer || "Hệ thống cần bạn cung cấp thêm thông tin để tiếp tục xử lý.";
      showNeedsInputBanner(msg);
      showToast("Cần bổ sung thông tin cho phiên này!", "warning");
    } else if (snapshot.status === "BLOCKED") {
      showToast("Yêu cầu bị chặn bởi Guardrail!", "warning");
    } else if (snapshot.status === "FAILED") {
      const errDetail = snapshot.error?.message || "Đã xảy ra lỗi trong quá trình thực thi.";
      showToast(`Tác vụ thất bại: ${errDetail}`, "error");
    } else if (snapshot.status === "COMPLETED") {
      showToast("Đã hoàn tất xử lý yêu cầu!", "success");
    }
  }

  // ===========================================================================
  // 10. DEMO MODE EXECUTION ENGINE
  // ===========================================================================
  function runDemoScenario(scenarioKey) {
    const fixture = DEMO_FIXTURES[scenarioKey];
    if (!fixture) {
      showToast("Không tìm thấy kịch bản demo!", "error");
      return;
    }

    stopPolling();
    clearChatUI();
    clearTraceUI();
    clearResultsUI();
    hideNeedsInputBanner();
    hidePostError();

    state.sessionId = fixture.session_id;
    state.currentRunId = fixture.run_id;
    state.lastSeq = 0;
    state.events = [];
    updateSessionUI();
    updateMetaRunInfo(fixture.run_id);

    if (dom.welcomeCard) dom.welcomeCard.hidden = true;

    appendMessageUI("user", fixture.userMessage);

    const isStepByStep = dom.demoStepByStep ? dom.demoStepByStep.checked : true;

    if (!isStepByStep) {
      for (const ev of fixture.events) {
        state.events.push(ev);
        renderTraceEvent(ev);
      }
      updateTraceMetaBar();
      updateRunStatus(fixture.status);
      handleRunCompleted(fixture);
      setLoadingState(false);
    } else {
      setLoadingState(true);
      updateRunStatus("RUNNING");

      let idx = 0;
      function playNextEvent() {
        if (idx < fixture.events.length) {
          const ev = fixture.events[idx];
          state.events.push(ev);
          state.lastSeq = ev.seq;
          renderTraceEvent(ev);
          updateTraceMetaBar();
          idx++;
          setTimeout(playNextEvent, 700);
        } else {
          updateRunStatus(fixture.status);
          handleRunCompleted(fixture);
          setLoadingState(false);
        }
      }
      playNextEvent();
    }
  }

  function runDemoForCustomMessage(customMessage) {
    const msg = customMessage.toLowerCase();
    if (msg.includes("500") || msg.includes("100m") || msg.includes("100 m")) {
      runDemoScenario("TC05");
    } else if (msg.includes("đặt lịch") && (msg.includes("điều hòa") || msg.includes("máy lạnh") || msg.includes("bus"))) {
      runDemoScenario("TC04");
    } else if (msg.includes("ngày mai") || msg.includes("thiếu")) {
      runDemoScenario("GT01");
    } else if (msg.includes("không đặt") || msg.includes("chỉ tìm")) {
      runDemoScenario("GT02");
    } else {
      runDemoScenario("TC02");
    }
  }

  // ===========================================================================
  // 11. UI RENDERING FUNCTIONS (Sử dụng Safe DOM Helper `el`, Tuyệt đối Không innerHTML)
  // ===========================================================================

  // Render Tin nhắn Hội thoại
  function appendMessageUI(sender, text) {
    if (!dom.chatMessages) return;

    const isUser = sender === "user";
    const titleText = isUser ? "Bạn" : "Student Housing Agent";
    const roleIcon = isUser ? svgIcon("user", "icon-xs") : svgIcon("bot", "icon-xs text-primary");

    const msgElement = el(
      "div",
      { className: `msg-wrapper msg-${sender}` },
      el(
        "div",
        { className: "msg-header" },
        roleIcon,
        el("strong", {}, titleText),
        el("span", {}, formatTime(new Date().toISOString()))
      ),
      el("div", { className: "msg-body" }, maskPii(text))
    );

    dom.chatMessages.appendChild(msgElement);
    if (dom.chatViewport) {
      dom.chatViewport.scrollTop = dom.chatViewport.scrollHeight;
    }
  }

  // Render Danh sách Thẻ Phòng Trọ (Room Cards & Comparison Table)
  function renderRoomCards(rooms) {
    if (!dom.resultsSection || !dom.roomCardsContainer || !dom.roomTableContainer) return;

    dom.roomCardsContainer.replaceChildren();
    dom.roomTableContainer.replaceChildren();

    if (!rooms || rooms.length === 0) {
      dom.resultsSection.hidden = false;
      const emptyBox = el(
        "div",
        { className: "welcome-card", style: { padding: "1.75rem", marginTop: "0" } },
        el("div", { className: "welcome-badge", style: { background: "var(--warning-subtle)", color: "var(--warning)", borderColor: "var(--warning-border)" } },
          svgIcon("alert-triangle", "icon-xs"),
          el("span", {}, "KHÔNG TÌM THẤY PHÒNG PHÙ HỢP")
        ),
        el("h4", { style: { fontSize: "1rem", fontWeight: "700", color: "var(--text-main)" } }, "Dữ liệu bộ lọc hiện tại rỗng"),
        el("p", { style: { fontSize: "0.8rem", color: "var(--text-muted)", margin: "0.35rem 0 0" } }, "Không có phòng nào thỏa mãn mức giá hoặc khoảng cách này. Hãy thử nâng mức ngân sách hoặc mở rộng bán kính.")
      );
      dom.roomCardsContainer.appendChild(emptyBox);
      return;
    }

    dom.resultsSection.hidden = false;

    // 1. Render Cards View
    for (const room of rooms) {
      const isSelected = Boolean(room.selected);

      // Amenities Tags
      const amenityElements = Array.isArray(room.amenities)
        ? room.amenities.map((a) => {
            const labels = {
              air_conditioning: "Điều hòa",
              wifi: "Wifi tốc độ cao",
              private_bathroom: "WC riêng",
              kitchen: "Bếp nấu",
              fan: "Quạt điện",
            };
            return el("span", { className: "amenity-tag" }, labels[a] || a);
          })
        : [];

      // Rating representation
      let ratingNode;
      if (room.rating && typeof room.rating.value === "number") {
        ratingNode = el(
          "span",
          { className: "badge badge-warning" },
          svgIcon("star", "icon-xs"),
          el("span", {}, `${room.rating.value}/${room.rating.scale || 5} (${room.rating.review_count || 0} đánh giá)`)
        );
      } else {
        ratingNode = el(
          "span",
          { className: "badge badge-neutral", title: "Chưa có dữ liệu đánh giá xác minh" },
          svgIcon("info", "icon-xs"),
          el("span", {}, "Chưa có đánh giá / Chưa xác minh")
        );
      }

      // Bus representation
      let busNode;
      const bus = room.bus || {};
      if (bus.status === "verified") {
        const distType = bus.distance_type === "walking" ? "đi bộ" : "chim bay";
        const routesText = Array.isArray(bus.routes) && bus.routes.length > 0 ? bus.routes.join(", ") : "Chưa rõ";
        busNode = el(
          "div",
          { className: "detail-val" },
          el("div", { style: { fontWeight: "700", color: "var(--success)", display: "flex", alignItems: "center", gap: "0.3rem" } },
            svgIcon("bus", "icon-xs"),
            el("span", {}, bus.nearest_stop_name || "Trạm bus gần nhất")
          ),
          el("div", { style: { fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.15rem" } },
            `Cách ${bus.distance_m || 0} m (${distType}) | Tuyến: ${routesText}`
          )
        );
      } else if (bus.status === "none") {
        busNode = el(
          "div",
          { className: "detail-val", style: { color: "var(--warning)" } },
          "Không có trạm trong bán kính khảo sát"
        );
      } else {
        busNode = el(
          "div",
          { className: "detail-val", style: { color: "var(--text-muted)" } },
          "Chưa xác minh / Vùng chưa hỗ trợ độ phủ"
        );
      }

      // Selection reason banner
      let reasonBox = null;
      if (room.selection_reason) {
        reasonBox = el(
          "div",
          { className: "selection-reason-box" },
          svgIcon("check-circle", "icon-sm text-success"),
          el("div", {},
            el("strong", {}, "Lý do chọn: "),
            room.selection_reason
          )
        );
      }

      const card = el(
        "div",
        { className: `room-card ${isSelected ? "is-selected" : ""}` },
        el("div", { className: "card-banner-strip" }),
        el(
          "div",
          { className: "card-inner" },
          el(
            "div",
            { className: "card-top" },
            el(
              "div",
              { className: "card-id-name" },
              el("span", { className: "room-code-tag" }, `MÃ: ${room.room_id}`),
              el("h4", { className: "room-name" }, room.name || `Phòng ${room.room_id}`)
            ),
            isSelected
              ? el("span", { className: "badge badge-success" }, svgIcon("star", "icon-xs"), el("span", {}, "Được chọn tối ưu"))
              : null
          ),
          el(
            "div",
            { className: "card-price-dist" },
            el("span", { className: "room-price" }, formatVnd(room.price_vnd)),
            el("span", { className: "room-distance" },
              svgIcon("pin", "icon-xs text-primary"),
              el("span", {}, `Cách trường: ${formatKm(room.distance_to_school_km)}`)
            )
          ),
          el(
            "div",
            { className: "card-details-grid" },
            el("div", { className: "detail-row" }, el("span", { className: "detail-lbl" }, "Đánh giá:"), ratingNode),
            el("div", { className: "detail-row" }, el("span", { className: "detail-lbl" }, "Xe bus:"), busNode),
            el("div", { className: "detail-row" }, el("span", { className: "detail-lbl" }, "Tiện ích:"), el("div", { className: "amenities-tags" }, amenityElements))
          ),
          reasonBox,
          el(
            "div",
            { className: "card-footer" },
            el("span", { className: "badge badge-simulated" },
              el("span", { className: "status-dot dot-sky" }),
              el("span", {}, "Dữ liệu mô phỏng")
            ),
            el("span", { style: { color: "var(--text-subtle)" } }, `Nguồn: ${room.data_source || "fixture"}`)
          )
        )
      );

      dom.roomCardsContainer.appendChild(card);
    }

    // 2. Render Table View (Bảng So Sánh)
    const table = el(
      "table",
      { className: "room-table" },
      el(
        "thead",
        {},
        el(
          "tr",
          {},
          el("th", {}, "Mã phòng"),
          el("th", {}, "Tên phòng"),
          el("th", {}, "Giá thuê"),
          el("th", {}, "Khoảng cách"),
          el("th", {}, "Rating"),
          el("th", {}, "Trạm Bus & Tuyến"),
          el("th", {}, "Được chọn / Đánh giá")
        )
      ),
      el(
        "tbody",
        {},
        rooms.map((r) => {
          const ratingText = r.rating && typeof r.rating.value === "number"
            ? `${r.rating.value}/${r.rating.scale} (${r.rating.review_count} lượt)`
            : "Chưa có đánh giá";

          let busText = "Chưa xác minh";
          if (r.bus?.status === "verified") {
            busText = `${r.bus.nearest_stop_name || "Trạm"} (${r.bus.distance_m}m, tuyến: ${r.bus.routes?.join(",")})`;
          } else if (r.bus?.status === "none") {
            busText = "Không có trạm";
          }

          return el(
            "tr",
            { className: r.selected ? "selected-row" : "" },
            el("td", { style: { fontFamily: "var(--font-mono)", fontWeight: "700", color: "var(--primary-brand)" } }, r.room_id),
            el("td", { style: { fontWeight: "600" } }, r.name || "--"),
            el("td", { style: { color: "#b91c1c", fontWeight: "700" } }, formatVnd(r.price_vnd)),
            el("td", {}, formatKm(r.distance_to_school_km)),
            el("td", {}, ratingText),
            el("td", {}, busText),
            el("td", {}, r.selected ? `✅ ${r.selection_reason || "Phù hợp nhất"}` : (r.selection_reason || "--"))
          );
        })
      )
    );

    dom.roomTableContainer.appendChild(table);
  }

  // Render Thẻ Xác Nhận Đặt Lịch (Chỉ khi status === 'CONFIRMED')
  function renderBookingCard(booking) {
    if (!dom.bookingSection || !dom.bookingCard) return;

    dom.bookingCard.replaceChildren();

    if (!booking || booking.status !== "CONFIRMED") {
      dom.bookingSection.hidden = true;
      return;
    }

    dom.bookingSection.hidden = false;

    const cardContent = el(
      "div",
      {},
      el(
        "div",
        { className: "booking-header" },
        el(
          "div",
          { className: "booking-title" },
          svgIcon("shield-check", "icon-md text-success"),
          el("span", {}, "XÁC NHẬN ĐẶT LỊCH XEM PHÒNG THÀNH CÔNG")
        ),
        el("span", { className: "badge badge-success" },
          svgIcon("check", "icon-xs"),
          el("span", {}, "CONFIRMED")
        )
      ),
      el(
        "div",
        { className: "booking-grid" },
        el(
          "div",
          { className: "booking-item" },
          el("span", { className: "booking-lbl" }, "Mã lịch hẹn:"),
          el("span", { className: "booking-val", style: { fontFamily: "var(--font-mono)", color: "var(--primary-brand)" } }, booking.booking_id)
        ),
        el(
          "div",
          { className: "booking-item" },
          el("span", { className: "booking-lbl" }, "Phòng đăng ký:"),
          el("span", { className: "booking-val" }, booking.room_id)
        ),
        el(
          "div",
          { className: "booking-item" },
          el("span", { className: "booking-lbl" }, "Thời gian xem phòng:"),
          el("span", { className: "booking-val" }, formatTime(booking.viewing_time))
        ),
        el(
          "div",
          { className: "booking-item" },
          el("span", { className: "booking-lbl" }, "Kênh xác thực:"),
          el("span", { className: "booking-val" }, "Phiên làm việc ReAct an toàn")
        )
      ),
      el(
        "div",
        { className: "booking-footer-note" },
        el("span", { className: "badge badge-simulated" },
          el("span", { className: "status-dot dot-sky" }),
          el("span", {}, "Dữ liệu mô phỏng")
        ),
        el("span", {}, "Lưu ý: Lịch hẹn được tạo trong phiên mô phỏng ReAct, không gửi thông báo thực tế tới chủ nhà.")
      )
    );

    dom.bookingCard.appendChild(cardContent);
  }

  function hideBookingCard() {
    if (dom.bookingSection) dom.bookingSection.hidden = true;
  }

  // ===========================================================================
  // 12. TIMELINE TRACE RENDERING
  // ===========================================================================
  function renderTraceEvent(ev) {
    if (!dom.traceEventsList || !dom.traceEmptyState) return;
    dom.traceEmptyState.hidden = true;

    let typeClass = "type-default";
    let typeLabel = ev.event_type;
    let badgeClass = "badge-neutral";
    let eventIcon = "info";

    switch (ev.event_type) {
      case "MODEL_DECISION":
        typeClass = "type-decision";
        typeLabel = "Tóm tắt quyết định";
        badgeClass = "badge-info";
        eventIcon = "bot";
        break;
      case "TOOL_PROPOSED":
      case "TOOL_STARTED":
      case "TOOL_RESULT":
        typeClass = "type-tool";
        typeLabel = ev.event_type === "TOOL_PROPOSED" ? "Đề xuất Tool" : (ev.event_type === "TOOL_STARTED" ? "Bắt đầu Tool" : "Kết quả Tool");
        badgeClass = "badge-purple";
        eventIcon = "tool";
        break;
      case "GUARDRAIL_CHECK":
        const verdict = ev.payload?.verdict;
        typeClass = verdict === "block" ? "type-guardrail-block" : "type-guardrail";
        typeLabel = `Guardrail [${verdict ? verdict.toUpperCase() : "CHECK"}]`;
        badgeClass = verdict === "allow" ? "badge-success" : (verdict === "block" ? "badge-danger" : "badge-purple");
        eventIcon = "shield-check";
        break;
      case "FINAL_ANSWER":
        typeClass = "type-final";
        typeLabel = "Câu trả lời cuối (Final)";
        badgeClass = "badge-success";
        eventIcon = "check-circle";
        break;
      case "ERROR":
        typeClass = "type-guardrail-block";
        typeLabel = "Lỗi (Error)";
        badgeClass = "badge-danger";
        eventIcon = "alert-triangle";
        break;
      case "RUN_STARTED":
        typeLabel = "Khởi động Run";
        badgeClass = "badge-neutral";
        eventIcon = "info";
        break;
      case "RUN_FINISHED":
        typeLabel = "Kết thúc Run";
        badgeClass = "badge-neutral";
        eventIcon = "check";
        break;
    }

    const headerNode = el(
      "div",
      {
        className: "event-header",
        dataset: { eventType: ev.event_type },
        onClick: (e) => {
          const body = e.currentTarget.nextElementSibling;
          if (body) {
            const isHidden = body.classList.toggle("is-hidden");
            e.currentTarget.classList.toggle("collapsed", isHidden);
          }
        },
      },
      el(
        "div",
        { className: "event-title-group" },
        el("span", { className: "event-seq-badge" }, `#${ev.seq}`),
        el("span", { className: `badge ${badgeClass}` },
          svgIcon(eventIcon, "icon-xs"),
          el("span", {}, typeLabel)
        ),
        ev.call_id ? el("code", { style: { fontSize: "0.7rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" } }, ev.call_id) : null
      ),
      el(
        "div",
        { className: "event-meta-right" },
        ev.duration_ms ? el("span", { className: "event-duration" }, `${ev.duration_ms} ms`) : null,
        el("span", { className: "chevron-icon" }, "▼")
      )
    );

    const bodyChildren = [];
    const payload = ev.payload || {};

    if (ev.event_type === "MODEL_DECISION") {
      bodyChildren.push(
        el(
          "div",
          { className: "summary-callout" },
          el("strong", {}, "Tóm tắt quyết định: "),
          payload.decision_summary || "Không có tóm tắt.",
          el("span", { className: "summary-meta" }, `Nguồn tóm tắt: ${payload.summary_source || "application"}`)
        )
      );

      const context = payload.model_context;
      if (context) {
        const modelMessages = Array.isArray(context.messages) ? context.messages : [];
        const toolSchemas = Array.isArray(context.tool_schemas) ? context.tool_schemas : [];
        bodyChildren.push(
          el(
            "div",
            { className: "model-context-panel" },
            el("div", { className: "model-context-title" }, "Ngữ cảnh model đã nhận (đã che PII)"),
            el(
              "details",
              { className: "context-details", open: true },
              el("summary", {}, `Lịch sử messages (${modelMessages.length})`),
              el("div", { className: "code-block-wrapper" }, el("pre", {}, maskPii(JSON.stringify(modelMessages, null, 2))))
            ),
            el(
              "details",
              { className: "context-details" },
              el("summary", {}, "System instruction"),
              el("div", { className: "code-block-wrapper" }, el("pre", {}, maskPii(context.system_instruction || "")))
            ),
            el(
              "details",
              { className: "context-details" },
              el("summary", {}, `Tool schemas (${toolSchemas.length})`),
              el("div", { className: "code-block-wrapper" }, el("pre", {}, maskPii(JSON.stringify(toolSchemas, null, 2))))
            ),
            context.application_guard_context
              ? el(
                  "details",
                  { className: "context-details" },
                  el("summary", {}, "Tiêu chí guardrail của ứng dụng"),
                  el("div", { className: "context-note" }, "Phần này hỗ trợ kiểm chứng quyết định, không phải chain-of-thought của model."),
                  el("div", { className: "code-block-wrapper" }, el("pre", {}, maskPii(JSON.stringify(context.application_guard_context, null, 2))))
                )
              : null
          )
        );
      }
    }

    if (ev.event_type === "GUARDRAIL_CHECK") {
      const v = payload.verdict || "unknown";
      bodyChildren.push(
        el(
          "div",
          { className: `guardrail-callout guardrail-${v}` },
          el("div", { style: { fontWeight: "700", display: "flex", alignItems: "center", gap: "0.3rem" } },
            svgIcon("shield-check", "icon-xs"),
            el("span", {}, `Quy tắc: ${payload.rule_id || "N/A"} → Kết luận: ${v.toUpperCase()}`)
          ),
          el("div", {}, `Lý do: ${payload.reason || "Không có giải thích."}`)
        )
      );
    }

    if (ev.event_type === "TOOL_PROPOSED") {
      bodyChildren.push(
        el("div", { style: { fontWeight: "700", color: "var(--purple)", display: "flex", alignItems: "center", gap: "0.3rem" } },
          svgIcon("tool", "icon-xs"),
          el("span", {}, `Công cụ đề xuất: ${payload.tool || payload.tool_name || "Không xác định"}`)
        ),
        el(
          "div",
          { className: "code-block-wrapper" },
          el("pre", {}, maskPii(JSON.stringify(payload.arguments || {}, null, 2)))
        )
      );
    }

    if (ev.event_type === "TOOL_RESULT") {
      bodyChildren.push(
        el("div", { style: { fontWeight: "700", color: payload.status === "SUCCESS" ? "var(--success)" : "var(--danger)" } }, `Trạng thái: ${payload.status || "UNKNOWN"}`),
        el(
          "div",
          { className: "code-block-wrapper" },
          el("pre", {}, maskPii(JSON.stringify(payload.observation || {}, null, 2)))
        )
      );
    }

    if (ev.event_type === "FINAL_ANSWER") {
      bodyChildren.push(
        el("div", { style: { background: "var(--success-subtle)", padding: "0.65rem 0.85rem", borderRadius: "6px", borderLeft: "3px solid var(--success)", color: "var(--text-main)", lineHeight: "1.55" } }, maskPii(payload.content || "")),
        Array.isArray(payload.evidence_refs) && payload.evidence_refs.length > 0
          ? el(
              "div",
              { className: "evidence-list" },
              el("strong", {}, "Bằng chứng tham chiếu (Evidence refs):"),
              payload.evidence_refs.map((ref) => el("span", { className: "evidence-item" }, `• ${ref}`))
            )
          : null
      );
    }

    if (!["MODEL_DECISION", "GUARDRAIL_CHECK", "TOOL_PROPOSED", "TOOL_RESULT", "FINAL_ANSWER"].includes(ev.event_type)) {
      bodyChildren.push(
        el(
          "div",
          { className: "code-block-wrapper" },
          el("pre", {}, maskPii(JSON.stringify(payload, null, 2)))
        )
      );
    }

    const bodyNode = el(
      "div",
      { className: "event-body" },
      ...bodyChildren
    );

    const liElement = el(
      "li",
      {
        className: `trace-event-item ${typeClass}`,
        dataset: { eventType: ev.event_type },
      },
      headerNode,
      bodyNode
    );

    dom.traceEventsList.appendChild(liElement);
    applyFilterToItem(liElement);
    if (dom.traceViewport) {
      dom.traceViewport.scrollTop = dom.traceViewport.scrollHeight;
    }
  }

  function updateTraceMetaBar() {
    if (dom.metaStepsCount) {
      dom.metaStepsCount.textContent = String(state.events.length);
    }
    if (dom.traceStepCounter) {
      dom.traceStepCounter.textContent = String(state.events.length);
    }

    if (dom.metaTotalDuration) {
      const finishEvent = state.events.find((e) => e.event_type === "RUN_FINISHED");
      if (finishEvent?.payload?.total_duration_ms) {
        dom.metaTotalDuration.textContent = `${finishEvent.payload.total_duration_ms} ms`;
      } else if (state.events.length > 1) {
        const first = new Date(state.events[0].timestamp).getTime();
        const last = new Date(state.events[state.events.length - 1].timestamp).getTime();
        if (!isNaN(first) && !isNaN(last) && last >= first) {
          dom.metaTotalDuration.textContent = `${last - first} ms`;
        }
      }
    }
  }

  function updateMetaRunInfo(runId) {
    if (dom.metaRunId) {
      dom.metaRunId.textContent = runId || "--";
    }
  }

  function updateRunStatus(status) {
    state.runStatus = status;
    if (!dom.traceStatusPill) return;

    dom.traceStatusPill.className = "status-pill";
    dom.traceStatusPill.textContent = status;

    switch (status) {
      case "RUNNING":
        dom.traceStatusPill.classList.add("status-running");
        break;
      case "COMPLETED":
        dom.traceStatusPill.classList.add("status-completed");
        break;
      case "NEEDS_INPUT":
        dom.traceStatusPill.classList.add("status-needs-input");
        break;
      case "BLOCKED":
        dom.traceStatusPill.classList.add("status-blocked");
        break;
      case "FAILED":
      case "LIMIT_REACHED":
      case "ACTION_STATUS_UNKNOWN":
        dom.traceStatusPill.classList.add("status-failed");
        break;
      default:
        dom.traceStatusPill.classList.add("status-idle");
        break;
    }
  }

  function expandAllTraceEvents() {
    document.querySelectorAll(".trace-event-item .event-body").forEach((b) => b.classList.remove("is-hidden"));
    document.querySelectorAll(".trace-event-item .event-header").forEach((h) => h.classList.remove("collapsed"));
  }

  function collapseAllTraceEvents() {
    document.querySelectorAll(".trace-event-item .event-body").forEach((b) => b.classList.add("is-hidden"));
    document.querySelectorAll(".trace-event-item .event-header").forEach((h) => h.classList.add("collapsed"));
  }

  function filterTraceEvents() {
    document.querySelectorAll(".trace-event-item").forEach((item) => {
      applyFilterToItem(item);
    });
  }

  function applyFilterToItem(item) {
    const type = item.dataset.eventType;
    if (state.activeFilter === "ALL") {
      item.hidden = false;
    } else if (state.activeFilter === "TOOL") {
      item.hidden = !["TOOL_PROPOSED", "TOOL_STARTED", "TOOL_RESULT"].includes(type);
    } else {
      item.hidden = type !== state.activeFilter;
    }
  }

  // ===========================================================================
  // 13. UI STATE HELPERS
  // ===========================================================================
  function setLoadingState(isLoading) {
    if (dom.btnSubmitChat) dom.btnSubmitChat.disabled = isLoading;
    if (dom.submitSpinner) dom.submitSpinner.hidden = !isLoading;
    if (dom.typingIndicator) dom.typingIndicator.hidden = !isLoading;
  }

  function showNeedsInputBanner(msg) {
    if (dom.needsInputBanner && dom.needsInputMessage) {
      dom.needsInputMessage.textContent = msg;
      dom.needsInputBanner.hidden = false;
      if (dom.chatInput) dom.chatInput.focus();
    }
  }

  function hideNeedsInputBanner() {
    if (dom.needsInputBanner) dom.needsInputBanner.hidden = true;
  }

  function showPostError(msg) {
    if (dom.postErrorBanner && dom.postErrorMessage) {
      dom.postErrorMessage.textContent = msg;
      dom.postErrorBanner.hidden = false;
    }
  }

  function hidePostError() {
    if (dom.postErrorBanner) dom.postErrorBanner.hidden = true;
  }

  function clearChatUI() {
    if (dom.chatMessages) dom.chatMessages.replaceChildren();
    if (dom.welcomeCard) dom.welcomeCard.hidden = false;
    clearResultsUI();
  }

  function clearResultsUI() {
    if (dom.resultsSection) dom.resultsSection.hidden = true;
    if (dom.roomCardsContainer) dom.roomCardsContainer.replaceChildren();
    if (dom.roomTableContainer) dom.roomTableContainer.replaceChildren();
    hideBookingCard();
  }

  function clearTraceUI() {
    if (dom.traceEventsList) dom.traceEventsList.replaceChildren();
    if (dom.traceEmptyState) dom.traceEmptyState.hidden = false;
    state.events = [];
    state.lastSeq = 0;
    updateTraceMetaBar();
    updateMetaRunInfo("--");
  }

  document.addEventListener("DOMContentLoaded", init);
})();
