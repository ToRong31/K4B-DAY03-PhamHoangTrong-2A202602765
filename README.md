# 🏫 STUDENT HOUSING REACT AGENT — TỪ LÝ THUYẾT ĐẾN THỰC THI (MCP ENHANCED)

> **Mã bài học:** `DAY03-REACT-AGENT`  
> **Lớp học:** Lớp Chiều (K4B)  
> **Học viên:** Phạm Hoàng Trọng — **MSSV:** 2A202602765  
> **Chủ đề triển khai:** Trợ lý tác tử AI hỗ trợ sinh viên tìm kiếm phòng trọ theo đa tiêu chí (GPS động Haversine, Đánh giá Rating đối chiếu, Tuyến bus lân cận) và đặt lịch xem phòng an toàn (Student Housing ReAct Agent).  
> **Kết quả nghiệm thu:** **5 / 5 PASS** trên bộ kiểm thử tự động, hỗ trợ cả chế độ Mock Offline và OpenAI Live, tích hợp Web API FastAPI và Giao diện Web trực quan.

---

## ⚡ 1. QUICKSTART — KHỞI CHẠY HỆ THỐNG

### Bước 1: Kích hoạt môi trường và cài đặt thư viện
```powershell
# Trên Windows PowerShell:
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

*(Trên Linux / macOS: `source .venv/bin/activate && pip install -r requirements.txt`)*

### Bước 2: Chạy kiểm thử tự động 5 Test Cases (CLI)
```powershell
# Chế độ Mock Offline (Xác định, 0đ, không tốn token LLM, không cần API key):
python src/app.py --all --mode mock

# Chế độ OpenAI Live (Kết nối model thật qua OpenAI Chat Completions):
$env:OPENAI_API_KEY = "sk-..."
python src/app.py --all --mode openai
```

**Kỳ vọng Output màn hình:**
```text
Chế độ LLM: mock | Dữ liệu: fixture (mô phỏng)
[TC01] PASS
[TC02] PASS
[TC03] PASS
[TC04] PASS
[TC05] PASS
Kết quả: 5/5 PASS | Trace: docs/trace_waterfall.json
```

### Bước 3: Chạy hội thoại tương tác (Interactive CLI)
```powershell
python src/app.py --interactive --mode mock
# hoặc với openai:
python src/app.py --interactive --mode openai
```

### Bước 4: Khởi chạy Giao diện Web (Full-stack FastAPI + HTML/CSS/JS)
```powershell
# Khởi động máy chủ backend và web tĩnh cùng origin:
$env:WEB_LLM_MODE = "mock"
python -m uvicorn web_api:app --app-dir src --host 127.0.0.1 --port 8000
```
Mở trình duyệt truy cập: **`http://127.0.0.1:8000/`**  
*(Giao diện hỗ trợ Dark/Light mode, hiển thị thẻ phòng trọ, bảng so sánh đa tiêu chí và Timeline Trace chi tiết từng bước ReAct).*

---

## 🎯 2. BỨC TRANH TỔNG THỂ & MỤC TIÊU HỆ THỐNG

Dự án phát triển một **Student Housing ReAct Agent** hoàn chỉnh, giải quyết bài toán tìm trọ thực tế của sinh viên:
1. **Lập luận đa bước (Multi-step Reasoning):** Tiếp nhận yêu cầu tự nhiên, bóc tách ngân sách, khoảng cách, tiện ích, trường học, điều kiện rating và tuyến bus; tra cứu danh sách phòng; truy vấn bổ sung rating và trạm bus cho shortlist; loại bỏ phòng vi phạm điều kiện cứng; xếp hạng và đề xuất đặt lịch.
2. **Giao thức MCP Facade (JSON-RPC 2.0):** Tách bạch giữa Agent Core điều phối (`src/app.py`) và MCP Server (`src/mcp_server.py`) quản lý công cụ độc lập.
3. **Tính toán Khoảng cách GPS Động (Haversine):** Tra cứu tọa độ GPS của trường đại học từ danh mục fixture, tính khoảng cách đường thẳng thực tế tới từng phòng trọ theo công thức Haversine; không dùng khoảng cách cố định.
4. **Hệ thống Guardrails bằng mã nguồn:** 13 quy tắc an toàn (G01 – G12, G17) kiểm soát chặt chẽ quyền đặt lịch, tính hợp lệ của tham số, xung đột lịch hẹn, ngân sách vòng lặp và che giấu thông tin cá nhân (PII Redaction).
5. **Khả năng quan sát toàn diện (Observability):** Xuất toàn bộ chuỗi sự kiện ra `docs/trace_waterfall.json` với độ trễ đo thực và ngữ cảnh quyết định minh bạch.

---

## 🛠️ 3. BỘ 6 CÔNG CỤ (TOOLS SPECIFICATION)

| Tên công cụ | Mục đích nghiệp vụ | Tham số đầu vào | Nguồn dữ liệu & Đặc điểm |
| :--- | :--- | :--- | :--- |
| `get_school_coordinates` | Tra cứu tọa độ GPS (`lat`, `lon`), mã trường và tên chuẩn của trường học | `school_name` (string) | `data/schools.json`. Định vị GPS trường học trước khi tìm phòng theo cự ly. Báo lỗi `NOT_FOUND` nếu không tồn tại. |
| `search_rental_rooms` | Tra cứu phòng trọ còn trống theo khoảng cách tính động từ tọa độ GPS trung tâm | `lat` (float), `lon` (float), `max_price` (int), `max_distance_km` (float), `amenities` (array), `school_name` (string) | `data/rooms.json`. Tính Haversine GPS từ tọa độ trung tâm. Yêu cầu `lat`, `lon` khi lọc theo `max_distance_km`. |
| `get_property_ratings` | Lấy rating mô phỏng đã xác thực đúng tòa nhà/bất động sản | `room_id` (string, regex `^P[0-9]{3}$`) | `data/ratings.json`. Trả về `rating`, `rating_scale`, `review_count`, `entity_match: verified`. |
| `get_nearby_bus_routes` | Tra cứu trạm dừng và các tuyến bus gần phòng trọ | `room_id` (string), `radius_m` (int 1–2000, mặc định 500) | `data/transit.json`. Trả về danh sách trạm, cự ly và các mã tuyến hoạt động (`coverage: supported`). |
| `book_room_viewing` | Ghi nhận lịch xem phòng trong hệ thống sau khi có ủy quyền | `room_id`, `student_id`, `viewing_time` (ISO 8601), `student_phone` | Bộ nhớ RAM với `threading.Lock()`. Kiểm tra phòng trống, giờ hợp lệ (08:00–17:30), chống trùng lịch và chống lặp idempotency. |
| `ask_user` | Hỏi lại người dùng khi thiếu thông tin quan trọng (Human-in-the-loop) | `question` (string 5–500 ký tự), `missing_field` (enum: `school_name`, `viewing_time`, `student_id`, `student_phone`, `other`) | Chuyển Agent sang trạng thái `NEEDS_INPUT`, bảo toàn `SessionState.pending_criteria` cho lượt hội thoại kế tiếp. |

---

## 📂 4. CẤU TRÚC THƯ MỤC DỰ ÁN

```text
📁 K4B-DAY03-PhamHoangTrong-2A202602765/
├── 📄 README.md                     <-- ⚡ Tài liệu tổng quan dự án & Hướng dẫn Quickstart
├── 📄 requirements.txt              <-- 📦 Danh sách thư viện Python (fastapi, uvicorn, openai, dotenv...)
│
├── 📁 data/                         <-- 📊 DỮ LIỆU FIXTURE MÔ PHỎNG CHUẨN HÓA
│   ├── 📄 schools.json              <-- Danh mục trường học, alias và tọa độ GPS (lat, lon)
│   ├── 📄 rooms.json                <-- 12 phòng trọ mẫu, giá thuê, tọa độ GPS, tiện ích, tình trạng
│   ├── 📄 ratings.json              <-- Dữ liệu đánh giá (rating, review count) gắn theo room_id
│   └── 📄 transit.json              <-- Dữ liệu trạm và tuyến xe bus phục vụ quanh phòng trọ
│
├── 📁 config/                       <-- ⚙️ CẤU HÌNH KIỂM THỬ
│   ├── 📄 test_cases.example.json   <-- File cấu hình mẫu
│   └── 📄 test_cases.json           <-- Bộ 5 Test Cases nghiệm thu chính thức của đề tài
│
├── 📁 src/                          <-- 💻 MÃ NGUỒN CHÍNH
│   ├── 📄 tools.py                  <-- 6 Tools schema, loader, GPS Haversine & booking in-memory
│   ├── 📄 mcp_server.py             <-- MCP Housing Server đóng vai trò JSON-RPC 2.0 Facade
│   ├── 📄 providers.py              <-- Multi-Provider: MockOfflineProvider & OpenAIProvider (Native Tools)
│   ├── 📄 app.py                    <-- ReAct Orchestrator, Session State, Guardrails, Trace & CLI Runner
│   ├── 📄 prompts.py                <-- System Prompts hướng dẫn Agent và giới hạn vòng lặp
│   ├── 📄 web_api.py                <-- FastAPI Web API Wrapper (POST/GET /api/runs) & Static Server
│   └── 📁 ai_levels/                <-- 📚 Mã nguồn tham khảo các cấp độ AI (Reference Only)
│
├── 📁 web/                          <-- 🌐 GIAO DIỆN WEB NGƯỜI DÙNG (VANILLA JS / SHADCN-INSPIRED)
│   ├── 📄 index.html                <-- Giao diện 2 cột: Chat/Room Cards & Timeline Trace
│   ├── 📄 styles.css                <-- Thiết kế hiện đại, Dark/Light mode, responsive
│   └── 📄 app.js                    <-- Quản lý Session, Polling API, chống XSS (không dùng innerHTML)
│
└── 📁 docs/                         <-- 📚 HỆ THỐNG TÀI LIỆU CHI TIẾT
    ├── 📄 REACT_HANDOFF.md          <-- 📌 Bàn giao chi tiết Backend Student Housing ReAct Agent
    ├── 📄 BACKEND_RUN.md            <-- Hướng dẫn vận hành Backend CLI & Web API
    ├── 📄 FRONTEND_RUN.md           <-- Hướng dẫn vận hành Frontend & Demo Mode (?demo=1)
    ├── 📄 REACT_ARCHITECTURE.md     <-- Đặc tả kiến trúc ReAct, State Machine, Hợp đồng Tool
    ├── 📄 REACT_GUARDRAILS_TRACE.md <-- Đặc tả 13 quy tắc Guardrail và cấu trúc Trace Waterfall
    ├── 📄 REACT_EXTERNAL_APIS.md    <-- Thiết kế kết nối API bên ngoài (Rating & Transit)
    ├── 📄 REACT_PLAN.md             <-- Kế hoạch và tiến độ thực thi các mốc P1 – P6
    ├── 📄 AGENT_TEAM_BRIEF.md       <-- Phân công trách nhiệm Backend và Frontend Agent
    ├── 📄 trace_eval.md             <-- 📊 Báo cáo thu hoạch nghiệm thu nộp bài LMS
    └── 📄 trace_waterfall.json      <-- File vết sự kiện thực tế sinh ra từ bộ kiểm thử 5/5 PASS
```

---

## 📊 5. BỘ 5 TEST CASES VÀ KẾT QUẢ NGHIỆM THU

| Mã TC | Phân loại | Câu hỏi tình huống | Hành vi kỳ vọng & Kết quả thực tế | Trạng thái |
| :---: | :--- | :--- | :--- | :---: |
| **TC01** | Direct Query | Chi phí phát sinh và lưu ý cọc khi thuê phòng | Trả lời hướng dẫn chung, **0 tool call**, không bịa đặt phòng cụ thể. | **PASS** |
| **TC02** | Two-step Query | Tìm phòng $\le$ 3.5 triệu, cách trường $\le$ 3 km | Gọi `get_school_coordinates` (GPS 10.0, 106.0) $\rightarrow$ gọi `search_rental_rooms`, trả về đúng shortlist `[P101, P103]`, không gọi đặt lịch. | **PASS** |
| **TC03** | Appointment Booking | Đặt lịch xem phòng P101 vào 09:30 ngày 18/09/2026, SV2026001, 0912345678 | Người dùng ủy quyền rõ ràng $\rightarrow$ gọi thẳng `book_room_viewing` mà không hỏi lại thừa; ghi nhận booking thành công. | **PASS** |
| **TC04** | Multi-step Reasoning | Tìm phòng $\le$ 4tr, $\le$ 3km có điều hòa, rating $\ge$ 4/5 ($\ge$ 20 lượt), có bus trong 500m; chọn phòng gần nhất rồi đặt lịch 15:00 ngày 16/09/2026 | Chuỗi ReAct gọi `get_school_coordinates` $\rightarrow$ `search_rental_rooms` $\rightarrow$ `get_property_ratings` và `get_nearby_bus_routes` $\rightarrow$ loại P102 vì rating 3.7 $\rightarrow$ chọn P103 (rating 4.3, bus 280m) $\rightarrow$ gọi `book_room_viewing`. | **PASS** |
| **TC05** | Edge Case Handling | Tìm phòng giá $\le$ 500 nghìn, cách trường $\le$ 100 mét | Gọi `get_school_coordinates` $\rightarrow$ `search_rental_rooms` nhận kết quả rỗng (count: 0) $\rightarrow$ thông báo không có phòng, hướng dẫn điều chỉnh tiêu chí, **không bịa phòng, không gọi book**. | **PASS** |

---

## 🛡️ 6. BẢO VỆ DỮ LIỆU & QUY TẮC AN TOÀN (GUARDRAILS)

- **Che giấu thông tin cá nhân (PII Redaction):** Số điện thoại (`091*****78`), mã sinh viên (`SV***001`) và các token bảo mật (`sk-...`, `Bearer...`) tự động bị che khi xuất ra log file, console hay API response.
- **Không sử dụng SQLite / Lưu trữ ngoài:** Mọi trạng thái và lịch hẹn duy trì an toàn trong RAM tiến trình qua khóa luồng `threading.Lock()`.
- **Chống XSS tại Frontend:** Toàn bộ DOM được khởi tạo qua các hàm tạo phần tử an toàn (`document.createElement`, `textContent`), tuyệt đối không dùng `innerHTML` cho dữ liệu từ người dùng hoặc LLM.
- **Không tự ý fallback:** Trường học không tồn tại sẽ trả lỗi `NOT_FOUND` và chuyển sang `NEEDS_INPUT`, không tự ý dùng trường mặc định. Live API lỗi sẽ chuyển `FAILED`, không tự ý chuyển sang mock mà không thông báo.

---

## 📚 7. TÀI LIỆU CHI TIẾT (DOCUMENTATION INDEX)

- [Bàn giao triển khai Backend](docs/REACT_HANDOFF.md)
- [Hướng dẫn Vận hành Backend](docs/BACKEND_RUN.md)
- [Hướng dẫn Vận hành Frontend](docs/FRONTEND_RUN.md)
- [Kiến trúc Hệ thống ReAct & Hợp đồng Dữ liệu](docs/REACT_ARCHITECTURE.md)
- [Hệ thống Guardrail & Đặc tả Trace Waterfall](docs/REACT_GUARDRAILS_TRACE.md)
- [Thiết kế Tích hợp API bên ngoài (Rating & Transit)](docs/REACT_EXTERNAL_APIS.md)
- [Kế hoạch và Tiến độ Thực thi (P1 - P6)](docs/REACT_PLAN.md)
- [Báo cáo Nghiệm thu Nộp bài (trace_eval.md)](docs/trace_eval.md)

