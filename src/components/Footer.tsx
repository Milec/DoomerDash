import type { DashboardPayload } from '../../shared/types.ts';
import { formatTimestamp } from '../lib/format.ts';

export default function Footer({ data }: { data: DashboardPayload }) {
  return (
    <footer className="mt-10 border-t border-line pt-4 text-[11px] leading-relaxed text-ink-muted">
      <div className="flex flex-wrap gap-x-10 gap-y-3">
        <div>
          <div className="mb-1 font-medium text-ink-2">Last successful data pull</div>
          <ul className="space-y-0.5">
            {data.sources.length === 0 && <li>nothing has been pulled yet</li>}
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
          <div className="mb-1 font-medium text-ink-2">Scores recalculated</div>
          <div className="tnum">{formatTimestamp(data.analytics_refreshed_at)}</div>
        </div>
      </div>

      <div className="mt-4 max-w-3xl space-y-2">
        <p>
          <strong className="text-ink-2">The method, in one paragraph.</strong> Each measure is
          scored against its own trailing {data.zscore_window_years}-year record. The top and bottom
          1% of that record are trimmed before working out what &ldquo;normal&rdquo; looks like, so
          one freak reading cannot permanently distort the scale - though a genuine new record still
          shows at full size. Measures that are bad when they fall are flipped, so positive always
          means worse. Nothing is scored until there are at least {data.zscore_min_obs} readings to
          compare against.
        </p>
        <p>
          <strong className="text-ink-2">Combined scores</strong> are a plain average of the measures
          in a group that have reported within {data.composite_window_days} days - no weighting,
          because weighting invites tuning a dashboard until it agrees with you. If fewer than half
          a group&rsquo;s measures are current, no combined score is shown at all.
        </p>
        <p>
          <strong className="text-ink-2">Nothing is invented.</strong> No gap is filled in, no value
          estimated, no figure carried forward to look current. Every row links to the organisation
          that published it so any number here can be checked at source in one click.
        </p>
      </div>
    </footer>
  );
}
