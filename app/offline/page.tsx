/**
 * Shown when a navigation is attempted with no network.
 *
 * It deliberately shows nothing from the last visit. A cached dashboard would
 * present numbers that may already have moved, and Radar's whole claim is that
 * what it shows is what it currently believes.
 */
export const dynamic = 'force-static';

export default function OfflinePage() {
  return (
    <main className="mx-auto max-w-md px-6 py-20 text-center">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-ink-faint">Opportunity Radar</p>
      <h1 className="mt-3 text-xl font-semibold text-ink">No connection</h1>
      <p className="mt-4 text-sm leading-relaxed text-ink-muted">
        Radar is not showing you the last thing it knew, because that may no longer be true.
        Scores, evidence and confidence change as the machine keeps working, and a stale number
        presented as current is worse than none.
      </p>
      <p className="mt-4 text-sm text-ink-faint">Reconnect and this page will load normally.</p>
    </main>
  );
}
