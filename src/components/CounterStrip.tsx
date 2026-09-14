import type { IndicatorView } from '../../shared/types.ts';
import { formatAge, formatDate, formatValue, formatZ } from '../lib/format.ts';
import { zColor } from '../lib/scale.ts';

/**
 * Counter-indicators. Always visible, never collapsible, never folded into a
 * composite. The sign convention is the same as everywhere else: positive z is
 * worse, so a rising real income shows a negative score.
 */
export default function CounterStrip({ items }: { items: IndicatorView[] }) {
  if (items.length === 0) return null;
  return (
    <section className="mt-8 rounded-lg border border-white/10 bg-surface/60 px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[12px] font-semibold tracking-tight text-ink-2">Counter-indicators</h2>
        <p className="text-[11px] text-ink-muted">Excluded from every composite</p>
      </div>
      <ul className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((ind) => (
          <li
            key={ind.slug}
            className={`flex items-start justify-between gap-3 border-t border-line pt-2 ${ind.is_stale ? 'stale' : ''}`}
          >
            <div className="min-w-0">
              <div className="truncate text-[12px] text-ink-2">{ind.name}</div>
              <div className="tnum mt-0.5 text-[11px] text-ink-muted">
                {formatValue(ind.value, ind.unit)}
              </div>
              <div className="mt-0.5 text-[10px] text-ink-muted">
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
            </div>
            <div className="text-right">
              <div className="tnum text-[15px] font-semibold leading-none" style={{ color: zColor(ind.z) }}>
                {formatZ(ind.z)}
              </div>
              {ind.z === null && (
                <div className="mt-1 text-[10px] leading-tight text-ink-muted">
                  n={ind.window_n ?? 0}
                  <br />
                  too short
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
