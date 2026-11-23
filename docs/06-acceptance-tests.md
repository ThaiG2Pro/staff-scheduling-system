**Tham chiếu:** `01-product-scope.md`, `02-manager-workflow.md`, `05-ux-spec.md`, `03-domain-model.md`, `04-optimization-spec.md`, `technical-design.md`

## 1. Chiến lược Kiểm thử Tinh gọn

1. **Automated Unit Tests (`pnpm test` — Vitest, 15 test cases):** Phủ trọn vẹn tầng Pure Domain (`decimalMath`, `csvParser`, `derivedMetrics`, `autoScheduler`) và các chốt chặn an toàn ở Persistence & State. Chạy nhanh (dưới 1 giây) — là "lưới an toàn" trực tiếp khi phỏng vấn viên yêu cầu sửa thuật toán tại chỗ.
2. **Manual Manager Walkthrough (Kiểm thử tay trên trình duyệt — đúng yêu cầu mục 2.8):** Tự đóng vai Store Manager thực hiện trọn vẹn các tác vụ thực tế trước khi nộp bài để bắt lỗi UX mà test tự động không thấy được.

*(Ghi chú đồng bộ với `technical-design.md`: Bộ benchmark hiệu năng `pnpm run bench` và `pnpm run bench:browser` được tách riêng khỏi `pnpm test` để tránh fail ngẫu nhiên theo phần cứng, chạy xác minh độc lập ở Slice 5).*

## 2. Bộ Unit Tests Cốt lõi (`pnpm test` — 15 Test Cases)

### 2.1 `decimalMath.test.ts` (2 cases)

| **ID** | **Ca kiểm thử** | **Kiểm chứng bắt buộc** |
| ----- | ----- | ----- |
| **T-01** | Quy đổi chuẩn với `N = 15` | `Transactions` `0, 1, 15, 16, 30, 31` $\to$ `RequiredStaff` `0, 1, 1, 2, 2, 3`. |
| **T-02** | Chống lỗi IEEE-754 với `N` thập phân, Overflow & Round-trip | `(21, 1.4)` $\to$ `15`, `(42, 2.8)` $\to$ `15`, và sát ranh giới `(21, 1.399999999999999)` $\to$ `16`; `DECIMAL_REGEX` parse đúng capture groups cho `"1.4"`, `"1.5e-7"`, `"1.5e+21"`; kết quả vượt `Number.MAX_SAFE_INTEGER` trả `SAFE_INTEGER_OVERFLOW`; kiểm tra Round-trip chuỗi `N` từ chối giá trị mất chính xác như `"1.0000000000000001"`. |

### 2.2 `csvParser.test.ts` (3 cases)

| **ID** | **Ca kiểm thử** | **Kiểm chứng bắt buộc** |
| ----- | ----- | ----- |
| **T-03** | Chuẩn hóa file CSV mẫu (Fri–Thu $\to$ Mon–Sun) & RFC 4180 | Đọc file `report_Transaction_20260807_20260813.csv` (kể cả có UTF-8 BOM `\uFEFF`, `\r\n`, quoted comma `"Fri, 07 Aug 2026"`, escaped quote `""`), ánh xạ đúng 7 ngày liên tiếp theo thứ tự `Mon(0)..Sun(6)` và đủ 16 khung giờ `7..22`. |
| **T-04** | Chấp nhận thứ tự ngày linh hoạt (Weekday-only) | File thuần tên thứ đổi thứ tự (`Wed..Tue`) parse thành công về `Mon–Sun`; đồng thời từ chối nếu trộn lẫn header tên thứ với header ngày lịch trong cùng một file. |
| **T-05** | Fail gracefully trên dữ liệu lỗi (E-01) | Thiếu giờ, trùng giờ, giá trị âm/chữ, multiline quoted field, số vượt `Number.isSafeInteger` (từng ô hoặc tổng 112 ô), ngày lịch không liên tiếp hoặc sai thứ UTC trả về `ok: false` kèm `CsvParseError` cụ thể và không ghi đè dữ liệu giao dịch cũ. |

### 2.3 `derivedMetrics.test.ts` (3 cases)

| **ID** | **Ca kiểm thử** | **Kiểm chứng bắt buộc** |
| ----- | ----- | ----- |
| **T-06** | Khớp ví dụ số học mục 2.6 đề bài | 3 giờ `(33, 3)`, `(48, 3)`, `(33, 2)` cho per-cell `11.0`, `16.0`, `16.5`; `totalTransactions = 114`, `totalStaffHours = 8`, `overall = 14.25` (hiển thị `14.3`), `average = 14.5`. Ô `staffHours = 0` trả `null` (`–`) và phân biệt đúng Staffing Gap (`txns > 0`) với ô trống (`txns = 0`). |
| **T-07** | Union-of-hours khi sửa tay trùng ca | Alice có `07:00–15:00` và `14:00–22:00` cùng ngày $\to$ ô `14:00` tính `staffHours = 1`, `assignedHours = 15`, vẫn bật cảnh báo Overlap và tách biệt khỏi *Hour Limit Warnings* khi tổng giờ chưa vượt `maxWeeklyHours`. |
| **T-08** | `demandCoverage`, Jain Index & ngưỡng Health Bar | Nhân sự dư ở giờ này không bù cho giờ thiếu (`demandCoverage <= 100%`); khi tất cả nhân viên có 0 giờ thì `fairnessJainIndex = null` (`–`), bỏ qua nhân viên `maxWeeklyHours = 0`; khi `eligibleStaffCount === 1` trả `1.0` kèm cờ/ghi chú 1 nhân viên; kiểm tra ngưỡng biên `75%` / `90%` (Coverage) và `80%` / `90%` (Fairness) trên **giá trị số thực đầy đủ chưa làm tròn**. |

### 2.4 `autoScheduler.test.ts` (5 cases)

| **ID** | **Ca kiểm thử** | **Kiểm chứng bắt buộc** |
| ----- | ----- | ----- |
| **T-09** | Ràng buộc cứng, Immutability & Tính xác định (F-04) | Chạy trên dữ liệu tuần mẫu: 0 nhân viên vượt `maxWeeklyHours`, mỗi người tối đa 1 ca/ngày, không trùng giờ; không mutate bất kỳ object/array nào thuộc input snapshot gốc; cùng input với 2 `idGenerator` khác nhau vẫn sinh cùng tập phân bổ `(day, shiftId, staffId)`. |
| **T-10** | Phản ví dụ Best-Fit (`S1`/`S2`) & Ca gối đầu | Với `S1` (`07–15`, 8h), `S2` (`12–16`, 4h), `P` (80h, Pin `S1`), `A` (8h), `B` (4h) $\to$ chọn `B` vào `S2` và `A` vào `S1` đạt `100%` coverage; ưu tiên ca gối đầu ngắn vào giờ cao điểm theo `efficiency`. |
| **T-11** | Bảo toàn Pin & Chặn xung đột Pin (E-03, F-07) | Assignment đã Pin giữ nguyên `id`, `day`, `shiftId`, `staffId`, `isPinned`; khi tập Pin tự vượt `maxWeeklyHours` hoặc có 2 Pin cùng ngày $\to$ trả `BLOCKED_PIN_CONFLICT`, không gỡ Pin và không thay đổi lịch cũ. |
| **T-12** | Tầng 2 Rebalance bảo toàn Độ phủ | Sau Stage 2, `JainIndex` cải thiện (hoặc giữ nguyên khi đã tối ưu), số lượng assignment ở mỗi `(day, shiftId)` và toàn bộ lưới `StaffHours` 112 ô trước/sau bằng nhau tuyệt đối, Pin bất biến, kết quả delta khớp tính lại đầy đủ. |
| **T-13** | Thiếu/dư nhân sự, Overflow & Atomic Commit (E-04) | Quỹ giờ nhỏ hơn nhu cầu $\to$ dừng sạch, báo rõ `uncoverableRequiredStaffHours` và `residualCoverableShortageHours`; quỹ giờ thừa $\to$ dừng tại `100%` coverage và báo `unusedCapacityHours`; khi `FAILED` (thiếu input, `idGenerator` ném lỗi hoặc sinh trùng ID giữa các assignment mới $\to$ `CANDIDATE_VALIDATION_FAILED`, hay tràn `SAFE_INTEGER_OVERFLOW` kể cả ở `unusedCapacityHours` $\to$ `UNEXPECTED_ERROR`) thì `Schedule.assignments` và `updatedAt` giữ nguyên. |

### 2.5 `persistence.test.ts` (2 cases)

| **ID** | **Ca kiểm thử** | **Kiểm chứng bắt buộc** |
| ----- | ----- | ----- |
| **T-14** | Serialize / Hydrate, State Scoping & Cascade | Chỉ lưu Source of Truth + Metadata (`schemaVersion`, `activeScheduleId`); tải lại khôi phục nguyên vẹn và tính lại đúng Derived State; Reassign một assignment đã Pin $\to$ assignment mới mặc định `Unpinned`; Strict Schedule Scoping và chuyển `activeScheduleId` không làm thay đổi `updatedAt`; xóa Staff/Shift cascade sạch assignment không để lại dữ liệu mồ côi. |
| **T-15** | Phòng thủ 4 Storage Modes, Save Error & Atomic Reset | JSON hỏng, chuỗi rỗng `""`, hoặc `N` ngoài `[1, 500]` $\to$ `recovery_locked` (giữ `rawPayload` trong RAM, không tự ghi đè); `schemaVersion > 1` $\to$ `incompatible_version_locked`; `getItem()` lỗi $\to$ `storage_unavailable_locked`; `setItem()` lỗi lúc auto-save $\to$ giữ state RAM và chuyển `saveStatus = 'save_error'`; `setItem()` lỗi lúc Reset $\to$ vẫn giữ trạng thái khóa (Atomic Reset Contract). |

## 3. Manual Store Manager Walkthrough (Chạy tay trên trình duyệt trước khi nộp)

| **#** | **Tác vụ đóng vai Store Manager** | **Kết quả phải đạt** |
| ----- | ----- | ----- |
| **M-01** | **Khởi động & Demo Store:** Mở app lần đầu $\to$ bấm *Load Demo Store* $\to$ bấm *Auto-schedule*. | Trong $< 5$ giây thấy ngay lịch tuần `Mon–Sun`, bảng 2.6 nhảy số mượt, 4 tín hiệu Health Bar hiển thị rõ ràng, không lag. |
| **M-02** | **Tạo lịch từ đầu & Import CSV:** Tạo Schedule mới $\to$ tải file CSV mẫu (`Fri–Thu`) $\to$ thử tải 1 file CSV lỗi. | File mẫu map đúng `Mon–Sun`; file lỗi báo rõ vị trí sai và giữ nguyên dữ liệu cũ (E-01). |
| **M-03** | **Thay người báo ốm (E-05):** Pin 1 ca của nhân viên A $\to$ click chip A $\to$ chọn nhân viên `Eligible` B trong Popover. | Hoàn tất trong 2 cú click; assignment mới của B ở trạng thái `Unpinned`; giờ cả 2 người, Summary và 4 tín hiệu Health Bar cập nhật ngay. |
| **M-04** | **Tăng cường Thứ 7 (E-06):** Tạo thêm Shift Template `11:00–15:00` $\to$ gán thêm người vào Thứ 7 (hoặc bấm chạy lại *Auto-schedule*). | Ca mới xuất hiện ngay trên lưới (không tự chạy lại solver); khi chạy lại *Auto-schedule*, các ca đã Pin giữ nguyên. |
| **M-05** | **Ghi đè cảnh báo mềm (E-07):** Gán 1 nhân viên thuộc `Requires attention` (vượt `maxWeeklyHours`) và 1 nhân viên làm 2 ca/ngày (chưa vượt trần tuần). | Xác nhận inline mượt; chỉ người vượt giờ tuần bật *Hour Limit Warnings*, người 2 ca/ngày hiện cảnh báo cục bộ riêng trên chip & Staff Panel. |
| **M-06** | **Sửa/Xóa Staff & Shift (E-08, E-09):** Kéo dài giờ 1 Shift đang có assignment; sau đó thử xóa 1 Staff đang có ca. | Sửa Shift áp dụng cả 7 ngày, giữ Pin và bật cảnh báo nếu phát sinh vượt giờ/trùng giờ; Xóa báo rõ số assignment bị ảnh hưởng và gỡ sạch sau khi xác nhận. |
| **M-07** | **Xung đột Pin (E-03):** Giảm `maxWeeklyHours` của người đang có ca Pin xuống thấp hơn giờ Pin $\to$ bấm *Auto-schedule*. | Hiện Banner lỗi nêu rõ người xung đột, giữ nguyên lịch và không gỡ Pin. |
| **M-08** | **Persist & Reload:** Sửa `N = 12.5`, chỉnh tay 2 ca, Pin 1 ca $\to$ bấm F5 tải lại trang. | Khôi phục nguyên vẹn 100% trạng thái, `N`, Pin và các bảng tính toán. |
| **M-09** | **Xóa Schedule cuối cùng:** Xóa hết các Schedule hiện có. | Luôn quay về Schedule List ở Empty State với 2 nút *Create Schedule* và *Load Demo Store*. |
| **M-10** | **Kiểm tra nhanh hiệu năng & Recovery:** Mở DevTools thử nhập JSON hỏng vào `localStorage` rồi F5 $\to$ kiểm tra Recovery Banner + nút *Reset & Start Fresh*; kiểm tra thêm cảm giác phản hồi khi chạy *Auto-schedule* với $\sim 20\text{–}30$ nhân viên. | App không crash, không tự ghi đè payload hỏng, khôi phục sạch sau khi xác nhận *Reset & Start Fresh*; nút *Auto-schedule* phản hồi tức thì không khựng. |

## 4. Cổng Chuyển sang P1 (P0 Exit Gate)

Chỉ bật UI toggle **Coverage View (P1)** trên bảng Aggregated Summary sau khi:

1. `pnpm run typecheck` và `pnpm test` (đủ `T-01` $\to$ `T-15`) xanh 100%.
2. Toàn bộ checklist tay `M-01` $\to$ `M-10` đều mượt và không còn lỗi UX.