import Link from 'next/link';
import { SignalForm } from '../../../../src/web/components/signal-form';
import { Panel } from '../../../../src/web/ui/primitives';
import { requireWorkspacePage } from '../../../../src/web/http/context';
import { readRequestContext } from '../../../../src/web/http/context';

export const dynamic = 'force-dynamic';

export default async function NewSignalPage() {
  await requireWorkspacePage('signals.write');
  const { session } = await readRequestContext();

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <Link href="/signals" className="font-mono text-xs text-ink-faint hover:text-ink">
          ← Signals
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-ink">Record evidence</h1>
        <p className="mt-1 text-sm leading-relaxed text-ink-muted">
          Radar compares what you enter against everything it already holds. If this repeats
          something it has seen, it will say so rather than counting it twice.
        </p>
      </div>

      <Panel className="p-5">
        <SignalForm csrfToken={session?.csrfSecret ?? ''} />
      </Panel>
    </div>
  );
}
