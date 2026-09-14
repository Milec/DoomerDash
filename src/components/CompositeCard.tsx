import type { FailureModeView } from '../../shared/types.ts';
import { formatZ } from '../lib/format.ts';
import { zColor, zLabel } from '../lib/scale.ts';

interface Props {
  mode: FailureModeView;
  expanded: boolean;
  onToggle: () => void;
}

const DEAD_BAND = 0.05;

function Trend({ now, then }: { now: number | null; then: number | null }) {
  if (now === null || then === null) {
    return <span className="text-[11px] text-ink-muted">no 30d comparison</span>;
  }
  const delta = now - then;
  const flat = Math.abs(delta) < DEAD_BAND;
  const worse = delta > 0;
  const color = flat ? '#7d7b73' : worse ? '#c74444' : '#2a78d6';
  return (
    <span className="tnum inline-flex items-center gap-1 text-[11px]" style={{ color }}>
      <span aria-hidden="true">{flat ? '→' : worse ? '↑' : '↓'}</span>
      <span>
        {flat ? 'flat' : `${delta > 0 ? '+' : ''}${delta.toFixed(2)}`} vs 30d
      </span>
    </span>
  );
}

export default function CompositeCard({ mode, expanded, onToggle }: Props) {
  const available = mode.status === 'ok' && mode.composite_z !== null;
  const color = available ? zColor(mode.composite_z) : '#7d7b73';

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className={`w-full rounded-lg border bg-surface px-4 py-3 text-left transition-colors hover:bg-surface-2 ${
        expanded ? 'border-white/25' : 'border-white/10'
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[13px] font-semibold tracking-tight text-ink">{mode.label}</h2>
        <span className="text-[11px] text-ink-muted" aria-hidden="true">{expanded ? '−' : '+'}</span>
      </div>
      <p className="mt-0.5 text-[11px] leading-snug text-ink-muted">{mode.subtitle}</p>

      <div className="mt-3 flex items-end gap-3">
        {available ? (
          <span className="tnum text-[30px] font-semibold leading-none" style={{ color }}>
            {formatZ(mode.composite_z)}
          </span>
        ) : (
          <span className="text-[15px] font-medium leading-none text-ink-muted">unavailable</span>
        )}
      </div>

      <div className="mt-2 space-y-1">
        {available ? (
          <>
            <div className="text-[11px] text-ink-2">{zLabel(mode.composite_z)}</div>
            <Trend now={mode.composite_z} then={mode.composite_z_30d_ago} />
          </>
        ) : (
          <div className="text-[11px] leading-snug text-ink-muted">
            {mode.status === 'no_members'
              ? 'No indicators wired up yet (Phase 2).'
              : `Only ${mode.fresh_member_count} of ${mode.member_count} members are fresh. Fewer than half, so no composite is computed.`}
          </div>
        )}
        <div className="tnum text-[11px] text-ink-muted">
          {mode.fresh_member_count}/{mode.member_count} members fresh
        </div>
      </div>
    </button>
  );
}
