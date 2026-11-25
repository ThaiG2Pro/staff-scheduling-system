import { AlertTriangle, CheckCircle2, GitCommitHorizontal, ShieldAlert, Sparkles, XCircle } from 'lucide-react';
import type { TraceEvent } from '../../../../src/domain/schedulerTrace';

interface NarrativeCardProps {
  readonly event: TraceEvent;
  readonly lens: 'manager' | 'debug';
}

const STATUS_STYLES: Record<
  TraceEvent['status'],
  { border: string; bg: string; badge: string; label: string; Icon: typeof CheckCircle2 }
> = {
  ok: {
    border: 'border-slate-200',
    bg: 'bg-white',
    badge: 'bg-emerald-100 text-emerald-800',
    label: 'Hợp lệ',
    Icon: CheckCircle2,
  },
  warning: {
    border: 'border-amber-200',
    bg: 'bg-amber-50/30',
    badge: 'bg-amber-100 text-amber-800',
    label: 'Lưu ý',
    Icon: AlertTriangle,
  },
  blocked: {
    border: 'border-orange-200',
    bg: 'bg-orange-50/40',
    badge: 'bg-orange-100 text-orange-900',
    label: 'Đã chặn an toàn',
    Icon: ShieldAlert,
  },
  error: {
    border: 'border-rose-200',
    bg: 'bg-rose-50/40',
    badge: 'bg-rose-100 text-rose-900',
    label: 'Lỗi dừng',
    Icon: XCircle,
  },
};

function getBusinessTakeaway(event: TraceEvent): string {
  switch (event.kind) {
    case 'storage_io':
      return event.status === 'ok'
        ? 'An toàn dữ liệu: Lịch làm việc được đọc/lưu nguyên vẹn.'
        : 'Cơ chế bảo vệ: Dữ liệu cũ của cửa hàng được giữ nguyên 100%, không bị ghi đè.';
    case 'input_gate':
      return event.status === 'ok'
        ? 'Kiểm duyệt đầu vào: Đảm bảo đủ nhân viên, mẫu ca và không trùng ca đã ghim.'
        : 'Phát hiện xung đột sớm trước khi xếp lịch để quản lý xử lý.';
    case 'transform':
      return 'Tính toán chính xác số người cần cho từng khung giờ cao điểm & thấp điểm.';
    case 'state_init':
      return 'Giữ nguyên mọi ca quản lý đã ghim cố định trước khi máy tự xếp phần còn lại.';
    case 'loop_step':
      if (event.stageId === 'stage_1a_gaps') {
        return 'Ưu tiên 1: Không để bất kỳ khung giờ nào có khách mà trống nhân viên.';
      }
      if (event.stageId === 'stage_1b_deficit') {
        return 'Ưu tiên 2: Bổ sung người vào các khung giờ đông khách nhất để tối ưu độ phủ.';
      }
      return 'Ưu tiên 3: Chia đều giờ làm giữa các nhân viên mà không làm giảm độ phủ cửa hàng.';
    case 'validation':
      return 'Kiểm tra chéo 5 quy tắc an toàn trước khi chốt lịch chính thức.';
    case 'output':
      return 'Lịch tuần đã sẵn sàng công bố cho cửa hàng!';
  }
}

export function NarrativeCard({ event, lens }: NarrativeCardProps) {
  const style = STATUS_STYLES[event.status];
  const StatusIcon = style.Icon;

  return (
    <div className={`rounded-xl border p-4 shadow-xs ${style.border} ${style.bg}`}>
      {/* Header row — same coordinates in both lenses */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-md bg-indigo-600 px-2 py-0.5 text-[11px] font-semibold text-white">
            {event.stageLabel}
          </span>
          {lens === 'debug' && (
            <>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">
                seq={event.seq}
              </span>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">
                {event.kind}
              </span>
            </>
          )}
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${style.badge}`}
        >
          <StatusIcon className="h-3 w-3" />
          {style.label}
        </span>
      </div>

      <h2 className="mt-2.5 text-sm font-bold leading-snug text-slate-900">{event.title}</h2>
      <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{event.narrative}</p>

      {/* Contextual footer: Business Takeaway (Manager) OR State Diff (Debug) in the exact same slot */}
      {lens === 'manager' ? (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-indigo-50/70 px-3 py-2 text-xs font-medium text-indigo-900">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-600" />
          <span>{getBusinessTakeaway(event)}</span>
        </div>
      ) : (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-slate-700">
            <GitCommitHorizontal className="h-3.5 w-3.5 text-indigo-600" />
            State Diff (Biến đổi bộ nhớ bước này)
          </div>
          {event.stateDiff && event.stateDiff.length > 0 ? (
            <ul className="space-y-0.5 font-mono text-[11px] text-slate-700">
              {event.stateDiff.map((line, i) => (
                <li key={i} className="leading-snug">
                  • {line}
                </li>
              ))}
            </ul>
          ) : (
            <p className="font-mono text-[11px] text-slate-400">
              (Không có thay đổi bộ đệm solver ở bước này)
            </p>
          )}
        </div>
      )}
    </div>
  );
}
