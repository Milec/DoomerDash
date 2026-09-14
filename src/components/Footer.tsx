import type { DashboardPayload } from '../../shared/types.ts';
import { formatTimestamp } from '../lib/format.ts';

export default function Footer({ data }: { data: DashboardPayload }) {
  return (
    <footer className="mt-10 border-t border-line pt-4 text-[11px] leading-relaxed text-ink-muted">
      <div className="flex flex-wrap gap-x-8 gap-y-2">
        <div>
          <div className="mb-1 font-medium text-ink-2">Last successful ingest</div>
          <ul className="space-y-0.5">
            {data.sources.length === 0 && <li>no ingest has run yet</li>}
            {data.sources.map((s) => (
              <li key={s.source} className="tnum">
                {s.source}: {formatTimestamp(s.last_success_at)}
                {s.last_status && s.last_status !== 'success' && (
                  <span className="text-z-warm-2"> · last run {s.last_status}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="mb-1 font-medium text-ink-2">Scores rebuilt</div>
          <div className="tnum">{formatTimestamp(data.analytics_refreshed_at)}</div>
        </div>
      </div>

      <p className="mt-4 max-w-3xl">
        Every indicator is a z-score against its own trailing {data.zscore_window_years}-year
        distribution, winsorized at the 1st/99th percentile before the mean and standard deviation
        are taken, and sign-flipped where needed so <strong className="text-ink-2">positive always
        means worse</strong>. No score is emitted until the window holds at least{' '}
        {data.zscore_min_obs} observations. Composites are the unweighted mean of members observed
        within {data.composite_window_days} days; below half fresh, a bucket reports no composite
        rather than one built from the survivors. Nothing is interpolated or forward-filled: a gap
        in a source is a gap here.
      </p>
    </footer>
  );
}
