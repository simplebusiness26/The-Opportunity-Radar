import Link from 'next/link';
import { SIGNAL_TYPES } from '../../../src/domain/taxonomy/signal-types';
import { EVIDENCE_CLASSES } from '../../../src/domain/taxonomy/evidence-class';
import { Button, DemoBadge, EmptyState, Panel, PanelHeader } from '../../../src/web/ui/primitives';
import { requireWorkspacePage } from '../../../src/web/http/context';
import { container } from '../../../src/composition/container';

export const dynamic = 'force-dynamic';

export default async function SignalsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string }>;
}) {
  const { ctx } = await requireWorkspacePage('signals.read');
  const params = await searchParams;
  const c = container();

  const { rows, total } = await c.repos.signals.list(ctx.workspaceId, {
    search: params.q,
    signalTypes: params.type ? [params.type as never] : undefined,
    includeDemo: true,
    limit: 100,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Signals</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Individual observations. Several of these become one piece of evidence; several
            pieces of evidence become a problem worth looking at.
          </p>
        </div>
        <Link href="/signals/new">
          <Button>Record evidence</Button>
        </Link>
      </div>

      <Panel>
        <PanelHeader title={`${total} ${total === 1 ? 'signal' : 'signals'}`} />
        {rows.length === 0 ? (
          <EmptyState
            title="Nothing observed yet"
            action={
              <Link href="/signals/new">
                <Button variant="secondary">Record the first one</Button>
              </Link>
            }
          >
            Radar has no evidence to reason about. Add what you have seen — a customer
            complaint, a job advert, a price someone quoted — and it will start connecting them.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((signal) => {
              const type = SIGNAL_TYPES[signal.signalTypeKey];
              const evidence = EVIDENCE_CLASSES[signal.evidenceClass];
              return (
                <li key={signal.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[0.6rem] uppercase tracking-wider text-accent">
                      {type?.label ?? signal.signalTypeKey}
                    </span>
                    <span className="text-line">·</span>
                    <span className="font-mono text-[0.6rem] uppercase tracking-wider text-ink-faint">
                      {evidence?.label ?? signal.evidenceClass}
                    </span>
                    {signal.demo ? <DemoBadge /> : null}
                    {signal.status === 'duplicate' ? (
                      <span className="font-mono text-[0.6rem] uppercase tracking-wider text-ink-faint">
                        repeat mention
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm font-medium text-ink">{signal.title}</p>
                  <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{signal.bodyText}</p>
                  <p className="mt-1.5 font-mono text-[0.65rem] text-ink-faint">
                    {signal.observedAt.toISOString().slice(0, 10)}
                    {signal.originKey ? ` · ${signal.originKey}` : ''}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
