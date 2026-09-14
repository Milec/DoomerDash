import { useEffect, useState } from 'react';
import type { DashboardPayload } from '../../shared/types.ts';

const KEY = 'doomerdash.howto.dismissed';

/**
 * The page is useless to anyone who does not know what the numbers mean, so the
 * explanation ships open by default and stays dismissed once closed.
 * localStorage can throw in private windows, hence the try/catch on both sides.
 */
export default function HowToRead({ data }: { data: DashboardPayload }) {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    try {
      if (localStorage.getItem(KEY) === '1') setOpen(false);
    } catch {
      /* storage unavailable; stay open */
    }
  }, []);

  function toggle() {
    setOpen((was) => {
      const next = !was;
      try {
        if (next) localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, '1');
      } catch {
        /* nothing to persist to */
      }
      return next;
    });
  }

  return (
    <section className="mb-4 rounded-lg border border-white/10 bg-surface">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left"
      >
        <span className="text-[12px] font-semibold text-ink">How to read this</span>
        <span className="text-[11px] text-ink-muted">{open ? 'hide' : 'show'}</span>
      </button>

      {open && (
        <div className="grid gap-5 border-t border-line px-4 py-4 text-[12px] leading-relaxed text-ink-2 lg:grid-cols-3">
          <div>
            <h3 className="mb-1.5 text-[12px] font-semibold text-ink">Read each measure in context</h3>
            <p>
              Oil prices and unemployment are different kinds of data, so the dashboard does not
              compare their raw numbers. Instead, it asks: <em className="text-ink">how unusual is
              this reading compared with the last {data.zscore_window_years} years?</em>
            </p>
            <p className="mt-2">
              &ldquo;Worse than 94% of the past decade&rdquo; means this measure has been under more pressure
              only 6% of the time in that period.
            </p>
          </div>

          <div>
            <h3 className="mb-1.5 text-[12px] font-semibold text-ink">One direction throughout</h3>
            <p>
              Inflation and borrowing costs are bad when they rise. Reservoir levels and shipping
              traffic are bad when they fall. The latter are reversed, so higher scores and warmer
              colours always point to more stress.
            </p>
            <p className="mt-2">
              The smaller <span className="tnum text-ink">score</span> shows the size of the move:
              0 is typical, +1 is above normal, and +2 is far above normal.
            </p>
          </div>

          <div>
            <h3 className="mb-1.5 text-[12px] font-semibold text-ink">What the dashboard leaves alone</h3>
            <p>
              Missing data is never filled in. If a source skips a day, the gap remains. Old data
              is <span className="stale inline-block px-1 text-ink">faded</span> and dated so it is
              not mistaken for a live reading.
            </p>
            <p className="mt-2">
              Seasonal measures—such as sea ice, reservoirs, and fuel stockpiles—are compared with
              <em className="text-ink">the same time of year</em>. Normal seasonal swings do not
              count as a warning.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
