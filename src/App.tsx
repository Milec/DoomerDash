import { useEffect, useState } from 'react';
import type { DashboardPayload } from '../shared/types.ts';
import CompositeCard from './components/CompositeCard.tsx';
import CounterStrip from './components/CounterStrip.tsx';
import Footer from './components/Footer.tsx';
import HowToRead from './components/HowToRead.tsx';
import IndicatorRow from './components/IndicatorRow.tsx';
import { formatTimestamp } from './lib/format.ts';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: DashboardPayload };

export default function App() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch('/api/dashboard')
      .then(async (r) => {
        if (!r.ok) {
          const body = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${r.status}`);
        }
        return (await r.json()) as DashboardPayload;
      })
      .then((data) => live && setState({ status: 'ready', data }))
      .catch((e: unknown) =>
        live && setState({ status: 'error', message: e instanceof Error ? e.message : String(e) }),
      );
    return () => {
      live = false;
    };
  }, []);

  if (state.status === 'loading') {
    return <Shell><p className="text-[12px] text-ink-muted">Loading indicators…</p></Shell>;
  }

  if (state.status === 'error') {
    return (
      <Shell>
        <div className="rounded-lg border border-z-warm-2/40 bg-surface px-4 py-3">
          <p className="text-[13px] font-medium text-z-warm-3">Could not load indicators</p>
          <p className="mt-1 text-[12px] text-ink-2">{state.message}</p>
          <p className="mt-2 text-[11px] text-ink-muted">
            The dashboard stays blank until it has a reliable reading.
          </p>
        </div>
      </Shell>
    );
  }

  const { data } = state;
  const expanded = data.failure_modes.find((m) => m.slug === open);

  return (
    <Shell>
      <HowToRead data={data} />
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {data.failure_modes.map((mode) => (
          <CompositeCard
            key={mode.slug}
            mode={mode}
            expanded={open === mode.slug}
            onToggle={() => setOpen(open === mode.slug ? null : mode.slug)}
          />
        ))}
      </div>

      {expanded && (
        <section className="mt-3 overflow-hidden rounded-lg border border-white/15 bg-surface">
          <header className="px-3 pt-3 pb-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h3 className="text-[12px] font-semibold text-ink">{expanded.label}</h3>
              <p className="text-[11px] text-ink-muted">
                Higher scores mean more pressure · faded rows need an update
              </p>
            </div>
            {expanded.explainer && (
              <p className="mt-1.5 max-w-4xl text-[11.5px] leading-relaxed text-ink-2">
                {expanded.explainer}
              </p>
            )}
          </header>
          {expanded.members.length === 0 ? (
            <p className="border-t border-line px-3 py-6 text-[12px] text-ink-muted">
              No data series have been added to this group yet.
            </p>
          ) : (
            expanded.members.map((ind) => <IndicatorRow key={ind.slug} ind={ind} />)
          )}
        </section>
      )}

      <CounterStrip items={data.counter_indicators} />
      <Footer data={data} />
      <p className="mt-6 text-[10px] text-ink-muted">
        Updated {formatTimestamp(data.generated_at)}
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-page px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="text-[15px] font-semibold tracking-tight text-ink">DoomerDash</h1>
        <p className="max-w-xl text-[11px] leading-snug text-ink-muted">
          A clear read on five sources of stress. Higher scores mean more pressure.
        </p>
      </header>
      <main className="mx-auto max-w-[1600px]">{children}</main>
    </div>
  );
}
