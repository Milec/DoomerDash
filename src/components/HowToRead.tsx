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
            <h3 className="mb-1.5 text-[12px] font-semibold text-ink">Every number is compared to its own past</h3>
            <p>
              Comparing an oil price to an unemployment rate directly would be meaningless - they
              are not the same kind of thing. So each measure is asked the same question instead:
              <em className="text-ink"> how unusual is this right now, compared with its own normal
              range over the last {data.zscore_window_years} years?</em>
            </p>
            <p className="mt-2">
              That is why a row says something like &ldquo;worse than 94% of the past decade&rdquo;.
              It means only 6% of the time in the last ten years was this measure in worse shape
              than it is today.
            </p>
          </div>

          <div>
            <h3 className="mb-1.5 text-[12px] font-semibold text-ink">Positive always means worse</h3>
            <p>
              Some things are bad when they rise (inflation, borrowing costs). Others are bad when
              they fall (water in reservoirs, cash in the banking system, ships passing through a
              canal). Those are flipped, so you never have to remember which way round each one
              goes. Higher score, redder colour, worse situation - everywhere on the page.
            </p>
            <p className="mt-2">
              The smaller <span className="tnum text-ink">score</span> next to each reading is a
              standard deviation: 0 is typical, +1 is worse than usual, +2 is much worse.
            </p>
          </div>

          <div>
            <h3 className="mb-1.5 text-[12px] font-semibold text-ink">What is deliberately not done</h3>
            <p>
              Nothing is estimated or filled in. If a source skips a day, the gap stays a gap.
              Anything older than it should be is <span className="stale inline-block px-1 text-ink">greyed out</span>{' '}
              with its age shown, because quarterly data presented as if it were live is worse than
              no data at all.
            </p>
            <p className="mt-2">
              Measures with a natural yearly rhythm - sea ice, reservoirs, fuel stockpiles - are
              compared against <em className="text-ink">the same time of year</em>, so
              &ldquo;it&rsquo;s September&rdquo; never gets mistaken for &ldquo;something is
              wrong&rdquo;. Those rows say so.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
