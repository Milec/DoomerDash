import type { DashboardPayload } from '../../shared/types.ts';
import { formatTimestamp } from '../lib/format.ts';

export default function Footer({ data }: { data: DashboardPayload }) {
  return (
    <footer className="mt-10 border-t border-line pt-4 text-[11px] leading-relaxed text-ink-muted">
      <div className="flex flex-wrap gap-x-10 gap-y-3">
        <div>
          <div className="mb-1 font-medium text-ink-2">Latest source updates</div>
          <ul className="space-y-0.5">
            {data.sources.length === 0 && <li>no source updates yet</li>}
            {data.sources.map((s) => (
              <li key={s.source} className="tnum">
                {s.source}: {formatTimestamp(s.last_success_at)}
                {s.last_status && s.last_status !== 'success' && (
                  <span className="text-z-warm-2"> · last attempt {s.last_status}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="mb-1 font-medium text-ink-2">Scores last calculated</div>
          <div className="tnum">{formatTimestamp(data.analytics_refreshed_at)}</div>
        </div>
      </div>

      <div className="mt-4 max-w-3xl space-y-2">
        <p>
          <strong className="text-ink-2">How scores work.</strong> Each measure is compared with its
          previous {data.zscore_window_years} years. The most extreme 1% at either end is excluded
          when setting the baseline, but new extremes still appear in full. Measures where a drop is
          bad are reversed, so a positive score always means more stress. A score needs at least
          {data.zscore_min_obs} observations.
        </p>
        <p>
          <strong className="text-ink-2">Group scores</strong> are simple averages of measures updated
          in the last {data.composite_window_days} days. Each measure gets equal weight. If fewer
          than half are current, the group score is withheld.
        </p>
        <p>
          <strong className="text-ink-2">No made-up data.</strong> Gaps stay visible; values are not
          estimated or carried forward. Every row links to its original publisher.
        </p>
      </div>
    </footer>
  );
}
