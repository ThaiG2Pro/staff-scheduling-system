export type ScenarioPresetId =
  | 'demo_store'
  | 'demo_stage2_rebalance'
  | 'phase2_mrv_availability'
  | 'phase2_shift_active_days'
  | 'complex_mixed_shifts_swap'
  | 'complex_uncoverable_gap'
  | 'complex_heavy_25_staff'
  | 'demo_with_pins'
  | 'pin_conflict_e03'
  | 'pin_conflict_unavailable'
  | 'storage_corrupt_lock';

export interface ScenarioPreset {
  readonly id: ScenarioPresetId;
  readonly name: string;
  readonly shortDescription: string;
  readonly badge: string;
  readonly defaultTargetN: number;
}

export const SCENARIO_PRESETS: readonly ScenarioPreset[] = [
  {
    id: 'demo_store',
    name: 'Demo Store — Tuần cao điểm (N=15 · Full công suất)',
    shortDescription: 'Chạy trọn 7 chặng từ Storage → CSV → BigInt → Stage 1 → Stage 2 → Validation → Atomic Save.',
    badge: 'Happy Path',
    defaultTargetN: 15,
  },
  {
    id: 'demo_stage2_rebalance',
    name: 'Demo Stage 2 — Dư nhân lực (N=28 · Xem san đều ca)',
    shortDescription: 'Stage 1 đóng gói Best-Fit làm lệch tải → Stage 2 chạy hàng loạt REASSIGN kéo Jain Index lên tối đa.',
    badge: 'Stage 2',
    defaultTargetN: 28,
  },
  {
    id: 'phase2_mrv_availability',
    name: 'Phase 2 · MRV & Ngày nghỉ nhân viên (Availability)',
    shortDescription: 'Mix NV chỉ làm T7–CN (2/7d), nghỉ giữa tuần (5/7d), full-week và nghỉ cả tuần (0/7d). Xem Stage 1 ưu tiên MRV và tô ô OFF.',
    badge: 'Phase 2 · MRV',
    defaultTargetN: 22,
  },
  {
    id: 'phase2_shift_active_days',
    name: 'Phase 2 · Ca hoạt động theo thứ (Shift Active Days)',
    shortDescription: 'Ca thường chỉ chạy T2–T6, ca cuối tuần chỉ T7–CN, ca tối chỉ T5–CN → kiểm tra lọc ngày hoạt động & uncoverable theo từng ô.',
    badge: 'Phase 2 · Days',
    defaultTargetN: 22,
  },
  {
    id: 'complex_mixed_shifts_swap',
    name: 'Phức tạp 1 — 14 NV · 5 Ca gối đầu (4h/6h/8h) · SWAP & REASSIGN',
    shortDescription: 'Quỹ giờ lẻ (10–40h + 1 NV nghỉ phép 0h), cao điểm trưa/tối cuối tuần, 3 ca ghim. Ép chạy cả Efficiency, REASSIGN lẫn SWAP khác thời lượng!',
    badge: 'Stress · SWAP',
    defaultTargetN: 22,
  },
  {
    id: 'complex_uncoverable_gap',
    name: 'Phức tạp 2 — Khuyết ca tối 19–23h (Uncoverable Gap)',
    shortDescription: 'Chỉ có ca 07–13h và 13–19h dù tối rất đông khách → kiểm tra chẩn đoán thiếu hụt cấu trúc & giới hạn nhân sự.',
    badge: 'Stress · Thiếu ca',
    defaultTargetN: 18,
  },
  {
    id: 'complex_heavy_25_staff',
    name: 'Phức tạp 3 — Flagship 25 NV · 6 Ca gối đầu (4–8h) · 5 Ca ghim',
    shortDescription: 'Bài test tải lớn: 25 nhân viên (8h–44h), 6 mẫu ca, lưu lượng gấp đôi, 5 ca ghim cố định.',
    badge: 'Stress · 25 NV',
    defaultTargetN: 22,
  },
  {
    id: 'demo_with_pins',
    name: 'Demo Store + 2 Ca ghim cố định (isPinned)',
    shortDescription: 'Xem thuật toán giữ nguyên 100% ca ghim của quản lý và chỉ lấp + cân bằng các ca còn lại.',
    badge: 'Pinned',
    defaultTargetN: 15,
  },
  {
    id: 'pin_conflict_e03',
    name: 'Kịch bản lỗi: Xung đột ca ghim (E-03)',
    shortDescription: '1 nhân viên bị ghim 2 ca cùng ngày → Pin Conflict Gate chặn ngay và giữ nguyên lịch cũ.',
    badge: 'Lỗi E-03',
    defaultTargetN: 15,
  },
  {
    id: 'pin_conflict_unavailable',
    name: 'Kịch bản lỗi: Ca ghim trùng ngày nghỉ (UNAVAILABLE_DAY)',
    shortDescription: 'Nhân viên đánh dấu nghỉ Thứ 2 nhưng bị ghim ca Thứ 2 → Pin Conflict Gate chặn với mã UNAVAILABLE_DAY.',
    badge: 'Lỗi OFF-Pin',
    defaultTargetN: 15,
  },
  {
    id: 'storage_corrupt_lock',
    name: 'Kịch bản lỗi: Storage hỏng (recovery_locked)',
    shortDescription: 'Mô phỏng payload localStorage bị hỏng → hệ thống khóa ghi đè và tạo bản sao lưu khôi phục.',
    badge: 'Storage Lock',
    defaultTargetN: 15,
  },
];
