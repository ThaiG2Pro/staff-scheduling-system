**Tham chiếu:** `01-product-scope.md` (Frozen), `02-manager-workflow.md` (Frozen), `05-ux-spec.md` (Frozen)

## 1. Phân loại Dữ liệu 3 Tầng (Data Classification)

Toàn bộ trạng thái ứng dụng được phân tách thành ba tầng rõ ràng nhằm bảo đảm tính nhất quán, tránh lưu trùng dữ liệu suy diễn và tách bạch metadata điều hướng khỏi mô hình miền:

| **Tầng dữ liệu** | **Nội dung** | **Lưu vào LocalStorage?** | **Quy tắc quản lý** |
| --- | --- | --- | --- |
| **Domain Source of Truth** | `Schedule`, `Staff`, `ShiftTemplate`, `Assignment` (kèm `isPinned`), `DemandDataset`, hệ số `N` | **Có** | Nguồn sự thật duy nhất của nghiệp vụ. Chỉ thay đổi qua các phép đột biến hợp lệ. |
| **Derived State** | `shiftDuration`, `assignedHours`, `remainingHours`, `utilization`, cảnh báo vi phạm, `AssignmentGuidance`, `AggregatedSummary`, 4 tín hiệu `ScheduleHealth` | **Không** | Luôn tính lại thuần túy (deterministic) từ Domain Source of Truth sau mọi thay đổi và ngay khi khôi phục trang (F-09). |
| **Persistence / UI Metadata** | `schemaVersion`, `activeScheduleId` | **Có** | Phục vụ serialization/migration và khôi phục ngữ cảnh điều hướng; không thuộc Domain Model của từng `Schedule`. |

## 2. Thực thể & Bất biến Dữ liệu Gốc (Domain Source of Truth)

### 2.1 Các Kiểu Giá trị Chuẩn hóa & Ý nghĩa "Một Tuần"

* **Tuần tương đối (Relative Typical Week):** Một `Schedule` biểu diễn một **tuần điển hình theo thứ trong tuần (`Monday–Sunday`)**, không gắn với ngày lịch cụ thể (không có trường `weekStartDate`), khớp với đề bài và `05-ux-spec.md` đã Freeze.
* `DayOfWeek`: số nguyên `0 | 1 | 2 | 3 | 4 | 5 | 6` ánh xạ cố định `0 = Mon, 1 = Tue, 2 = Wed, 3 = Thu, 4 = Fri, 5 = Sat, 6 = Sun` (F-01).
* `OperatingHour`: số nguyên `7 | 8 | ... | 22` đại diện cho 16 khung giờ $[h, h+1)$ trong khoảng hoạt động `07:00–23:00` (F-02, F-03).

### 2.2 `Schedule` (Aggregate Root — Top-level Container)

Mỗi `Schedule` là một đơn vị dữ liệu khép kín cho một tuần làm việc độc lập.

| **Trường** | **Kiểu** | **Bắt buộc** | **Quy tắc & Bất biến (Invariants)** |
| --- | --- | --- | --- |
| `id` | `string` (UUID) | Có | Duy nhất trên toàn ứng dụng. |
| `name` | `string` | Có | Chuỗi không rỗng sau khi trim. |
| `createdAt` | `string` (ISO 8601) | Có | Thời điểm khởi tạo, bất biến sau khi tạo. |
| `updatedAt` | `string` (ISO 8601) | Có | Cập nhật theo đúng quy tắc tại mục 2.7. |
| `targetTxnsPerStaffHour` | `number` | Có | Hệ số `N`; số hữu hạn và lớn hơn `0` (`Number.isFinite(N) && N > 0`). Giá trị mặc định và biên nhập liệu chốt tại `04-optimization-spec.md`. |
| `staff` | `Staff[]` | Có | Danh sách nhân viên thuộc Schedule này (mặc định `[]`). |
| `shifts` | `ShiftTemplate[]` | Có | Danh sách Shift Template thuộc Schedule này (khi tạo mới seed sẵn `07:00–15:00` và `15:00–23:00`). |
| `demand` | `DemandDataset \| null` | Có | `null` khi chưa nạp CSV; mỗi Schedule giữ tối đa **1** bộ dữ liệu giao dịch. |
| `assignments` | `Assignment[]` | Có | Danh sách phân công trong tuần (mặc định `[]`). |

### 2.3 `Staff`

| **Trường** | **Kiểu** | **Bắt buộc** | **Quy tắc & Bất biến** |
| --- | --- | --- | --- |
| `id` | `string` (UUID) | Có | Duy nhất trong phạm vi `Schedule.staff`. |
| `name` | `string` | Có | Chuỗi không rỗng sau khi trim. |
| `maxWeeklyHours` | `number` | Có | Số nguyên không âm (`Number.isInteger(v) && v >= 0`). Nhân viên có `maxWeeklyHours === 0` được phép tồn tại nhưng không tham gia Auto-schedule và không tính vào Jain Index. |

*(Không chứa `availability`, `role`, `skills` hay `assignedHours` — đúng `01-product-scope.md` và `05-ux-spec.md`).*

### 2.4 `ShiftTemplate`

Khung giờ ca dùng lại cho cả 7 ngày `Mon–Sun` trong một `Schedule`.

| **Trường** | **Kiểu** | **Bắt buộc** | **Quy tắc & Bất biến** |
| --- | --- | --- | --- |
| `id` | `string` (UUID) | Có | Duy nhất trong phạm vi `Schedule.shifts`. |
| `startHour` | `number` | Có | Số nguyên thuộc `[7, 22]`. |
| `endHour` | `number` | Có | Số nguyên thuộc `[8, 23]`, bắt buộc `startHour < endHour` (không có ca qua đêm, F-02, F-03). |

* **Bất biến duy nhất:** Không cho phép hai `ShiftTemplate` có cùng cặp `(startHour, endHour)` trong cùng một `Schedule` để tránh trùng hàng trên Weekly Roster.
* **Quy tắc giao nhau giữa các Template:** Hai `ShiftTemplate` khác nhau **được phép có khoảng thời gian giao nhau** (ví dụ: `07:00–15:00` và `12:00–20:00` cùng tồn tại). Ràng buộc không trùng giờ chỉ được đánh giá trên các `Assignment` của **cùng một nhân viên** (vi phạm cứng với Auto-schedule theo F-04, cảnh báo mềm khi sửa tay theo F-05), không đánh giá giữa các `ShiftTemplate`.
* **Thời lượng ca:** Không lưu trường `duration`; luôn suy diễn là `endHour - startHour` (số nguyên từ `1` đến `16`, phủ các `OperatingHour` thỏa `startHour <= h < endHour`).

### 2.5 `Assignment`

Biểu diễn việc phân công một nhân viên cụ thể vào một ca cụ thể trong một ngày cụ thể.

| **Trường** | **Kiểu** | **Bắt buộc** | **Quy tắc & Bất biến** |
| --- | --- | --- | --- |
| `id` | `string` (UUID) | Có | Duy nhất trong phạm vi `Schedule.assignments`. |
| `day` | `DayOfWeek` (`0..6`) | Có | Thứ trong tuần (`Mon–Sun`). |
| `shiftId` | `string` | Có | Tham chiếu tới `ShiftTemplate.id` tồn tại trong `Schedule.shifts`. |
| `staffId` | `string` | Có | Tham chiếu tới `Staff.id` tồn tại trong `Schedule.staff`. |
| `isPinned` | `boolean` | Có | Mặc định `false`. Áp dụng ở cấp chính assignment này (`Staff + Shift + Day`, F-07). |

* **Bất biến chống gán lặp tuyệt đối (Data Integrity Invariant):** Trong cùng một `Schedule`, bộ ba **`(day, shiftId, staffId)` phải duy nhất**. Một nhân viên có thể bị ghi đè tay để làm 2 ca khác nhau trong ngày (có cảnh báo mềm), nhưng **không bao giờ** được gán 2 lần vào cùng một ca của cùng một ngày.

### 2.6 `DemandDataset` (Transactions)

Biểu diễn dữ liệu giao dịch đã được chuẩn hóa sau khi Import CSV hợp lệ (F-08).

| **Trường** | **Kiểu** | **Bắt buộc** | **Quy tắc & Bất biến** |
| --- | --- | --- | --- |
| `importedAt` | `string` (ISO 8601) | Có | Thời điểm nạp dữ liệu hợp lệ gần nhất. |
| `sourceFileName` | `string` | Không | Tên file gốc (hoặc `"Demo Store"` cho dữ liệu mẫu) để hiển thị ngữ cảnh cho Manager. |
| `transactions` | `Record<DayOfWeek, Record<OperatingHour, number>>` | Có | Ma trận đầy đủ **7 ngày (`0..6`) $\times$ 16 giờ (`7..22`) = 112 ô**; mọi giá trị là số nguyên không âm (`>= 0`). |

### 2.7 Quy tắc Cập nhật `Schedule.updatedAt`

* `Schedule.updatedAt` **chỉ** được cập nhật khi bất kỳ trường **Domain Source of Truth** nào thuộc Schedule thay đổi hợp lệ: đổi tên Schedule, đổi hệ số `N`, thêm/sửa/xóa `Staff` hoặc `ShiftTemplate`, thêm/gỡ/Reassign `Assignment`, bật/tắt `Pin/Unpin`, commit kết quả `Auto-schedule`, và `Import CSV` thành công.
* **Không** cập nhật `Schedule.updatedAt` khi chỉ tính lại **Derived State** hoặc thay đổi **Persistence / UI Metadata** (như chuyển `activeScheduleId`).

## 3. Quan hệ, Phạm vi Sở hữu & Phân giải Định danh (Ownership & Scoping)

```text
Schedule (1)
 ├── (0..1) DemandDataset      [112 hourly transaction counts, normalized Mon–Sun]
 ├── (0..N) Staff              [id, name, maxWeeklyHours]
 ├── (0..N) ShiftTemplate      [id, startHour, endHour]
 └── (0..N) Assignment         [id, day, shiftId -> ShiftTemplate, staffId -> Staff, isPinned]
```

* **Sở hữu độc quyền:** Không chia sẻ `Staff`, `ShiftTemplate`, `Assignment` hay `DemandDataset` giữa các `Schedule`.
* **Quy tắc phân giải theo phạm vi sở hữu (Strict Schedule Scoping):** Mọi thao tác đọc/cập nhật/xóa thực thể con (`Staff`, `ShiftTemplate`, `Assignment`) **bắt buộc phải xác định `Schedule` sở hữu trước**, rồi mới phân giải định danh con bên trong collection của `Schedule` đó. Không bao giờ tra cứu hoặc đột biến thực thể con theo ID trên toàn ứng dụng mà bỏ qua ngữ cảnh `Schedule`.
* **Toàn vẹn tham chiếu (Referential Integrity):** Mọi `Assignment` phải có `staffId` thuộc `Schedule.staff` và `shiftId` thuộc `Schedule.shifts`. Không tồn tại assignment mồ côi (orphan assignment).
* **Tách phẳng `Assignment` khỏi `ShiftTemplate` và `Staff`:** Giúp tính toán `AggregatedSummary`, lọc theo ngày/nhân viên, và thực hiện cascade sửa/xóa an toàn mà không bị trùng lặp dữ liệu.

## 4. Vòng đời `Assignment` & Tính Nguyên tử của Auto-schedule

### 4.1 Các Thao tác Thủ công

| **Thao tác** | **Tiền điều kiện** | **Biến đổi Domain Source of Truth** | **Hệ quả Derived State** |
| --- | --- | --- | --- |
| **Assign** | `staffId`, `shiftId` tồn tại trong Schedule; chưa có `(day, shiftId, staffId)`; đã xác nhận nếu thuộc `Requires attention`. | Thêm mới `Assignment` với `isPinned = false`. | Tính lại toàn bộ Derived State (F-09). Không chạy Auto-schedule. |
| **Unassign** | `assignmentId` tồn tại trong Schedule. | Xóa `Assignment` khỏi `Schedule.assignments`. | Tính lại toàn bộ Derived State. Không chạy Auto-schedule. |
| **Reassign** | `assignmentId` và `newStaffId` tồn tại; nếu `newStaffId === oldStaffId` là **no-op**; nếu khác thì `(day, shiftId, newStaffId)` chưa tồn tại. *(Không có 2-way Swap trong MVP).* | Thay thế assignment cũ bằng assignment mới có `staffId = newStaffId`, giữ nguyên `(day, shiftId)`, và **đặt `isPinned = false` (`Unpinned`)** bất kể assignment cũ có đang Pin hay không. | Cập nhật giờ cả 2 nhân viên và tính lại toàn bộ Derived State (E-05). |
| **Pin / Unpin** | `assignmentId` tồn tại trong Schedule. | Đảo `isPinned` (`true` $\leftrightarrow$ `false`) của đúng `Assignment` đó; cập nhật `updatedAt`. | Không thay đổi giờ/Summary; ảnh hưởng lần chạy Auto-schedule tiếp theo (E-03). |

### 4.2 Kiểm định Pin trước khi Chạy Auto-schedule (E-03)

Gọi $P = \{ a \in \text{Schedule.assignments} \mid a.\text{isPinned} = \text{true} \}$. Auto-schedule bị chặn và trả về danh sách xung đột nếu trong $P$ tồn tại bất kỳ vi phạm cứng nào (F-04):

1. Tổng `assignedHours` tính trên riêng $P$ của một nhân viên $> \text{maxWeeklyHours}$ (kể cả khi `maxWeeklyHours === 0` mà nhân viên có assignment đã Pin).
2. Một nhân viên có $> 1$ assignment đã Pin trong cùng một `day`.
3. Một nhân viên có hai assignment đã Pin trùng khoảng thời gian `[startHour, endHour)` trong cùng một `day` *(bị bao hàm bởi điều kiện 2 khi giới hạn là 1 ca/ngày, nhưng vẫn kiểm tra tường minh)*.

### 4.3 Quy tắc Nguyên tử cho Auto-schedule (Atomic Auto-schedule Rule)

Auto-schedule **không bao giờ** xóa dần các assignment cũ trước khi có kết quả hoàn chỉnh. Toàn bộ quy trình bắt buộc chạy theo cơ chế **tạo trạng thái ứng viên (candidate state) $\rightarrow$ kiểm định $\rightarrow$ commit một lần**:

1. **Giữ nguyên** `Schedule.assignments` hiện tại trong suốt quá trình tính toán.
2. **Kiểm tra điều kiện đầu vào (E-02)** và **kiểm định tập Pin $P$ (E-03)**. Nếu thất bại, dừng ngay và không thay đổi dữ liệu.
3. **Chạy bộ giải** để tạo tập `candidateAssignments` (chứa đầy đủ cả assignment đã Pin lẫn assignment mới sinh ra).
4. **Kiểm định toàn bộ `candidateAssignments` trước khi commit:**
   * Mọi assignment trong tập Pin gốc $P$ đều có mặt **đúng một lần** với nguyên vẹn `id`, `day`, `shiftId`, `staffId` và `isPinned = true`.
   * Không có `id` trùng lặp và không có bộ ba `(day, shiftId, staffId)` trùng lặp.
   * Mọi `staffId` và `shiftId` đều tham chiếu tới thực thể đang tồn tại trong `Schedule`.
   * Không vi phạm bất kỳ ràng buộc cứng nào của Auto-schedule (F-04: không vượt `maxWeeklyHours`, không trùng giờ, tối đa 1 ca/ngày cho mỗi nhân viên).
   * Mọi assignment mới sinh ra (không thuộc $P$) đều có `isPinned = false`.
5. **Commit nguyên tử:** Chỉ khi toàn bộ bước 4 đạt, mới thay thế `Schedule.assignments` bằng `candidateAssignments` trong một lần cập nhật duy nhất và cập nhật `Schedule.updatedAt`.

* **Trường hợp lỗi:** Nếu bộ giải thất bại, timeout, không tạo được nghiệm hợp lệ hoặc `candidateAssignments` không vượt qua bước kiểm định 4, hệ thống **giữ nguyên 100% `Schedule.assignments` trước khi chạy** và thông báo lỗi rõ ràng.

## 5. Quy tắc Tác động Dây chuyền (Cascade & Mutation Rules)

Mọi thao tác dưới đây đều được phân giải trong phạm vi `Schedule` sở hữu và **tuyệt đối không** tự động chạy lại Auto-schedule.

| **Thao tác** | **Kiểm tra trước khi thực thi** | **Biến đổi Domain Source of Truth** | **Hệ quả Derived State** |
| --- | --- | --- | --- |
| **Edit `Staff`** | `name` không rỗng; `maxWeeklyHours` nguyên `>= 0`. | Cập nhật `Staff`; giữ nguyên `Assignment` và `isPinned`. | Tính lại Staff Metrics, `Hour Limit Warnings`, `Fairness`. *(Nếu giảm `maxWeeklyHours` làm Pin vượt trần $\rightarrow$ lần Auto-schedule sau dừng theo E-03).* |
| **Delete `Staff`** (E-08) | Đếm số `Assignment` của `staffId`; nếu `> 0` bắt buộc xác nhận. | Xóa `Staff` và **cascade delete** toàn bộ `Assignment` có `staffId` tương ứng. | Tính lại Weekly Roster, Staff Metrics, `AggregatedSummary`, 4 tín hiệu `ScheduleHealth`. |
| **Add `ShiftTemplate`** | `7 <= startHour < endHour <= 23`; không trùng `(startHour, endHour)` đã có (được phép giao nhau một phần). | Thêm vào `Schedule.shifts`. | Hiện hàng mới trên Weekly Roster (0 assignment). |
| **Edit `ShiftTemplate`** (E-09) | `7 <= startHour < endHour <= 23`; không trùng `(startHour, endHour)` với Shift khác; thông báo số assignment chịu ảnh hưởng trên cả 7 ngày. | Cập nhật `startHour`, `endHour`. **Giữ nguyên toàn bộ `Assignment` trên cả 7 ngày và giữ nguyên `isPinned` của từng assignment.** Không tự xóa assignment. | Tính lại tổng giờ nhân viên, `AggregatedSummary`, 4 tín hiệu `ScheduleHealth` và cảnh báo phát sinh (chỉ vượt `maxWeeklyHours` vào `Hour Limit Warnings`; lỗi trùng giờ/2 ca ngày hiện riêng). *(Nếu làm Pin vi phạm cứng $\rightarrow$ lần Auto-schedule sau dừng theo E-03).* |
| **Delete `ShiftTemplate`** (E-08) | Đếm số `Assignment` dùng `shiftId`; nếu `> 0` bắt buộc xác nhận. | Xóa `ShiftTemplate` và **cascade delete** toàn bộ `Assignment` có `shiftId` tương ứng. | Tính lại Weekly Roster, Staff Metrics, `AggregatedSummary`, 4 tín hiệu `ScheduleHealth`. |
| **Import CSV** (E-01 & GĐ 2) | Parse & validate đủ 7 ngày (chuẩn hóa `Mon–Sun`), đủ 16 giờ (`7..22`), không trùng/thiếu, giá trị nguyên `>= 0`. | Hợp lệ: thay thế toàn bộ `Schedule.demand` (giữ `staff`, `shifts`, `assignments`). Lỗi: không thay đổi bất kỳ dữ liệu nào. | Nếu hợp lệ: tính lại `AggregatedSummary` và 4 tín hiệu `ScheduleHealth`. |
| **Delete `Schedule`** | Bắt buộc xác nhận. | Xóa toàn bộ `Schedule`; đặt `activeScheduleId = null` nếu đang mở Schedule này. | Quay về Schedule List (hoặc Empty State nếu rỗng). |

## 6. Đặc tả Dữ liệu Tính toán (Derived Data Specification)

Mọi phép tính dưới đây là **pure functions** nhận đầu vào là một `Schedule`.

### 6.1 Định nghĩa Trùng giờ & Đếm Giờ Nhân sự Duy nhất (Union of Covered Hours)

* Hai `ShiftTemplate` $s_1, s_2$ trong cùng một ngày **trùng thời gian (overlapping)** khi và chỉ khi:

$$
s_1.\text{startHour} < s_2.\text{endHour} \quad \land \quad s_2.\text{startHour} < s_1.\text{endHour}
$$

*(Ví dụ: `[7, 15)` và `[15, 23)` tiếp giáp nhau, **không** trùng thời gian).*

* **Nguyên tắc chống đếm trùng khi sửa tay có ca trùng giờ:** Một nhân viên chỉ có thể hiện diện tối đa **1 lần** trong cùng một khung giờ $(d, h)$. Do đó, cả `assignedHours` lẫn `staffHours` đều tính theo **nhân viên duy nhất trên hợp các khoảng thời gian được gán**, không cộng dồn cơ học thời lượng từng assignment:
  * **Giờ làm thực tế của nhân viên $i$ (`assignedHours`):**

$$
\text{assignedHours}_i = \sum_{d=0}^{6}\sum_{h=7}^{22} \mathbf{1}\left[\exists a \in \text{assignments} : a.\text{staffId} = i \land a.\text{day} = d \land \text{start}(a) \le h < \text{end}(a)\right]
$$

  * **Số nhân sự trực tại ô $(d, h)$ (`staffHours`):**

$$
\text{staffHours}(d, h) = \left|\left\{ i \in \text{Staff} \;\middle|\; \exists a \in \text{assignments} : a.\text{staffId} = i \land a.\text{day} = d \land \text{start}(a) \le h < \text{end}(a) \right\}\right|
$$

  * **Hệ quả nhất quán toán học:**

$$
\text{totalStaffHours} = \sum_{d=0}^{6}\sum_{h=7}^{22} \text{staffHours}(d, h) = \sum_{i \in \text{Staff}} \text{assignedHours}_i
$$

*(Khi không có ca trùng giờ, công thức này cho kết quả y hệt tổng thời lượng các ca; khi Manager chủ động ghi đè gán 2 ca trùng giờ cho cùng 1 người, cảnh báo Overlap vẫn bật nhưng độ phủ nhân sự và tổng giờ không bị thổi phồng sai thực tế).*

### 6.2 Staff Metrics & Warnings (Tách biệt loại cảnh báo — E-07)

Với mỗi `staff` $i$:

* `assignedHours`: tính theo công thức hợp giờ tại mục 6.1.
* `remainingHours`: `staff.maxWeeklyHours - assignedHours` *(có thể âm nếu vượt giới hạn)*.
* `overtimeHours`: `Math.max(0, assignedHours - staff.maxWeeklyHours)`.
* `isOverMaxHours`: `assignedHours > staff.maxWeeklyHours` *(chạm đúng bằng trần `===` là `false`)*.
* `utilization`: `staff.maxWeeklyHours > 0 ? assignedHours / staff.maxWeeklyHours : null`.
* `multiShiftDays`: danh sách các `DayOfWeek` mà nhân viên $i$ có $> 1$ assignment.
* `overlappingAssignmentIds`: tập `assignment.id` của nhân viên $i$ có ít nhất 1 cặp trùng thời gian trong cùng một ngày.

### 6.3 Assignment Guidance Evaluation (Phục vụ Popover)

Khi đánh giá `candidate` cho `(day, targetShift)` (với tập phân công hiện tại $A$, và tham số tùy chọn `excludeAssignmentId` khi ở chế độ `Reassign`):

* **Loại trừ (Không hiển thị làm lựa chọn mới):** `candidate` đã có assignment tại đúng `(day, targetShift)` (trừ trường hợp Reassign chính mình là no-op).
* **Tạo tập giả định $A_{\text{hyp}}$:** Loại bỏ `excludeAssignmentId` (nếu có) khỏi $A$, sau đó thêm assignment giả định `(day, targetShift.id, candidate.id)`.
* **Đánh giá các điều kiện mềm (sinh mảng `reasons`):**
  1. `wouldExceedMaxHours`: Tính `hypotheticalAssignedHours` của `candidate` trên $A_{\text{hyp}}$ bằng đúng công thức hợp giờ tại mục 6.1. Nếu `hypotheticalAssignedHours > candidate.maxWeeklyHours` $\rightarrow$ ghi lý do kèm số giờ vượt `+(hypotheticalAssignedHours - candidate.maxWeeklyHours)h`.
  2. `alreadyHasShiftOnDay`: Trên $A \setminus \{\text{excludeAssignmentId}\}$, `candidate` đã có $\ge 1$ assignment khác trong cùng `day` $\rightarrow$ lý do *"Đã có ca trong ngày"*.
  3. `wouldOverlapShift`: Trên $A \setminus \{\text{excludeAssignmentId}\}$, `candidate` có assignment trong cùng `day` trùng khoảng `[startHour, endHour)` với `targetShift` $\rightarrow$ lý do *"Trùng thời gian với ca [HH:00–HH:00]"*.
* **Phân nhóm:** `reasons.length === 0` $\rightarrow$ **`Eligible`**; `reasons.length > 0` $\rightarrow$ **`Requires attention`**.

### 6.4 Aggregated Summary (Mục 2.6 Đề bài)

Tính trên lưới 7 ngày (`0..6`) $\times$ 16 giờ (`7..22`):

* **Mỗi ô $(d, h)$:**
  * `transactions`: `demand ? demand.transactions[d][h] : null`.
  * `staffHours`: tính theo công thức nhân viên duy nhất tại mục 6.1.
  * `txnsPerStaffHour`: `transactions !== null && staffHours > 0 ? transactions / staffHours : null` (UI hiển thị `–`).
  * `isStaffingGap`: `transactions !== null && transactions > 0 && staffHours === 0`.
* **4 Chỉ số Tổng tuần:**
  * `totalTransactions`: `demand !== null` ? $\sum_{d=0}^{6}\sum_{h=7}^{22} \text{transactions}(d, h)$ : `null`.
  * `totalStaffHours`: $\sum_{d=0}^{6}\sum_{h=7}^{22} \text{staffHours}(d, h)$ *(bằng $\sum_i \text{assignedHours}_i$)*.
  * `overallTxnsPerStaffHour`: `totalTransactions !== null && totalStaffHours > 0 ? totalTransactions / totalStaffHours : null`.
  * `averageTxnsPerStaffHour`: với $C_{\text{staffed}} = \{ (d, h) \mid \text{staffHours}(d, h) > 0 \}$, nếu `demand !== null` và $|C_{\text{staffed}}| > 0$:

$$
\text{averageTxnsPerStaffHour} = \frac{1}{|C_{\text{staffed}}|} \sum_{(d, h) \in C_{\text{staffed}}} \frac{\text{transactions}(d, h)}{\text{staffHours}(d, h)}
$$

Ngược lại trả về `null` *(các ô `staffHours === 0` tuyệt đối không tính vào mẫu số)*.

### 6.5 Schedule Health — 4 Independent Signals

1. **`staffingGapCount`** (`number | null`): số ô có `isStaffingGap === true` (`null` nếu `demand === null`).
2. **`hourLimitWarningCount`** (`number`): số lượng `Staff` có `isOverMaxHours === true` *(chỉ đo vượt `maxWeeklyHours`; không gộp lỗi 2 ca/ngày hay trùng giờ)*.
3. **`demandCoverage`** (`DemandCoverageMetric | null`): chỉ số mức độ đáp ứng nhu cầu nhân sự trên toàn tuần (`null` nếu `demand === null`). Công thức chính xác và ngưỡng đánh giá (nếu có) chốt tại `04-optimization-spec.md`.
4. **`fairnessJainIndex`** (`number | null`): lọc $E = \{ s \in \text{staff} \mid s.\text{maxWeeklyHours} > 0 \}$, đặt $u_i = \frac{\text{assignedHours}_i}{\text{maxWeeklyHours}_i}$. Nếu $|E| = 0$ hoặc $\sum_{i \in E} u_i = 0$ trả về **`null`** (hiển thị `–`, không trả về `1.0`); ngược lại:

$$
J(u) = \frac{\left(\sum_{i \in E} u_i\right)^2}{|E| \sum_{i \in E} u_i^2}
$$

## 7. Hợp đồng Lưu trữ & Khôi phục (`LocalStorage` Persistence Contract)

### 7.1 Cấu trúc Payload Lưu trữ

Lưu dưới một khóa chính duy nhất (VD: `staff_scheduler_state_v1`) gồm **Persistence / UI Metadata** và mảng **Domain Source of Truth**:

* **Cấu trúc lược đồ (Minh họa — không dùng làm JSON fixture kiểm thử):**

```typescript
interface PersistedAppState {
  schemaVersion: 1;                  // Persistence Metadata
  activeScheduleId: string | null;   // UI Navigation Metadata
  schedules: Schedule[];             // Domain Source of Truth (không chứa Derived State)
}
```

* **Yêu cầu Payload hợp lệ đối với `DemandDataset.transactions`:** Một payload JSON hợp lệ bắt buộc chứa **đầy đủ cả 7 key ngày (`"0"` đến `"6"`)**, và trong mỗi ngày chứa **đầy đủ cả 16 key giờ (`"7"` đến `"22"`)** với giá trị là số nguyên không âm (tổng cộng đúng 112 giá trị số). Các bộ test sẽ dùng fixture JSON đầy đủ 112 ô, không dùng cấu trúc rút gọn.

### 7.2 Xử lý `schemaVersion` & Safe Hydration

Khi khởi động ứng dụng và đọc dữ liệu từ `LocalStorage`:

| **Trường hợp schemaVersion** | **Hành vi bắt buộc** |
| --- | --- |
| **Bằng phiên bản hiện tại (`1`)** | Tiến hành kiểm định toàn vẹn cấu trúc rồi deserialize bình thường. |
| **Nhỏ hơn phiên bản hiện tại (có migration)** | Chạy hàm migration tuần tự lên phiên bản hiện tại, kiểm định toàn vẹn rồi mới nạp. |
| **Lớn hơn phiên bản hiện tại** | **Tuyệt đối không ghi đè** `LocalStorage`; hiển thị thông báo dữ liệu thuộc phiên bản mới hơn không tương thích và tạm khóa auto-save đè lên khóa chính. |
| **Thiếu, không phải số nguyên hợp lệ, hoặc JSON lỗi cú pháp** | Xem là payload không đáng tin cậy; chuyển vào **Luồng Recovery** bên dưới. |

### 7.3 Kiểm định Toàn vẹn Dữ liệu khi Deserialize

Ngoài việc kiểm tra tham chiếu `Assignment`, bộ validator bắt buộc kiểm tra đầy đủ:

1. Mọi `Schedule`, `Staff`, `ShiftTemplate`, `Assignment` đều có `id` chuỗi không rỗng và **không trùng `id`** trong từng collection sở hữu.
2. `Staff.name`, `Schedule.name` không rỗng; `Staff.maxWeeklyHours` là số nguyên `>= 0`.
3. `ShiftTemplate.startHour` thuộc `[7, 22]`, `endHour` thuộc `[8, 23]`, `startHour < endHour`, không trùng cặp `(startHour, endHour)` trong cùng Schedule.
4. `Schedule.targetTxnsPerStaffHour` là số hữu hạn `> 0`.
5. Nếu `Schedule.demand !== null`: đủ đúng 7 key ngày $\times$ 16 key giờ, mọi giá trị là số nguyên `>= 0`.
6. Mọi `Assignment` có `day` thuộc `[0..6]`, `isPinned` là `boolean`, `staffId` và `shiftId` tồn tại trong Schedule sở hữu, và không trùng bộ ba `(day, shiftId, staffId)`.
7. Nếu `activeScheduleId` không tồn tại trong `schedules` hợp lệ $\rightarrow$ đặt về `null` (mở Schedule List).

### 7.4 Chính sách Auto-save, Bảo vệ Dữ liệu & Recovery (Chống Ghi đè Mất Dữ liệu)

* **Chỉ lưu Source of Truth & Metadata:** Tuyệt đối không serialize `assignedHours`, `AggregatedSummary`, `ScheduleHealth`, hay danh sách cảnh báo vào `LocalStorage`.
* **Tự động lưu đồng bộ (Auto-save):** Mỗi khi Domain Source of Truth thay đổi hợp lệ, cập nhật `Schedule.updatedAt` và ghi đồng bộ vào `LocalStorage`.
* **Không bao giờ âm thầm ghi đè payload hỏng hoặc không tương thích:**
  * Khi deserialize thất bại (JSON hỏng, schema lỗi, vi phạm bất biến dữ liệu): **không crash** ứng dụng; sao lưu nguyên văn chuỗi raw vào khóa dự phòng (VD: `staff_scheduler_recovery_backup`) hoặc giữ nguyên khóa chính ở chế độ **chặn auto-save**.
  * Hiển thị thông báo recovery rõ ràng cho người dùng và chỉ cho phép ghi đè lên khóa chính sau khi người dùng **xác nhận khởi tạo dữ liệu mới**.
  * Chỉ riêng trường hợp `Assignment` mồ côi trên một payload có cấu trúc tổng thể hợp lệ mới được phép tự lọc bỏ kèm cảnh báo nhẹ; các sai lệch cấu trúc khác đi qua chính sách recovery thay vì âm thầm xóa cả `Schedule`.
* **Xử lý lỗi khi ghi `LocalStorage` (`QuotaExceededError`, chặn quyền truy cập):**
  * Chỉ báo *"Saved locally"* trên Top Action Bar **chỉ** hiển thị khi `localStorage.setItem()` thành công.
  * Nếu ghi thất bại: lập tức chuyển chỉ báo sang trạng thái **lỗi lưu trữ / chưa được lưu** (*"Unable to save locally"*) kèm thông báo rõ ràng; không để người dùng hiểu nhầm dữ liệu trong bộ nhớ RAM đã được lưu bền vững.
* Sau khi khôi phục hợp lệ, lập tức tính lại toàn bộ **Derived State** từ Domain Source of Truth (Giai đoạn 7 Workflow).

## 8. Hợp đồng Bàn giao sang Phase 4 (`04-optimization-spec.md`)

Tài liệu `04-optimization-spec.md` nhận trực tiếp mô hình dữ liệu và các quy tắc từ `03-domain-model.md`:

* **Đầu vào bộ giải:** `Schedule.demand` (đủ 112 ô), tập `Staff` có `maxWeeklyHours > 0`, `Schedule.shifts` (khác rỗng), `Schedule.targetTxnsPerStaffHour` (`N`), và tập assignment đã Pin $P$.
* **Đầu ra bộ giải (tương thích Atomic Auto-schedule Rule):**
  * `BLOCKED_PIN_CONFLICT`: kèm danh sách chi tiết nhân viên/assignment Pin vi phạm (E-03).
  * `FAILED`: kèm lý do lỗi kỹ thuật/không khả thi (không chạm vào `Schedule.assignments`).
  * `SUCCESS`: trả về **toàn bộ tập `Assignment[]` cuối cùng** (bao gồm nguyên vẹn toàn bộ $P$ và các assignment mới có `isPinned = false`) kèm đối tượng chẩn đoán kết quả chạy (E-04), để tầng ứng dụng kiểm định 1 lần rồi commit nguyên tử.
* **Trọng tâm cần chốt ở Phase 4:** (1) Công thức `Transactions` $\rightarrow$ `N` $\rightarrow$ `Required staff per hour` $\rightarrow$ ánh xạ lên `ShiftTemplate`; (2) Thuật toán phân bổ công bằng và xử lý thiếu/dư nhân sự; (3) Định nghĩa chính thức cho `demandCoverage` và ngưỡng hiển thị (nếu có) cho `demandCoverage` & `fairnessJainIndex`.