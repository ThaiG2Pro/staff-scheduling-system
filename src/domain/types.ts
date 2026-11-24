/**
 * @file Pure domain types, solver contracts, CSV parser results, and UI-friendly derived DTOs.
 * Defines the Domain Source of Truth (`Schedule`, `Staff`, `ShiftTemplate`, `Assignment`,
 * `DemandDataset`) without any persistence or UI framework metadata.
 */

export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type OperatingHour =
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15
  | 16
  | 17
  | 18
  | 19
  | 20
  | 21
  | 22;

// --- Domain Source of Truth ---

export interface Staff {
  id: string;
  name: string;
  maxWeeklyHours: number;
}

export interface ShiftTemplate {
  id: string;
  startHour: number;
  endHour: number;
}

export interface Assignment {
  id: string;
  day: DayOfWeek;
  shiftId: string;
  staffId: string;
  isPinned: boolean;
}

export type TransactionGrid = Record<DayOfWeek, Record<OperatingHour, number>>;

export interface DemandDataset {
  importedAt: string;
  sourceFileName?: string;
  transactions: TransactionGrid;
}

export interface Schedule {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  targetTxnsPerStaffHour: number;
  staff: Staff[];
  shifts: ShiftTemplate[];
  demand: DemandDataset | null;
  assignments: Assignment[];
}

// --- Deep Readonly Solver Contract ---

export interface DeepReadonlyDemand {
  readonly importedAt: string;
  readonly sourceFileName?: string;
  readonly transactions: Readonly<Record<DayOfWeek, Readonly<Record<OperatingHour, number>>>>;
}

export interface AutoScheduleInput {
  readonly demand: DeepReadonlyDemand | null;
  readonly staff: readonly Readonly<Staff>[];
  readonly shifts: readonly Readonly<ShiftTemplate>[];
  readonly existingAssignments: readonly Readonly<Assignment>[];
  readonly targetTxnsPerStaffHour: number;
  readonly idGenerator: () => string;
}

export type MissingInputCode = 'DEMAND' | 'SHIFTS' | 'ELIGIBLE_STAFF' | 'INVALID_N';

export type PinConflictType =
  | 'OVER_MAX_HOURS'
  | 'MULTIPLE_SHIFTS_SAME_DAY'
  | 'OVERLAPPING_SHIFTS';

export interface PinConflict {
  staffId: string;
  staffName: string;
  type: PinConflictType;
  assignmentIds: string[];
  details: string;
}

export type RebalanceStopReason = 'CONVERGED' | 'MAX_ITERATIONS_REACHED' | 'SKIPPED';

export interface AutoScheduleDiagnostics {
  preservedPinnedCount: number;
  generatedAssignmentsCount: number;
  totalRequiredStaffHours: number;
  coveredRequiredStaffHours: number;
  demandCoverage: number | null;
  shortageHours: number;
  uncoverableRequiredStaffHours: number;
  residualCoverableShortageHours: number;
  overstaffedHours: number;
  unusedCapacityHours: number;
  unscheduledEligibleStaffCount: number;
  fairnessJainIndex: number | null;
  rebalanceIterationsRun: number;
  rebalanceStopReason: RebalanceStopReason;
  summaryMessages: string[];
}

export type AutoScheduleResult =
  | {
      status: 'SUCCESS';
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
      missingInputs?: MissingInputCode[];
      message: string;
    };

// --- CSV Parser Contract ---

export interface CsvParseError {
  row?: number;
  column?: number;
  dayLabel?: string;
  hourLabel?: string;
  message: string;
}

export type CsvParseResult =
  | {
      ok: true;
      transactions: TransactionGrid;
      totalTransactions: number;
    }
  | {
      ok: false;
      errors: CsvParseError[];
    };

// --- Derived State & UI-Friendly DTOs ---

export type HealthStatus = 'neutral' | 'good' | 'attention' | 'warning';

export interface StaffMetrics {
  staffId: string;
  assignedHours: number;
  remainingHours: number;
  overtimeHours: number;
  isOverMaxHours: boolean;
  utilization: number | null;
  multiShiftDays: DayOfWeek[];
  overlappingAssignmentIds: string[];
}

export interface AssignmentWarningFlags {
  assignmentId: string;
  isOverMaxHours: boolean;
  isMultiShiftDay: boolean;
  isOverlapping: boolean;
}

export type AssignmentGuidanceReasonCode =
  | 'WOULD_EXCEED_MAX_HOURS'
  | 'ALREADY_HAS_SHIFT_ON_DAY'
  | 'WOULD_OVERLAP_SHIFT';

export interface AssignmentGuidanceReason {
  code: AssignmentGuidanceReasonCode;
  message: string;
  excessHours?: number;
  overlappingShiftLabel?: string;
}

export interface AssignmentGuidanceOption {
  staff: Readonly<Staff>;
  currentAssignedHours: number;
  hypotheticalAssignedHours: number;
  remainingHoursAfter: number;
  status: 'ELIGIBLE' | 'REQUIRES_ATTENTION';
  reasons: AssignmentGuidanceReason[];
}

export interface AssignmentGuidanceResult {
  eligible: AssignmentGuidanceOption[];
  requiresAttention: AssignmentGuidanceOption[];
}

export interface DeletePreview {
  affectedAssignmentsCount: number;
  affectedAssignmentIds: string[];
}

export interface SummaryCell {
  day: DayOfWeek;
  hour: OperatingHour;
  transactions: number | null;
  staffHours: number;
  txnsPerStaffHour: number | null;
  isStaffingGap: boolean;
  requiredStaff: number | null;
  coverageDelta: number | null;
}

export interface AggregatedSummary {
  cells: Record<DayOfWeek, Record<OperatingHour, SummaryCell>>;
  totalTransactions: number | null;
  totalStaffHours: number;
  overallTxnsPerStaffHour: number | null;
  averageTxnsPerStaffHour: number | null;
}

export interface DemandCoverageMetric {
  ratio: number | null;
  coveredRequiredStaffHours: number;
  totalRequiredStaffHours: number;
  shortageHours: number;
  uncoverableRequiredStaffHours: number;
  residualCoverableShortageHours: number;
  overstaffedHours: number;
}

export interface ScheduleHealth {
  staffingGapCount: number | null;
  staffingGapStatus: HealthStatus;
  hourLimitWarningCount: number;
  hourLimitWarningStatus: HealthStatus;
  demandCoverage: DemandCoverageMetric | null;
  demandCoverageStatus: HealthStatus;
  fairnessJainIndex: number | null;
  fairnessStatus: HealthStatus;
  eligibleStaffCount: number;
  isSingleEligibleStaff: boolean;
  unusedCapacityHours: number;
}

export interface ScheduleViewModel {
  staffMetrics: Record<string, StaffMetrics>;
  assignmentWarnings: Record<string, AssignmentWarningFlags>;
  summary: AggregatedSummary;
  health: ScheduleHealth;
}

export type ScheduleDerivationResult =
  | { ok: true; viewModel: ScheduleViewModel }
  | { ok: false; error: 'INVALID_INPUT' | 'SAFE_INTEGER_OVERFLOW'; message: string };
