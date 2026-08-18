/**
 * Placeholder root. Replaced by the dashboard in Phase 2; kept minimal so the
 * Phase 0 smoke test asserts the toolchain, not the product.
 */
export const dynamic = 'force-dynamic';

export default function HomePage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-ink-faint">
        Opportunity Radar
      </p>
      <h1 className="mt-3 text-2xl font-semibold text-ink">System initialising</h1>
      <p className="mt-4 text-sm leading-relaxed text-ink-muted">
        The core platform is installed and the database is reachable. Product surfaces are
        introduced in later build phases.
      </p>
    </main>
  );
}
