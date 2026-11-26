import type { Assignment, ShiftTemplate, Staff } from '../../../../src/domain/types';

export interface ComplexFixture {
  readonly label: string;
  readonly csvFileName: string;
  readonly csvText: string;
  readonly staff: readonly Staff[];
  readonly shifts: readonly ShiftTemplate[];
  readonly pinnedAssignments: readonly Assignment[];
}

/**
 * Case 1: Mixed overlapping shifts (4h / 6h / 8h), 14 diverse staff with odd hour caps (10h..40h + 1 on-leave 0h),
 * spiky lunch & weekend dinner peaks, 0-demand off-peak hours, and 3 manager-pinned shifts.
 * Designed to exercise Best-Fit packing, efficiency (4h vs 8h), Stage 2 REASSIGN, AND different-duration SWAP!
 */
export function buildComplexMixedShiftsFixture(): ComplexFixture {
  const csvText = [
    '"Aug 10, 2026 - Aug 16, 2026"',
    ',"Mon, 10 Aug","Tue, 11 Aug","Wed, 12 Aug","Thu, 13 Aug","Fri, 14 Aug","Sat, 15 Aug","Sun, 16 Aug"',
    '7am,18,14,16,20,25,30,0',
    '8am,34,30,36,40,48,55,22',
    '9am,42,38,44,46,54,68,45',
    '10am,46,42,48,50,62,78,60',
    '11am,78,74,82,85,92,98,88',
    '12pm,92,86,90,94,105,112,96',
    '1pm,84,76,80,82,95,104,90',
    '2pm,36,30,34,38,52,72,64',
    '3pm,22,18,20,24,42,60,54',
    '4pm,18,16,18,22,46,64,52',
    '5pm,44,40,46,50,74,86,70',
    '6pm,68,62,66,72,96,108,88',
    '7pm,74,68,72,78,104,114,92',
    '8pm,52,48,50,58,88,96,74',
    '9pm,24,20,22,28,54,62,38',
    '10pm,0,0,8,12,26,34,14',
  ].join('\n');

  const shifts: ShiftTemplate[] = [
    { id: 'sh-early-4h', startHour: 7, endHour: 11 },   // 4h sáng sớm
    { id: 'sh-morn-8h', startHour: 7, endHour: 15 },    // 8h sáng dài
    { id: 'sh-lunch-4h', startHour: 11, endHour: 15 },  // 4h cao điểm trưa (test efficiency!)
    { id: 'sh-eve-6h', startHour: 15, endHour: 21 },    // 6h chiều tối
    { id: 'sh-late-6h', startHour: 17, endHour: 23 },   // 6h tối muộn gối đầu
  ];

  const staff: Staff[] = [
    { id: 'st-01', name: 'An (Trưởng ca)', maxWeeklyHours: 40 },
    { id: 'st-02', name: 'Bình (Full-time)', maxWeeklyHours: 40 },
    { id: 'st-03', name: 'Châu (Full-time)', maxWeeklyHours: 36 },
    { id: 'st-04', name: 'Dũng (Full-time)', maxWeeklyHours: 30 },
    { id: 'st-05', name: 'Em (Part-time)', maxWeeklyHours: 28 },
    { id: 'st-06', name: 'Giang (Part-time)', maxWeeklyHours: 26 },
    { id: 'st-07', name: 'Hà (Part-time)', maxWeeklyHours: 22 },
    { id: 'st-08', name: 'Khánh (Part-time)', maxWeeklyHours: 20 },
    { id: 'st-09', name: 'Linh (Part-time)', maxWeeklyHours: 18 },
    { id: 'st-10', name: 'Minh (SV Ca ngắn)', maxWeeklyHours: 14 },
    { id: 'st-11', name: 'Ngọc (SV Ca ngắn)', maxWeeklyHours: 12 },
    { id: 'st-12', name: 'Phúc (SV Ca ngắn)', maxWeeklyHours: 10 },
    { id: 'st-13', name: 'Quân (SV Ca ngắn)', maxWeeklyHours: 10 },
    { id: 'st-14', name: 'Thảo (Nghỉ phép 0h)', maxWeeklyHours: 0 },
  ];

  const pinnedAssignments: Assignment[] = [
    { id: 'pin-fri-lead', day: 4, shiftId: 'sh-eve-6h', staffId: 'st-01', isPinned: true },
    { id: 'pin-sat-lead', day: 5, shiftId: 'sh-morn-8h', staffId: 'st-01', isPinned: true },
    { id: 'pin-sun-lunch', day: 6, shiftId: 'sh-lunch-4h', staffId: 'st-10', isPinned: true },
  ];

  return {
    label: 'Stress · 14 NV · 5 Ca gối đầu (4h/6h/8h) · SWAP & REASSIGN',
    csvFileName: 'stress_mixed_shifts_spiky.csv',
    csvText,
    staff,
    shifts,
    pinnedAssignments,
  };
}

/**
 * Case 2: Structural Uncoverable Gap (missing evening shifts 19:00–23:00) + tight staff capacity.
 * Tests `uncoverableRequiredStaffHours` diagnostics, red permanent gaps, and partial-capacity rebalance.
 */
export function buildComplexUncoverableGapFixture(): ComplexFixture {
  const csvText = [
    '"Aug 10, 2026 - Aug 16, 2026"',
    ',"Mon, 10 Aug","Tue, 11 Aug","Wed, 12 Aug","Thu, 13 Aug","Fri, 14 Aug","Sat, 15 Aug","Sun, 16 Aug"',
    '7am,15,12,18,16,22,28,20',
    '8am,28,25,30,32,38,46,36',
    '9am,40,36,42,44,52,64,50',
    '10am,44,40,46,48,58,70,56',
    '11am,56,52,58,60,72,82,68',
    '12pm,68,62,66,70,84,96,78',
    '1pm,60,55,58,62,76,88,72',
    '2pm,34,30,32,36,48,60,48',
    '3pm,28,24,26,30,42,54,44',
    '4pm,32,28,30,34,48,62,50',
    '5pm,46,42,44,48,66,78,64',
    '6pm,54,50,52,58,74,86,70',
    '7pm,62,58,60,66,88,96,76',
    '8pm,50,46,48,54,76,84,62',
    '9pm,30,26,28,34,48,56,36',
    '10pm,14,10,12,16,26,32,18',
  ].join('\n');

  // Intentionally NO shift covers 19:00–23:00!
  const shifts: ShiftTemplate[] = [
    { id: 'sh-day-1', startHour: 7, endHour: 13 },  // 6h
    { id: 'sh-day-2', startHour: 13, endHour: 19 }, // 6h
  ];

  const staff: Staff[] = [
    { id: 'u-01', name: 'Hùng', maxWeeklyHours: 24 },
    { id: 'u-02', name: 'Kiên', maxWeeklyHours: 24 },
    { id: 'u-03', name: 'Lan', maxWeeklyHours: 18 },
    { id: 'u-04', name: 'Mai', maxWeeklyHours: 18 },
    { id: 'u-05', name: 'Nam', maxWeeklyHours: 18 },
    { id: 'u-06', name: 'Oanh', maxWeeklyHours: 12 },
    { id: 'u-07', name: 'Phong', maxWeeklyHours: 12 },
    { id: 'u-08', name: 'Quyên', maxWeeklyHours: 12 },
  ];

  return {
    label: 'Stress · Khuyết ca tối 19–23h (Uncoverable Gap)',
    csvFileName: 'stress_uncoverable_evening.csv',
    csvText,
    staff,
    shifts,
    pinnedAssignments: [],
  };
}

/**
 * Case 3: Flagship Store Scale Stress-Test (25 staff, 6 overlapping shifts 4h/5h/6h/8h, high volume, 5 pins).
 */
export function buildComplexFlagship25StaffFixture(): ComplexFixture {
  const csvText = [
    '"Aug 10, 2026 - Aug 16, 2026"',
    ',"Mon, 10 Aug","Tue, 11 Aug","Wed, 12 Aug","Thu, 13 Aug","Fri, 14 Aug","Sat, 15 Aug","Sun, 16 Aug"',
    '7am,36,32,38,40,48,60,42',
    '8am,64,58,66,70,84,102,78',
    '9am,88,80,90,94,110,136,112',
    '10am,102,94,104,110,128,154,130',
    '11am,142,132,146,152,174,198,176',
    '12pm,168,158,172,178,204,228,196',
    '1pm,154,142,156,162,188,210,180',
    '2pm,92,84,96,100,124,152,134',
    '3pm,74,68,76,80,104,132,116',
    '4pm,82,76,84,88,118,144,122',
    '5pm,116,108,120,126,158,184,152',
    '6pm,148,138,152,160,196,222,184',
    '7pm,156,144,160,168,206,232,190',
    '8pm,120,112,124,132,172,194,154',
    '9pm,64,56,66,72,108,126,88',
    '10pm,24,20,26,30,52,66,38',
  ].join('\n');

  const shifts: ShiftTemplate[] = [
    { id: 'fs-open-4h', startHour: 7, endHour: 11 },    // 4h
    { id: 'fs-morn-8h', startHour: 7, endHour: 15 },    // 8h
    { id: 'fs-mid-5h', startHour: 10, endHour: 15 },    // 5h
    { id: 'fs-aft-6h', startHour: 13, endHour: 19 },    // 6h
    { id: 'fs-eve-6h', startHour: 15, endHour: 21 },    // 6h
    { id: 'fs-close-6h', startHour: 17, endHour: 23 },  // 6h
  ];

  const caps = [
    44, 40, 40, 40, 38, 36, 36, 32, 32, 30,
    28, 28, 26, 24, 24, 22, 20, 20, 18, 16,
    16, 14, 12, 10, 8,
  ];
  const staff: Staff[] = caps.map((cap, i) => ({
    id: `fs-${String(i + 1).padStart(2, '0')}`,
    name: `NV ${String(i + 1).padStart(2, '0')} (${cap}h)`,
    maxWeeklyHours: cap,
  }));

  const pinnedAssignments: Assignment[] = [
    { id: 'fs-pin-1', day: 0, shiftId: 'fs-morn-8h', staffId: 'fs-01', isPinned: true },
    { id: 'fs-pin-2', day: 4, shiftId: 'fs-eve-6h', staffId: 'fs-01', isPinned: true },
    { id: 'fs-pin-3', day: 5, shiftId: 'fs-morn-8h', staffId: 'fs-02', isPinned: true },
    { id: 'fs-pin-4', day: 5, shiftId: 'fs-close-6h', staffId: 'fs-03', isPinned: true },
    { id: 'fs-pin-5', day: 6, shiftId: 'fs-mid-5h', staffId: 'fs-10', isPinned: true },
  ];

  return {
    label: 'Stress · Flagship 25 NV · 6 Ca gối đầu (4–8h) · 5 Ca ghim',
    csvFileName: 'stress_flagship_25_staff.csv',
    csvText,
    staff,
    shifts,
    pinnedAssignments,
  };
}

/**
 * Phase 2 Case A: Staff Availability & Stage 1 MRV Priority.
 * Mixes weekend-only (2/7d), midweek-off (5/7d), weekday-only (5/7d), full-week (7/7d),
 * and an all-week-unavailable staff (0/7d, excluded by `isStaffEligible`).
 */
export function buildPhase2MrvAvailabilityFixture(): ComplexFixture {
  const csvText = [
    '"Aug 10, 2026 - Aug 16, 2026"',
    ',"Mon, 10 Aug","Tue, 11 Aug","Wed, 12 Aug","Thu, 13 Aug","Fri, 14 Aug","Sat, 15 Aug","Sun, 16 Aug"',
    '7am,16,16,18,18,22,34,30',
    '8am,28,28,30,30,36,52,48',
    '9am,36,36,38,38,44,64,58',
    '10am,40,40,42,42,48,72,64',
    '11am,54,54,56,56,64,86,78',
    '12pm,64,62,66,66,76,96,88',
    '1pm,58,56,60,60,70,88,80',
    '2pm,32,30,34,34,42,60,54',
    '3pm,24,24,26,26,34,52,46',
    '4pm,26,26,28,28,38,56,48',
    '5pm,44,44,46,46,58,76,68',
    '6pm,56,54,58,58,72,88,78',
    '7pm,60,58,62,62,76,92,82',
    '8pm,46,44,48,48,60,76,66',
    '9pm,24,22,26,26,38,52,42',
    '10pm,10,10,12,12,20,30,22',
  ].join('\n');

  const shifts: ShiftTemplate[] = [
    { id: 'mrv-morn', startHour: 7, endHour: 13 },  // 6h
    { id: 'mrv-aft', startHour: 13, endHour: 19 },  // 6h
    { id: 'mrv-eve', startHour: 17, endHour: 23 },  // 6h
  ];

  const staff: Staff[] = [
    { id: 'mrv-01', name: 'An (Chỉ T7–CN)', maxWeeklyHours: 12, unavailableDays: [0, 1, 2, 3, 4] },
    { id: 'mrv-02', name: 'Bình (Chỉ T6–CN)', maxWeeklyHours: 18, unavailableDays: [0, 1, 2, 3] },
    { id: 'mrv-03', name: 'Châu (Nghỉ T3, T5)', maxWeeklyHours: 30, unavailableDays: [1, 3] },
    { id: 'mrv-04', name: 'Dũng (Nghỉ T7, CN)', maxWeeklyHours: 30, unavailableDays: [5, 6] },
    { id: 'mrv-05', name: 'Em (Nghỉ T2, T4)', maxWeeklyHours: 24, unavailableDays: [0, 2] },
    { id: 'mrv-06', name: 'Giang (Full 7 ngày)', maxWeeklyHours: 36 },
    { id: 'mrv-07', name: 'Hà (Full 7 ngày)', maxWeeklyHours: 36 },
    { id: 'mrv-08', name: 'Khánh (Nghỉ cả tuần)', maxWeeklyHours: 24, unavailableDays: [0, 1, 2, 3, 4, 5, 6] },
  ];

  return {
    label: 'Phase 2 · MRV & Ngày nghỉ nhân viên (Availability)',
    csvFileName: 'phase2_mrv_availability.csv',
    csvText,
    staff,
    shifts,
    pinnedAssignments: [],
  };
}

/**
 * Phase 2 Case B: Shift Active Days (`daysOfWeek`).
 * Weekday shifts run Mon–Fri only; Weekend Booster runs Sat–Sun only; Late shift runs Thu–Sun only
 * (leaving Mon–Wed 19:00–23:00 structurally uncoverable per-cell).
 */
export function buildPhase2ShiftActiveDaysFixture(): ComplexFixture {
  const csvText = [
    '"Aug 10, 2026 - Aug 16, 2026"',
    ',"Mon, 10 Aug","Tue, 11 Aug","Wed, 12 Aug","Thu, 13 Aug","Fri, 14 Aug","Sat, 15 Aug","Sun, 16 Aug"',
    '7am,18,18,18,20,24,36,32',
    '8am,32,32,34,36,42,58,52',
    '9am,40,40,42,44,50,70,64',
    '10am,44,44,46,48,54,78,70',
    '11am,58,58,60,62,70,92,84',
    '12pm,68,66,70,72,82,104,94',
    '1pm,60,58,62,64,74,94,86',
    '2pm,34,32,36,38,46,66,60',
    '3pm,26,24,28,30,38,58,52',
    '4pm,28,26,30,34,44,64,56',
    '5pm,46,44,48,52,64,84,74',
    '6pm,56,54,58,64,78,96,86',
    '7pm,42,40,44,68,82,102,90',
    '8pm,34,32,36,56,70,88,76',
    '9pm,18,16,20,38,50,62,48',
    '10pm,10,10,12,22,30,38,26',
  ].join('\n');

  const shifts: ShiftTemplate[] = [
    { id: 'sd-wkday-morn', startHour: 7, endHour: 13, daysOfWeek: [0, 1, 2, 3, 4] },    // T2–T6
    { id: 'sd-wkday-aft', startHour: 13, endHour: 19, daysOfWeek: [0, 1, 2, 3, 4] },    // T2–T6
    { id: 'sd-wknd-full', startHour: 7, endHour: 15, daysOfWeek: [5, 6] },              // Chỉ T7–CN
    { id: 'sd-wknd-aft', startHour: 13, endHour: 19, daysOfWeek: [5, 6] },              // Chỉ T7–CN
    { id: 'sd-late-thu-sun', startHour: 17, endHour: 23, daysOfWeek: [3, 4, 5, 6] },    // Chỉ T5–CN
  ];

  const staff: Staff[] = [
    { id: 'sd-01', name: 'An', maxWeeklyHours: 36 },
    { id: 'sd-02', name: 'Bình', maxWeeklyHours: 36 },
    { id: 'sd-03', name: 'Châu', maxWeeklyHours: 30 },
    { id: 'sd-04', name: 'Dũng', maxWeeklyHours: 30 },
    { id: 'sd-05', name: 'Em', maxWeeklyHours: 24 },
    { id: 'sd-06', name: 'Giang', maxWeeklyHours: 24, unavailableDays: [0, 1] },
    { id: 'sd-07', name: 'Hà', maxWeeklyHours: 24, unavailableDays: [2, 3] },
    { id: 'sd-08', name: 'Khánh', maxWeeklyHours: 16, unavailableDays: [0, 1, 2, 3, 4] },
  ];

  return {
    label: 'Phase 2 · Ca hoạt động theo thứ (Shift Active Days)',
    csvFileName: 'phase2_shift_active_days.csv',
    csvText,
    staff,
    shifts,
    pinnedAssignments: [],
  };
}
