import type { IndicatorView } from '../../shared/types.ts';
import { formatAge, formatDate, formatValue, formatZ } from '../lib/format.ts';
import { plainReading, zColor } from '../lib/scale.ts';

/**
 * Counter-indicators. Always visible, never collapsible, never folded into a
 * combined score. The sign convention is the same as everywhere else - positive
 * means worse - so a rising median income shows as a negative score.
 */
export default function CounterStrip({ items }: { items: IndicatorView[] }) {
  if (items.length === 0) return null;
  return (
    <section className="mt-8 rounded-lg border border-white/10 bg-surface/60 px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-[12px] font-semibold tracking-tight text-ink-2">Things that are going right</h2>
        <p className="text-[11px] text-ink-muted">Kept out of every combined score, so they cannot flatter it</p>
      </div>
      <p className="mt-1.5 max-w-3xl text-[11px] leading-relaxed text-ink-muted">
        A board that only tracks what is deteriorating will always look like a crisis. These are
        here as a deliberate counterweight - measured the same way, on the same scale, and shown
        whether they help the story or not.
      </p>
      <ul className="mt-3 grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((ind) => (
          <li key={ind.slug} className={`border-t border-line pt-2 ${ind.is_stale ? 'stale' : ''}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[12px] font-medium text-ink-2">{ind.name}</div>
                <div className="tnum mt-0.5 text-[11px] text-ink-muted">
                  {formatValue(ind.value, ind.unit)}
                </div>
              </div>
              <div className="shrink-0 text-right">
                {ind.z === null ? (
                  <div className="text-[10px] leading-tight text-ink-muted">
                    too short
                    <br />
                    <span className="tnum">n={ind.window_n ?? 0}</span>
                  </div>
                ) : (
                  <div className="tnum text-[14px] font-semibold leading-none" style={{ color: zColor(ind.z) }}>
                    {formatZ(ind.z)}
                  </div>
                )}
              </div>
            </div>
            <div className="mt-1 text-[11px] leading-snug" style={{ color: zColor(ind.z) }}>
              {ind.pct_worse !== null && plainReading(ind.pct_worse, ind.seasonal)}
            </div>
            <div className="mt-1 text-[10px] text-ink-muted">
              <span className="tnum">{formatDate(ind.obs_date)}</span> · {formatAge(ind.age_days)}
              {ind.source_url && (
                <>
                  {' · '}
                  <a
                    href={ind.source_url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="underline decoration-dotted underline-offset-2 hover:text-ink-2"
                  >
                    source
                  </a>
                </>
              )}
            </div>
            {ind.explainer && (
              <p className="mt-1.5 text-[11px] leading-relaxed text-ink-muted">{ind.explainer}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
