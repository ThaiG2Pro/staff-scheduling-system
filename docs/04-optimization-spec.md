**Tham chiếu:** `01-product-scope.md` (Frozen), `02-manager-workflow.md` (Frozen), `05-ux-spec.md` (Frozen), `03-domain-model.md` (Frozen)

## 1. Quy đổi Nhu cầu theo Giờ (Demand Conversion)

### 1.1 Tham số Mục tiêu `N` (`Schedule.targetTxnsPerStaffHour`)

* **Ý nghĩa nghiệp vụ:** Ngưỡng năng suất giao dịch giả định trên mỗi nhân viên trong một giờ (không phải năng suất đo lường thực tế).
* **Giá trị mặc định ban đầu:** $N = 15$ khi tạo `Schedule` mới. Đây là giá trị khởi điểm giả định cho MVP (cần hiệu chuẩn theo phân phối dữ liệu của Demo Store, không khẳng định là chuẩn chung cho ngành bán lẻ/F&B); Manager luôn có thể chỉnh trực tiếp trên Top Action Bar.
* **Miền giá trị & Quy tắc nhập liệu:**
  * Tầng Domain (`03-domain-model.md`): số thực hữu hạn dương (`Number.isFinite(N) && N > 0`).
  * Tầng UI / Technical Design: chấp nhận số thực dương trong khoảng **`[1, 500]`** (bao gồm giá trị thập phân như `12.5`). Có thể cấu hình nút tăng/giảm bước `1` hoặc `0.1`, nhưng **tuyệt đối không** áp dụng HTML validation `step="1"` khiến số thập phân hợp lệ bị từ chối; parse và validate theo quy tắc số thực.

### 1.2 Công thức `RequiredStaff(d, h)`

Với mỗi ngày $d \in \{0,\dots,6\}$ và mỗi khung giờ mở cửa $h \in \{7,\dots,22\}$:

$$
\text{RequiredStaff}(d, h) = \begin{cases} 0 & \text{nếu } \text{Transactions}(d, h) = 0 \\ \left\lceil \dfrac{\text{Transactions}(d, h)}{N} \right\rceil & \text{nếu } \text{Transactions}(d, h) > 0 \end{cases}
$$

### 1.3 Diễn giải & Các Trường hợp Biên

* **Hệ quả có chủ đích của làm tròn lên theo từng giờ:** Vì $\text{Transactions}(d, h)$ là số nguyên $\ge 1$ và $N > 0$, phép làm tròn lên $\lceil \cdot \rceil$ tự động bảo đảm $\text{RequiredStaff}(d, h) \ge 1$ với mọi giờ có giao dịch mà không cần hằng số chặn riêng (một khung giờ có `1` giao dịch vẫn cần `1` nhân viên). Đây là hệ quả chủ đích của việc lập lịch nhân sự nguyên trên các ô 1 giờ, không phải lỗi công thức.
* **`Transactions(d, h) = 0`:** Nhu cầu bằng `0`. Bộ giải không phân bổ thêm nhân sự cho ô này và ô này không được tính là *Staffing Gap*.
* **Ví dụ kiểm chứng với $N = 15$:** $0 \to 0$, $1 \to 1$, $15 \to 1$, $16 \to 2$, $30 \to 2$, $31 \to 3$.
* **`N` rất nhỏ / rất lớn:** Khi `N` nhỏ sinh `RequiredStaff` vượt xa quỹ giờ đội ngũ, bộ giải vẫn tuân thủ tuyệt đối hard constraints và báo cáo phần chưa phủ qua `diagnostics`; khi `N` rất lớn (VD: $N = 500$, $\text{Transactions} = 5$), $\text{RequiredStaff} = 1$, bảo đảm cửa hàng vẫn có tối thiểu 1 người trực khi có khách giao dịch.

> **Độ chính xác số học của `RequiredStaff`:** Công thức `RequiredStaff` được hiểu theo phép tính thập phân chính xác về mặt nghiệp vụ. Triển khai không được tạo thêm một nhân viên chỉ vì sai số biểu diễn số thực IEEE-754. Technical Design phải chọn phương pháp tính phù hợp và kiểm thử các trường hợp tỷ lệ toán học là số nguyên, ví dụ $21 / 1.4 = 15$. Không sử dụng epsilon tùy ý nếu chưa chứng minh không làm sai lệch kết quả ở các trường hợp nằm sát ranh giới.

## 2. Ánh xạ Nhu cầu $7 \times 16$ lên `ShiftTemplate` (Shift Coverage)

### 2.1 Nguyên tắc Ánh xạ theo Thiếu hụt Biên (Hourly Marginal Deficit)

Hệ thống **không** quy đổi tĩnh từ lưới $7 \times 16$ sang một con số cố định *"ca X cần Y người"* (như lấy `max` hay `mean` trong khung ca) trước khi phân công, vì khi cửa hàng có các `ShiftTemplate` giao nhau một phần (VD: `07:00–15:00`, `11:00–15:00`, `15:00–23:00`, được phép tồn tại theo `03-domain-model.md`), việc tính độc lập từng ca sẽ đếm trùng nhu cầu ở vùng giao nhau và dẫn tới thừa nhân sự. Thay vào đó, bộ giải ánh xạ động theo **thiếu hụt biên tại từng khung giờ (Hourly Marginal Deficit)** trên lưới $7 \times 16$ tại trạng thái hiện tại.

### 2.2 Các Đại lượng Đánh giá Ứng viên `(day, shift)`

Tại trạng thái hiện tại của lịch ứng viên, với mỗi ô $(d, h)$:

$$
\text{deficit}(d, h) = \max\big(0,\; \text{RequiredStaff}(d, h) - \text{StaffHours}(d, h)\big)
$$

Với một cặp $(d, s)$ có độ dài $\text{duration}(s) = s.\text{endHour} - s.\text{startHour}$ và tập giờ phủ $H(s) = \{h \mid s.\text{startHour} \le h < s.\text{endHour}\}$, khi xét thêm **1 nhân viên hợp lệ** vào $(d, s)$:

1. **Số lỗ hổng không người được xóa ($\Delta\text{gaps}$):**

$$
\Delta\text{gaps}(d, s) = \big|\{ h \in H(s) \mid \text{RequiredStaff}(d, h) > 0 \land \text{StaffHours}(d, h) = 0 \}\big|
$$

2. **Số staff-hours nhu cầu được đáp ứng thêm — Marginal Covered Staff-Hours ($\Delta\text{cov}$):**

$$
\Delta\text{cov}(d, s) = \big|\{ h \in H(s) \mid \text{deficit}(d, h) > 0 \}\big|
$$

*(Đơn vị: `staff-hours` — mỗi giờ đang thiếu trong ca được tăng thêm đúng 1 nhân viên trực, không hàm ý toàn bộ thiếu hụt của các giờ đó đã được lấp hết sau 1 phân công).*

3. **Hiệu suất phủ ca ($\text{efficiency}$):**

$$
\text{efficiency}(d, s) = \frac{\Delta\text{cov}(d, s)}{\text{duration}(s)} \in [0, 1]
$$

*(Tự động ưu tiên ca ngắn/ca gối đầu khớp giờ cao điểm thay vì ca 8 giờ gây nhiều giờ thừa; ví dụ: khi chỉ khung `11:00–15:00` thiếu người, ca `11:00–15:00` đạt $\text{efficiency} = 4/4 = 1.0$, cao gấp đôi ca `07:00–15:00` đạt $4/8 = 0.5$).*

4. **Áp lực giao dịch hiện tại ($\text{pressure}$):**

$$
\text{pressure}(d, s) = \sum_{h \in H(s),\; \text{deficit}(d, h) > 0} \frac{\text{Transactions}(d, h)}{\max(1,\; \text{StaffHours}(d, h))}
$$

*(Dùng làm tiêu chí phá đồng hạng để bảo vệ những khung giờ có mật độ đơn/nhân viên căng thẳng nhất trước).*

### 2.3 Thiếu hụt Cấu trúc do Không có `ShiftTemplate` (`uncoverableRequiredStaffHours`)

Nếu tồn tại khung giờ $(d, h)$ có $\text{RequiredStaff}(d, h) > 0$ nhưng **không có bất kỳ `ShiftTemplate` nào** trong `Schedule.shifts` chứa giờ $h$ (VD: Manager đã xóa ca tối `15:00–23:00`), bộ giải nhận diện đây là **thiếu hụt cấu trúc**:

$$
\text{uncoverableRequiredStaffHours} = \sum_{\substack{d, h \\ \nexists s \in \text{shifts}:\, h \in H(s)}} \text{RequiredStaff}(d, h)
$$

*(Đơn vị: `staff-hours` — tổng nhu cầu nhân sự tại các khung giờ không nằm trong bất kỳ `ShiftTemplate` nào của Schedule. Bộ giải không tự sinh ca mới mà báo rõ trong `diagnostics` để Manager thêm `ShiftTemplate` phù hợp).*

## 3. Ràng buộc Cứng & Cổng Tiền kiểm (Hard Constraints)

### 3.1 Cổng Sẵn sàng Đầu vào (Input Readiness Gate — E-02)

Bộ giải chỉ chạy khi thỏa đồng thời 4 điều kiện:

1. `demand !== null` (đủ 112 ô giao dịch hợp lệ).
2. `shifts.length > 0`.
3. Tồn tại ít nhất 1 nhân viên thuộc tập $E = \{ i \in \text{staff} \mid \text{maxWeeklyHours}_i > 0 \}$.
4. `targetTxnsPerStaffHour` (`N`) hữu hạn và $> 0$.

Nếu thiếu điều kiện nào $\to$ trả về `FAILED` (`reasonCode: 'MISSING_INPUT'`), giữ nguyên lịch hiện tại.

### 3.2 Cổng Kiểm định Assignment đã Pin (Pin Conflict Gate — E-03, F-07)

Gọi $P = \{ a \in \text{existingAssignments} \mid a.\text{isPinned} = \text{true} \}$. Kiểm tra riêng $P$ theo F-04:

1. Tổng `assignedHours` (tính theo hợp giờ duy nhất) trên $P$ của bất kỳ nhân viên nào $> \text{maxWeeklyHours}$ (kể cả nhân viên có `maxWeeklyHours === 0` mà có Pin).
2. Bất kỳ nhân viên nào có $> 1$ assignment trong $P$ ở cùng một `day`.
3. Bất kỳ nhân viên nào có 2 assignment trong $P$ trùng khoảng `[startHour, endHour)` trong cùng một `day`.

Nếu có vi phạm $\to$ dừng ngay, trả về `BLOCKED_PIN_CONFLICT` kèm danh sách xung đột chi tiết; tuyệt đối không tự gỡ Pin.

### 3.3 Điều kiện Hợp lệ cho Phân công Mới (F-04)

Nhân viên $i \in E$ hợp lệ (`eligible`) cho $(d, s)$ tại trạng thái ứng viên hiện tại khi và chỉ khi:

1. $\text{assignedHours}_i + \text{duration}(s) \le \text{maxWeeklyHours}_i$ *(khi chưa có ca nào trong ngày $d$, thời lượng tăng thêm bằng đúng $\text{duration}(s)$)*.
2. Nhân viên $i$ chưa có bất kỳ assignment nào trong ngày $d$ *(bảo đảm tối đa 1 ca/ngày, không trùng giờ và không trùng bộ ba `(d, s, i)`)*.
3. Toàn bộ tập $P$ được giữ nguyên bất biến (`id`, `day`, `shiftId`, `staffId`, `isPinned = true`).

## 4. Thuật toán Heuristic 2 Tầng Xác định (Deterministic Two-Stage Heuristic)

> **Tuyên bố phạm vi thuật toán (MVP Heuristic Contract):** Bộ giải sử dụng **thuật toán heuristic tham lam xác định 2 tầng** (Stage 1: Coverage Construction bằng Greedy + Best-Fit; Stage 2: Coverage-Preserving Fairness Rebalance). Thuật toán ưu tiên độ phủ trước rồi tối ưu công bằng mà không làm giảm độ phủ đã đạt, nhưng **không tuyên bố hay cam kết tối ưu toàn cục (global optimality)** trong mọi tổ hợp ràng buộc phức tạp.

### 4.1 Khởi tạo

* `candidateAssignments = [...P]` (sao chép nguyên vẹn tập đã Pin).
* Tính sẵn lưới `StaffHours(d, h)` và `assignedHours[i]` từ $P$.

### 4.2 Tầng 1 — Xây dựng Độ phủ (Greedy Construction + Best-Fit Staff Selection)

#### Quy tắc Chọn Nhân viên (`pickEligibleStaff(d, s)`)

Để tránh tiêu hao nhân viên có quỹ giờ lớn vào ca ngắn khiến ca dài về sau không có người nhận (bảo toàn năng lực cho các ca khó bố trí hơn), ưu tiên **Best-Fit** trước **Jain Index**:

1. Lọc danh sách nhân viên $i \in E$ thỏa mục 3.3. Nếu rỗng $\to$ trả về `null`.
2. Tính độ dư quỹ giờ sau giả định gán (`postAssignmentSlack`):

$$
\text{postAssignmentSlack}_i = \text{maxWeeklyHours}_i - \text{hypotheticalAssignedHours}_i
$$

Chọn ứng viên có **`postAssignmentSlack` nhỏ nhất** *(Best-Fit)*.
3. *(Nếu bằng nhau)*: Chọn ứng viên làm **`JainIndex` giả định của tập $E$ lớn nhất** (biên sai số so sánh số thực $\varepsilon = 10^{-9}$).
4. *(Phá đồng hạng xác định)*: `staff.id` tăng dần theo thứ tự từ điển chuẩn (lexicographical code-unit order).

#### Hai bước Phân bổ Ca của Tầng 1

* **Bước 1A — Xóa Lỗ hổng Không Người (`Staffing Gaps`):** Lặp chừng nào còn tồn tại cặp $(d, s)$ có $\Delta\text{gaps}(d, s) > 0$ và có ít nhất 1 nhân viên hợp lệ:
  1. Chọn $(d, s)$ tốt nhất theo thứ tự:
     * $\Delta\text{gaps}(d, s)$ **lớn nhất**;
     * $\text{efficiency}(d, s)$ **lớn nhất**;
     * $\text{pressure}(d, s)$ **lớn nhất**;
     * Tie-break xác định: `(d ASC, s.startHour ASC, s.endHour ASC, s.id ASC)`.
  2. Gọi `pickEligibleStaff(d, s)` $\to$ tạo assignment mới (`isPinned: false`), cập nhật `StaffHours` và `assignedHours`.

* **Bước 1B — Lấp Đầy Thiếu hụt Nhu cầu Còn lại:** Lặp chừng nào còn tồn tại cặp $(d, s)$ có $\Delta\text{cov}(d, s) > 0$ và có ít nhất 1 nhân viên hợp lệ:
  1. Chọn $(d, s)$ tốt nhất theo thứ tự:
     * $\text{efficiency}(d, s)$ **lớn nhất**;
     * $\Delta\text{cov}(d, s)$ **lớn nhất**;
     * $\text{pressure}(d, s)$ **lớn nhất**;
     * Tie-break xác định: `(d ASC, s.startHour ASC, s.endHour ASC, s.id ASC)`.
  2. Gọi `pickEligibleStaff(d, s)` $\to$ tạo assignment mới (`isPinned: false`), cập nhật `StaffHours` và `assignedHours`.

* **Điều kiện dừng:** Dừng ngay khi không còn $(d, s)$ nào có $\Delta\text{cov}(d, s) > 0$ hoặc hết nhân viên hợp lệ. Không thêm ca vào khung giờ đã đủ người chỉ để tiêu hết quỹ giờ.

> **Ghi chú về đánh đổi độ dài ca cố định (Fixed-Shift Spillover Trade-off):** Khi cửa hàng chỉ có 2 ca mặc định 8 giờ và chỉ 1 giờ cao điểm trưa thiếu 1 người, Bước 1B vẫn bổ sung 1 người (sau khi các ca có hiệu suất cao hơn đã được ưu tiên) để bảo đảm giờ đông nhất được phủ đúng tinh thần đề bài, đồng thời báo rõ số `overstaffedHours` phát sinh để Manager cân nhắc thêm một `ShiftTemplate` gối đầu ngắn hơn.

### 4.3 Tầng 2 — Cân bằng Công bằng Bảo toàn Độ phủ (Coverage-Preserving Fairness Pass)

Tầng 2 tối ưu `JainIndex` của tập $E$ trên kết quả Tầng 1 với **6 bất biến bắt buộc** bảo đảm độ phủ không thay đổi dù chỉ 1 ô giờ:

1. **Không thêm hoặc xóa** bất kỳ `Assignment` nào.
2. **Không thay đổi** `id`, `day`, `shiftId` và `isPinned` của bất kỳ `Assignment` nào.
3. **Chỉ được thay đổi `staffId`** của các `Assignment` có `isPinned === false`.
4. Với mọi cặp `(day, shiftId)`, **số lượng `Assignment` (multiset) trước và sau Tầng 2 phải bằng nhau tuyệt đối**.
5. Mọi nước đi ứng viên phải được kiểm định lại toàn bộ hard constraints (`maxWeeklyHours`, tối đa 1 ca/ngày, không trùng giờ, duy nhất bộ ba `(day, shiftId, staffId)`).
6. Nếu bất kỳ điều kiện nào không thỏa $\to$ loại bỏ nước đi đó.

> **Hệ quả toán học:** Với mọi $(d, h)$, $\text{StaffHours}_{\text{before}}(d, h) = \text{StaffHours}_{\text{after}}(d, h)$, do đó `demandCoverage`, `shortageHours`, `overstaffedHours` và `staffingGapCount` được bảo toàn chính xác 100%.

#### Phép Biến đổi Nội bộ, Thứ tự Duyệt & Tie-Break Xác định

* **Bỏ qua (Skipped):** Nếu $|E| \le 1$ hoặc số assignment chưa Pin $= 0$ $\to$ không chạy vòng lặp (`rebalanceIterationsRun = 0`, `rebalanceStopReason = 'SKIPPED'`).
* **Thứ tự duyệt xác định:**
  * Sắp xếp danh sách assignment chưa Pin $U$ theo khóa `(day ASC, shift.startHour ASC, shift.endHour ASC, assignment.id ASC)`.
  * Sắp xếp danh sách nhân viên $E$ theo `staff.id ASC`.
* **Hai phép biến đổi nội bộ của solver** *(lưu ý: Swap dưới đây chỉ là phép hoán đổi `staffId` nội bộ giữa 2 assignment chưa Pin, giữ nguyên danh tính slot của từng assignment — **không** phải tính năng 2-way Swap trên giao diện Manager)*:
  1. **`REASSIGN`:** Với từng $a \in U$ và từng $e \in E$ ($e \ne a.\text{staffId}$), thử đổi $a.\text{staffId} \leftarrow e$.
  2. **`SWAP` (khác thời lượng):** Với từng cặp $(a_1, a_2)$ trong $U$ ($a_1$ đứng trước $a_2$ theo thứ tự đã sắp) sao cho `duration(a1) !== duration(a2)` và `a1.staffId !== a2.staffId`, thử hoán đổi `a1.staffId` và `a2.staffId` cho nhau.
* **Tiêu chí chọn nước đi tốt nhất trong mỗi vòng lặp:**
  * Chỉ nhận các nước đi hợp lệ làm tăng thực sự $\Delta J = J_{\text{new}} - J_{\text{current}} > 10^{-6}$.
  * Chọn nước đi có $\Delta J$ lớn nhất. Nếu hai nước đi có $\Delta J$ bằng nhau trong biên sai số $10^{-9}$, phá đồng hạng theo khóa từ điển tăng dần: `(moveType: 'REASSIGN' < 'SWAP', primaryAssignmentId ASC, secondaryAssignmentIdOrStaffId ASC)`.
* **Điều kiện dừng:** Dừng khi không còn nước đi nào có $\Delta J > 10^{-6}$ (`rebalanceStopReason = 'CONVERGED'`) hoặc đạt trần an toàn `MAX_REBALANCE_ITERATIONS = 200` (`rebalanceStopReason = 'MAX_ITERATIONS_REACHED'`).

## 5. Công thức Chính thức cho Metrics & Ngưỡng Hiển thị Health Bar

Toàn bộ các đại lượng sau là **Derived State** (tính nhất quán cho cả lịch từ Auto-schedule và lịch sau chỉnh tay). Đơn vị của toàn bộ các đại lượng thiếu/dư là **`staff-hours`** (tổng số vị trí nhân sự thiếu hoặc dư cộng gộp qua 112 ô giờ, không phải số giờ đồng hồ).

### 5.1 Bộ Công thức Chính thức

1. **Tổng nhu cầu nhân sự tuần (`totalRequiredStaffHours`, đơn vị: `staff-hours`):**

$$
\text{totalRequiredStaffHours} = \sum_{d=0}^{6}\sum_{h=7}^{22} \text{RequiredStaff}(d, h)
$$

2. **Nhu cầu đã được đáp ứng (`coveredRequiredStaffHours`, đơn vị: `staff-hours`):**

$$
\text{coveredRequiredStaffHours} = \sum_{d=0}^{6}\sum_{h=7}^{22} \min\big(\text{StaffHours}(d, h),\; \text{RequiredStaff}(d, h)\big)
$$

3. **Tỷ lệ Đáp ứng Nhu cầu (`demandCoverage`):**
   * Nếu `demand === null` hoặc `totalRequiredStaffHours === 0`: trả về **`null`** (UI hiển thị `–`, kèm giải thích *"Chưa có dữ liệu giao dịch"* hoặc *"Không có nhu cầu giao dịch trong tuần"* — tuyệt đối không hiển thị `100%` hay `NaN`).
   * Ngược lại:

$$
\text{demandCoverage} = \frac{\text{coveredRequiredStaffHours}}{\text{totalRequiredStaffHours}} \in [0, 1]
$$

   * **Phân biệt tường minh với `Staffing Gaps`:** *Staffing Gaps* đếm số ô có `Transactions > 0` và `StaffHours = 0`; *Demand Coverage* đo tỷ lệ đáp ứng toàn bộ nhu cầu nhân sự (nhân sự dư ở giờ này không bù cho giờ thiếu và không đẩy tỷ lệ vượt `100%`).
   * *Ví dụ:* Ô giờ cần `3` nhân viên nhưng mới có `1` nhân viên $\to$ không phải `Staffing Gap` (`+0` gap), nhưng chỉ đóng góp $1/3$ cho `Demand Coverage` và phát sinh `2` `shortageHours`.

4. **Tổng thiếu hụt nhu cầu (`shortageHours`, đơn vị: `staff-hours`):**

$$
\text{shortageHours} = \sum_{d=0}^{6}\sum_{h=7}^{22} \max\big(0,\; \text{RequiredStaff}(d, h) - \text{StaffHours}(d, h)\big) = \text{totalRequiredStaffHours} - \text{coveredRequiredStaffHours}
$$

Được phân tách tường minh trong `diagnostics` thành hai phần cộng lại bằng đúng `shortageHours`:
   * **`uncoverableRequiredStaffHours`** (`staff-hours`): tổng `RequiredStaff` ở các ô không có bất kỳ `ShiftTemplate` nào phủ tới.
   * **`residualCoverableShortageHours`** (`staff-hours`):

$$
\text{residualCoverableShortageHours} = \text{shortageHours} - \text{uncoverableRequiredStaffHours}
$$

   *(Nhu cầu còn thiếu tại các ô có ít nhất một `ShiftTemplate` sau khi bộ giải heuristic chạy xong — không khẳng định nguyên nhân duy nhất là cạn năng lực nhân sự).*

5. **Dư thừa so với nhu cầu tại sàn (`overstaffedHours`, đơn vị: `staff-hours`):**

$$
\text{overstaffedHours} = \sum_{d=0}^{6}\sum_{h=7}^{22} \max\big(0,\; \text{StaffHours}(d, h) - \text{RequiredStaff}(d, h)\big)
$$

6. **Quỹ giờ hợp đồng chưa sử dụng (`unusedCapacityHours`, đơn vị: `staff-hours`):**

$$
\text{unusedCapacityHours} = \sum_{i \in E} \max\big(0,\; \text{maxWeeklyHours}_i - \text{assignedHours}_i\big)
$$

*(Tách bạch rõ `overstaffedHours` = giờ xếp dư trên sàn vượt nhu cầu giao dịch vs. `unusedCapacityHours` = quỹ giờ hợp đồng của đội ngũ chưa phân bổ vào lịch).*

7. **Chỉ số ô cho P1 Conditional Coverage View (`CellCoverage`):**
   * `requiredStaff = RequiredStaff(d, h)`
   * `coverageDelta = StaffHours(d, h) - RequiredStaff(d, h)` ($< 0$: thiếu, $= 0$: khớp, $> 0$: thừa).

### 5.2 Ngưỡng Hiển thị Trực quan trên Schedule Health Bar

Đây là **ngưỡng UX hỗ trợ đọc nhanh** (luôn đi kèm con số thực và dòng giải thích, không phải rào chắn chặn thao tác, không phải ngưỡng tối ưu của bộ giải hay tiêu chuẩn ngành), được tách thành hằng số cấu hình để dễ điều chỉnh. Các trạng thái hoàn toàn độc lập (không cộng thành điểm tổng hợp) và **bắt buộc đánh giá trên giá trị số thực đầy đủ trước khi làm tròn để hiển thị**:

| **Health Signal** | **Neutral (–)** | **Good** | **Attention** | **Warning** |
| ----- | ----- | ----- | ----- | ----- |
| **1. Staffing Gaps** | `demand === null` | `0` ô | — | $> 0$ ô |
| **2. Hour Limit Warnings** | — | `0` nhân viên | — | $> 0$ nhân viên (`assigned > max`) |
| **3. Demand Coverage** | `demand === null` hoặc `totalRequiredStaffHours === 0` | $\ge 90\%$ | $75\% \text{ – } < 90\%$ | $< 75\%$ |
| **4. Fairness (Jain Index)** | `fairnessJainIndex === null` | $\ge 0.90$ | $0.80 \text{ – } < 0.90$ | $< 0.80$ |

* **Lưu ý hiển thị khi $|E| = 1$:** Nếu chỉ có duy nhất 1 nhân viên đủ điều kiện (`maxWeeklyHours > 0`) và người đó đã có giờ làm, `fairnessJainIndex = 1.0` theo công thức đã Freeze tại `03-domain-model.md`. UI giữ nguyên công thức và hiển thị ghi chú giải thích ngắn (*"Chỉ có 1 nhân viên đủ điều kiện — chưa có dữ liệu so sánh giữa nhiều nhân viên"*).
* **Lưu ý đồng nhất với `01-product-scope.md`:** `Fairness` luôn được đọc song hành với `Demand Coverage`, vì một lịch có `Fairness = 1.00` vẫn có thể có `Demand Coverage < 75%` nếu thiếu quỹ giờ.

## 6. Hợp đồng Bộ giải (Solver Contract)

### 6.1 Đầu vào (`AutoScheduleInput`)

Bộ giải là một **pure function** nhận đầu vào bất biến; `idGenerator` được inject vào lõi bộ giải để kiểm thử xác định (tầng ứng dụng truyền `() => crypto.randomUUID()` khi chạy thực tế):

```typescript
interface AutoScheduleInput {
  demand: DemandDataset | null;
  staff: readonly Staff[];
  shifts: readonly ShiftTemplate[];
  existingAssignments: readonly Assignment[];
  targetTxnsPerStaffHour: number; // N
  idGenerator: () => string;      // Bắt buộc inject từ caller (app dùng crypto.randomUUID)
}
```

### 6.2 Đầu ra (`AutoScheduleResult`)

Khớp 100% với 3 trạng thái đã chốt tại mục 8 của `03-domain-model.md`:

```typescript
type AutoScheduleResult =
  | {
      status: 'SUCCESS';
      /** Toàn bộ tập Assignment cuối cùng: nguyên vẹn tập Pin P + các assignment mới (isPinned = false) */
      assignments: Assignment[];
      diagnostics: AutoScheduleDiagnostics;
    }
  | {
      status: 'BLOCKED_PIN_CONFLICT';
      conflicts: PinConflict[];
    }
  | {
      status: 'FAILED';
      reasonCode: 'MISSING_INPUT' | 'CANDIDATE_VALIDATION_FAILED' | 'UNEXPECTED_ERROR';
      missingInputs?: ('DEMAND' | 'SHIFTS' | 'ELIGIBLE_STAFF' | 'INVALID_N')[];
      message: string;
    };

interface PinConflict {
  staffId: string;
  staffName: string;
  type: 'OVER_MAX_HOURS' | 'MULTIPLE_SHIFTS_SAME_DAY' | 'OVERLAPPING_SHIFTS';
  assignmentIds: string[];
  details: string;
}

interface AutoScheduleDiagnostics {
  preservedPinnedCount: number;
  generatedAssignmentsCount: number;
  totalRequiredStaffHours: number;          // staff-hours
  coveredRequiredStaffHours: number;        // staff-hours
  demandCoverage: number | null;
  shortageHours: number;                    // staff-hours
  uncoverableRequiredStaffHours: number;    // staff-hours
  residualCoverableShortageHours: number;   // staff-hours
  overstaffedHours: number;                 // staff-hours
  unusedCapacityHours: number;              // staff-hours
  unscheduledEligibleStaffCount: number;    // Số NV trong E có assignedHours === 0 sau khi chạy
  fairnessJainIndex: number | null;
  rebalanceIterationsRun: number;
  rebalanceStopReason: 'CONVERGED' | 'MAX_ITERATIONS_REACHED' | 'SKIPPED';
  summaryMessages: string[];                // Danh sách thông điệp súc tích hiển thị lên Banner E-04
}
```

### 6.3 Quy tắc Thông điệp Tóm tắt (`summaryMessages` — E-04)

* Khi `totalRequiredStaffHours === 0`: thông báo dữ liệu giao dịch toàn tuần bằng `0`, không cần phân bổ thêm ca mới (vẫn bảo toàn các assignment đã Pin nếu có).
* Khi `shortageHours === 0` và `totalRequiredStaffHours > 0`: báo đã phủ `100%` nhu cầu dự kiến; nêu rõ `unusedCapacityHours` (nếu $> 0$) và `overstaffedHours` (nếu $> 0$); nếu `unscheduledEligibleStaffCount > 0`, giải thích rõ số nhân viên chưa có ca là do nhu cầu tuần đã được đáp ứng đủ mà không tạo ca thừa.
* Khi `uncoverableRequiredStaffHours > 0`: báo rõ số `staff-hours` nhu cầu nằm ngoài toàn bộ `ShiftTemplate` hiện có (gợi ý bổ sung Shift Template phủ các giờ này).
* Khi `residualCoverableShortageHours > 0`: báo rõ số `staff-hours` nhu cầu tại các khung giờ có ca nhưng bộ giải heuristic chưa thể phủ trong giới hạn ràng buộc hiện tại (gợi ý bổ sung nhân sự, điều chỉnh giờ trần, thêm ca gối đầu ngắn hoặc tinh chỉnh tay).

### 6.4 Tính Xác định, Atomic Commit & Mục tiêu Hiệu năng

1. **Tính xác định (Determinism):** Lõi bộ giải không phụ thuộc vào `Math.random`, `Date.now` hay nguồn ngẫu nhiên toàn cục. Với cùng một `AutoScheduleInput` (bao gồm cùng `idGenerator` xác định), bộ giải luôn sinh cùng một `AutoScheduleResult` giống hệt 100%.
2. **Atomic Commit & Kiểm định Ứng viên (`03-domain-model.md` mục 4.3):** Trước khi trả `SUCCESS`, bộ giải chạy `validateCandidateAssignments(candidateAssignments, input)` xác minh đủ 5 bất biến (bảo toàn nguyên vẹn từng phần tử tập Pin $P$, không trùng `id` hay bộ ba `(day, shiftId, staffId)`, tham chiếu hợp lệ, thỏa toàn bộ F-04, assignment mới có `isPinned = false`). Nếu kiểm định thất bại $\to$ trả `FAILED` (`CANDIDATE_VALIDATION_FAILED`), không thay đổi `Schedule.assignments`.
3. **Mục tiêu Hiệu năng (Performance Target — Cần Benchmark ở Phase 5):**
   * Mục tiêu thiết kế: toàn bộ chu trình (Tầng 1 + Tầng 2 + Candidate Validation) hoàn thành mượt cho trải nghiệm tương tác đồng bộ trên trình duyệt (tham chiếu mục tiêu $< 50\text{ ms}$ ở cấu hình tiêu chuẩn 7 ngày $\times$ 2–6 ca $\times$ 10–30 nhân viên, và cần đo cụ thể ở kịch bản xấu nhất chạm `200` vòng rebalance).
   * Con số thực tế trên trình duyệt/thiết bị tham chiếu và giới hạn quy mô an toàn sẽ được **benchmark và kiểm chứng chính thức trong Phase 5 (Technical Design)**, không coi là cam kết tuyệt đối tại Phase 4.