import Link from 'next/link';
import { OpportunityForm } from '../../../../src/web/components/opportunity-form';
import { Panel } from '../../../../src/web/ui/primitives';
import { readRequestContext, requireWorkspacePage } from '../../../../src/web/http/context';

export const dynamic = 'force-dynamic';

export default async function NewOpportunityPage() {
  await requireWorkspacePage('opportunities.write');
  const { session } = await readRequestContext();

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <Link href="/opportunities" className="font-mono text-xs text-ink-faint hover:text-ink">
          ← Opportunities
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-ink">New opportunity</h1>
      </div>
      <Panel className="p-5">
        <OpportunityForm csrfToken={session?.csrfSecret ?? ''} />
      </Panel>
    </div>
  );
}
