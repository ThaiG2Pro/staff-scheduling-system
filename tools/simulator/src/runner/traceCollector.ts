import {
  TRACE_SCHEMA_VERSION,
  type SchedulerTraceObserver,
  type TraceEvent,
  type TraceRun,
  type TraceStageRange,
} from '../../../../src/domain/schedulerTrace';
import { SIMULATOR_ALGORITHM_REF } from '../algorithmRef';

export class TraceCollector implements SchedulerTraceObserver {
  private readonly events: TraceEvent[] = [];

  emit(event: Omit<TraceEvent, 'seq'>): void {
    this.events.push({
      ...event,
      seq: this.events.length,
    });
  }

  build(scenarioName: string, outcome: TraceRun['outcome']): TraceRun {
    const stages: TraceStageRange[] = [];
    for (const ev of this.events) {
      const last = stages[stages.length - 1];
      if (last && last.id === ev.stageId) {
        stages[stages.length - 1] = {
          id: last.id,
          label: last.label,
          startSeq: last.startSeq,
          endSeq: ev.seq,
        };
      } else {
        stages.push({
          id: ev.stageId,
          label: ev.stageLabel,
          startSeq: ev.seq,
          endSeq: ev.seq,
        });
      }
    }

    return {
      schemaVersion: TRACE_SCHEMA_VERSION,
      scenarioName,
      createdAtIso: new Date().toISOString(),
      outcome,
      algorithmRef: SIMULATOR_ALGORITHM_REF,
      stages,
      events: this.events,
    };
  }
}

export function parseTraceRunJson(raw: string): { ok: true; run: TraceRun } | { ok: false; error: string } {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return { ok: false, error: 'File JSON không phải là một đối tượng TraceRun hợp lệ.' };
    }
    const obj = parsed as Record<string, unknown>;
    if (obj.schemaVersion !== TRACE_SCHEMA_VERSION) {
      return {
        ok: false,
        error: `Phiên bản trace không tương thích (nhận ${String(obj.schemaVersion)}, cần ${TRACE_SCHEMA_VERSION}).`,
      };
    }
    if (!Array.isArray(obj.events) || obj.events.length === 0) {
      return { ok: false, error: 'File trace không có sự kiện (events) nào để phát lại.' };
    }
    if (!Array.isArray(obj.stages) || typeof obj.scenarioName !== 'string') {
      return { ok: false, error: 'Thiếu trường bắt buộc (stages hoặc scenarioName).' };
    }
    return { ok: true, run: parsed as TraceRun };
  } catch (err) {
    return {
      ok: false,
      error: `Không thể đọc JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
