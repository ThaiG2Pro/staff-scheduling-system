## 1. Người dùng, Công việc cần hoàn thành & Nguyên tắc Xuyên suốt

- **Người dùng mục tiêu:** Store Manager của một cửa hàng bán lẻ hoặc F&B (vận hành đơn điểm, quản lý nhóm nhân sự có quỹ giờ hợp đồng khác nhau).
- **Công việc cốt lõi (Jobs to be Done):** Nạp dữ liệu giao dịch lịch sử, thiết lập danh sách nhân viên và ca làm việc, tạo nhanh bản nháp lịch tuần khớp với mức độ bận rộn theo giờ, rà soát các điểm bất hợp lý, điều chỉnh trực tiếp theo thực tế cửa hàng và xác nhận độ phủ trên bảng tổng hợp.
- **Nguyên tắc xuyên suốt:** _Không xây dựng một hệ thống phô diễn thuật toán phức tạp. Xây dựng một công cụ giúp Manager hoàn thành công việc lập lịch tuần tốt hơn với ít thao tác hơn và ít phải tính nhẩm thủ công hơn._

## 2. Phân tầng Phạm vi & Đối chiếu Yêu cầu Đề bài

### 2.1 Tính năng Ứng dụng (In-Scope)

đề bài : instructions.md


| **Ưu tiên** | **Hạng mục** | **Mapping Đề bài** | **Phạm vi chốt** |
| :--- | :--- | :--- | :--- |
| **P0 — Must-have** | **Quản lý Schedule, Staff, Shift** | 2.1, 2.2, 2.4 | Tạo/chuyển/đổi tên/xóa Schedule (1 tuần **Mon–Sun**). CRUD Staff (tên + `maxWeeklyHours`), kèm thanh theo dõi quỹ giờ trực tiếp (`assigned / max`) ngay cạnh lưới lịch. CRUD Shifts (`startTime`, `endTime`), seed sẵn `07:00–15:00` và `15:00–23:00` (hỗ trợ cả ca gối đầu như `11:00–15:00`), thay đổi tự động đồng bộ sang lịch và bảng tổng hợp. |
| **P0 — Must-have** | **CSV Transaction Importer** | 2.3 | Nhập file dữ liệu giao dịch theo giờ (`7am–10pm`, ví dụ file mẫu `report_Transaction_20260807_20260813.csv` chạy từ Thứ Sáu 07/08/2026 đến Thứ Năm 13/08/2026), tự chuẩn hóa thứ tự cột về **Mon–Sun**, kiểm tra hợp lệ và báo lỗi chi tiết mà không ghi đè dữ liệu cũ khi lỗi. |
| **P0 — Must-have** | **Auto-schedule** | 2.5 | Nút tạo bản nháp lịch tuần theo nhu cầu giao dịch, tôn trọng tuyệt đối giới hạn giờ hợp đồng, phân phối công bằng theo tỷ lệ sử dụng quỹ giờ, bảo toàn các assignment đã pin và hiển thị tóm tắt rõ phần thiếu/dư công suất. |
| **P0 — Must-have** | **Weekly Roster & Direct Editing** | 2.7 | Bố cục **Shift-first** dễ đọc theo ngày và ca (đọc nhanh trong 3 giây); gán/đổi/gỡ nhân viên trực tiếp qua **Assignment Guidance Popover**; hỗ trợ **Assignment Pinning**; cảnh báo mềm khi sửa tay; cập nhật tức thì **Schedule Health** và bảng tổng hợp. |
| **P0 — Must-have** | **Aggregated Summary đầy đủ** | 2.6 | Lưới 7 ngày × 16 giờ hiển thị đủ 3 chỉ số/ô: `Transactions`, `Staff hours`, `Txns / staff hour` (hiển thị `–` khi `staff hours = 0`) + 4 chỉ số tổng tuần (`Total staff hours`, `Total transactions`, `Overall Txns/hr`, `Average Txns/hr`). |
| **P0 — Must-have** | **Local Persistence & Demo Store** | Tech Req | Lưu trữ tự động qua `LocalStorage`. Seed sẵn 1 **Demo Store** hoàn chỉnh (dữ liệu CSV đề cho + 8–10 nhân viên có quỹ giờ đa dạng `16h–40h`) kèm nút nạp nhanh để người dùng/người đánh giá trải nghiệm ngay trong 5 giây. |
| **P1 — Conditional Stretch** | **Coverage View** | Stretch Goal | Chế độ xem tích hợp trên bảng 2.6, đối chiếu `scheduled / required staff` theo từng khung giờ và hiển thị độ lệch (`-2`, `0`, `+1`) kèm màu sắc + ký hiệu rõ ràng để làm nổi bật vùng thiếu/thừa người. **Điều kiện kích hoạt:** Chỉ triển khai sau khi toàn bộ luồng P0 chạy ổn định và pass bộ test nghiệp vụ cốt lõi. |

### 2.2 Sản phẩm Bàn giao (Project Deliverables — Không phải tính năng App)

- **Research Note (Mục 2.8):** Bản ghi chú khoảng nửa trang trong `README.md`, đúc kết từ việc trực tiếp đóng vai Store Manager trải nghiệm quy trình trên tối thiểu **Deputy** và **Legion** (và các công cụ liên quan): bài học rút ra, ý tưởng áp dụng và ít nhất một điểm cố tình làm khác đi kèm lý do.
- **AI Usage Note & Runbook:** Tài liệu hướng dẫn chạy 1–2 lệnh trong `README.md` và ghi chú trung thực về phần giao cho AI, phần tự kiểm chứng và phần ghi đè đề xuất của AI.

## 3. Ranh giới Quyết định: Tự động hóa, Ghi đè & Phản hồi

### 3.1 Quyền hạn và Thứ tự Ưu tiên của Auto-schedule

Auto-schedule chỉ tạo **bản nháp (draft)** và tuân thủ nghiêm ngặt thứ tự ưu tiên 4 bước:

1. **Ràng buộc cứng:** Tuyệt đối không vượt `maxWeeklyHours`, không xếp trùng giờ, tối đa 1 ca/ngày cho mỗi nhân viên.
2. **Đáp ứng nhu cầu:** Phủ nhân sự tương xứng với lượng giao dịch theo giờ (giờ đông khách nhiều người hơn giờ vắng).
3. **Phân bổ công bằng:** Cân bằng tỷ lệ sử dụng quỹ giờ hợp đồng $u_i = \frac{\text{assignedHours}_i}{\text{maxWeeklyHours}_i}$ để tránh tình trạng người 0 giờ, người kịch trần.
4. **Minh bạch thiếu/dư:** Khi nhu cầu vượt quỹ giờ đội ngũ (hoặc ngược lại), không ẩn lỗi hay tự phá ràng buộc; hiển thị tóm tắt rõ ràng phần giờ còn thiếu hoặc công suất chưa dùng.

> **Lưu ý về mô hình hóa nhu cầu:** Công thức cụ thể và tham số chuyển đổi (phân biệt rõ **`N`** — số giao dịch/giờ trên mỗi nhân viên, **`Required staff per hour`** — nhu cầu nhân sự ước lượng theo giờ, và **`Required staff per shift`** — nhu cầu nhân sự sau khi ánh xạ các hourly requirements lên từng ca) sẽ được thiết kế và kiểm chứng trên dữ liệu mẫu trong **`04-optimization-spec.md`**, không chốt cứng tại tài liệu này.

### 3.2 Quy tắc Assignment Pinning

- **Đối tượng pin:** Áp dụng cho một phân công cụ thể (`Staff + Shift + Day`), không phải Shift Template.
- **Hành vi khi chạy Auto-schedule:**
  - Các assignment đã pin được giữ nguyên.
  - Các assignment chưa pin được phép tính toán và phân bổ lại.
  - **Xung đột pin:** Nếu tập assignment đã pin hiện tại tự vi phạm ràng buộc cứng (ví dụ: tổng giờ pin của một nhân viên đã vượt `maxWeeklyHours` do Manager vừa sửa tay), hệ thống **không âm thầm gỡ pin** và **không tạo lịch vi phạm** — hệ thống dừng chạy tự động, báo rõ xung đột và yêu cầu Manager xử lý trước.

### 3.3 Quyền Ghi đè của Manager & Assignment Guidance Popover

Hệ thống áp dụng cơ chế kiểm soát bất đối xứng: **khóa cứng với Auto-schedule, cảnh báo mềm với thao tác tay** (để không cản trở Manager trong tình huống khẩn cấp như nhân viên báo ốm).

- Khi Manager gán hoặc đổi nhân viên cho một ca, **Assignment Guidance Popover** chia danh sách thành 2 nhóm rõ ràng (tránh dùng từ "Khả dụng/Available" để không gây hiểu nhầm rằng hệ thống biết lịch bận cá nhân):
  - **`Eligible`:** Thỏa mãn mọi điều kiện gán ca của hệ thống (kèm thông tin quỹ giờ còn lại, ví dụ: _Còn 8h quỹ hợp đồng_).
  - **`Requires attention`:** Có cảnh báo hoặc không khuyến nghị, ghi rõ lý do cụ thể (_Đã có ca trong ngày_, _Trùng thời gian với ca khác_, _Gán ca này sẽ vượt giới hạn tuần +Xh_).
- Manager vẫn có thể chọn nhân viên thuộc nhóm `Requires attention` qua thao tác xác nhận rõ ràng; cảnh báo sẽ lập tức phản ánh lên giao diện lịch và thanh sức khỏe.

### 3.4 Schedule Health — 4 Independent Signals

Thay vì nén chất lượng lịch thành một điểm số tổng 0–100 dễ che giấu lỗi nghiêm trọng, thanh trạng thái hiển thị **4 tín hiệu độc lập**, tính lại tức thì sau mọi thay đổi:

1. **Staffing Gaps:** Số khung giờ mở cửa có giao dịch nhưng 0 nhân viên trực.
2. **Hour Limit Warnings:** Số nhân viên đang vượt `maxWeeklyHours` (phản ánh rõ các ca Manager ghi đè bằng tay).
3. **Demand Coverage:** Mức độ đáp ứng nhu cầu nhân sự ước lượng trên toàn tuần.
4. **Fairness:** Chỉ số Jain trên tỷ lệ sử dụng quỹ giờ $u_i$:

$$J(u) = \frac{\left(\sum_{i=1}^{n} u_i\right)^2}{n \sum_{i=1}^{n} u_i^2}$$

- **Quy tắc tính biên:** Chỉ tính trên nhóm nhân viên có `maxWeeklyHours > 0`. Nếu toàn bộ nhân viên chưa được xếp giờ nào ($\sum u_i = 0$), hiển thị **`–`** (tuyệt đối không hiển thị `1.0`). Fairness là chỉ số đo độ đồng đều tỷ lệ sử dụng giờ, được đọc song hành với Demand Coverage chứ không đại diện cho mức độ đủ người.

### 3.5 Quy tắc Tác động khi Sửa / Xóa Staff và Shift

- **Xóa Staff hoặc Shift đang được sử dụng:** Không xóa âm thầm. Phải hiển thị số lượng assignment bị ảnh hưởng và yêu cầu xác nhận trước khi xóa.
- **Đồng bộ sau xác nhận:** Gỡ các assignment liên quan và lập tức tính lại: lưới lịch tuần, tổng giờ từng nhân viên, bảng Aggregated Summary (2.6) và 4 tín hiệu Schedule Health.

### 3.6 Hợp đồng CSV Importer

- Tự nhận diện thứ trong tuần từ tên ngày hoặc ngày tháng ở header; không giả định cột đầu tiên là Thứ Hai (ví dụ file mẫu `report_Transaction_20260807_20260813.csv` bắt đầu từ Thứ Sáu).
- Chuẩn hóa và ánh xạ toàn bộ dữ liệu về thứ tự **Monday → Sunday** trước khi lưu.
- Kiểm tra tính toàn vẹn: đủ 7 ngày, đủ 16 khung giờ (`07:00`–`22:00`), không thiếu giờ, không trùng giờ, số lượng giao dịch là số nguyên không âm.
- Nếu file không hợp lệ: giữ nguyên dữ liệu cũ (không ghi đè) và thông báo lỗi chỉ rõ cột/ngày/giờ vi phạm nếu xác định được.

## 4. Phạm vi Cố tình Loại trừ (Explicitly Out-of-Scope)

| **Hạng mục loại trừ** | **Lý do Product** |
| :--- | :--- |
| **Backend, Database server, Auth, Multi-user, RBAC** | Đề bài xác định rõ client-side + `LocalStorage` là phù hợp và Auth/Multi-user nằm ngoài phạm vi; ưu tiên chạy 1–2 lệnh và phản hồi live tức thì. |
| **Per-staff Availability / Days off** | Thuộc Stretch Goal; lược bỏ để tránh làm nặng khâu nhập liệu cốt lõi và giữ UI tập trung vào bài toán phân bổ theo nhu cầu. |
| **Roles / Skills (VD: Supervisor bắt buộc)** | Thuộc Stretch Goal; tránh biến bài toán MVP thành lập lịch đa kỹ năng phức tạp. Cấu trúc `Staff` vẫn được giữ sạch để dễ mở rộng sau. |
| **Drag-and-Drop phức tạp** | Thuộc Stretch Goal; ưu tiên thao tác **Click-to-assign / 1-click Swap** nhanh, ít lỗi, thân thiện bàn phím và dễ kiểm soát cảnh báo hơn. |
| **Ca làm việc qua đêm & phút lẻ** | Khung dữ liệu mẫu là `07:00–23:00`; dùng giờ chẵn giúp khớp 1-1 với lưới 1-hour cell ở bảng 2.6. |
| **Payroll, Timesheet, Luật lao động đa khu vực** | Tập trung hoàn toàn vào **Weekly Schedule Planning** đúng đề bài, không mở rộng sang HRM/Payroll. |

## 5. Bộ Giả định Đã Đóng băng (Frozen Decisions)

| **ID** | **Quyết định đã đóng băng** |
| :--- | :--- |
| **F-01** | Một `Schedule` đại diện cho một tuần **Monday–Sunday**. |
| **F-02** | Giờ làm việc dùng đơn vị giờ nguyên theo khoảng nửa mở $[start, end)$, không hỗ trợ ca qua đêm (VD: `07:00–15:00` phủ các giờ `07`–`14`, tương đương 8 staff-hours). |
| **F-03** | Khung giờ hoạt động MVP là **`07:00–23:00`**, gồm **16 hourly cells** mỗi ngày _(đây là giả định sản phẩm cho MVP khớp phạm vi dữ liệu mẫu, không phải trường giờ mở cửa do đề bài bắt buộc)_. |
| **F-04** | `Auto-schedule` bắt buộc tôn trọng `maxWeeklyHours`, không xếp chồng thời gian và tối đa 1 ca/ngày _(quy tắc 1 ca/ngày là giả định đơn giản hóa của MVP; chưa chặn cứng Clopening ở MVP nhưng tách sẵn hàm kiểm tra để dễ bật thêm)_. |
| **F-05** | Chỉnh sửa thủ công có thể tạo cảnh báo vượt giờ hoặc trùng ca, nhưng không chặn cứng thao tác của Manager. |
| **F-06** | Fairness đo bằng tỷ lệ sử dụng quỹ giờ (`utilization ratio`) và Jain Index; đây là chỉ số đánh giá đi cùng độ phủ, không phải mục tiêu duy nhất của bộ giải. |
| **F-07** | Pinning áp dụng ở cấp từng assignment (`Staff + Shift + Day`); assignment đã pin được bảo vệ khỏi thay đổi tự động và chặn chạy tự động nếu tự gây xung đột giờ hợp đồng. |
| **F-08** | Dữ liệu CSV được chuẩn hóa về `Monday–Sunday` trước khi lưu; import lỗi không làm mất dữ liệu hiện có. |
| **F-09** | Bảng Aggregated Summary và 4 tín hiệu Schedule Health được tính lại ngay lập tức sau mọi thay đổi dữ liệu. |
| **F-10** | Kiến trúc Client-side + `LocalStorage`; không triển khai backend, authentication hoặc multi-user. |

## 6. Điểm Mở Bàn giao sang Các Phase Tiếp theo

1. **Sang Phase 2 & 3 (`02-manager-workflow.md` & `03-domain-model.md`):** Chốt mô hình **Shift Template dùng lại cho cả tuần** (theo hướng nghiêng đã thống nhất) và định nghĩa rõ tác động dây chuyền khi sửa `startTime`/`endTime` của một Shift Template đang có nhân viên được gán ở nhiều ngày (kể cả khi việc sửa giờ khiến một assignment vượt `maxWeeklyHours` hoặc trùng ca).
2. **Sang Phase 4 (`04-optimization-spec.md`):** Chốt công thức quy đổi `Transactions` $\rightarrow$ `N` $\rightarrow$ `Required staff per hour` $\rightarrow$ `Required staff per shift` và kiểm thử trên file CSV mẫu.