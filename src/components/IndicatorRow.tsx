import type { IndicatorView } from '../../shared/types.ts';
import { formatAge, formatDate, formatSpan, formatValue, formatZ } from '../lib/format.ts';
import { plainReading, severityWord, zColor } from '../lib/scale.ts';
import Sparkline from './Sparkline.tsx';

export default function IndicatorRow({ ind }: { ind: IndicatorView }) {
  const color = zColor(ind.z);
  const unscored = ind.z === null && ind.pct_worse === null;

  return (
    <div className={`border-t border-line px-3 py-3 ${ind.is_stale ? 'stale' : ''}`}>
      <div className="grid grid-cols-1 items-start gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_7rem_8.5rem_minmax(0,1fr)]">
        {/* name + provenance */}
        <div className="min-w-0">
          <div className="text-[13px] font-medium leading-tight text-ink">{ind.name}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-muted">
            <span>{ind.cadence}</span>
            {ind.seasonal && <span title="Compared against the same time of year">· same season</span>}
            {ind.source_url && (
              <a
                href={ind.source_url}
                target="_blank"
                rel="noreferrer noopener"
                className="underline decoration-dotted underline-offset-2 hover:text-ink-2"
              >
                {ind.source}:{ind.source_series_id ?? ind.slug}
              </a>
            )}
          </div>
        </div>

        {/* the headline reading, in words */}
        <div className="min-w-0">
          {unscored ? (
            <div className="text-[12px] leading-snug text-ink-muted">
              Not enough history for a score
              <span className="tnum"> (n={ind.window_n ?? 0})</span>
            </div>
          ) : (
            <>
              <div className="text-[13px] font-semibold leading-snug" style={{ color }}>
                {plainReading(ind.pct_worse, ind.seasonal)}
              </div>
              <div className="tnum mt-0.5 text-[11px] text-ink-muted">
                score {formatZ(ind.z)} · {severityWord(ind.z)}
              </div>
            </>
          )}
        </div>

        {/* raw value */}
        <div className="tnum text-[12px] text-ink-2">
          {formatValue(ind.value, ind.unit)}
        </div>

        {/* as-of */}
        <div className="text-[11px] text-ink-muted">
          <div className="tnum">{formatDate(ind.obs_date)}</div>
          <div className={ind.is_stale ? 'font-medium text-ink-2' : ''}>
            {formatAge(ind.age_days)}
            {ind.is_stale && ` · needs an update`}
          </div>
        </div>

        {/* sparkline */}
        <div>
          <Sparkline points={ind.spark} color={color} unit={ind.unit} label={ind.name} />
          {ind.spark.length > 1 && (
            <div className="mt-0.5 text-right text-[10px] text-ink-muted">
              last {formatSpan(ind.spark_days)}
            </div>
          )}
        </div>
      </div>

      {ind.explainer && (
        <p className="mt-2 max-w-4xl text-[11.5px] leading-relaxed text-ink-muted">{ind.explainer}</p>
      )}
      {ind.notes && (
        <p className="mt-1 max-w-4xl text-[11px] italic leading-relaxed text-ink-muted/80">{ind.notes}</p>
      )}
    </div>
  );
}
