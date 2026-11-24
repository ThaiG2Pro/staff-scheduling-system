# Low-Fi Interactive Wireframe & UI Layout Spec (`T2.5`)

- **Change:** `staff-scheduling-mvp`
- **Mapped ACs:** `AC-04`, `AC-05`
- **References:** `docs/05-ux-spec.md`, `docs/04-optimization-spec.md` (§5), `openspec/changes/staff-scheduling-mvp/design.md`
- **Interactive Prototype (mở trực tiếp trên trình duyệt Desktop 1280px+):** [`wireframe.html`](./wireframe.html)

> **Tại sao dùng Interactive HTML Prototype thay vì sơ đồ ASCII?**  
> Giao diện có mật độ thông tin cao (lưới Roster 7 cột song song Staff Panel 25% và bảng Summary 7×16 mỗi ô 3 dòng số liệu). File `wireframe.html` sử dụng đúng dữ liệu Demo Store (`src/domain/demoData.ts`) và bộ class Tailwind CSS mục tiêu để kiểm chứng tỷ lệ pixel, tràn chữ, cuộn dọc/ngang và luồng tương tác 2-click trước khi triển khai React components tại **T3** và **T4**.

---

## 1. Cách Review nhanh trên `wireframe.html`

Thanh công cụ màu tối ở đỉnh `wireframe.html` (`T2.5 Interactive Wireframe`) chỉ phục vụ bước duyệt thiết kế, cho phép chuyển nhanh toàn bộ màn hình & trạng thái:

1. **Screen:** `Workspace` | `Schedule List` | `List (Empty)`
2. **Storage Mode:** `normal (saved)` | `normal (save_error)` | `recovery_locked` | `incompatible_version_locked` | `storage_unavailable_locked`
3. **Contextual Banners:** `Auto-schedule Success (E-04)` | `Pin Conflict (E-03)` (bấm nút để highlight chip xung đột) | `CSV Import Error (E-01)` | `Empty Schedule Onboarding` (kèm disabled Auto-schedule E-02)
4. **Interactive Roster & Summary:**
   - Bấm **Pin (`📌`)** để bật/tắt trạng thái Pin trên từng chip.
   - Bấm **tên nhân viên trên chip** → mở **Assignment Guidance Popover** chế độ **Reassign** (thử chọn nhóm `Eligible` 1-click hoặc nhóm `Requires attention` với inline confirm 1 chạm; xác minh chip đã Pin khi Reassign sẽ chuyển về `Unpinned`).
   - Bấm **`+ Add`** → mở Popover chế độ **Assign** (có ô **Quick Search tự focus**, gõ tên + `Enter` để gán trong 1 giây); bấm **`×`** → gỡ ngay kèm **Floating Undo Toast (5s) + `Ctrl+Z`**.
   - Bấm **Auto-schedule** → xem **Review Banner** hiển thị delta `Before → After` (`Coverage`, `Gaps`), tag `New` trên ca vừa sinh và nút **`Undo Auto-schedule`** 1 chạm.
   - Bấm tên nhân viên ở **Team Panel** (có lọc `All / Under cap / Over limit`, ô search & `Sort: Hrs left`) → tự chuyển về `Weekly Roster` và highlight toàn bộ ca của người đó.
   - Chuyển sang tab **Hourly Summary (7×16)**, bật thử toggle **`Workload` ↔ `Staffing vs. Needed`**, và **click trực tiếp vào ô `Gap` / `High` / `Understaffed`** để nhảy về đúng cột ngày & các ca bao phủ giờ đó trên `Weekly Roster`.
   - Thử nhập giá trị `N` thập phân (VD `12.5`) hoặc vượt độ chính xác round-trip (VD `1.0000000000000001`).

---

## 2. Bố cục Tổng thể & Tỷ lệ Khung hình (Desktop 1280px+)

| Vùng giao diện | Kích thước / Layout Tailwind | Nội dung & Quy tắc cố định |
| :--- | :--- | :--- |
| **1. Top Action Bar** | `w-full px-5 py-2.5 flex items-center justify-between gap-4` | Trái: `← Schedules`, Inline Rename Input (`w-64 xl:w-72` không cắt tên cửa hàng), Passive Save Badge (`Saved locally` / `Unable to save locally...`). Phải: `Import CSV`, **`Shifts`** *(tooltip: Manage shift templates)*, **`Target [15] txns/hr`** (`inputMode="decimal"`, **không** đặt `step="1"`, kèm `-`/`+`), nút chính `Auto-schedule`, và menu **`⋯` (More)** bên phải chứa hành động phá hủy `Delete Schedule…` (tránh bấm nhầm cạnh ô đổi tên). |
| **2. Schedule Health Strip** | `bg-white rounded-xl border border-slate-300/80` + `grid grid-cols-4 divide-x divide-slate-200` | Dải liền khối cố định ngay dưới Top Bar, hiển thị **4 tín hiệu độc lập** (tuyệt đối không gộp điểm 0–100) với **4 icon hình dạng chuẩn WCAG** (`✓ Good`, `◐ Attention`, `⚠ Warning`, `– Neutral`). **Actionable:** click *Staffing Gaps* / *Demand Coverage* chuyển sang `Hourly Summary`; click *Hour Limit Warnings* khi `> 0` highlight ngay nhân viên vượt giờ trên Roster. |
| **3. Contextual Banners** | `hidden` khi không có thông báo | **Auto-schedule Review Banner (E-04):** hiển thị delta `Before → After` (`Coverage`, `Gaps`), số ca mới + số ca Pin giữ nguyên, nút **`Undo Auto-schedule`** 1 chạm và `Keep draft`. Ngoài ra còn banner lỗi Pin Conflict kèm nút highlight chip (E-03) và lỗi CSV (E-01) bằng ngôn ngữ vận hành tự nhiên. |
| **4. Main Split Workspace** | `flex min-h-0 gap-4 items-start` | **Trái (~75%):** `flex-1 min-w-0` chứa Tabbed Core View (`Weekly Roster` \| `Hourly Summary`).<br>**Phải (~25%):** `w-[296px] xl:w-[316px] shrink-0 sticky top-12` chứa `Team` panel cố định kèm **Search + Filter (`All / Under cap / Over limit` — không dùng từ "Available") + Sort (`Name / Hrs left`)**. |

---

## 3. Ngôn ngữ Thiết kế & Hệ màu 4 Tầng (Homebase/When I Work + Legion/Deputy)

- **Định hướng giao diện đã chốt:** **Homebase + When I Work** làm xương sống (khoảng thở rộng, font **Inter**, thao tác 2-click tại chỗ) kết hợp tinh hoa **Legion + Deputy** (*Live Health Strip* 1 dải gọn mượt, *Guardrails* chủ động kèm soft override, *left accent bar* cho trạng thái ca).
- **Hệ màu 4 tầng chống chói trắng & đạt 100% WCAG AA (bắt buộc áp dụng cho T3/T4):**
  - **Layer 0 (Page Canvas):** `#E6ECF3` (xám xanh mát dịu — tách khối rõ khỏi các card trắng, không dùng `#F8FAFC` gây trắng chồng trắng).
  - **Layer 1 (Elevated Cards / Panels / Top Bar):** `#FFFFFF` với viền `border-slate-300/80`.
  - **Layer 2 (Table Headers / Weekend Columns / Tracks):** `bg-slate-100` (`#F1F5F9`), cuối tuần `bg-slate-100/60`, đường kẻ lưới rõ `border-slate-200` (cấm dùng `border-slate-100` vô hình).
  - **Layer 3 (Shift Chips):** Nổi hẳn lên khỏi ô lưới — Ca thường `bg-slate-100/90 border-slate-300/90 border-l-slate-600`; Pinned `bg-indigo-50 border-indigo-300 border-l-indigo-600`; Cảnh báo `bg-amber-50 border-amber-300 border-l-amber-600`.
  - **Typography Contrast (0% `text-slate-400` trên chữ cần đọc):** Chữ chính `text-slate-900` (17.4:1), chữ phụ `text-slate-700` (9.4:1), chú thích tối thiểu `text-slate-600` (7.0:1).
- **Icons:** Dùng 100% **SVG vector mảnh đồng nhất** (`lucide-react` trong React T3/T4) — **không dùng system emoji** trong giao diện sản phẩm.
- **Progressive Disclosure & Keyboard Accessibility:**
  - Icon `Pin` (khi chưa ghim), nút `×` trên chip và `Edit` / `Delete` trên Team Panel dùng `opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100` (luôn hiển thị khi di chuột hoặc điều hướng bàn phím bằng `Tab`); chip đã ghim luôn hiện icon ghim màu indigo.
  - Nút `+ Add` ở các ô đã đủ người giữ `opacity: 0.78` chữ `text-slate-600` (đọc rõ ngay, nổi 100% khi hover/focus); chỉ ô **Gap** hoặc **Need +2+** mới hiện nút màu nổi bật.
- **Floating Undo Toast (5s) + `Ctrl+Z`:** Mọi thao tác gỡ ca (`×`), gán/đổi ca (`Assign`/`Reassign`), đổi Pin hoặc chạy `Auto-schedule` đều đẩy snapshot in-memory vào Undo stack và hiện thanh Undo Toast (5 giây, kèm phím tắt `Ctrl+Z` / `Cmd+Z`).
- **Accessibility — Không dùng màu sắc đơn lẻ:** Mọi trạng thái đều đi kèm **biểu tượng SVG phân biệt hình dạng + nhãn chữ tường minh**:

| Trạng thái | Nền / Viền Tailwind | Biểu tượng & Nhãn bắt buộc |
| :--- | :--- | :--- |
| **Good** | `bg-emerald-50 border-emerald-200 text-emerald-800` | `✓ Good` |
| **Attention** | `bg-amber-50 border-amber-300 text-amber-900` | `◐ Attention` |
| **Warning / Error** | `bg-rose-50 border-rose-300 text-rose-800` | `⚠ Warning` / `⛔` |
| **Neutral** | `bg-slate-100 border-slate-300 text-slate-700` | `– Neutral` |
| **Pinned Chip** | `bg-indigo-50 border-indigo-300 text-indigo-950` | Icon Pin hiển thị rõ (opacity 100%) + viền trái indigo |
| **AI-New Chip (Review)** | `bg-sky-50 border-sky-300 text-slate-900` | Tag nhỏ `New` màu sky + viền trái sky (biến mất khi bấm `Keep draft`) |
| **Chip Over Weekly Cap** | Badge `bg-rose-100 border-rose-300 text-rose-800` | Nhãn **`OT`** + tooltip `Over weekly hour limit (+Xh)` (tách biệt với cảnh báo cục bộ `2+ shifts / Overlap`) |
| **Local Chip Warning** | `bg-amber-50 border-amber-300 text-amber-950` | Icon `⚠` + tooltip ghi rõ `2+ shifts` hoặc `Overlap` (tách biệt Hour Limit Warnings) |
| **Staff Over Limit** | `bg-rose-100 border-rose-300 text-rose-800` | Badge `+Xh` + thanh tiến độ `bg-rose-600` |
| **Staff At Cap (`=== max`)** | `bg-emerald-50 border-emerald-200 text-emerald-800` | Nhãn `At cap` + thanh `bg-emerald-600` (không báo lỗi) |

---

## 4. Đặc tả 4 Tín hiệu Schedule Health Bar (`AC-05`)

Đánh giá **độc lập** trên giá trị số thực chưa làm tròn (`unrounded float`), đồng bộ `HEALTH_THRESHOLDS` trong `src/domain/constants.ts`. Nhãn hiển thị dùng **ngôn ngữ Store Manager** (tránh dev jargon như *"Jain"* hay *"Union-of-hours"* trên tiêu đề; công thức kỹ thuật đặt trong tooltip):

| Tín hiệu (Nhãn UI) | Neutral (`–`) | Good (`✓`) | Attention (`◐`) | Warning (`⚠`) |
| :--- | :--- | :--- | :--- | :--- |
| **Staffing Gaps** | `demand === null` | `0` ô | — | `> 0` ô (`txns > 0 && staff === 0`) |
| **Hour Limit Warnings** | — | `0` nhân viên | — | `> 0` nhân viên (`assigned > maxWeeklyHours`) |
| **Demand Coverage** | `demand === null` hoặc `totalRequired === 0` | `>= 90%` (`0.90`) | `75% – < 90%` | `< 75%` (`0.75`) |
| **Hour Fairness** *(hiện `%` đồng bộ với Demand Coverage; subtext/tooltip kèm `Jain 0.00–1.00`)* | `fairnessJainIndex === null` | `>= 90%` (`0.90`) | `80% – < 90%` | `< 80%` (`0.80`, kèm ghi chú nếu `\|E\| = 1`) |

---

## 5. Đặc tả Weekly Roster & Assignment Guidance Popover (`AC-04`)

- **Lưới Shift-first (Sticky Header & Shift Column):** 7 cột cố định `Mon → Sun` (`sticky top-0`) × `N` hàng `Shift` (sắp xếp `startHour ASC`, cột đầu `w-36 sticky left-0` có nút `Edit` / `Delete` nhanh).
- **Chỉ báo thiếu người phân tầng mức độ nghiêm trọng ngay trên Roster (chống Alert Fatigue & đồng nhất từ vựng `Need`):**
  - **Header từng cột ngày (`Mon`..`Sun`):**
    - Đỏ (`⚠ X gap(s)`): có giờ khách > 0 & 0 nhân viên.
    - Cam (`Need Xh`): thiếu nặng (`maxPeakNeed >= 2` hoặc `shortageHours >= 6`).
    - Trung tính nhẹ (`Need Xh`, nền trắng): thiếu nhẹ 1–5h — không tô nền cam để tránh nhiễu mắt.
    - Xanh (`✓ Covered`): phủ đủ 100%.
  - **Nút `+ Add` trong từng ô `(Shift × Day)`:**
    - Đỏ (`⚠ Gap · Add`): khung giờ ca có Gap.
    - Cam (`+ Add (need 2+)`): khung giờ ca thiếu nặng từ 2 người trở lên ở giờ cao điểm.
    - Trung tính nhấn nhẹ (`+ Add (need 1)`, **không tô nền cam**): thiếu nhẹ 1 người ở giờ cao điểm (tooltip liệt kê rõ giờ thiếu).
- **Tối ưu 2-click & Keyboard Search (Quick Filter auto-focus):**
  - *Thay người báo ốm (E-05):* Click tên trên chip → Click ứng viên nhóm `Eligible` (hoặc gõ vài ký tự tên + `Enter`).
  - *Thêm người ca Thứ 7 (E-06):* Click `+ Add` tại ô Thứ 7 → Click ứng viên nhóm `Eligible` (hoặc gõ tên + `Enter`).
- **Phân nhóm trong Popover (khớp DTO từ `constraints.ts`):**
  1. **`Eligible`:** Hiển thị `assigned/max · Xh left`; bấm 1 chạm (hoặc `Enter` trên kết quả khớp đầu tiên) để gán ngay. Nếu `eligible` rỗng và **toàn đội đã đạt 100% quỹ giờ tuần**, hiển thị hộp nhắc ngắn: *"Team is at 100% weekly capacity — assigning anyone below will trigger an overtime warning, or consider adjusting shift hours / adding staff."*
  2. **`Requires attention`:** Liệt kê từng mục `reasons[]` (`Already has a shift on ...`, `Overlaps with ...`, `Exceeds weekly limit (+Xh)`). Bấm vào mở xác nhận inline 1 chạm (`Assign with warning? [Cancel] [Confirm]`) — cho phép soft override, không chặn cứng.
- **Quy tắc Pin khi Reassign (E-05):** Nếu chip cũ đang `isPinned: true`, Popover hiển thị dải ghi chú màu indigo: *"Replacing a pinned shift starts as Unpinned"*, và kết quả Reassign luôn đặt `isPinned = false`.
- **Phạm vi cố tình giữ gọn ở MVP (tư liệu cho Research Note 2.8):** Chỉ hỗ trợ `Assign` / `Reassign` bằng click + keyboard search (chủ động **không** làm 2-way Swap, **không** làm Drag-and-Drop phức tạp theo `01-product-scope.md §4`, và **không** nhân đôi lưới `By Staff` vì đã có click-to-highlight trên Team Panel).

---

## 6. Đặc tả Hourly Summary (Aggregated Summary 7×16) & Cổng P1 (`AC-05`)

- **Hàng 4 thẻ KPI Tổng tuần (bắt buộc ở P0):**
  1. `Total Transactions` (*Weekly customer transactions*)
  2. `Total Staff Hours` (*Total scheduled staff-hours*)
  3. `Overall Txns / Staff Hr` (`Total Transactions ÷ Total Staff Hours`, hiện `–` khi mẫu số `0`)
  4. `Average Txns / Staff Hr` (*Avg per active hour*, hiện `–` khi rỗng) phân biệt rõ với *Overall*.
- **Lưới Chi tiết P0 (`7 cột Mon–Sun × 16 hàng 07:00–22:00`, sticky header & sticky hour column, không thêm hàng tổng ngày):**
  - Mỗi ô 3 dòng xếp tầng: `Transactions` / `Staff hours` / **`Txns / staff hour`**.
  - **Actionable Cells (1-click jump):** Click trực tiếp vào bất kỳ ô **`Gap`**, **`↑ High`** (ở chế độ `Workload`) hoặc **`▼ -X` Understaffed** (ở chế độ `Staffing vs. Needed`) → tự động chuyển về `Weekly Roster`, highlight đúng cột ngày & các ô ca bao phủ giờ đó kèm badge `Focused: <Day> <Hour>` có thể tắt.
  - **Staffing Gap** (`txns > 0 && staff === 0`): nền `bg-rose-50`, chữ **`– (Gap)`**.
  - **Zero/Zero** (`txns === 0 && staff === 0`): nền `bg-slate-100/70`, chữ **`–`** (không cảnh báo).
  - **High Load** (`txns/h > N`): nền `bg-amber-50`, chữ **`↑ XX.X/h`**.
- **P1 Conditional Coverage View (`Workload` ↔ `Staffing vs. Needed`):**
  - Đã kiểm chứng sẵn bố cục ô (`scheduled / required needed`) với **3 sắc độ thiếu người đồng bộ 1-1 với Weekly Roster** + thanh chú thích `Key:` đổi động theo chế độ xem:
    - **Gap (`0 / X`):** nền đỏ đậm `bg-rose-100`, nhãn **`⚠ Gap (-X)`**.
    - **Thiếu nặng (`delta <= -2`, VD `1/4`, `2/4`):** nền hồng `bg-rose-50`, nhãn **`▼ -2` / `▼ -3`** (*Need 2+*).
    - **Thiếu nhẹ (`delta === -1`, VD `2/3`, `3/4`):** nền vàng cam nhạt `bg-amber-50`, nhãn **`▼ -1`** (*Need 1*).
    - **Đủ (`0`):** nền xanh lá nhạt `bg-emerald-50/70`, nhãn **`✓ 0`** (*On target*).
    - **Dư (`+1+`):** nền xanh dương nhạt `bg-sky-50`, nhãn **`▲ +X`** (*Overstaffed*).
  - **Cổng triển khai:** Chỉ bật toggle này trong ứng dụng React ở **T5**, sau khi toàn bộ luồng P0 pass 100% Acceptance Tests.

---

## 7. Ma trận Trạng thái Storage, Modals & Mapping sang Code (`T3` / `T4`)

| Thành phần UI trong Wireframe | File React mục tiêu (`T3` / `T4`) | Ràng buộc bắt buộc |
| :--- | :--- | :--- |
| `Schedule List` + Empty State | `src/ui/screens/ScheduleListScreen.tsx` | `Open / Rename / Delete`, `Create Schedule`, `Load Demo Store` |
| `Storage Lock / Recovery Banner` | `src/ui/workspace/RecoveryBanner.tsx` | Đủ 4 `storageMode`: `recovery_locked` có *Reset & Start Fresh* (Atomic Reset); `storage_unavailable_locked` có *Retry Storage Access* (không có nút Reset) |
| `Top Action Bar` + Target `N` | `src/ui/workspace/TopActionBar.tsx` | Round-trip decimal validator cho `N ∈ [1, 500]`; `saveStatus` tách biệt Domain Commit |
| `Schedule Health Bar` | `src/ui/workspace/ScheduleHealthBar.tsx` | 4 tín hiệu độc lập đánh giá trên unrounded float |
| `Contextual Banners` | `src/ui/workspace/ContextualBanners.tsx` | E-01 (CSV), E-03 (Pin Conflict + highlight), E-04 (Auto-schedule diagnostics) |
| `Weekly Roster Grid` + `Chip` | `src/ui/roster/WeeklyRosterGrid.tsx`, `AssignmentChip.tsx` | Shift-first, Pin toggle, local warning tách biệt Hour Limit, quick `×` |
| `Assignment Guidance Popover` | `src/ui/roster/AssignmentGuidancePopover.tsx` | Pre-grouped `eligible[]` & `requiresAttention[]`, inline soft-override confirm |
| `Aggregated Summary 7×16` | `src/ui/summary/AggregatedSummaryView.tsx` | 4 KPIs + 7×16 P0 metrics; P1 Coverage toggle chỉ mở ở T5 |
| `Staff Panel` + Modals | `src/ui/panels/StaffPanel.tsx`, `StaffFormModal.tsx`, `ManageShiftsModal.tsx`, `CsvImportModal.tsx`, `ConfirmDialog.tsx` | Staff Form đúng 2 trường; Manage Shifts hiện số assignment bị ảnh hưởng (E-09); Delete Confirm hiện số assignment bị gỡ (E-08) |
