/**
 * @file Schedule derived-state selector, Aggregated Summary (Section 2.6), and Health Bar signals.
 * Provides `deriveScheduleViewModel`, `computeWeeklySummary`, and unrounded Health Bar
 * status classifiers (`Staffing Gaps`, `Hour Limit Warnings`, `Demand Coverage`, `Fairness`).
 */

import {
  DAYS_OF_WEEK,
  HEALTH_THRESHOLDS,
  MAX_SAFE_BIGINT,
  OPERATING_HOURS,
} from './constants';
import { computeRequiredStaff, isValidTargetN, safeBigIntToNumber } from './decimalMath';
import { buildCellCoverableGrid, computeStaffHoursGrid, isStaffEligible } from './hardRules';
import { computeAllStaffMetrics, computeFairnessJainIndex } from './staffMetrics';
import type {
  AggregatedSummary,
  DayOfWeek,
  DemandCoverageMetric,
  HealthStatus,
  MissingInputCode,
  OperatingHour,
  Schedule,
  ScheduleDerivationResult,
  ScheduleHealth,
  ScheduleListItemSummary,
  ShiftTemplate,
  SummaryCell,
} from './types';

/** Classifies Staffing Gaps count into Health Bar status. */
export function classifyStaffingGapStatus(gapCount: number | null): HealthStatus {
  if (gapCount === null) return 'neutral';
  return gapCount === 0 ? 'good' : 'warning';
}

/** Classifies Hour Limit Warnings count into Health Bar status. */
export function classifyHourLimitStatus(warningCount: number): HealthStatus {
  return warningCount === 0 ? 'good' : 'warning';
}

/** Evaluates Demand Coverage status on the full unrounded float ratio. */
export function classifyDemandCoverageStatus(ratio: number | null): HealthStatus {
  if (ratio === null) return 'neutral';
  if (ratio >= HEALTH_THRESHOLDS.coverageGood) return 'good';
  if (ratio >= HEALTH_THRESHOLDS.coverageAttention) return 'attention';
  return 'warning';
}

/** Evaluates Fairness (Jain Index) status on the full unrounded float value. */
export function classifyFairnessStatus(jainIndex: number | null): HealthStatus {
  if (jainIndex === null) return 'neutral';
  if (jainIndex >= HEALTH_THRESHOLDS.fairnessGood) return 'good';
  if (jainIndex >= HEALTH_THRESHOLDS.fairnessAttention) return 'attention';
  return 'warning';
}

/**
 * Computes the 7x16 Aggregated Summary (Section 2.6) and Demand Coverage metrics
 * with BigInt overflow guards on all aggregate sums.
 *
 * @param schedule - Readonly schedule snapshot.
 * @param shiftMap - Lookup map of `shiftId -> ShiftTemplate`.
 * @returns Summary grid, weekly totals, staffing gap count, and demand coverage metric.
 */
export function computeWeeklySummary(
  schedule: Readonly<Schedule>,
  shiftMap: ReadonlyMap<string, Readonly<ShiftTemplate>>,
):
  | {
      ok: true;
      summary: AggregatedSummary;
      staffingGapCount: number | null;
      demandCoverage: DemandCoverageMetric | null;
    }
  | { ok: false; error: 'INVALID_INPUT' | 'SAFE_INTEGER_OVERFLOW'; message: string } {
  const staffHoursGrid = computeStaffHoursGrid(schedule.assignments, shiftMap);
  const cellCoverable = buildCellCoverableGrid(schedule.shifts);

  const cells = {} as Record<DayOfWeek, Record<OperatingHour, SummaryCell>>;
  let totalTransactionsBigInt = 0n;
  let totalStaffHoursBigInt = 0n;
  let totalRequiredBigInt = 0n;
  let coveredRequiredBigInt = 0n;
  let shortageBigInt = 0n;
  let uncoverableBigInt = 0n;
  let overstaffedBigInt = 0n;
  let staffedCellCount = 0;
  let sumPerCellTxnsPerStaffHour = 0;
  let staffingGapCount = 0;

  const hasDemand = schedule.demand !== null;

  for (const d of DAYS_OF_WEEK) {
    const dayRow = {} as Record<OperatingHour, SummaryCell>;
    for (const h of OPERATING_HOURS) {
      const idx = d * 16 + (h - 7);
      const staffHours = staffHoursGrid[idx] ?? 0;
      totalStaffHoursBigInt += BigInt(staffHours);

      let transactions: number | null = null;
      let txnsPerStaffHour: number | null = null;
      let isStaffingGap = false;
      let requiredStaff: number | null = null;
      let coverageDelta: number | null = null;

      if (hasDemand && schedule.demand) {
        const txns = schedule.demand.transactions[d][h];
        if (!Number.isSafeInteger(txns) || txns < 0) {
          return { ok: false, error: 'INVALID_INPUT', message: `Invalid transaction count at day ${d}, hour ${h}.` };
        }
        transactions = txns;
        totalTransactionsBigInt += BigInt(txns);
        if (totalTransactionsBigInt > MAX_SAFE_BIGINT) {
          return { ok: false, error: 'SAFE_INTEGER_OVERFLOW', message: 'SAFE_INTEGER_OVERFLOW: totalTransactions exceeded Number.MAX_SAFE_INTEGER.' };
        }

        const reqRes = computeRequiredStaff(txns, schedule.targetTxnsPerStaffHour);
        if (!reqRes.ok) {
          return {
            ok: false,
            error: reqRes.error,
            message:
              reqRes.error === 'SAFE_INTEGER_OVERFLOW'
                ? 'SAFE_INTEGER_OVERFLOW: RequiredStaff exceeded Number.MAX_SAFE_INTEGER.'
                : 'Invalid targetTxnsPerStaffHour or transactions.',
          };
        }

        requiredStaff = reqRes.value;
        coverageDelta = staffHours - requiredStaff;

        const reqBig = BigInt(requiredStaff);
        const shBig = BigInt(staffHours);
        totalRequiredBigInt += reqBig;
        coveredRequiredBigInt += shBig < reqBig ? shBig : reqBig;
        shortageBigInt += reqBig > shBig ? reqBig - shBig : 0n;
        overstaffedBigInt += shBig > reqBig ? shBig - reqBig : 0n;
        if (cellCoverable[idx] === 0 && reqBig > shBig) uncoverableBigInt += reqBig - shBig;

        if (
          totalRequiredBigInt > MAX_SAFE_BIGINT ||
          shortageBigInt > MAX_SAFE_BIGINT ||
          overstaffedBigInt > MAX_SAFE_BIGINT
        ) {
          return {
            ok: false,
            error: 'SAFE_INTEGER_OVERFLOW',
            message: 'SAFE_INTEGER_OVERFLOW: Demand coverage aggregate exceeded Number.MAX_SAFE_INTEGER.',
          };
        }

        if (staffHours > 0) {
          txnsPerStaffHour = txns / staffHours;
          staffedCellCount += 1;
          sumPerCellTxnsPerStaffHour += txnsPerStaffHour;
        } else if (txns > 0) {
          isStaffingGap = true;
          staffingGapCount += 1;
        }
      }

      dayRow[h] = { day: d, hour: h, transactions, staffHours, txnsPerStaffHour, isStaffingGap, requiredStaff, coverageDelta };
    }
    cells[d] = dayRow;
  }

  const totalStaffHoursSafe = safeBigIntToNumber(totalStaffHoursBigInt);
  if (!totalStaffHoursSafe.ok) {
    return { ok: false, error: 'SAFE_INTEGER_OVERFLOW', message: 'SAFE_INTEGER_OVERFLOW: totalStaffHours exceeded Number.MAX_SAFE_INTEGER.' };
  }

  const totalStaffHours = totalStaffHoursSafe.value;
  const totalTransactions = hasDemand ? Number(totalTransactionsBigInt) : null;
  const overallTxnsPerStaffHour =
    totalTransactions !== null && totalStaffHours > 0 ? totalTransactions / totalStaffHours : null;
  const averageTxnsPerStaffHour =
    hasDemand && staffedCellCount > 0 ? sumPerCellTxnsPerStaffHour / staffedCellCount : null;

  let demandCoverage: DemandCoverageMetric | null = null;
  if (hasDemand) {
    const totalRequiredStaffHours = Number(totalRequiredBigInt);
    const coveredRequiredStaffHours = Number(coveredRequiredBigInt);
    const shortageHours = Number(shortageBigInt);
    const uncoverableRequiredStaffHours = Number(uncoverableBigInt);
    demandCoverage = {
      ratio: totalRequiredStaffHours === 0 ? null : coveredRequiredStaffHours / totalRequiredStaffHours,
      coveredRequiredStaffHours,
      totalRequiredStaffHours,
      shortageHours,
      uncoverableRequiredStaffHours,
      residualCoverableShortageHours: shortageHours - uncoverableRequiredStaffHours,
      overstaffedHours: Number(overstaffedBigInt),
    };
  }

  return {
    ok: true,
    summary: { cells, totalTransactions, totalStaffHours, overallTxnsPerStaffHour, averageTxnsPerStaffHour },
    staffingGapCount: hasDemand ? staffingGapCount : null,
    demandCoverage,
  };
}

/**
 * Returns the list of missing or invalid prerequisites blocking Auto-schedule (E-02).
 * Enables TopActionBar to render disabled state and contextual helper text before click.
 */
export function getMissingAutoScheduleInputs(schedule: Readonly<Schedule>): MissingInputCode[] {
  const missing: MissingInputCode[] = [];
  if (schedule.demand === null) missing.push('DEMAND');
  if (schedule.shifts.length === 0) missing.push('SHIFTS');
  if (!schedule.staff.some(isStaffEligible)) missing.push('ELIGIBLE_STAFF');
  if (!isValidTargetN(schedule.targetTxnsPerStaffHour)) missing.push('INVALID_N');
  return missing;
}

/**
 * Derives lightweight card metadata for `ScheduleListScreen` using union-of-hours `totalStaffHours`.
 *
 * @param schedules - List of persisted schedules.
 * @returns UI-ready summary cards with `staffCount`, `totalStaffHours`, and `hasDemand`.
 */
export function deriveScheduleListSummaries(
  schedules: readonly Readonly<Schedule>[],
): ScheduleListItemSummary[] {
  return schedules.map((schedule) => {
    const shiftMap = new Map(schedule.shifts.map((sh) => [sh.id, sh]));
    const grid = computeStaffHoursGrid(schedule.assignments, shiftMap);
    let totalStaffHours = 0;
    for (let i = 0; i < grid.length; i++) {
      totalStaffHours += grid[i] ?? 0;
    }
    return {
      id: schedule.id,
      name: schedule.name,
      staffCount: schedule.staff.length,
      totalStaffHours,
      hasDemand: schedule.demand !== null,
      updatedAt: schedule.updatedAt,
    };
  });
}

/**
 * Pure derived-state selector for a Schedule (`Domain Model §6`, `Optimization Spec §5`).
 * Computes `staffMetrics`, `assignmentWarnings`, `summary`, `health`, and `autoScheduleMissingInputs`.
 *
 * @param schedule - Readonly schedule snapshot.
 * @returns Complete `ScheduleViewModel` or a controlled overflow/validation error.
 */
export function deriveScheduleViewModel(schedule: Readonly<Schedule>): ScheduleDerivationResult {
  const shiftMap = new Map(schedule.shifts.map((sh) => [sh.id, sh]));

  const staffRes = computeAllStaffMetrics(schedule.staff, schedule.assignments, shiftMap);
  if (!staffRes.ok) return staffRes;

  const summaryRes = computeWeeklySummary(schedule, shiftMap);
  if (!summaryRes.ok) return summaryRes;

  const {
    staffMetrics,
    assignmentWarnings,
    hourLimitWarningCount,
    totalTeamCapacityHours,
    unusedCapacityHours,
  } = staffRes.data;
  const { summary, staffingGapCount, demandCoverage } = summaryRes;
  const fairness = computeFairnessJainIndex(schedule.staff, staffMetrics);

  const health: ScheduleHealth = {
    staffingGapCount,
    staffingGapStatus: classifyStaffingGapStatus(staffingGapCount),
    hourLimitWarningCount,
    hourLimitWarningStatus: classifyHourLimitStatus(hourLimitWarningCount),
    demandCoverage,
    demandCoverageStatus: classifyDemandCoverageStatus(demandCoverage ? demandCoverage.ratio : null),
    fairnessJainIndex: fairness.jainIndex,
    fairnessStatus: classifyFairnessStatus(fairness.jainIndex),
    eligibleStaffCount: fairness.eligibleStaffCount,
    isSingleEligibleStaff: fairness.isSingleEligibleStaff,
    totalTeamCapacityHours,
    unusedCapacityHours,
  };

  return {
    ok: true,
    viewModel: {
      staffMetrics,
      assignmentWarnings,
      summary,
      health,
      autoScheduleMissingInputs: getMissingAutoScheduleInputs(schedule),
    },
  };
}
