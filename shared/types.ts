/** Wire format between the Worker and the SPA. The browser sees nothing else. */

export type FailureModeSlug =
  | 'fiscal_monetary'
  | 'credit_plumbing'
  | 'physical_resource'
  | 'supply_conflict'
  | 'institutional';

export type CompositeStatus = 'ok' | 'insufficient_members' | 'no_members';

export interface SparkPoint {
  /** ISO date exactly as the source published it. Never a timestamp. */
  d: string;
  v: number;
  z: number | null;
}

export interface IndicatorView {
  slug: string;
  name: string;
  failure_mode: FailureModeSlug;
  source: string;
  source_series_id: string | null;
  unit: string | null;
  cadence: string;
  transform: string;
  higher_is_worse: boolean;
  is_counter: boolean;
  notes: string | null;
  source_url: string | null;
  license: string | null;
  stale_after_days: number;
  /** Null when the indicator has no observations at all. */
  obs_date: string | null;
  value: number | null;
  /** Null when the trailing window holds fewer than the minimum observations. */
  z: number | null;
  window_n: number | null;
  age_days: number | null;
  is_stale: boolean;
  spark: SparkPoint[];
  spark_days: number;
}

export interface FailureModeView {
  slug: FailureModeSlug;
  label: string;
  subtitle: string;
  status: CompositeStatus;
  composite_z: number | null;
  composite_z_30d_ago: number | null;
  member_count: number;
  fresh_member_count: number;
  members: IndicatorView[];
}

export interface SourceStatus {
  source: string;
  last_success_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
  last_rows_upserted: number | null;
  last_error_text: string | null;
}

export interface DashboardPayload {
  generated_at: string;
  /** When the z-score snapshot was last rebuilt. Null means never. */
  analytics_refreshed_at: string | null;
  composite_window_days: number;
  zscore_window_years: number;
  zscore_min_obs: number;
  failure_modes: FailureModeView[];
  counter_indicators: IndicatorView[];
  sources: SourceStatus[];
}
