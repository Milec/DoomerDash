/**
 * One module per upstream source. A source is fully described by this interface:
 * given an indicator row, return its observations. Everything else - upserting,
 * run records, retries at the orchestration level, z-scoring - is shared.
 *
 * Adding an indicator to a source that already has a connector is a database
 * insert and nothing else.
 */

/** A single observation. `obs_date` is an ISO date (YYYY-MM-DD), never a timestamp. */
export interface Observation {
  obs_date: string;
  value: number;
}

export type Transform = 'level' | 'yoy_pct' | 'diff' | 'ratio';

export interface IndicatorRow {
  slug: string;
  name: string;
  source: string;
  source_series_id: string | null;
  transform: Transform;
  cadence: string;
  unit: string | null;
}

export interface ConnectorContext {
  /** Per-source credentials, pulled from Worker secrets by the orchestrator. */
  apiKey?: string;
  /** Earliest observation date to request. */
  observationStart: string;
  signal?: AbortSignal;
}

export interface Connector {
  /** Must match `indicators.source`. */
  readonly source: string;
  /**
   * Returns every observation the source currently reports for this indicator.
   * Implementations MUST drop missing/unparseable points rather than filling
   * them. A gap is data; a fabricated value is a lie.
   */
  fetchSeries(indicator: IndicatorRow, ctx: ConnectorContext): Promise<Observation[]>;
}
