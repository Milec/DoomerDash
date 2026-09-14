import { Line, LineChart, ResponsiveContainer, Tooltip, YAxis } from 'recharts';
import type { SparkPoint } from '../../shared/types.ts';
import { formatValue } from '../lib/format.ts';

interface Props {
  points: SparkPoint[];
  color: string;
  unit: string | null;
  label: string;
}

function SparkTooltip({ active, payload, unit }: {
  active?: boolean;
  payload?: Array<{ payload: SparkPoint }>;
  unit: string | null;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded border border-white/15 bg-surface-2 px-2 py-1 text-[11px] leading-tight shadow-lg">
      <div className="tnum text-ink">{formatValue(p.v, unit)}</div>
      <div className="tnum text-ink-muted">{p.d}</div>
    </div>
  );
}

/**
 * Value over the indicator's own window. Gaps stay gaps: a missing observation
 * is an absent point, and the line is not bridged across it.
 */
export default function Sparkline({ points, color, unit, label }: Props) {
  if (points.length < 2) {
    return (
      <div className="flex h-8 items-center text-[11px] text-ink-muted" aria-label={`${label}: too few points to plot`}>
        {points.length === 1 ? 'single point' : 'no data'}
      </div>
    );
  }
  return (
    <div className="h-8 w-full" role="img" aria-label={`${label} sparkline`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 3, right: 2, bottom: 3, left: 2 }}>
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Tooltip
            content={<SparkTooltip unit={unit} />}
            cursor={{ stroke: '#2c2c2a', strokeWidth: 1 }}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3, fill: color, stroke: '#12120f', strokeWidth: 2 }}
            isAnimationActive={false}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
