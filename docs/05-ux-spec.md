**Tham chiếu:** `01-product-scope.md` (Frozen), `02-manager-workflow.md` (Frozen)

## 1. Kiến trúc Thông tin & Màn hình (Screens & Navigation)

Ứng dụng gồm **2 màn hình chính** nhằm giữ ngữ cảnh liền mạch cho Manager:

1. **Schedule List (Entry Point & Home):**
   * Hiển thị danh sách các Schedule đã lưu (tên, số nhân viên, tổng giờ đã xếp, trạng thái đã nạp CSV hay chưa), kèm nút **Create Schedule** và **Load Demo Store**.
   * Mỗi mục hỗ trợ 3 thao tác: **Open**, **Rename** (inline hoặc modal nhỏ), **Delete** (có hộp thoại xác nhận).
   * **Empty State** (khi chưa có Schedule nào hoặc sau khi xóa Schedule cuối cùng): hiển thị thông điệp ngắn gọn cùng 2 hành động: **Create Schedule** và **Load Demo Store**.

2. **Schedule Workspace (Màn hình làm việc chính):**
   * Gom toàn bộ vòng lặp *Prepare → Generate → Review → Adjust → Validate* trong một không gian thống nhất để Manager thấy ngay tác động của từng thao tác mà không phải mở nhiều trang rời rạc.

## 2. Bố cục Schedule Workspace (Layout Regions)

Workspace chia thành **4 vùng cố định** (tối ưu cho màn hình Desktop 1280px+):

| **Vùng giao diện** | **Nội dung & Vai trò** |
| :--- | :--- |
| **1. Top Action Bar** | Nút quay về **Schedule List**, Tên Schedule (hỗ trợ **Rename** inline và nút **Delete Schedule**), chỉ báo tự động lưu thụ động (*"Saved locally"* — không có trạng thái Publish/Finalize), nút **Import CSV**, nút **Manage Shifts**, ô chỉnh hệ số mục tiêu **`N` (txns/staff hr)** và nút chính **Auto-schedule**. |
| **2. Schedule Health Bar** | Dải trạng thái cố định ngay dưới Top Bar, hiển thị **4 tín hiệu độc lập** (không gộp điểm 0–100):<br><br>1. **Staffing Gaps:** số ô giờ có `Transactions > 0` và `Staff hours = 0`. **Trạng thái cảnh báo** (biểu tượng + màu sắc) khi số Gap > 0.<br><br>2. **Hour Limit Warnings:** số nhân viên có `assigned > maxWeeklyHours`. **Trạng thái cảnh báo** (biểu tượng + màu sắc) khi có từ 1 nhân viên vượt giới hạn trở lên.<br><br>3. **Demand Coverage:** hiển thị giá trị độ phủ và dòng giải thích ngắn; **chưa tự đặt ngưỡng màu tốt/trung bình/xấu** (chờ công thức và ngưỡng định lượng từ `04-optimization-spec.md`).<br><br>4. **Fairness (Jain Index):** hiển thị giá trị `0.00–1.00`, hoặc `–` khi toàn bộ nhân viên chưa có giờ nào, kèm giải thích ngắn; **chưa tự đặt ngưỡng màu đánh giá tốt/xấu** (chờ `04-optimization-spec.md`).<br><br>Mỗi tín hiệu đều có dòng giải thích ngắn (`tooltip/subtext`). |
| **3. Main Split Workspace** | Chia 2 cột song song để hỗ trợ trực tiếp vòng lặp *Review ↔ Adjust*:<br><br>• **Trái (~75%): Tabbed Core View** chuyển đổi tức thì giữa 2 tab **Weekly Roster** (mặc định) và **Aggregated Summary** (kết hợp thanh Health Bar luôn ghim để tránh rối mắt trên 1 màn hình).<br><br>• **Phải (~25%): Staff Panel** luôn hiển thị cạnh Roster, liệt kê danh sách nhân viên, thanh tiến độ giờ `assigned / max`, nút **Add Staff** và thao tác **Edit / Delete**. |
| **4. Contextual Banners** | Xuất hiện ngay dưới Schedule Health Bar khi cần thông báo kết quả chạy Auto-schedule (E-04), lỗi xung đột Pin (E-03) hoặc lỗi Import CSV (E-01), có nút đóng rõ ràng. |

## 3. Thiết kế Chi tiết các Thành phần Tương tác (Interaction Design)

### 3.1 Weekly Roster (Bố cục Shift-first)

* **Cấu trúc lưới:**
  * **Cột:** 7 cột cố định theo thứ tự **`Mon`, `Tue`, `Wed`, `Thu`, `Fri`, `Sat`, `Sun`** (F-01).
  * **Hàng:** Mỗi hàng là một **Shift Template** (VD: `07:00 – 15:00 (8h)`, `15:00 – 23:00 (8h)`), sắp xếp theo `startHour` tăng dần. Đầu hàng có thao tác sửa/xóa nhanh Shift Template.

* **Trong mỗi ô `(Shift × Day)`:**
  * Hiển thị danh sách **Assignment Chips** (tên nhân viên được gán).
  * **Thao tác trực tiếp trên từng Assignment Chip:**
    * Biểu tượng **Pin (`📌`)**: bấm 1 lần để bật/tắt Pin cho đúng assignment (`Staff + Shift + Day`). Chip đã Pin có nhãn và viền khác biệt rõ ràng với chip chưa Pin.
    * Bấm vào tên chip → mở **Assignment Guidance Popover** ở chế độ **Reassign** (kèm lựa chọn gỡ nhanh).
    * Nút **`×`** nhỏ trên chip → gỡ nhân viên khỏi ca ngay lập tức (không cần modal xác nhận).
    * **Cảnh báo cục bộ trên chip:** Nếu assignment gây **2 ca/ngày** hoặc **trùng thời gian ca** (E-07), hiển thị icon cảnh báo kèm tooltip nêu rõ lý do ngay trên chip (không gộp vào *Hour Limit Warnings*).
  * Nút **`+ Add`** luôn hiển thị ở cuối ô → mở **Assignment Guidance Popover** ở chế độ **Assign**.

### 3.2 Assignment Guidance Popover (Thao tác Assign & Reassign — E-05, E-06, E-07)

* **Phạm vi thao tác chốt cho MVP:** Chỉ triển khai thao tác **`Assign`** (gán mới vào ca) và **`Reassign`** (đổi nhân viên của một assignment hiện có). Không xây dựng luồng **2-way Swap** (hoán đổi đồng thời 2 nhân viên trên 2 assignment khác nhau) trong MVP.
* Mở inline sát ô/chip đang thao tác (không chuyển trang, không che toàn màn hình), chia danh sách nhân viên thành **2 nhóm tách biệt** (không dùng nhãn *"Khả dụng/Available"*):
  1. **`Eligible` (Đứng đầu):** Nhân viên thỏa mọi điều kiện gán ca của hệ thống. Mỗi dòng hiển thị Tên nhân viên + số giờ hiện tại và quỹ giờ còn lại (VD: *`Minh — 16/32h • Còn 8h sau khi gán`* hoặc *`Còn 16h quỹ hợp đồng`*). Bấm 1 chạm để Assign/Reassign ngay.
  2. **`Requires attention` (Bên dưới, phân tách rõ):** Nhân viên có cảnh báo, liệt kê cụ thể từng lý do:
     * *Đã có ca trong ngày*
     * *Trùng thời gian với ca [HH:00–HH:00]*
     * *Việc gán ca sẽ vượt giới hạn tuần +Xh (vd: 44/40h)*
     * **Xác nhận ghi đè mềm:** Bấm vào ứng viên thuộc nhóm này sẽ mở bước xác nhận inline 1 chạm (*"Xác nhận gán kèm cảnh báo?"* + **Confirm** / **Cancel**), bảo đảm Manager ghi đè có chủ đích mà không bị chặn cứng (F-05).
* **Hành vi Pin khi Reassign (E-05):** Khi Reassign một assignment đang được Pin, assignment cũ bị thay thế bằng assignment mới; **assignment mới mặc định ở trạng thái `Unpinned`**. Popover hiển thị ghi chú rõ ràng và Manager phải chủ động Pin lại nếu muốn bảo vệ quyết định mới trong lần chạy Auto-schedule tiếp theo.

### 3.3 Staff Panel & Staff Form (Cột phải cố định — P0 Staff CRUD)

* Hiển thị tổng quỹ giờ hợp đồng và tổng giờ đã xếp của toàn đội (VD: *`Team capacity: 240h • Assigned: 192h`*), danh sách nhân viên, nút **Add Staff** và thao tác **Edit / Delete** trên từng dòng.
* Mỗi dòng nhân viên gồm: Tên, thanh tiến độ giờ `assigned / max` (VD: `32 / 40h`), nút **Edit** và nút **Delete**.
* **Phân biệt trạng thái giờ chính xác (Giai đoạn 4 & E-07):**
  * `assigned < maxWeeklyHours`: trung tính.
  * `assigned === maxWeeklyHours`: hiển thị đạt trần hợp lệ (không gắn màu/icon cảnh báo).
  * `assigned > maxWeeklyHours`: hiển thị badge cảnh báo đỏ **`+Xh over`** (khớp 1-1 với *Hour Limit Warnings* trên Schedule Health Bar).
  * Nếu nhân viên có cảnh báo **2 ca/ngày** hoặc **trùng thời gian ca**, hiển thị biểu tượng cảnh báo riêng cạnh tên kèm tooltip chỉ rõ ngày bị ảnh hưởng (tách biệt hoàn toàn với cảnh báo vượt giờ tuần).
* Bấm vào tên nhân viên trên Staff Panel sẽ **highlight nhẹ** các ca của nhân viên đó trên Weekly Roster để quét nhanh lịch cá nhân.
* **Staff Form Drawer/Modal (Add / Edit Staff):**
  * Chỉ gồm đúng **2 trường dữ liệu** theo Product Scope (không thêm availability, role hay skills):
    1. **Staff Name** (bắt buộc, không rỗng).
    2. **Maximum Weekly Hours (`maxWeeklyHours`)** (số nguyên không âm; lưu ý chỉ nhân viên có `maxWeeklyHours > 0` được tính vào Jain Index và tham gia Auto-schedule).
  * Gồm 2 nút hành động: **Save** và **Cancel**.
  * Sau khi bấm **Save**: cập nhật ngay Staff Panel, tổng giờ/cảnh báo liên quan, Aggregated Summary và cả 4 tín hiệu Schedule Health (không tự động chạy lại Auto-schedule).

### 3.4 Quản lý Shift Templates, Xóa Staff/Shift & Nhập CSV (E-01, E-08, E-09)

* **Manage Shifts Drawer/Modal:**
  * Liệt kê các Shift Templates dùng lại cho cả tuần `Mon–Sun`, kèm nút **Add Shift** (`startHour`, `endHour` nguyên thuộc `07:00–23:00`, `startHour < endHour`).
  * **Sửa giờ Shift Template (E-09):**
    * Nếu Shift đang có assignment, hiển thị số lượng assignment chịu ảnh hưởng trên cả 7 ngày trước khi lưu (*"Thay đổi áp dụng cho X phân công trên cả tuần; trạng thái Pin của từng phân công sẽ được giữ nguyên"*).
    * Sau khi lưu: áp dụng khung giờ mới cho toàn bộ assignment dùng Shift Template đó trên cả 7 ngày, giữ nguyên trạng thái Pin, và tính lại ngay Weekly Roster, tổng giờ nhân viên, Aggregated Summary và cả 4 tín hiệu Schedule Health.
    * **Cảnh báo phát sinh sau khi sửa giờ:** Nếu khung giờ mới khiến assignment vi phạm ràng buộc, hiển thị cảnh báo ngay tại assignment và nhân viên liên quan — chỉ *Hour Limit Warnings* phản ánh việc vượt `maxWeeklyHours`; lỗi trùng giờ hoặc 2 ca/ngày được hiển thị riêng. **Không** tự động xóa assignment và **không** tự động chạy lại Auto-schedule.

* **Xóa Staff hoặc Shift Template đang có assignment (E-08):**
  * Không xóa âm thầm. Mở hộp thoại xác nhận nêu rõ: *"Xóa [Tên] sẽ gỡ bỏ X phân công đang có trong lịch tuần"*.
  * **Hành vi sau khi xác nhận (Confirm):** Gỡ bỏ toàn bộ assignment liên quan, cập nhật ngay Weekly Roster, tổng giờ nhân viên, Aggregated Summary và cả **4 tín hiệu Schedule Health**. **Không** tự động chạy lại Auto-schedule.

* **CSV Import Modal / Dropzone (E-01 & Giai đoạn 2):**
  * Hỗ trợ chọn hoặc kéo-thả file `.csv`. Nếu Schedule đã có dữ liệu giao dịch, hiển thị thông báo trước khi nạp: *"File hợp lệ mới sẽ thay thế toàn bộ dữ liệu giao dịch hiện tại của tuần này"*.
  * Khi hợp lệ: xác nhận số ngày đã chuẩn hóa về `Mon–Sun` và tổng giao dịch; thay thế toàn bộ bộ dữ liệu giao dịch cũ và cập nhật ngay Aggregated Summary cùng 4 tín hiệu Schedule Health (không tự động chạy lại Auto-schedule).
  * Khi lỗi: đóng khung lỗi màu đỏ liệt kê cụ thể **cột / ngày / giờ** vi phạm (nếu xác định được) và xác nhận *"Dữ liệu giao dịch cũ vẫn được giữ nguyên"*.

### 3.5 Aggregated Summary View (Mục 2.6 + P1 Conditional Coverage View)

* **Hàng KPI Tổng tuần (4 thẻ bắt buộc phía trên bảng):**
  1. **Total Transactions** (tổng giao dịch toàn tuần)
  2. **Total Staff Hours** (tổng giờ nhân sự đã xếp)
  3. **Overall Txns / Staff Hour** (`Total Transactions ÷ Total Staff Hours`, hiện `–` khi `Total Staff Hours = 0`)
  4. **Average Txns / Staff Hour** (trung bình cộng các ô có `Staff hours > 0`, hiện `–` khi không có ô nào có nhân viên), kèm ghi chú ngắn giải thích sự khác biệt với *Overall*.

* **Lưới Chi tiết P0 (7 cột `Mon–Sun` × 16 hàng `07:00–22:00`):**
  * *(Không đưa hàng Tổng ngày vào phạm vi bắt buộc P0 để giữ đúng dữ liệu yêu cầu tại `01-product-scope.md`).*
  * Mỗi ô hiển thị gọn **3 giá trị xếp tầng** theo thứ tự dễ quét:
    * Dòng 1: `Transactions` (VD: `48 txns`)
    * Dòng 2: `Staff hours` (VD: `3 staff`)
    * Dòng 3 (nhấn đậm): `Txns / staff hour` (VD: `16.0/h`, hoặc `–` khi `Staff hours = 0`)
  * **Mã hóa trực quan rõ ràng (không dùng màu đơn lẻ):**
    * **Staffing Gap** (`Transactions > 0` và `Staff hours = 0`): nền đỏ nhạt + viền/biểu tượng cảnh báo + nhãn `– (Gap)`.
    * **Không có giao dịch & không có nhân viên** (`Transactions = 0` và `Staff hours = 0`): nền trung tính + chữ `–` (không tô cảnh báo).
    * **Tải cao** (`Txns / staff hour > N`): nền cam nhạt + ký hiệu mũi tên tăng / nhãn nổi bật để Manager nhận diện nhanh các khung giờ có tỷ lệ giao dịch/nhân viên cao hơn mức mục tiêu `N`.

* **P1 — Conditional Stretch Goal (Coverage View Toggle):**
  * Nút chuyển đổi `Metrics View` (P0) ↔ `Coverage View` (P1 — chỉ triển khai sau khi toàn bộ P0 hoàn tất và pass kiểm thử nghiệp vụ). Khi bật `Coverage View`, mỗi ô hiển thị `scheduled / required` và độ lệch có dấu (`-2`, `0`, `+1`) kèm ký hiệu trực quan.

## 4. Ma trận Trạng thái & Phản hồi Hệ thống (System States & Feedback)

| **Tình huống / Ngoại lệ** | **Trạng thái UI & Phản hồi cụ thể** |
| :--- | :--- |
| **Chưa đủ đầu vào để Auto-schedule (E-02)** | Nút **Auto-schedule** ở trạng thái disabled (hoặc hiển thị thông báo inline khi bấm), kèm tooltip/helper text chỉ rõ điều kiện đang thiếu (*"Cần nạp CSV giao dịch"*, *"Cần ít nhất 1 nhân viên có giờ > 0"*, hoặc *"Cần ít nhất 1 ca làm việc"*). |
| **Xung đột Pin trước khi Auto-schedule (E-03)** | Không thay đổi lịch hiện tại và không gỡ Pin; hiển thị Banner lỗi màu đỏ liệt kê từng nhân viên/assignment đã Pin bị vi phạm ràng buộc cứng kèm nút điều hướng nhanh/highlight trực tiếp các chip đó trên Roster để Manager gỡ Pin hoặc chỉnh giờ trước. |
| **Kết quả Auto-schedule thành công (E-04)** | Hiển thị Banner thông tin ngay trên Roster tóm tắt: số phân công mới, số assignment Pin được giữ nguyên, tổng giờ đã dùng, cùng cảnh báo rõ ràng nếu **thiếu quỹ giờ** (*"Còn X giờ nhu cầu chưa thể phủ do hết quỹ giờ hợp đồng"*) hoặc **dư công suất** (*"Còn dư Y giờ hợp đồng chưa sử dụng"*). |
| **Schedule trống chưa có dữ liệu** | Trong vùng Roster: hướng dẫn 3 bước ngắn (*1. Import CSV → 2. Add Staff → 3. Run Auto-schedule*) kèm nút tắt **Load Demo Store**. |
| **Tải lại trang / Đổi Schedule (Giai đoạn 7)** | Tự động khôi phục đúng Schedule gần nhất (hoặc Schedule List nếu chưa mở lịch nào) từ `LocalStorage` với 100% dữ liệu, Pin và hệ số `N`, sau đó tính lại ngay Aggregated Summary và cả 4 tín hiệu Schedule Health. |

## 5. Khả năng Truy cập & Thao tác Nhanh (Usability & Accessibility Baseline)

* **Không dùng màu sắc làm tín hiệu duy nhất:** Mọi trạng thái (*Staffing Gap*, *Overtime*, *Overlap / 2 shifts*, *Pinned*) đều đi kèm biểu tượng và nhãn chữ tường minh.
* **Tương phản đọc tốt:** Bảo đảm tỷ lệ tương phản chữ đọc dễ chịu trên mọi ô có nền màu trong bảng 7 × 16 của Aggregated Summary.
* **Tối ưu số thao tác cho 2 kịch bản 2.8:**
  * *Thay người báo ốm (E-05):* 2 cú click (Click chip người nghỉ → Click nhân viên `Eligible` đầu danh sách trong popover Reassign).
  * *Thêm người cho ca Thứ 7 (E-06):* 2 cú click (Click `+ Add` tại ô Thứ 7 → Click nhân viên `Eligible`).