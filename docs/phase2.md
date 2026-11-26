# Phase 2 — Shift Active Days & Staff Availability (Days Off)

> **Change ID:** `shift-days-and-staff-availability`  
> **Branch:** `feat/shift-days-and-staff-availability`  
> **Trạng thái:** Tài liệu tổng quan nghiệp vụ & kiến trúc trước Phase S1/S2  
> **Tương thích dữ liệu:** Giữ nguyên `schemaVersion: 1` (backward-compatible bằng optional fields).

---

## 1. Mục tiêu

Mở rộng hệ thống xếp lịch MVP hiện tại với 2 ràng buộc thực tế quan trọng nhất trong vận hành cửa hàng bán lẻ:

1. **Cấu hình ngày áp dụng cho Ca làm việc (`Shift Active Days`):** Cho phép từng mẫu ca (`ShiftTemplate`) chỉ hoạt động vào những ngày cụ thể trong tuần (ví dụ: ca chính `07:00–15:00` chạy `T2 → CN`, ca tăng cường `10:00–14:00` chỉ chạy `T7, CN`).
2. **Cấu hình ngày nghỉ của Nhân viên (`Staff Availability / Days Off`):** Cho phép đánh dấu các ngày không thể đi làm trong tuần của từng nhân viên. Cả thao tác gán tay (có cảnh báo) lẫn thuật toán Auto-schedule (ràng buộc cứng) đều tôn trọng ngày nghỉ này.

---

## 2. Tính năng 1: Cấu hình ngày áp dụng cho Ca làm việc (`ShiftTemplate.daysOfWeek`)

### 2.1. Mô hình dữ liệu & Tương thích ngược
- Mở rộng `ShiftTemplate` trong `src/domain/types.ts`:
  ```ts
  export interface ShiftTemplate {
    id: string;
    startHour: number;
    endHour: number;
    /** Danh sách ngày áp dụng (0 = Mon .. 6 = Sun). Undefined = mặc định cả 7 ngày [0..6]. */
    daysOfWeek?: DayOfWeek[];
  }
  ```
- **Quy ước chuẩn hóa:**
  - Nếu `daysOfWeek` là `undefined` (dữ liệu cũ từ MVP): hệ thống hiểu là áp dụng đủ cả 7 ngày `[0, 1, 2, 3, 4, 5, 6]`.
  - Mảng hợp lệ phải chứa các số nguyên duy nhất thuộc `0..6` và có **ít nhất 1 ngày** được bật (không cho lưu ca có 0 ngày hoạt động).
  - Giữ nguyên quy tắc không trùng cặp `(startHour, endHour)` trong cùng 1 Schedule.

### 2.2. Trải nghiệm người dùng (UI/UX)
- **Màn hình cấu hình ca (`ManageShiftsModal.tsx`):**
  - Mỗi ca hiển thị một hàng **7 ô toggle (`T2`, `T3`, `T4`, `T5`, `T6`, `T7`, `CN`)**.
  - Click trực tiếp từng ô để bật/tắt (`on/off`) ngày áp dụng. Mặc định khi tạo ca mới: bật cả 7 ngày.
  - Ngăn không cho tắt ngày cuối cùng đang bật (hoặc hiển thị lỗi validation rõ ràng).
- **Lưới xếp lịch tuần (`WeeklyRosterGrid.tsx`):**
  - Tại các ô `(day, shift)` mà ca đó bị tắt: hiển thị trạng thái **disabled / mờ / gạch chéo**, ẩn nút `+ Assign` để Manager không gán nhầm.

### 2.3. Quy tắc nghiệp vụ khi tắt ngày đang có lịch
- **Đã chốt: Cascade xóa có xác nhận.**
- Khi Manager tắt một hoặc nhiều ngày trên một `ShiftTemplate` vốn đang có `Assignment` (kể cả assignment đang Pinned) vào các ngày đó:
  - Hệ thống tính preview số lượng assignment bị ảnh hưởng (tương tự `previewDeleteShift` — E-08).
  - Hiển thị thông báo xác nhận; khi Manager xác nhận lưu, hệ thống **tự động xóa (cascade delete)** toàn bộ assignment thuộc các ngày bị tắt của ca đó trong cùng 1 lần cập nhật immutable.

### 2.4. Tác động thuật toán & Chỉ số hệ thống
- **Stage 1 (`schedulerStage1.ts`):**
  - Precompute `shiftDayMask: Uint8Array` (mỗi phần tử là bitmask 7-bit của `daysOfWeek`).
  - Trong Step 1A (lấp Staffing Gaps), Step 1B (bù giờ thiếu) và `collectStage1TraceCandidates`: bỏ qua ngay cặp `(d, sIdx)` nếu `(shiftDayMask[sIdx] & (1 << d)) === 0`.
- **Stage 2 (`schedulerStage2.ts`):**
  - Vì Stage 2 chỉ `REASSIGN` hoặc `SWAP` nhân viên trên các ca Stage 1 đã tạo (không sinh mới `(day, shift)`), ràng buộc ngày của ca tự động được bảo toàn.
- **Nâng cấp `hourCoverable` 1D → `cellCoverable` 2D (`7 × 16`):**
  - Ở MVP, `derivedMetrics.ts` và `schedulerDiagnostics.ts` dùng mảng 1D `Uint8Array(16)` (giả định ca nào cũng chạy cả 7 ngày).
  - Phase 2 nâng lên mảng 2D `Uint8Array(7 * 16)` theo tọa độ `d * 16 + (h - 7)` để tính chính xác `uncoverableRequiredStaffHours` và `residualCoverableShortageHours` theo từng ngày.
- **Post-condition Validator (`constraints.ts`):**
  - `validateCandidateAssignments()` kiểm tra mọi assignment mới sinh ra đều thuộc ngày đang bật của shift đó.

---

## 3. Tính năng 2: Ngày nghỉ của Nhân viên (`Staff.unavailableDays`)

### 3.1. Mô hình dữ liệu & Tương thích ngược
- Mở rộng `Staff` trong `src/domain/types.ts`:
  ```ts
  export interface Staff {
    id: string;
    name: string;
    maxWeeklyHours: number;
    /** Danh sách ngày nghỉ không thể làm việc (0 = Mon .. 6 = Sun). Undefined / [] = sẵn sàng cả tuần. */
    unavailableDays?: DayOfWeek[];
  }
  ```
- Dữ liệu cũ từ MVP không có `unavailableDays` → mặc định hiểu là `[]` (sẵn sàng cả 7 ngày).

### 3.2. Trải nghiệm người dùng (UI/UX)
- **Cấu hình nhân viên (`StaffFormModal.tsx` & `StaffPanel.tsx`):**
  - Thêm hàng **7 ô toggle (`T2..CN`)** chọn nhanh ngày nghỉ (click on/off) khi thêm/sửa nhân viên.
  - Hiển thị tóm tắt ngắn gọn các ngày nghỉ (vd: `Off: T4, CN`) trên thẻ nhân viên trong `StaffPanel`.
- **Gán thủ công có hướng dẫn (`AssignmentGuidancePopover.tsx`):**
  - Khi Manager chọn gán nhân viên vào ngày nằm trong `unavailableDays`, nhân viên đó được xếp xuống nhóm **`Requires Attention`** kèm lý do `STAFF_UNAVAILABLE_ON_DAY` (vẫn cho phép Manager chủ động override theo triết lý sản phẩm).
- **Cảnh báo trên lịch (`AssignmentChip.tsx`):**
  - Nếu có assignment rơi vào ngày nghỉ của nhân viên (do Manager override thủ công hoặc sửa ngày nghỉ sau khi đã gán), chip hiển thị warning badge `isUnavailableDay`.

### 3.3. Quy tắc nghiệp vụ & Trường hợp biên
- **Nhân viên nghỉ cả 7 ngày (`unavailableDays.length === 7`):**
  - **Đã chốt:** Loại ngay khỏi tập `eligibleStaff` (tương đương nhân viên có `maxWeeklyHours === 0`).
  - Không tham gia Stage 1/Stage 2 và **không tính vào mẫu số của chỉ số công bằng Jain Fairness Index**.
  - Nếu toàn bộ nhân viên đều `maxWeeklyHours === 0` hoặc nghỉ đủ 7 ngày → báo thiếu input `ELIGIBLE_STAFF` (E-02).
- **Pin Conflict Gate (`checkPinConflicts` — E-03):**
  - Bổ sung `PinConflictType`: `'UNAVAILABLE_DAY'`.
  - Nếu nhân viên có assignment đang **Pinned** vào đúng ngày nằm trong `unavailableDays`, Auto-schedule sẽ bị chặn ở Pin Conflict Gate và liệt kê rõ conflict để Manager gỡ pin hoặc đổi ngày nghỉ trước khi chạy.

### 3.4. Tác động thuật toán (Tối ưu hiệu năng O(1))
- **Working State (`schedulerState.ts` & `autoScheduler.ts`):**
  - Lưu riêng `unavailableMask: Uint8Array` (7-bit mask cho từng nhân viên trong `eligibleStaff`).
  - **Không** ghi trộn `unavailableDays` vào `state.dayOccupied` để tránh bị `applyRebalanceMove()` xóa nhầm khi chuyển ca (`dayOccupied[...] = 0`).
- **Stage 1 (`schedulerStage1.ts` — `pickBestFitStaff`):**
  - Bổ sung kiểm tra `O(1)` ngay đầu vòng lặp:
    ```ts
    if ((state.unavailableMask[i]! & (1 << day)) !== 0) continue;
    ```
- **Stage 2 (`schedulerStage2.ts` — `findBestRebalanceMove`):**
  - Khi dựng bitmask `dayMask[s]` đầu mỗi iteration:
    ```ts
    let mask = state.unavailableMask[s]!;
    for (let d = 0; d < 7; d++) {
      if (dayOccupied[base + d] !== 0) mask |= 1 << d;
    }
    dayMask[s] = mask;
    ```
  - Cả nhánh `REASSIGN` lẫn `SWAP` đều tự động tôn trọng ngày nghỉ mà **không thêm bất kỳ câu lệnh `if` nào trong vòng lặp nóng**.
- **Hard Rules & Validator (`hardRules.ts`, `constraints.ts`):**
  - Thêm rule hook độc lập `checkStaffAvailableOnDayRule(staff, day)` và `checkShiftActiveOnDayRule(shift, day)`.
  - `validateCandidateAssignments()` xác minh 100% assignment mới sinh không vi phạm ngày nghỉ của nhân viên.

---

## 4. Bản đồ tác động theo 4 tầng kiến trúc

| Layer | File dự kiến cập nhật | Nội dung thay đổi chính |
|---|---|---|
| **Domain** | `src/domain/types.ts` | Thêm `daysOfWeek?` vào `ShiftTemplate`, `unavailableDays?` vào `Staff`; mở rộng `PinConflictType`, `AssignmentGuidanceReasonCode`, `AssignmentWarningFlags`. |
| **Domain** | `src/domain/hardRules.ts` | Thêm helper bitmask/predicate `isShiftActiveOnDay`, `isStaffAvailableOnDay`, `isStaffEligible`. |
| **Domain** | `src/domain/constraints.ts` | Cập nhật `checkPinConflicts`, `evaluateStaffGuidance`, `validateCandidateAssignments`; thêm preview cho cascade xóa khi tắt ngày shift. |
| **Domain** | `src/domain/autoScheduler.ts`, `schedulerState.ts` | Lọc `eligibleStaff` (loại nghỉ 7 ngày); khởi tạo `shiftDayMask` & `unavailableMask`. |
| **Domain** | `src/domain/schedulerStage1.ts`, `schedulerStage2.ts` | Skip ngày tắt của shift ở Stage 1; skip ngày nghỉ ở `pickBestFitStaff`; OR `unavailableMask` vào `dayMask[s]` ở Stage 2. |
| **Domain** | `src/domain/derivedMetrics.ts`, `schedulerDiagnostics.ts`, `staffMetrics.ts` | Nâng `hourCoverable` 1D → `cellCoverable` 2D (`7×16`); cập nhật `eligibleStaff` trong Jain Index & `getMissingAutoScheduleInputs`; gắn cờ `isUnavailableDay` trong `assignmentWarnings`. |
| **Persistence** | `src/persistence/storageSchema.ts` | Validate `daysOfWeek?` & `unavailableDays?` (unique int `0..6`, shift ≥ 1 ngày), giữ tương thích ngược `schemaVersion: 1`. |
| **State** | `src/state/scheduleEntityActions.ts`, `useScheduleStore.ts` | Hỗ trợ lưu `daysOfWeek` (kèm cascade xóa assignment ngày bị tắt) và `unavailableDays`. |
| **UI** | `ManageShiftsModal.tsx`, `WeeklyRosterGrid.tsx`, `StaffFormModal.tsx`, `StaffPanel.tsx`, `AssignmentGuidancePopover.tsx`, `AssignmentChip.tsx` | Component toggle 7 ngày (`T2..CN`), trạng thái disabled trên Roster Grid, dialog xác nhận cascade xóa, warning badge & guidance reason. |

---

## 5. Danh sách Edge Cases cần khóa ở Phase S1/S2

1. **Dữ liệu cũ trong `localStorage`:** Payload MVP chưa có `daysOfWeek` / `unavailableDays` vẫn load mượt ở `schemaVersion: 1`.
2. **Tắt toàn bộ 7 ngày của 1 Shift:** Bị chặn ở UI và State validation (shift phải có ít nhất 1 ngày bật).
3. **Tắt ngày trên Shift đang có cả assignment thường và assignment Pinned:** Hiển thị đúng tổng số bị ảnh hưởng và cascade xóa sạch khi xác nhận.
4. **Nhân viên nghỉ cả 7 ngày (`unavailableDays.length === 7`):** Không xuất hiện trong `eligibleStaff`, không kéo tụt Jain Index, và nếu mọi nhân viên đều nghỉ 7 ngày thì nút Auto-schedule báo thiếu `ELIGIBLE_STAFF`.
5. **Pin Conflict với ngày nghỉ:** Nhân viên bị Pin vào Thứ 4, sau đó Manager đánh dấu nghỉ Thứ 4 → Auto-schedule chặn tại Pin Conflict Gate với lỗi `UNAVAILABLE_DAY`.
6. **Gán thủ công vào ngày nghỉ:** Vẫn cho phép override nhưng hiển thị cảnh báo trong Guidance Popover và badge cảnh báo trên `AssignmentChip`.
7. **Ca chỉ chạy T7–CN nhưng T2–T6 có demand:** `uncoverableRequiredStaffHours` phải phản ánh đúng các giờ T2–T6 không có ca nào phủ.
8. **Stage 2 Rebalance (REASSIGN & SWAP):** Không bao giờ chuyển hoặc hoán đổi một ca vào ngày nghỉ của nhân viên đích, đồng thời giữ nguyên 100% ma trận độ phủ 112 ô.
