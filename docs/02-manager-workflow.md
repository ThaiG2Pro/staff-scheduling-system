**Tham chiếu:** `01-product-scope.md` (Frozen — Phase 1)

## 1. Tổng quan Hành trình Lập lịch Tuần

Quy trình lập lịch của Store Manager gồm **khởi tạo & chuẩn bị đầu vào (1–3)**, một **vòng lặp rà soát và tinh chỉnh trực tiếp (4 → 5 → 6)** cho đến khi đạt mục tiêu vận hành, và **lưu trữ để tiếp tục làm việc bất kỳ lúc nào (7)**:

```text
1. Entry Point
      │
      ▼
2. Prepare (Demand, Staff, Shifts)
      │
      ▼
3. Generate (Chọn N & Chạy Auto-schedule) ◀──────────────────┐
      │                                                      │
      ▼                                                      │
4. Review Health & Roster                                    │
      │                                                      │
      ▼                                                      │
5. Adjust & Pin (Sửa tay / Chỉnh Staff-Shift) ◀────┐         │
      │                                            │         │
      ▼                                            │         │
6. Validate Summary                                │         │
      ├── Chưa đạt (cần sửa tay) ──────────────────┘         │
      ├── Chưa đạt (cần đổi N / thêm Shift / chạy lại) ──────┘
      │
      ▼
7. Persist & Resume (Tự động lưu & Khôi phục nguyên vẹn)
```

## 2. Luồng Chính theo 7 Giai đoạn (Core Workflow)

### Giai đoạn 1: Entry Point (Khởi điểm & Quản lý Schedule)

* **Hành động của Manager:** Mở ứng dụng; chọn một Schedule đã có, tạo mới một Schedule trống, nạp nhanh **Demo Store**, đổi tên (**Rename**) hoặc xóa (**Delete**) một Schedule.

* **Quyết định của Manager:** Làm việc trên lịch tuần mới, tiếp tục lịch cũ, đổi tên cho dễ quản lý hay dọn bỏ lịch không còn dùng.

* **Phản hồi của Hệ thống:**
  * Mở đúng Schedule đã chọn kèm toàn bộ trạng thái đã lưu.
  * Khi tạo mới: khởi tạo một tuần `Monday–Sunday` trống, seed sẵn 2 Shift Template mặc định (`07:00–15:00` và `15:00–23:00`).
  * Khi nạp Demo Store: khởi tạo lịch mẫu đầy đủ (dữ liệu giao dịch chuẩn hóa `Mon–Sun`, danh sách nhân viên đa dạng quỹ giờ và 2 ca mặc định).
  * Khi đổi tên: cập nhật ngay tên Schedule.
  * **Khi xóa Schedule:** Yêu cầu xác nhận trước khi xóa để tránh mất dữ liệu. Sau khi xóa Schedule hiện tại, hệ thống **luôn quay về Schedule List**; nếu không còn Schedule nào trong danh sách, hiển thị **Empty State** với hai hành động: **Create Schedule** và **Load Demo Store**.

* **Tiêu chí hoàn thành:** Manager đang đứng trong một Schedule hợp lệ để bắt đầu chuẩn bị hoặc chỉnh sửa dữ liệu.

### Giai đoạn 2: Prepare (Chuẩn bị Đầu vào: Demand, Staff, Shifts)

* **Hành động của Manager:**
  1. Tải lên (hoặc kiểm tra) file CSV giao dịch theo giờ.
  2. Thêm, sửa hoặc xóa nhân viên cùng giới hạn giờ tối đa/tuần (`maxWeeklyHours`).
  3. Rà soát 2 ca mặc định; thêm, sửa hoặc xóa các **Shift Template** dùng lại cho cả tuần `Monday–Sunday` (ví dụ: thêm ca cao điểm `11:00–15:00`).

* **Quyết định của Manager:** Xác định đội hình tuần này, mức giờ trần của từng người và tập khung ca làm việc phù hợp với cửa hàng.

* **Phản hồi của Hệ thống:**
  * **Quy tắc nạp CSV:** Mỗi Schedule chỉ sử dụng **một bộ dữ liệu giao dịch** cho tuần đó. Khi file CSV mới hợp lệ, hệ thống chuẩn hóa theo thứ tự `Monday–Sunday` (16 khung giờ `07:00–22:00`) và **thay thế toàn bộ bộ dữ liệu giao dịch hiện tại** sau khi xác thực thành công (không gộp hay cộng dồn), đồng thời tính lại Aggregated Summary và 4 tín hiệu Schedule Health (không tự động chạy lại Auto-schedule). Nếu file CSV không hợp lệ, giữ nguyên dữ liệu cũ (E-01).
  * Cập nhật danh sách nhân viên, tổng quỹ giờ hợp đồng toàn đội và danh mục Shift Template.
  * Thể hiện rõ trạng thái sẵn sàng cho bước tạo lịch tự động (đủ dữ liệu giao dịch, có nhân viên hợp lệ và tối thiểu 1 Shift Template).

* **Tiêu chí hoàn thành:** Schedule có đủ dữ liệu giao dịch hợp lệ, danh sách nhân viên có `maxWeeklyHours > 0` và tối thiểu 1 Shift Template hợp lệ trong khung `07:00–23:00`.

### Giai đoạn 3: Generate (Thiết lập hệ số `N` & Chạy Auto-schedule)

* **Hành động của Manager:** Rà soát hoặc điều chỉnh hệ số mục tiêu `N` (số giao dịch/giờ mỗi nhân viên xử lý), sau đó bấm **Auto-schedule**.

* **Quyết định của Manager:** Chọn mức tải mục tiêu `N` và chủ động kích hoạt hệ thống tạo bản nháp (hoặc chạy lại phần chưa pin sau khi đã chốt tay một số ca).

* **Phản hồi của Hệ thống:**
  * Sinh bản nháp lịch tuần phân bổ nhân viên vào các ca theo ngày (giữ nguyên 100% các assignment đã pin).
  * Hiển thị tóm tắt kết quả chạy: mức độ đáp ứng nhu cầu, tổng quỹ giờ đã phân bổ, phần giờ còn thiếu (nếu thiếu nhân sự) hoặc quỹ giờ chưa sử dụng (nếu thừa công suất).
  * Cập nhật ngay lưới lịch tuần, tổng giờ từng nhân viên, bảng Aggregated Summary và toàn bộ 4 tín hiệu Schedule Health.

* **Tiêu chí hoàn thành:** Một bản nháp lịch tuần hợp lệ (không tự vi phạm ràng buộc cứng) được tạo ra để Manager rà soát.

### Giai đoạn 4: Review (Rà soát Schedule Health & Lịch tuần)

* **Hành động của Manager:** Đọc nhanh **4 tín hiệu độc lập trên Schedule Health** (*Staffing Gaps*, *Hour Limit Warnings*, *Demand Coverage*, *Fairness — Jain Index*), quét lưới lịch tuần theo ngày × ca và đối chiếu tiến độ giờ từng nhân viên (`assigned / max`).

* **Quyết định của Manager:** Đánh giá bản nháp hiện tại đã đáp ứng nhu cầu cửa hàng chưa và xác định cụ thể các điểm cần can thiệp tay (giờ mở cửa trống người, ngày cao điểm mỏng nhân sự, nhân viên cần đổi ca theo thực tế cửa hàng).

* **Phản hồi của Hệ thống:**
  * Hiển thị riêng biệt trạng thái và giải thích của từng tín hiệu sức khỏe (khi chưa xếp giờ nào, Fairness hiển thị `–`).
  * Hiển thị rõ `assigned / max` cho từng nhân viên; chỉ gắn cảnh báo vượt giờ với nhân viên có `assigned > maxWeeklyHours` (nhân viên chạm đúng `assigned == maxWeeklyHours` là trạng thái đạt trần hợp lệ, không phải cảnh báo vi phạm).
  * Làm nổi bật các cảnh báo khác nếu có từ thao tác sửa tay (như 2 ca/ngày hoặc trùng thời gian ca) ngay tại assignment/nhân viên liên quan.

* **Tiêu chí hoàn thành:** Manager nắm rõ chính xác những điểm ổn định và những chỗ cần điều chỉnh tay.

### Giai đoạn 5: Adjust & Pin (Điều chỉnh Trực tiếp)

* **Hành động của Manager:**
  * Gán thêm nhân viên vào một ca trong ngày.
  * Đổi người (Reassign / Swap) cho một assignment hiện có.
  * Gỡ nhân viên khỏi ca.
  * **Pin / Unpin** từng assignment cụ thể (`Staff + Shift + Day`) để bảo vệ quyết định thủ công trong lần chạy Auto-schedule sau.
  * (Khi cần) Thêm, sửa hoặc xóa Staff hoặc Shift Template ngay trong lúc tinh chỉnh.

* **Quyết định của Manager:** Chọn ứng viên phù hợp từ danh sách hướng dẫn hoặc chủ động xác nhận ghi đè cảnh báo mềm khi có tình huống khẩn cấp; quyết định cố định những ca nào và khi nào cần chạy lại Auto-schedule.

* **Phản hồi của Hệ thống:**
  * Khi gán/đổi người, hiển thị **Assignment Guidance** tách 2 nhóm:
    * **`Eligible`:** Thỏa mọi điều kiện gán ca của hệ thống, kèm thông tin quỹ giờ còn lại (VD: *Còn 8h quỹ hợp đồng*).
    * **`Requires attention`:** Ghi rõ từng lý do cảnh báo (*Đã có ca trong ngày*, *Bị trùng thời gian với ca khác*, *Việc gán ca sẽ vượt giới hạn tuần +Xh*).
  * Cho phép chọn ứng viên nhóm `Requires attention` sau thao tác xác nhận rõ ràng (không chặn cứng).
  * **Quy tắc Pin khi Reassign:** Khi đổi nhân viên cho một assignment đang được Pin, assignment cũ bị thay thế bằng assignment mới; **trạng thái Pin không tự động chuyển sang nhân viên mới**. Manager có thể chủ động Pin assignment mới nếu muốn.
  * **Tách biệt cập nhật dữ liệu với chạy lại bộ giải:** Mọi thao tác chỉnh sửa assignment, Staff hoặc Shift Template đều **chỉ** cập nhật ngay dữ liệu liên quan, tổng giờ, cảnh báo, bảng Aggregated Summary và 4 tín hiệu Schedule Health — **tuyệt đối không tự động chạy lại Auto-schedule**. Việc tái tạo lịch tự động chỉ diễn ra khi Manager chủ động bấm **Auto-schedule** ở Giai đoạn 3.

* **Tiêu chí hoàn thành:** Các thay đổi thực tế của Manager đã được ghi nhận, các ca quan trọng đã được pin (nếu muốn) và mọi cảnh báo phát sinh đều hiển thị minh bạch.

### Giai đoạn 6: Validate (Kiểm chứng trên Aggregated Summary)

* **Hành động của Manager:** Rà soát bảng **Aggregated Summary** theo ngày × giờ (`Transactions`, `Staff hours`, `Txns / staff hour`) cùng 4 chỉ số tổng tuần (`Total staff hours`, `Total transactions`, `Overall Txns/hr`, `Average Txns/hr`). *(Nếu triển khai Stretch Goal P1: đối chiếu thêm Coverage View).*

* **Quyết định của Manager:**
  * Kiểm tra các khung giờ có **`Transactions > 0` nhưng `Staff hours = 0`** (*Staffing Gaps* — lưu ý phân biệt với khung giờ `Transactions = 0, Staff hours = 0` tuy cùng hiển thị `–` nhưng không phải thiếu nhân sự).
  * Xem xét các khung giờ có tỷ lệ `Txns / staff hour` cao bất thường so với năng lực phục vụ thực tế.
  * Đọc đồng thời `Overall Txns/hr` và `Average Txns/hr` để hiểu cả hiệu suất tổng thể toàn tuần lẫn mức tải trung bình theo từng ô giờ có nhân viên *(không coi sự chênh lệch giữa hai chỉ số này là lỗi tự thân)*.
  * Nếu chưa hài lòng: quay lại **Giai đoạn 5** để chỉnh tay, hoặc điều chỉnh `N`/Staff/Shift rồi quay lại **Giai đoạn 3** để chạy lại Auto-schedule.

* **Phản hồi của Hệ thống:**
  * Hiển thị chính xác 3 giá trị trên từng ô (hiển thị `–` khi `Staff hours = 0`) và 4 chỉ số tổng tuần.
  * Phân biệt rõ về mặt trực quan giữa ô `–` không có giao dịch và ô `–` có giao dịch (*Staffing Gap*), đồng thời làm nổi bật các giờ có mật độ giao dịch/nhân viên cao.

* **Tiêu chí hoàn thành:** Manager xác nhận bảng tổng hợp phản ánh đúng ý đồ bố trí nhân sự và không còn lỗ hổng vận hành ngoài ý muốn.

### Giai đoạn 7: Persist & Resume (Lưu trữ & Tiếp tục Làm việc)

* **Hành động của Manager:** Đóng trình duyệt, tải lại ứng dụng, hoặc chuyển sang Schedule khác rồi quay lại sau. *(Không có trạng thái Publish, Approve hay Finalized trong MVP).*

* **Quyết định của Manager:** Tạm dừng hoặc chuyển đổi ngữ cảnh làm việc mà không sợ mất công sức tinh chỉnh.

* **Phản hồi của Hệ thống:**
  * Tự động lưu liên tục vào bộ nhớ cục bộ sau mỗi thay đổi (dữ liệu giao dịch, Staff, Shift Templates, Assignments, trạng thái pin và hệ số `N`).
  * Khi tải lại ứng dụng hoặc mở lại Schedule: khôi phục đầy đủ dữ liệu đã lưu và tính toán lại ngay bảng Aggregated Summary cùng 4 tín hiệu Schedule Health từ dữ liệu vừa khôi phục.

* **Tiêu chí hoàn thành:** Manager tải lại ứng dụng hoặc mở lại Schedule và tiếp tục làm việc liền mạch với đúng dữ liệu, phân công, pinning và hệ số `N` đã lưu.

## 3. Các Kịch bản Thực địa & Nhánh Ngoại lệ (Operational Scenarios & Exceptions)

| **Mã** | **Kịch bản / Ngoại lệ** | **Hành động của Manager** | **Phản hồi & Hành vi bắt buộc của Hệ thống** |
|---|---|---|---|
| **E-01** | **Upload CSV lỗi** (thiếu ngày/giờ, trùng giờ, giá trị âm/không phải số nguyên, sai định dạng) | Tải lên file CSV không hợp lệ | Giữ nguyên dữ liệu hiện có (không ghi đè); hiển thị thông báo lỗi chỉ rõ cột/ngày/giờ vi phạm (nếu xác định được) để Manager khắc phục. |
| **E-02** | **Chạy Auto-schedule khi thiếu đầu vào** (chưa có dữ liệu giao dịch, 0 nhân viên hợp lệ hoặc 0 Shift Template) | Bấm Auto-schedule (hoặc xem trạng thái nút) | Không chạy bộ giải; thông báo rõ điều kiện nào đang thiếu trước khi có thể chạy tự động (VD: *"Cần ít nhất 1 nhân viên và dữ liệu giao dịch"*). |
| **E-03** | **Xung đột Assignment đã Pin trước khi Auto-schedule** (tập assignment đã pin tự vi phạm ràng buộc cứng: vượt `maxWeeklyHours`, trùng giờ hoặc >1 ca/ngày) | Bấm Auto-schedule | **Không** âm thầm gỡ pin và **không** tạo lịch vi phạm; dừng chạy, liệt kê rõ nhân viên/assignment pin đang gây xung đột và yêu cầu Manager xử lý (gỡ pin hoặc chỉnh giờ) trước. |
| **E-04** | **Thiếu quỹ giờ toàn đội hoặc Thừa công suất** | Bấm Auto-schedule | Sinh bản nháp hợp lệ tốt nhất trong giới hạn hợp đồng; thông báo rõ phần nhu cầu còn thiếu (kèm gợi ý thêm nhân sự / tạo ca tăng cường) hoặc lượng quỹ giờ chưa sử dụng để Manager chủ động xử lý. |
| **E-05** | **Nhân viên báo ốm đột xuất** *(Kịch bản thực địa 2.8)* | Chọn assignment của người nghỉ → đổi sang nhân viên thay thế | Mở Assignment Guidance xếp nhóm `Eligible` lên đầu; nếu assignment cũ đang được Pin, **trạng thái Pin không tự động chuyển sang người mới** (Manager có thể pin lại chủ động). Ngay sau khi thay thế, cập nhật tức thì tổng giờ của cả hai nhân viên, Aggregated Summary và **toàn bộ 4 tín hiệu Schedule Health**. |
| **E-06** | **Tăng cường Thứ 7 đông khách** *(Kịch bản thực địa 2.8)* | Gán thêm nhân viên trực tiếp vào ca Thứ 7 hoặc thêm Shift Template phủ giờ cao điểm rồi gán tay / bấm chạy lại Auto-schedule | Cho phép gán nhanh trực tiếp vào ca Thứ 7; nếu thêm Shift Template mới, ca mới xuất hiện ngay trên lưới tuần (không tự chạy lại bộ giải) và chỉ được đưa vào tối ưu khi Manager bấm Auto-schedule (vẫn bảo toàn các assignment đã pin). |
| **E-07** | **Ghi đè cảnh báo mềm khi sửa tay** (xếp vượt `maxWeeklyHours`, xếp 2 ca/ngày hoặc trùng giờ ca) | Chọn ứng viên nhóm `Requires attention` và xác nhận | Lưu phân công và tách bạch chính xác tín hiệu cảnh báo: **chỉ** bật *Hour Limit Warnings* trên Schedule Health khi `assigned > maxWeeklyHours`; với lỗi 2 ca/ngày hoặc trùng giờ ca, hiển thị cảnh báo tương ứng ngay trên assignment/nhân viên mà **không** gộp vào *Hour Limit Warnings*. |
| **E-08** | **Xóa Staff hoặc Shift Template đang có assignment** | Bấm xóa Staff hoặc Shift Template | Không xóa âm thầm; thông báo số lượng assignment bị ảnh hưởng và yêu cầu xác nhận. Sau khi xác nhận: gỡ toàn bộ assignment liên quan và tính lại ngay tổng giờ nhân viên, Aggregated Summary và 4 tín hiệu Schedule Health. |
| **E-09** | **Sửa giờ (`startTime`/`endTime`) của Shift Template đang có assignment** | Chỉnh khung giờ của một Shift Template dùng lại cho cả tuần (VD: đổi `07:00–15:00` thành `07:00–16:00`) | Thông báo số assignment bị ảnh hưởng; áp dụng khung giờ mới cho **toàn bộ assignment dùng Shift Template đó trên cả 7 ngày**; **giữ nguyên trạng thái pin** của từng assignment; lập tức tính lại tổng giờ, Aggregated Summary, 4 tín hiệu Schedule Health và cảnh báo phát sinh (vượt giờ/trùng giờ). Nếu thay đổi này làm assignment đã pin vi phạm ràng buộc cứng, lần chạy Auto-schedule tiếp theo bắt buộc dừng và xử lý theo **E-03**. |

## 4. Điểm Bàn giao sang Các Tài liệu Tiếp theo

* **Sang `05-ux-spec.md` (Phase 2B):** Hiện thực hóa đúng 7 giai đoạn, 3 quy tắc chuyển trạng thái vừa chốt và 9 kịch bản E-01 → E-09 thành bố cục màn hình, trạng thái, thao tác và phản hồi trực quan — sao cho Manager không phải nhảy qua nhiều trang/form rời rạc trong vòng lặp `Review ↔ Adjust ↔ Validate` và có thể hoàn tất kịch bản **E-05 (thay người báo ốm)** và **E-06 (tăng cường Thứ 7)** trong tối đa **2–3 thao tác**. Tuyệt đối **không** tự mở rộng thêm business logic, trạng thái mới (như Publish/Approve) hay tính năng ngoài `01-product-scope.md`.

* **Sang `03-domain-model.md` (Phase 3):** Chính thức hóa `Shift` là **Shift Template cấp Schedule** dùng lại xuyên suốt `Monday–Sunday`, kèm các quy tắc cascade nhất quán cho **E-08** và **E-09**.