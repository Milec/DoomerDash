import type { IndicatorView } from '../../shared/types.ts';
import { formatAge, formatDate, formatSpan, formatValue, formatZ } from '../lib/format.ts';
import { zColor, zLabel } from '../lib/scale.ts';
import Sparkline from './Sparkline.tsx';

export default function IndicatorRow({ ind }: { ind: IndicatorView }) {
  const color = zColor(ind.z);
  const unscored = ind.z === null;

  return (
    <div
      className={`grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 border-t border-line px-3 py-3 sm:grid-cols-[minmax(0,1.4fr)_5rem_8rem_8.5rem_minmax(0,1fr)] sm:gap-x-4 ${ind.is_stale ? 'stale' : ''}`}
    >
      {/* name + source link */}
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium text-ink">{ind.name}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-muted">
          <span>{ind.cadence}</span>
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

      {/* z, the headline number */}
      <div className="justify-self-end text-right sm:justify-self-start sm:text-left">
        <div className="tnum text-[17px] font-semibold leading-none" style={{ color }}>
          {formatZ(ind.z)}
        </div>
        <div className="mt-1 text-[10px] leading-none text-ink-muted">
          {unscored ? `n=${ind.window_n ?? 0}` : 'z'}
        </div>
      </div>

      {/* raw value, secondary */}
      <div className="tnum col-span-2 text-[12px] text-ink-2 sm:col-span-1">
        {formatValue(ind.value, ind.unit)}
      </div>

      {/* as-of */}
      <div className="col-span-2 text-[11px] text-ink-muted sm:col-span-1">
        <div className="tnum">{formatDate(ind.obs_date)}</div>
        <div className={ind.is_stale ? 'font-medium text-ink-2' : ''}>
          {formatAge(ind.age_days)}
          {ind.is_stale && ` · past ${ind.stale_after_days}d`}
        </div>
      </div>

      {/* sparkline */}
      <div className="col-span-2 sm:col-span-1">
        <Sparkline points={ind.spark} color={color} unit={ind.unit} label={ind.name} />
        <div className="mt-0.5 text-right text-[10px] text-ink-muted">
          {ind.spark.length > 1 ? `${formatSpan(ind.spark_days)} · ${zLabel(ind.z)}` : zLabel(ind.z)}
        </div>
      </div>

      {ind.notes && (
        <p className="col-span-2 text-[11px] leading-snug text-ink-muted sm:col-span-5">{ind.notes}</p>
      )}
    </div>
  );
}
