**Tham chiếu:** `01-product-scope.md`, `02-manager-workflow.md`, `05-ux-spec.md`, `03-domain-model.md`, `04-optimization-spec.md` (All Frozen)

## 1. Công nghệ, Cấu hình Biên dịch & Scripts (Stack, Tooling & Reproducibility)

| **Hạng mục** | **Lựa chọn & Hợp đồng kỹ thuật** |
|---|---|
| **Runtime & Build** | **Vite + React 19 + TypeScript**. Quản lý toolchain qua **`mise` + `pnpm`**. Chạy 100% client-side, khởi động bằng 2 lệnh (`pnpm install && pnpm run dev`), không cần network round-trip; thời gian phản hồi thực tế phụ thuộc vào phép tính Derived State và chu kỳ render của trình duyệt. |
| **TypeScript Config** | `target: "ES2020"` (hoặc cao hơn để hỗ trợ `BigInt` gốc), `lib: ["ES2020", "DOM", "DOM.Iterable"]`, `strict: true`, `noUncheckedIndexedAccess: true`. Trình duyệt mục tiêu là modern evergreen browsers hỗ trợ `BigInt` và `crypto.randomUUID()`. |
| **Styling** | **Tailwind CSS** cho lưới Weekly Roster, bảng Aggregated Summary $7 \times 16$ và các trạng thái tương phản rõ ràng (không dùng màu sắc làm tín hiệu duy nhất), không phụ thuộc thư viện UI cồng kềnh. |
| **Testing & Benchmark** | **Vitest** (Unit, Integration, Acceptance Tests), **Vitest Bench** (Solver microbenchmark trên Node), và **Playwright + Chromium** (Browser performance test và E2E/integration). |
| **Persistence** | **`window.localStorage`** (khớp F-10) bọc qua adapter phòng thủ toàn diện lỗi truy cập/đọc/ghi, migration và recovery. |
| **External Libraries** | **Không dùng thư viện giải toán ngoài.** Giữ bộ giải gọn, dễ giải thích từng dòng và dễ sửa nóng trong buổi on-site interview. |
| **Cài đặt & Scripts** | Quản lý qua **`mise` + `pnpm`**. Commit `pnpm-lock.yaml` và dùng `pnpm install --frozen-lockfile` (hoặc `pnpm install`) cho cài đặt tái lập (tuyệt đối không dùng `npm`). Tách riêng các script trong `package.json`: `dev`, `typecheck`, `test`, `bench`, `bench:browser`, `build`. |

## 2. Ranh giới Mô-đun & Hướng Phụ thuộc (Module Boundaries)

Kiến trúc tách cứng **4 lớp độc lập** với hướng phụ thuộc một chiều (`ui` $\to$ `state` $\to$ `domain` & `persistence`). Lớp `domain` là **100% Pure TypeScript**: không import React, DOM, `window.localStorage`, `File`, `Math.random`, `Date.now` hay `crypto.randomUUID`. Toàn bộ **Persistence / UI Metadata** đặt riêng tại `src/persistence/storageTypes.ts`, không nằm trong `src/domain/types.ts`.

```text
src/
├── domain/                       # 100% Pure TypeScript (Deterministic, Deep-Readonly inputs)
│   ├── types.ts                  # Chỉ chứa Domain Source of Truth, Derived State & Solver Contract
│   ├── decimalMath.ts            # Chia trần thập phân chính xác bằng BigInt + kiểm soát Safe Integer
│   ├── csvParser.ts              # Pure parseCsvTransactions(text) — không đọc File, không gọi đồng hồ
│   ├── constraints.ts            # Kiểm định F-04, Pin Conflict Gate (E-03), Assignment Guidance (E-07)
│   ├── derivedMetrics.ts         # Union-of-hours, Aggregated Summary (2.6), Health Bar (4 tín hiệu), P1 Coverage
│   ├── autoScheduler.ts          # Heuristic 2 tầng (Best-Fit + Delta Rebalance) + Candidate Validator
│   └── demoData.ts               # Seed dữ liệu Demo Store (CSV mẫu + danh sách Staff đa dạng + 2 ca mặc định)
├── persistence/                  # Tầng Lưu trữ, Metadata, Schema Validator, Migration & Recovery
│   ├── storageTypes.ts           # PersistedAppState (schemaVersion, activeScheduleId), StorageMode, LoadResult
│   ├── storageSchema.ts          # Validate toàn vẹn cấu trúc, ID, safe integer, N [1,500], ISO timestamps, 7x16 demand
│   └── localStorageAdapter.ts    # Bọc toàn bộ truy cập/đọc/ghi storage, backup, version guard & recovery lock
├── state/                        # Application Actions, Injected Clock/ID & Immutable Store
│   ├── scheduleActions.ts        # Strict Schedule Scoping, Immutable Mutations, Atomic Commit, Revision Guard
│   └── useScheduleStore.ts       # React store khởi tạo thuần từ bootstrapState + memoized selectors
├── ui/                           # React Components (mỏng, render Derived State & gọi Actions)
│   ├── screens/                  # ScheduleListScreen, ScheduleWorkspaceScreen
│   ├── workspace/                # TopActionBar, ScheduleHealthBar, ContextualBanners, RecoveryBanner
│   ├── roster/                   # WeeklyRosterGrid, AssignmentChip, AssignmentGuidancePopover
│   ├── summary/                  # AggregatedSummaryView (P0 Metrics + P1 Conditional Coverage Toggle)
│   └── panels/                   # StaffPanel, StaffFormModal, ManageShiftsModal, CsvImportModal, ConfirmDialog
├── main.tsx                      # Gọi loadState() một lần trước React render để truyền bootstrapState
├── __tests__/                    # Unit, Integration & Acceptance Tests (chạy bằng `pnpm test`)
└── benchmarks/                   # Vitest Bench (`pnpm run bench`) & Playwright Chromium (`pnpm run bench:browser`)
```

## 3. Độ chính xác Số học, Biên `N` & Giới hạn Số nguyên An toàn (`src/domain/decimalMath.ts`)

### 3.1 Giới hạn Safe Integer & Quy tắc Truyền lỗi `SAFE_INTEGER_OVERFLOW`

Áp dụng thống nhất quy tắc **Safe Integer (`Number.isSafeInteger`, tức $[0, 2^{53}-1]$)** xuyên suốt `csvParser`, `storageSchema`, `derivedMetrics` và `autoScheduler`:

1. **Giá trị đơn lẻ:** Mọi `transactions[d][h]` và `maxWeeklyHours` phải thỏa `Number.isSafeInteger(v) && v >= 0`.
2. **Bảo vệ toàn bộ phép cộng Aggregate Metric bằng `BigInt`:** Mọi phép cộng tạo ra chỉ số tổng hợp kiểu `number` — cụ thể gồm `totalTransactions`, `totalRequiredStaffHours`, **`unusedCapacityHours`** ($\sum_{i \in E} \max(0, \text{maxWeeklyHours}_i - \text{assignedHours}_i)$), `shortageHours`, `uncoverableRequiredStaffHours`, `residualCoverableShortageHours`, `overstaffedHours` và tổng quỹ giờ đội ngũ (`totalTeamCapacityHours`) — đều bắt buộc cộng dồn bằng `BigInt` và kiểm tra `<= BigInt(Number.MAX_SAFE_INTEGER)` trước khi chuyển về `number`.
3. **Kết quả `RequiredStaff(d, h)`:** Mọi kết quả chia trần `BigInt` phải thỏa `<= BigInt(Number.MAX_SAFE_INTEGER)` trước khi chuyển sang `number`.
4. **Hợp đồng truyền lỗi lên Solver (giữ nguyên enum Phase 4 đã Freeze):**
   * Bất kỳ lỗi `SAFE_INTEGER_OVERFLOW` nào phát sinh trong quá trình tính `RequiredStaff`, tính tổng nhu cầu hoặc xây dựng `diagnostics` (bao gồm `unusedCapacityHours`) bắt buộc được tầng Solver trả về dưới dạng:
     * `status: 'FAILED'`
     * `reasonCode: 'UNEXPECTED_ERROR'`
     * `message`: chứa mã kỹ thuật xác định **`SAFE_INTEGER_OVERFLOW`** kèm mô tả trường bị tràn.
   * Tuyệt đối **không** âm thầm chuyển đổi mất độ chính xác và **không** commit candidate state.
   * Ở tầng `derivedMetrics` (ngoài Solver), mọi tổng hợp vượt Safe Integer trả về lỗi kiểm soát thay vì hiển thị giá trị đã mất độ chính xác.
5. **Đồng nhất biên ứng dụng $N \in [1, 500]$ (Phase 4):**
   * Mọi thao tác đổi `N` trên UI, mọi application action (`setTargetTxnsPerStaffHour`, `createSchedule`) và **validator khi Hydration (`storageSchema.ts`)** đều bắt buộc `Number.isFinite(N) && N >= 1 && N <= 500`.
   * Giá trị ngoài $[1, 500]$ lúc Hydrate **tuyệt đối không được tự động clamp**; phải báo lỗi dữ liệu và đưa payload vào luồng Recovery giữ nguyên `rawPayload`.
   * Hàm lõi `computeRequiredStaff(transactions, n)` vẫn duy trì kiểm tra `SAFE_INTEGER_OVERFLOW` như một lớp phòng thủ độc lập cho mọi $n > 0$ hữu hạn.

### 3.2 Thuật toán Parse Thập phân & Chia Trần Chính xác bằng `BigInt`

Để triệt tiêu hoàn toàn sai số IEEE-754 mà **không dùng epsilon tùy ý**, hàm `computeRequiredStaff` phân rã `n.toString()` thành phân số thập phân chính xác và tính phép chia trần bằng `BigInt`:

```ts
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const DECIMAL_REGEX = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

export function computeRequiredStaff(
  transactions: number,
  n: number,
): { ok: true; value: number } | { ok: false; error: 'INVALID_INPUT' | 'SAFE_INTEGER_OVERFLOW' } {
  if (!Number.isSafeInteger(transactions) || transactions < 0 || !Number.isFinite(n) || n <= 0) {
    return { ok: false, error: 'INVALID_INPUT' };
  }
  if (transactions === 0) {
    return { ok: true, value: 0 };
  }

  const raw = n.toString();
  const match = DECIMAL_REGEX.exec(raw);

  if (!match || match[1] === undefined) {
    return { ok: false, error: 'INVALID_INPUT' };
  }

  const intPart = match[1];
  const fracPart = match[2] ?? '';
  const exponentPart = match[3] ? Number(match[3]) : 0;

  const digits = (intPart + fracPart).replace(/^0+/, '');
  if (!digits) {
    return { ok: false, error: 'INVALID_INPUT' };
  }

  const mantissa = BigInt(digits);
  const exponent = exponentPart - fracPart.length;

  let num: bigint;
  let den: bigint;
  if (exponent < 0) {
    num = BigInt(transactions) * 10n ** BigInt(-exponent);
    den = mantissa;
  } else {
    num = BigInt(transactions);
    den = mantissa * 10n ** BigInt(exponent);
  }

  const ceilResult = (num + den - 1n) / den;
  if (ceilResult > MAX_SAFE_BIGINT) {
    return { ok: false, error: 'SAFE_INTEGER_OVERFLOW' };
  }

  return { ok: true, value: Number(ceilResult) };
}
```

#### Kiểm chứng Capture Groups, Hành vi Biên & Smoke Tests bắt buộc

| **Input (`raw`)** | **`match[1]` (`intPart`)** | **`match[2]` (`fracPart`)** | **`match[3]` (`exponentPart`)** | **`(mantissa, exponent)`** |
|---|---|---|---|---|
| `"1.4"` | `"1"` | `"4"` | `undefined` | `(14n, -1)` |
| `"12.5"` | `"12"` | `"5"` | `undefined` | `(125n, -1)` |
| `"0.015"` | `"0"` | `"015"` | `undefined` | `(15n, -3)` |
| `"100"` | `"100"` | `undefined` | `undefined` | `(100n, 0)` |
| `"1.5e-7"` | `"1"` | `"5"` | `"-7"` | `(15n, -8)` |
| `"1.5e+21"` | `"1"` | `"5"` | `"+21"` | `(15n, 20)` |

```ts
expect(DECIMAL_REGEX.test('1.4')).toBe(true);
expect(DECIMAL_REGEX.exec('1.4')?.slice(1, 4)).toEqual(['1', '4', undefined]);
expect(DECIMAL_REGEX.exec('1.5e-7')?.slice(1, 4)).toEqual(['1', '5', '-7']);
expect(DECIMAL_REGEX.exec('1.5e+21')?.slice(1, 4)).toEqual(['1', '5', '+21']);
```

* **Kiểm chứng hành vi chia trần:**
  * `21 / 1.4`: `num = 210n`, `den = 14n` $\to$ `(210n + 13n) / 14n = 223n / 14n = 15n` $\to$ **`15`** (chính xác tuyệt đối).
  * `42 / 2.8`: `num = 420n`, `den = 28n` $\to$ **`15`**.
  * `21 / 1.399999999999999`: `num = 21000000000000000n`, `den = 1399999999999999n` $\to$ **`16`** (không bị epsilon tùy ý làm tròn xuống sai).

### 3.3 Kiểm soát Round-Trip Chuỗi Nhập `N` trên UI (`TopActionBar`)

Vì `Domain Model` đã Freeze `targetTxnsPerStaffHour: number`, UI không được âm thầm nhận một chuỗi thập phân bị IEEE-754 làm tròn sang số khác (VD: `"1.0000000000000001"` bị ép thành `1`):

* Dùng `<input type="text" inputMode="decimal" />` kèm hai nút `-` / `+` (bước tăng `1` khi bấm nút), **không** đặt HTML `step="1"` để tránh trình duyệt chặn giá trị thập phân hợp lệ như `1.4` hay `12.5`.
* Quy trình validate chuỗi `rawInput`:
  1. Trim và khớp `^\d+(?:\.\d+)?$`.
  2. Parse `parsed = Number(trimmed)` và kiểm tra `Number.isFinite(parsed) && parsed >= 1 && parsed <= 500`.
  3. **Kiểm tra Round-Trip chính xác thập phân:** Chuẩn hóa `trimmed` về dạng thập phân chính tắc `canonicalInput` (bỏ `0` thừa ở đầu phần nguyên và cuối phần thập phân) và chuyển `parsed.toString()` sang dạng thập phân không ký hiệu khoa học `canonicalParsed`. Nếu `canonicalInput !== canonicalParsed` (VD: `"1.0000000000000001"` $\to$ `"1"`) $\to$ từ chối với thông báo lỗi inline (*"Giá trị vượt độ chính xác số thập phân được hỗ trợ"*), không ghi đè `Schedule.targetTxnsPerStaffHour`.

## 4. Triển khai Bộ giải, Determinism & Kiểm soát Bất biến (`src/domain/autoScheduler.ts`)

### 4.1 Deep-Readonly Snapshot Input & Luồng Thực thi Pure Function

Lõi bộ giải nhận đầu vào **deep-readonly** và tuyệt đối không mutate bất kỳ object/array nào thuộc snapshot gốc:

```ts
type DeepReadonlyDemand = {
  readonly importedAt: string;
  readonly sourceFileName?: string;
  readonly transactions: Readonly<Record<DayOfWeek, Readonly<Record<OperatingHour, number>>>>;
};

interface AutoScheduleInput {
  readonly demand: DeepReadonlyDemand | null;
  readonly staff: readonly Readonly<Staff>[];
  readonly shifts: readonly Readonly<ShiftTemplate>[];
  readonly existingAssignments: readonly Readonly<Assignment>[];
  readonly targetTxnsPerStaffHour: number;
  readonly idGenerator: () => string; // Chỉ gọi sau khi tối ưu hoàn tất
}
```

```text
runAutoSchedule(input: AutoScheduleInput): AutoScheduleResult
  1. checkInputReadiness(input)        -> thiếu? trả FAILED ('MISSING_INPUT')
  2. checkPinConflicts(input)          -> xung đột? trả BLOCKED_PIN_CONFLICT
  3. runStage1Coverage(state)          -> Bước 1A (Gaps) + Bước 1B (Deficit) với Best-Fit -> Jain -> ID
  4. runStage2Rebalance(state)         -> Delta-based O(1) evaluation, tối đa 200 vòng (dùng stableKey nội bộ)
  5. assignGeneratedIds(state, gen)    -> Gọi idGenerator() theo stableKey ASC + kiểm tra trùng ID toàn cục
  6. validateCandidateAssignments()    -> Kiểm định độc lập toàn bộ 5 bất biến Atomic Commit & lưới StaffHours
  7. buildDiagnostics()                -> Tính metrics (có BigInt overflow guard) + summaryMessages -> trả SUCCESS
```

### 4.2 Tách Bạch Deterministic Allocation khỏi Generated Identity

Phân biệt rõ hai tính chất:

* **Deterministic Allocation (Bắt buộc):** Với cùng dữ liệu đầu vào (`demand`, `staff`, `shifts`, `existingAssignments`, `N`), thuật toán **luôn tạo ra cùng một tập phân bổ nhân viên vào các slot `(day, shiftId)`**, hoàn toàn không phụ thuộc vào chuỗi UUID được sinh ra.
* **Generated Identity:** Ở môi trường thực tế dùng `crypto.randomUUID()`, trường `id` của các assignment mới tạo ra có thể khác nhau giữa các lần chạy (còn với một `idGenerator` xác định được inject trong test, toàn bộ output kể cả `id` là giống hệt nhau).

**Cơ chế thực thi:**

1. Trong suốt Stage 1 và Stage 2, các phân công mới **không mang UUID** mà dùng cấu trúc nội bộ `WorkingAssignment` với khóa ổn định xác định:
   * `stableOrdinal: number` (`0, 1, 2, ...` theo đúng trình tự tạo ra ở Stage 1).
   * `initialStaffId: string` (nhân viên được chọn ban đầu tại Stage 1).
   * Khóa sắp xếp & phá đồng hạng nội bộ của Tầng 2: `(day ASC, shift.startHour ASC, shift.endHour ASC, shiftId ASC, initialStaffId ASC, stableOrdinal ASC)`.
   * Khóa phá đồng hạng nước đi Tầng 2: `(moveType: 'REASSIGN' < 'SWAP', primaryStableKey ASC, secondaryStableKeyOrStaffId ASC)`.
2. **Chỉ sau khi Stage 2 hoàn tất**, mới duyệt các phân công mới theo đúng thứ tự `stableKey ASC` để gọi `idGenerator()` gán `id`; các assignment thuộc tập Pin $P$ giữ nguyên tuyệt đối `id` gốc từ `existingAssignments`.
3. **Kiểm định toàn vẹn ID & Lỗi `idGenerator`:** Bọc việc gọi `idGenerator()` trong `try/catch`; xác minh mỗi `id` là chuỗi không rỗng và **duy nhất trên toàn bộ `candidateAssignments`** (kiểm tra chống trùng giữa tập Pin $P$ với assignment mới **và** giữa các assignment mới với nhau). Nếu `idGenerator()` ném lỗi, trả về ID rỗng/không hợp lệ, hoặc phát sinh trùng ID $\to$ trả về `FAILED` (`reasonCode: 'CANDIDATE_VALIDATION_FAILED'`), tuyệt đối không commit.

### 4.3 Cấu trúc Dữ liệu Nội bộ & Đánh giá Delta Tầng 2 ($O(1)$ mỗi nước đi)

Dựa trên bất biến mọi phân công sau Bước 2 (Pin Gate) và Bước 3 (Stage 1) đều thỏa F-04 (tối đa 1 ca/ngày cho mỗi nhân viên), Tầng 2 duy trì **trạng thái tăng dần (incremental state)** indexed theo `staffIndex` $\in [0, |E|-1]$:

* **Kiểu mảng an toàn không overflow:**
  * `maxHours: Float64Array` — giới hạn giờ từng nhân viên thuộc $E$ (biểu diễn chính xác 100% mọi `Number.isSafeInteger`, khắc phục hoàn toàn lỗi tràn 32-bit của `Int32Array`).
  * `assignedHours: Int32Array` — giờ hiện tại từng nhân viên (an toàn tuyệt đối vì theo F-04 giới hạn tối đa là $7 \times 16 = 112$).
  * `dayOccupied: Uint8Array` (kích thước $|E| \times 7$) — `1` nếu nhân viên đã có ca vào ngày `d`, `0` nếu trống.
  * `sumU: number`, `sumU2: number` — lưu sẵn $\sum_{i \in E} u_i$ và $\sum_{i \in E} u_i^2$.
* **Độ phức tạp mỗi vòng Tầng 2:** Duyệt $O(|U| \cdot |E| + |U|^2)$ nước đi (`REASSIGN` + `SWAP` khác thời lượng); **mỗi nước đi được kiểm tra ràng buộc và tính $J_{\text{new}}$ trong $O(1)$**:
  * **Đánh giá `REASSIGN(a, newStaff)` trong $O(1)$:**
    * Điều kiện hợp lệ: `dayOccupied[newStaff * 7 + a.day] === 0` **và** `assignedHours[newStaff] + a.duration <= maxHours[newStaff]`.
    * Tính $J_{\text{new}}$ trong $O(1)$: trừ $(u_{\text{old}}, u_{\text{old}}^2)$ của `oldStaff` và `newStaff`, cộng $(u_{\text{new}}, u_{\text{new}}^2)$ mới vào bản sao cục bộ của `sumU`, `sumU2`.
  * **Đánh giá `SWAP(a1, a2)` (với `a1.duration !== a2.duration`, `s1 !== s2`) trong $O(1)$:**
    * Điều kiện ngày: nếu `a1.day === a2.day` thì **luôn hợp lệ về ngày** (cả hai chỉ đổi ca khác nhau trong cùng ngày đó; vì `a1.duration !== a2.duration` nên `a1.shiftId !== a2.shiftId`, bảo đảm không vi phạm duy nhất `(day, shiftId, staffId)`); nếu `a1.day !== a2.day`, bắt buộc `dayOccupied[s1 * 7 + a2.day] === 0 && dayOccupied[s2 * 7 + a1.day] === 0`.
    * Điều kiện giờ tuần: `assignedHours[s1] - L1 + L2 <= maxHours[s1]` **và** `assignedHours[s2] - L2 + L1 <= maxHours[s2]`.
    * Tính $J_{\text{new}}$ trong $O(1)$ theo delta tương tự trên.
* **Cập nhật đồng bộ trạng thái tăng dần & Chống trôi dấu phẩy động:**
  * Khi áp dụng `REASSIGN(a, oldStaff -> newStaff)`: cập nhật đồng thời `dayOccupied[oldStaff * 7 + a.day] = 0`, `assignedHours[oldStaff] -= L`, **và** `dayOccupied[newStaff * 7 + a.day] = 1`, `assignedHours[newStaff] += L`.
  * Khi áp dụng `SWAP(a1, a2)` (`s1`, `s2`): cập nhật đồng thời `assignedHours[s1] = assignedHours[s1] - L1 + L2`, `assignedHours[s2] = assignedHours[s2] - L2 + L1`; nếu `a1.day !== a2.day`, cập nhật đồng thời cả 4 ô `dayOccupied[s1 * 7 + a1.day] = 0`, `dayOccupied[s1 * 7 + a2.day] = 1`, `dayOccupied[s2 * 7 + a2.day] = 0`, `dayOccupied[s2 * 7 + a1.day] = 1`.
  * Cuối mỗi vòng sau khi áp dụng nước đi tốt nhất, tính lại trực tiếp `sumU` và `sumU2` từ `assignedHours` và `maxHours` ($O(|E|)$) để triệt tiêu sai số cộng dồn dấu phẩy động.
* **Kiểm định Hậu điều kiện Độc lập (Bước 6):** Chạy `validateCandidateAssignments(candidateAssignments, input)` độc lập hoàn toàn với trạng thái tăng dần để xác minh đủ 5 bất biến Atomic Commit (`03-domain-model.md` mục 4.3), tính duy nhất ID trên toàn bộ `candidateAssignments`, lưới `StaffHours(d, h)` trước/sau Stage 2 bằng nhau tuyệt đối trên cả 112 ô, và kiểm tra không có `SAFE_INTEGER_OVERFLOW` khi dựng `diagnostics` (bao gồm `unusedCapacityHours`).

## 5. Quản lý Trạng thái, Bootstrap & Persistence (`src/state/` & `src/persistence/`)

### 5.1 Bootstrap ngoài React Strict Mode, Immutability & Revision Guard (`src/state/`)

Để tránh side effect (đọc storage / ghi backup key) bị chạy lặp trong React Strict Mode khi nằm bên trong lazy initializer:

```ts
// src/main.tsx
const bootstrapState = loadState();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App bootstrapState={bootstrapState} />
  </StrictMode>,
);
```

* **Store thuần túy & Hydration Gate:** `useScheduleStore` khởi tạo trực tiếp từ `bootstrapState` đã nạp sẵn trước lần render đầu tiên (tuyệt đối không render Schedule List rỗng rồi mới đọc trong `useEffect`, và không đọc/ghi storage bên trong initializer). Auto-save chỉ được phép chạy khi `storageMode === 'normal'`.
* **Inject Clock & ID:** Mọi application action nhận dependency `{ nowIso: () => string; generateId: () => string }` (mặc định thực tế: `() => new Date().toISOString()` và `() => crypto.randomUUID()`), bảo đảm kiểm thử xác định 100% các mốc `createdAt`, `updatedAt`, `importedAt`.
* **Immutable Mutations & Strict Schedule Scoping:** Mọi đột biến tạo bản sao object/array mới để `useMemo([activeSchedule])` luôn tái tính Derived State chính xác. Mọi action nhắm vào thực thể con (`Staff`, `ShiftTemplate`, `Assignment`) bắt buộc nhận `scheduleId` tường minh, tra cứu đúng `Schedule` sở hữu trước rồi mới thao tác bên trong.
* **Quy tắc cập nhật `Schedule.updatedAt`:** Chỉ các đột biến hợp lệ lên Domain Source of Truth mới cập nhật `Schedule.updatedAt`; chuyển đổi `activeScheduleId` hay đổi tab UI (`Roster` $\leftrightarrow$ `Summary`) tuyệt đối không chạm `updatedAt`.
* **Tách bạch Domain Commit vs. Persistence Result:**
  * **Domain Commit (Atomic trên RAM):** Gọi `runAutoSchedule(snapshot)` bên ngoài bước ghi state. Nếu `result.status === 'BLOCKED_PIN_CONFLICT'` hoặc `'FAILED'`: giữ nguyên tham chiếu `Schedule.assignments` và `Schedule.updatedAt` cũ, chỉ cập nhật UI state cục bộ (Banner lỗi / highlight chip xung đột Pin). Chỉ khi `result.status === 'SUCCESS'` (đã qua Candidate Validation) mới thay thế `Schedule.assignments = result.assignments` và cập nhật `Schedule.updatedAt = nowIso()` trong một lần chuyển state nguyên tử.
  * **Persistence Result (`saveStatus`):** Theo dõi độc lập xem payload RAM mới nhất đã ghi xuống `LocalStorage` thành công hay chưa (`'saved' | 'save_error' | 'locked'`).
* **Revision Guard (Dự phòng nếu chạy Solver bất đồng bộ trong Web Worker):**
  * Duy trì `scheduleRevision: Record<string, number>` tăng `+1` sau mỗi Domain mutation của Schedule đó trong runtime.
  * Khi dispatch sang Worker: (1) lưu `snapshotRevision` của Schedule; (2) khi Worker trả kết quả, so sánh `currentRevision === snapshotRevision`; (3) nếu lệch revision thì hủy bỏ kết quả cũ (không ghi đè thao tác mới hơn của Manager); chỉ commit khi revision khớp và vượt qua Candidate Validation.

### 5.2 Persistence, 4 Trạng thái Storage & Atomic Reset Contract (`src/persistence/`)

* **Khóa lưu trữ:** Chính `staff_scheduler_state_v1`; sao lưu dự phòng `staff_scheduler_recovery_backup`.
* **Bọc `try/catch` toàn diện:** Mọi thao tác truy cập `window.localStorage`, `getItem()`, `setItem()` khóa chính và `setItem()` khóa backup đều được bọc `try/catch`. Chỉ `raw === null` mới là trạng thái lần đầu mở ứng dụng; `raw === ""` là payload hỏng $\to$ đưa vào `recovery_locked`.
* **Kiểm tra `schemaVersion` & Migration:**
  * `=== 1`: chạy validator toàn vẹn.
  * `< 1` (khi có phiên bản cũ hơn về sau): chạy hàm migration tuần tự lên phiên bản hiện tại rồi chạy validator toàn vẹn.
  * `> 1`: chuyển sang `incompatible_version_locked`, tuyệt đối không ghi đè.
  * Thiếu hoặc không phải số nguyên hợp lệ: chuyển sang `recovery_locked`.
* **Schema Validator Đầy đủ (`storageSchema.ts`):**
  * Kiểm tra toàn bộ 7 quy tắc mục 7.3 `03-domain-model.md`, **cộng thêm:**
    * `targetTxnsPerStaffHour` hữu hạn và nằm trong **`[1, 500]`** (không auto-clamp).
    * `createdAt`, `updatedAt`, `importedAt` là chuỗi ISO 8601 hợp lệ (phân biệt rõ thiếu trường vs. sai định dạng); `sourceFileName` nếu có phải là `string`.
    * `maxWeeklyHours`, từng ô `transactions[d][h]` và tổng `totalTransactions` thỏa `Number.isSafeInteger` và `>= 0`.
  * Chỉ trường hợp `Assignment` mồ côi trên payload có cấu trúc tổng thể hợp lệ mới được tự lọc bỏ kèm cảnh báo nhẹ; các sai lệch cấu trúc khác đi vào `recovery_locked`.
* **4 Trạng thái Storage (`storageMode`) & Recovery UI gọn nhẹ (khớp `03-domain-model.md` và `05-ux-spec.md`):**

| **`storageMode`** | **Nguyên nhân kích hoạt** | **Hành vi Auto-save & RAM** | **UI & Hành động cho Người dùng** |
|---|---|---|---|
| **`normal`** | `getItem() === null` hoặc Hydrate/Migration hợp lệ | Auto-save bật. Khi `setItem()` lỗi $\to$ giữ state RAM mới nhất, chuyển `saveStatus = 'save_error'` (Top Bar ngừng hiện *"Saved locally"*, chuyển sang *"Unable to save locally — changes exist in memory only"*); lần ghi tiếp theo luôn ghi toàn bộ payload RAM mới nhất. | Hoạt động bình thường. |
| **`recovery_locked`** | JSON hỏng, `raw === ""`, thiếu/sai `schemaVersion`, hoặc vi phạm schema (kể cả `N` ngoài $[1, 500]$) | Auto-save **khóa** (`saveStatus = 'locked'`). Giữ nguyên `rawPayload` trong RAM và thử sao lưu sang `staff_scheduler_recovery_backup` (best-effort, không phụ thuộc thành công). | Schedule List trống + **Recovery Banner** thông báo nguyên nhân rõ ràng và nút **Reset & Start Fresh** (tuân thủ *Atomic Reset Contract*, chỉ ghi đè khóa chính sau khi Manager xác nhận). |
| **`incompatible_version_locked`** | `schemaVersion > 1` | Auto-save **khóa** (`saveStatus = 'locked'`). Giữ `rawPayload` trong RAM; tuyệt đối không ghi đè khóa chính. | Banner thông báo dữ liệu thuộc phiên bản ứng dụng mới hơn không tương thích; khóa auto-save và không tự ghi đè. |
| **`storage_unavailable_locked`** | Truy cập `window.localStorage` hoặc `getItem()` ném exception (`SecurityError`, v.v.) | Auto-save **khóa** (`saveStatus = 'locked'`). Không coi là lần đầu mở app; khóa thao tác tạo hoặc chỉnh sửa dữ liệu cho đến khi Storage khả dụng trở lại. | Banner thông báo không thể truy cập `LocalStorage`, hướng dẫn kiểm tra quyền trình duyệt kèm nút **Retry Storage Access** (gọi lại `loadState()` / tải lại ứng dụng). **Không** hiển thị nút *Reset & Start Fresh*. |

* **Atomic Reset Contract (Bắt buộc cho `Reset & Start Fresh`):**
  1. Người dùng xác nhận **Reset & Start Fresh**.
  2. Tạo payload khởi tạo sạch (`schemaVersion: 1, activeScheduleId: null, schedules: []`) trong bộ nhớ.
  3. Gọi `localStorage.setItem(PRIMARY_KEY, cleanJson)` để ghi payload sạch xuống khóa chính.
  4. **Chỉ khi `setItem()` thành công:** chuyển `storageMode = 'normal'`, xóa `rawPayload` khỏi RAM, đặt `saveStatus = 'saved'` và bật lại Auto-save.
  5. **Nếu `setItem()` thất bại:** giữ nguyên `recovery_locked` (hoặc trạng thái khóa hiện tại), **giữ nguyên `rawPayload` trong RAM**, và hiển thị thông báo lỗi Reset rõ ràng. Tuyệt đối không mở khóa ứng dụng hay để người dùng hiểu nhầm dữ liệu cũ đã được xóa.

## 6. Triển khai CSV Importer (`src/domain/csvParser.ts`)

### 6.1 Tách Đôi Trách nhiệm (Pure Domain vs. Application)

1. **Pure Domain (`parseCsvTransactions(text: string)`):** Không nhận `File`, không gọi đồng hồ, không tạo UUID. Trả về:
   ```ts
   interface CsvParseError {
     row?: number;
     column?: number;
     dayLabel?: string;
     hourLabel?: string;
     message: string;
   }

   type CsvParseResult =
     | { ok: true; transactions: Record<DayOfWeek, Record<OperatingHour, number>>; totalTransactions: number }
     | { ok: false; errors: CsvParseError[] };
   ```
2. **Application Action (`importCsvToSchedule`):** UI gọi `await file.text()`. Nếu `file.text()` thất bại $\to$ báo lỗi đọc file ngay tại modal, không gọi mutation, giữ nguyên `Schedule.demand` cũ (E-01). Nếu đọc được chuỗi $\to$ gọi `parseCsvTransactions(text)`; chỉ khi `ok === true` mới gắn `importedAt = nowIso()` và `sourceFileName = file.name` để tạo `DemandDataset` và thay thế toàn bộ `Schedule.demand` trong một mutation nguyên tử.

### 6.2 Hợp đồng Parse CSV Nghiêm ngặt

* **UTF-8 BOM:** Loại bỏ ký tự BOM đầu file (`\uFEFF`) trước khi phân tích header đầu tiên.
* **RFC 4180:** Xử lý đầy đủ quoted comma (VD: `"Fri, 07 Aug 2026"`), escaped quote (`""`), `\r\n` / `\n`; báo lỗi rõ nếu có unclosed quote. Nếu ô bọc ngoặc kép chứa ký tự xuống dòng (multiline quoted field): parser không tách nhầm hàng, nhưng validator báo lỗi cụ thể ô đó chứa ký tự xuống dòng không hợp lệ cho định dạng báo cáo giao dịch.
* **Cấu trúc hàng & cột chặt chẽ:** Chỉ bỏ dòng hoàn toàn trống ở cuối file (trailing empty lines); không âm thầm bỏ cột/hàng thừa có dữ liệu. Đúng **8 cột** (1 cột giờ + 7 cột ngày) và đúng **16 dòng dữ liệu** tương ứng 16 khung giờ duy nhất `7..22` (`7am`–`10pm` hoặc `07:00`–`22:00`, báo lỗi rõ nếu thiếu hoặc trùng giờ).
* **Hai Chế độ Header Ngày (Không trộn lẫn):**
  1. **Weekday-only:** Cả 7 cột đều là tên thứ (VD: `Mon..Sun` theo bất kỳ thứ tự nào), phủ đủ 7 thứ phân biệt `0..6`.
  2. **Calendar-date:** Cả 7 cột đều là ngày lịch tường minh (VD: `Fri 07 Aug 2026`, `2026-08-07`, `07 Aug 2026`, `Aug 07, 2026`). Tính thứ hoàn toàn bằng **UTC** (`Date.UTC`); từ chối ngày không tồn tại (`31 Feb 2026`) và định dạng số mơ hồ (`01/02/2026`); nếu có cả tên thứ lẫn ngày lịch thì phải khớp UTC; 7 ngày phải liên tiếp ($\text{maxUtcDay} - \text{minUtcDay} = 6$ ngày) phủ đủ `Mon–Sun` *(vẫn chấp nhận hợp lệ file mẫu `Fri 07 Aug – Thu 13 Aug 2026` rồi chuẩn hóa lưu theo `Mon–Sun`)*.
  * **Từ chối trộn lẫn:** Nếu trong cùng file vừa có cột ngày lịch vừa có cột chỉ có tên thứ $\to$ báo lỗi header không nhất quán.
* **Kiểm tra Ô Giao dịch:** Trim khoảng trắng đầu/cuối ô, khớp `^\d+$`, từ chối ô rỗng, số âm, số thập phân, chữ cái; kiểm tra `Number.isSafeInteger` cho từng ô và cộng dồn `BigInt` kiểm tra tổng 112 ô $\le \text{Number.MAX\_SAFE\_INTEGER}$.

## 7. Chiến lược Derived State, Rendering & Tách tầng P0 / P1

* **Memoized Derivation:** Khi mở một `Schedule`, toàn bộ Derived State (`staffMetrics`, `summary`, `health`, `assignmentWarnings`) được tính tập trung qua một selector thuần túy `deriveScheduleViewModel(schedule)` bọc trong `useMemo([schedule])` (hoạt động chính xác nhờ bất biến Immutable Mutations tại Mục 5.1).
* **Quy tắc Ngưỡng Health Bar:** Hàm phân loại trạng thái (`'neutral' | 'good' | 'attention' | 'warning'`) nhận **giá trị số thực đầy đủ chưa làm tròn (`toFixed`)** và so sánh chính xác trên các biên đã chốt tại `04-optimization-spec.md` (`0.75`, `0.90` cho Demand Coverage; `0.80`, `0.90` cho Fairness Jain Index).
* **Tách rõ Cổng P1 (`Coverage View`):**
  * Dữ liệu `requiredStaff` và `coverageDelta` cho từng ô đã nằm sẵn trong `derivedMetrics.ts` (phục vụ chung cho `demandCoverage` của P0 Health Bar).
  * Tuy nhiên, phần UI nút chuyển đổi `Metrics View` $\leftrightarrow$ `Coverage View` trong `AggregatedSummaryView` chỉ được kích hoạt và kiểm thử **sau khi toàn bộ luồng P0 hoàn tất và pass 100% Acceptance Tests**.

## 8. Kế hoạch Benchmark Hiệu năng & Chính sách Escalation

Tách riêng khỏi `pnpm test` (chạy bằng `pnpm run bench` và `pnpm run bench:browser`) để không làm fail test logic ngẫu nhiên theo phần cứng.

### 8.1 Hai Cấp Benchmark Bắt buộc

| **Loại Benchmark** | **Công cụ & Script** | **Phương pháp đo & Chỉ số báo cáo** | **Mục đích** |
|---|---|---|---|
| **1. Solver Microbenchmark** | **Vitest Bench** trên Node (`pnpm run bench`) | Có warm-up, lặp nhiều lần; báo cáo `median`, `p95`, `max` | Theo dõi hồi quy tốc độ thuật toán qua các phiên bản code. |
| **2. Browser Performance Test** | **Playwright + Chromium** (`pnpm run bench:browser`) | Có warm-up, **tối thiểu 100 lần chạy** sau warm-up trên Chromium; báo cáo **`median`**, **`p95`**, **`max`** và **số lần chạy vượt 50 ms (`over50msCount`)** | Xác minh độ mượt thực tế và rủi ro Long Task trên main thread trình duyệt. |

### 8.2 Ba Bộ Dữ liệu & Kiểm chứng Worst-Case 200 Vòng

1. **Standard (Demo Store):** 7 ngày $\times$ 2–4 shifts, 10–15 nhân viên — *Mục tiêu Chromium: `p95 <= 20 ms`, `over50msCount = 0`*.
2. **Large Store:** 7 ngày $\times$ 6 shifts (gồm ca gối đầu), 30 nhân viên — *Mục tiêu Chromium: `p95 <= 50 ms`, không có Long Task lặp lại*.
3. **Worst-Case Stress (200 vòng):** 7 ngày $\times$ 6 shifts, 50 nhân viên có quỹ giờ bất cân xứng. **Bắt buộc assert trong fixture** (nếu hội tụ sớm hơn 200 vòng thì không được tính là worst-case):
   ```ts
   expect(result.status).toBe('SUCCESS');
   expect(result.diagnostics.rebalanceStopReason).toBe('MAX_ITERATIONS_REACHED');
   expect(result.diagnostics.rebalanceIterationsRun).toBe(200);
   ```

### 8.3 Chính sách Escalation Đóng kín trên Chromium (Ngưỡng Long Task 50 ms)

Không diễn giải `p95 <= 50 ms` là bằng chứng tuyệt đối không có Long Task; đánh giá đồng thời `p95`, `max` và `over50msCount` trên tối thiểu 100 lần đo:

| **Điều kiện đo Worst-Case trên Chromium ($\ge 100$ lần sau warm-up)** | **Hành động kỹ thuật bắt buộc** |
|---|---|
| **`p95 <= 50 ms` và không có Long Task lặp lại** (`over50msCount` không lặp lại có hệ thống) | Giữ solver chạy đồng bộ trong MVP. |
| **`p95 > 50 ms` hoặc xuất hiện Long Task lặp lại** | Bắt buộc tối ưu thêm thuật toán/cấp phát bộ nhớ (VD: cắt tỉa ứng viên SWAP) và đo lại trên Chromium. |
| **Vẫn không đạt sau khi tối ưu** | Chuyển `runAutoSchedule` sang **Web Worker** kết hợp **`scheduleRevision` Guard** (Mục 5.1) để bảo toàn Atomic Commit mà không chặn main thread. |

## 9. Lộ trình Xây dựng theo Vertical Slices (Sang Phase 6)
0. **Slice 0 — Project Setup & Demo Store:** `package.json`, `tsconfig.json`, `vitest.config.ts`, `playwright.config.ts`, `README.md` + pass toàn bộ tests Atomic Commit, Bootstrap Hydration, Atomic Reset, Recovery & Save Error.
1. **Slice 1 — Pure Domain Core:** `types`, `decimalMath`, `csvParser`, `constraints`, `derivedMetrics`, `autoScheduler` + pass 100% unit/acceptance tests miền nghiệp vụ.
2. **Slice 2 — Persistence, State & Demo Store:** `storageTypes`, `storageSchema`, `localStorageAdapter`, `scheduleActions`, `demoData` + pass toàn bộ tests Atomic Commit, Bootstrap Hydration, Atomic Reset, Recovery & Save Error.
3. **Slice 3 — App Shell & Prepare Flows:** `main.tsx` bootstrap, `ScheduleList`, `RecoveryBanner` (đủ 4 storage modes), `TopActionBar` (kèm round-trip `N`), `StaffPanel` + `StaffFormModal`, `ManageShiftsModal`, `CsvImportModal`.
4. **Slice 4 — Roster, Direct Editing & Summary P0:** `ScheduleHealthBar` (4 tín hiệu độc lập), `WeeklyRosterGrid`, `AssignmentChip` (Pin + Cảnh báo cục bộ), `AssignmentGuidancePopover`, `AggregatedSummaryView` (P0).
5. **Slice 5 — Verification, Benchmarks & Conditional P1:** Chạy trọn vẹn `06-acceptance-tests.md`, chạy Node (`pnpm run bench`) + Playwright Chromium (`pnpm run bench:browser`), kiểm thử đóng vai Manager (E-01 $\to$ E-09), hoàn thiện `README.md` (Research Note 2.8 + AI Usage Note), rồi mới bật P1 `Coverage View` sau khi P0 xanh 100%.