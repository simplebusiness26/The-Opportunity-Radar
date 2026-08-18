import { requireWorkspacePage } from '../../../src/web/http/context';
import { container } from '../../../src/composition/container';
import { listSourcesWithHealth } from '../../../src/application/sources/manage';
import { ADAPTER_REGISTRY } from '../../../src/adapters/sources/registry';
import { Callout, EmptyState, Panel, PanelHeader } from '../../../src/web/ui/primitives';
import { SourceForm } from '../../../src/web/components/source-form';

export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<string, string> = {
  ok: 'text-positive',
  degraded: 'text-caution',
  failing: 'text-negative',
  not_configured: 'text-caution',
  disabled: 'text-ink-faint',
};

const STATUS_LABEL: Record<string, string> = {
  ok: 'connected',
  degraded: 'degraded',
  failing: 'failing',
  not_configured: 'needs setup',
  disabled: 'disabled',
};

function ago(date: Date | null, now: Date): string {
  if (!date) return 'never';
  const minutes = Math.round((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

export default async function SourcesPage() {
  const { ctx, session } = await requireWorkspacePage('workspace.read');
  const c = container();
  const now = c.clock.now();

  const sources = await listSourcesWithHealth(
    { repos: c.repos, tx: c.tx, clock: c.clock, secretBox: c.secretBox, adapters: c.adapters },
    ctx,
  );

  const manifests = [...ADAPTER_REGISTRY.values()].map((adapter) => adapter.manifest);
  const free = manifests.filter((manifest) =>
    manifest.configFields.every((field) => !field.secret || !field.required),
  );

  const canConfigure = ctx.role === 'owner' || ctx.role === 'admin';

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-ink">Sources</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Where external evidence comes from. Each source reports its own state honestly: a source
          that is failing is shown as failing, and its evidence is not quietly assumed complete.
        </p>
      </div>

      <Panel>
        <PanelHeader title={`Configured (${sources.length})`} />
        {sources.length === 0 ? (
          <EmptyState title="No sources connected">
            Radar works without any: you can record evidence by hand. Connecting a source lets it
            find evidence on its own.{' '}
            {free.length > 0 ? (
              <>
                {free.map((manifest) => manifest.name).join(' and ')} need no credentials at all.
              </>
            ) : null}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {sources.map((source) => (
              <li key={source.id} className="px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{source.name}</p>
                    <p className="font-mono text-[0.65rem] text-ink-faint">
                      {source.adapterName} · {source.category.replace(/_/g, ' ')}
                    </p>
                  </div>
                  <span
                    className={`font-mono text-[0.6rem] uppercase tracking-wider ${
                      STATUS_TONE[source.status] ?? 'text-ink-faint'
                    }`}
                  >
                    {STATUS_LABEL[source.status] ?? source.status}
                  </span>
                </div>

                <p className="mt-1.5 font-mono text-[0.65rem] text-ink-faint">
                  last run {ago(source.lastRunAt, now)}
                  {source.lastSuccessAt ? ` · last success ${ago(source.lastSuccessAt, now)}` : ''}
                  {source.itemsLastRun > 0 ? ` · ${source.itemsLastRun} items` : ''}
                </p>

                {source.message ? (
                  <p className="mt-1 text-sm text-ink-muted">{source.message}</p>
                ) : null}

                {source.remedy ? (
                  <div className="mt-2">
                    <Callout tone={source.status === 'failing' ? 'negative' : 'caution'}>
                      {source.remedy}
                    </Callout>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {canConfigure ? (
        <SourceForm csrfToken={session?.csrfSecret ?? ''} manifests={manifests} />
      ) : null}

      <Panel>
        <PanelHeader title="What each source is good for" />
        <ul className="divide-y divide-line">
          {manifests.map((manifest) => (
            <li key={manifest.adapterKey} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-ink">{manifest.name}</span>
                {manifest.configFields.every((field) => !field.secret || !field.required) ? (
                  <span className="font-mono text-[0.6rem] uppercase tracking-wider text-positive">
                    no credentials needed
                  </span>
                ) : (
                  <span className="font-mono text-[0.6rem] uppercase tracking-wider text-ink-faint">
                    needs credentials
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-ink-muted">{manifest.description}</p>
              <p className="mt-1.5 text-xs text-ink-faint">
                {manifest.termsPolicy} {manifest.costNote}
              </p>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
