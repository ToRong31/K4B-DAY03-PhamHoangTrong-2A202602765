# 📊 BÁO CÁO THU HOẠCH NGHIỆM THU BÀI LAB 3 (BƯỚC 3 — SUBMISSION ARTIFACT)

> **Họ và Tên Học viên:** Phạm Hoàng Trọng  
> **Mã Sinh Viên / Mã Học viên:** 2A202602765  
> **Chủ đề Lựa chọn:** Trợ lý AI hỗ trợ sinh viên tìm nhà trọ / phòng trọ gần trường theo đa tiêu chí và đặt lịch xem phòng (Student Housing Assistant) — Đề tài Mở, Mục 5 trong `docs/DANH_SACH_DE_TAI.md`.

---

## 1. BẢNG CHẤM ĐIỂM AGENTIC FIT SCORING MATRIX (ĐÁNH GIÁ CHỦ ĐỀ)

| Tiêu chí Đánh giá | Mức độ (1 - 5) | Giải trình chi tiết lý do chọn điểm |
| :--- | :---: | :--- |
| **1. Multi-step Reasoning** | 5 / 5 | Agent trích xuất các tiêu chí (ngân sách, khoảng cách, tiện ích, trường học, rating, tuyến bus); tra cứu ứng viên phù hợp; truy vấn rating và trạm bus cho từng ứng viên; đối chiếu điều kiện cứng (loại bỏ phòng không đạt); xếp hạng ứng viên theo độ ưu tiên `(khoảng cách, giá, mã phòng)` và tiến hành đặt lịch khi có ủy quyền. |
| **2. Tool Interaction** | 5 / 5 | Agent tương tác với 6 công cụ độc lập qua MCP Server: `get_school_coordinates` (tra cứu tọa độ GPS trường học), `search_rental_rooms` (tìm phòng theo tọa độ GPS và Haversine), `get_property_ratings` (xác thực rating), `get_nearby_bus_routes` (tra trạm bus và tuyến xe), `book_room_viewing` (ghi nhận lịch xem phòng có kiểm tra trùng lịch và tính lũy kế idempotency), và `ask_user` (hỏi lại người dùng khi thiếu thông tin quan trọng như tên trường học). |
| **3. Dynamic Decision** | 5 / 5 | Bước tiếp theo hoàn toàn phụ thuộc vào Observation thực tế: nếu chưa có tọa độ trường thì gọi `get_school_coordinates`; nếu người dùng chưa nêu trường khi lọc khoảng cách thì gọi `ask_user` chuyển trạng thái `NEEDS_INPUT`; nếu rating chưa đạt hoặc UNKNOWN thì loại bỏ; nếu không có trạm bus trong bán kính thì loại bỏ; nếu danh sách phòng rỗng thì dừng và hướng dẫn sinh viên mở rộng tiêu chí. |
| **4. Long Horizon Goal** | 5 / 5 | Agent duy trì thông tin sinh viên (`student_id`, `student_phone`), giờ hẹn và các ràng buộc xuyên suốt chuỗi ReAct đa lượt, kiểm soát ngân sách cuộc gọi, xác nhận bằng chứng thành công trước khi đưa ra câu trả lời cuối cùng (`FINAL_ANSWER`). |
| **TỔNG ĐIỂM AGENTIC FIT** | **20 / 20** | *20/20 > 12/20: Bài toán xuất sắc đáp ứng yêu cầu kiến trúc ReAct Agent, kết hợp tra cứu dữ liệu đa nguồn, tác vụ hành động thực tế và cơ chế Human-in-the-Loop.* |

**Phạm vi hoàn thiện hệ thống:**
1. `get_school_coordinates(school_name)`: Tra cứu tọa độ GPS (`lat`, `lon`), mã trường và tên chuẩn từ fixture `data/schools.json`.
2. `search_rental_rooms(lat, lon, max_price, max_distance_km, amenities, school_name)`: Tính khoảng cách Haversine động từ tọa độ GPS trung tâm tới 12 phòng trọ trong `data/rooms.json`.
3. `get_property_ratings(room_id)`: Tra cứu điểm đánh giá thực tế từ `data/ratings.json`.
4. `get_nearby_bus_routes(room_id, radius_m)`: Tra cứu trạm dừng và các tuyến bus từ `data/transit.json`.
5. `book_room_viewing(room_id, student_id, viewing_time, student_phone)`: Đặt lịch hẹn xem phòng với cơ chế khóa thread-safe, chống trùng lịch và bảo vệ PII.
6. `ask_user(question, missing_field)`: Hỏi lại người dùng khi thiếu thông tin (đặc biệt là tên trường học khi cần tính khoảng cách), bảo toàn ngữ cảnh đa lượt.

---

## 2. TRÍCH XUẤT KẾT QUẢ WATERFALL TRACE LOG (SAU KHI CHẠY TEST SUITE)

Trích xuất chuỗi sự kiện tiêu biểu từ `docs/trace_waterfall.json` cho ca kiểm thử phức tạp **TC04** (Multi-step Reasoning: Tra cứu GPS trường $\rightarrow$ Tìm kiếm phòng $\rightarrow$ Tra cứu Rating & Bus $\rightarrow$ Loại P102 vì rating thấp $\rightarrow$ Chọn P103 $\rightarrow$ Đặt lịch xem phòng $\rightarrow$ Phản hồi):

```json
[
  {
    "seq": 3,
    "step": 1,
    "event_type": "TOOL_PROPOSED",
    "payload": {
      "tool": "get_school_coordinates",
      "arguments": {
        "school_name": "Trường mẫu của bài lab"
      }
    }
  },
  {
    "seq": 6,
    "step": 1,
    "event_type": "TOOL_RESULT",
    "payload": {
      "status": "SUCCESS",
      "observation": {
        "status": "SUCCESS",
        "school_id": "VINUNI",
        "name": "Trường Đại học VinUni (Gia Lâm, Hà Nội)",
        "lat": 10.0,
        "lon": 106.0,
        "source": "fixture-schools"
      }
    }
  },
  {
    "seq": 8,
    "step": 2,
    "event_type": "TOOL_PROPOSED",
    "payload": {
      "tool": "search_rental_rooms",
      "arguments": {
        "lat": 10.0,
        "lon": 106.0,
        "school_name": "Trường Đại học VinUni (Gia Lâm, Hà Nội)",
        "max_price": 4000000,
        "max_distance_km": 3.0,
        "amenities": ["air_conditioning"]
      }
    }
  },
  {
    "seq": 38,
    "step": 4,
    "event_type": "TOOL_PROPOSED",
    "payload": {
      "tool": "book_room_viewing",
      "arguments": {
        "room_id": "P103",
        "student_id": "SV***001",
        "viewing_time": "2026-09-16T15:00:00+07:00",
        "student_phone": "[REDACTED]"
      }
    }
  },
  {
    "seq": 41,
    "step": 4,
    "event_type": "TOOL_RESULT",
    "payload": {
      "status": "SUCCESS",
      "observation": {
        "status": "SUCCESS",
        "booking_id": "DEMO-BK-001",
        "room_id": "P103",
        "viewing_time": "2026-09-16T15:00:00+07:00",
        "replayed": false,
        "data_source": "fixture"
      }
    }
  },
  {
    "seq": 44,
    "step": 4,
    "event_type": "FINAL_ANSWER",
    "payload": {
      "content": "Đã đặt lịch xem phòng P103 trong hệ thống mô phỏng vào 2026-09-16T15:00:00+07:00. Mã lịch: DEMO-BK-001. Phòng có giá 3,500,000 VNĐ/tháng. Khoảng cách GPS đường thẳng tới Trường Đại học VinUni (Gia Lâm, Hà Nội): 1.998 km. Rating mô phỏng 4.3/5 từ 37 lượt. Trạm gần nhất Trạm Cầu Vồng cách 280 m đường thẳng, tuyến: BUS-12, BUS-33.",
      "outcome": "COMPLETED"
    }
  }
]
```

---

## 3. TỔNG KẾT KẾT QUẢ NGHIỆM THU & NỘP BÀI

- [x] **Hỗ trợ đa chế độ:** Hệ thống hỗ trợ chế độ Mock Offline (`--mode mock`) phục vụ kiểm thử logic không tốn phí, và chế độ OpenAI Live (`--mode openai`) giao tiếp với LLM API thật.
- [x] **Kết quả kiểm thử tự động (Test Suite):** **5 / 5 PASS** (100% đạt chuẩn trên các kịch bản TC01 – TC05).
- [x] **Số lượt gọi Tool qua MCP Server chính xác:** Đầy đủ 6 tools (`get_school_coordinates`, `search_rental_rooms`, `get_property_ratings`, `get_nearby_bus_routes`, `book_room_viewing`, `ask_user`), xử lý chuỗi tuần tự theo đúng kế hoạch suy luận và hỗ trợ làm rõ khi thiếu thông tin.
- [x] **Bảo vệ quyền riêng tư (Privacy & Redaction):** Toàn bộ số điện thoại (`091*****78`), mã sinh viên (`SV***001`) và khóa bảo mật được ẩn danh tự động trước khi xuất ra trace log hoặc API.
- [x] **Hạ tầng Web & Giao diện người dùng:** Đã hoàn thiện FastAPI (`src/web_api.py`) và Frontend trực quan (`web/`) hỗ trợ xem phòng, so sánh bảng và theo dõi Timeline Trace thời gian thực.
- [x] **Kết quả đẩy Repo nộp bài:** Mã nguồn đã sẵn sàng, cấu trúc sạch sẽ và tuân thủ quy chuẩn.

---

> ✅ **HOÀN TẤT NỘP BÀI:** Sao chép đường link GitHub Repository cá nhân của bạn và dán vào ô nộp bài trên hệ thống LMS VLearn để hoàn tất Bài Lab 3!
