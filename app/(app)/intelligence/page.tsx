import { requireWorkspacePage } from '../../../src/web/http/context';
import { container } from '../../../src/composition/container';
import { capabilityLabel } from '../../../src/domain/taxonomy/capabilities';
import { Callout, EmptyState, Panel, PanelHeader } from '../../../src/web/ui/primitives';
import { CapabilityForm } from '../../../src/web/components/capability-form';
import { readCalibration } from '../../../src/application/memory/execution';

export const dynamic = 'force-dynamic';

const MATURITY_TONE: Record<string, string> = {
  experimental: 'text-caution',
  working: 'text-ink-muted',
  production: 'text-positive',
  battle_tested: 'text-positive',
};

export default async function IntelligencePage() {
  const { ctx, session } = await requireWorkspacePage('intelligence.read');
  const c = container();

  const [capabilities, assets, resources, goals, calibration, history] = await Promise.all([
    c.repos.graph.listCapabilities(ctx.workspaceId),
    c.repos.graph.listAssets(ctx.workspaceId),
    c.repos.graph.listResources(ctx.workspaceId),
    c.repos.graph.listGoals(ctx.workspaceId),
    readCalibration(c.repos, ctx.workspaceId),
    c.repos.executionHistory.list(ctx.workspaceId, 10),
  ]);

  const empty =
    capabilities.length === 0 && assets.length === 0 && resources.length === 0 && goals.length === 0;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-ink">Our capability</h1>
        <p className="mt-1 text-sm text-ink-muted">
          What this team already has. Anyone can watch the market; this is the half nobody else
          knows, and it is what lets Radar tell you which opportunity <em>you</em> could ship in a
          fortnight.
        </p>
      </div>

      {empty ? (
        <Callout tone="caution" title="Radar cannot judge fit yet">
          Until it knows what you have built, every opportunity looks the same as it would to a
          stranger. Recording even a handful of capabilities changes the ranking materially.
        </Callout>
      ) : null}

      <Panel>
        <PanelHeader
          title={`Capabilities (${capabilities.length})`}
          hint="Matched against what each opportunity requires."
        />
        {capabilities.length === 0 ? (
          <EmptyState title="Nothing recorded yet">
            Add what you can already do — authentication, payments, data pipelines — and Radar will
            start estimating how much of each opportunity is already built.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {capabilities.map((capability) => (
              <li key={capability.nodeId} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-ink">{capability.name}</span>
                  <span className={`font-mono text-[0.6rem] uppercase tracking-wider ${MATURITY_TONE[capability.maturity]}`}>
                    {capability.maturity.replace('_', ' ')}
                  </span>
                </div>
                <p className="mt-1 font-mono text-[0.65rem] text-ink-faint">
                  {capabilityLabel(capability.taxonomyKey)}
                  {capability.assetNames.length ? (
                    <> · provided by {capability.assetNames.join(', ')}</>
                  ) : null}
                </p>
                {capability.notes ? (
                  <p className="mt-1 text-sm text-ink-muted">{capability.notes}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <CapabilityForm csrfToken={session?.csrfSecret ?? ''} />

      <Panel>
        <PanelHeader title={`Reusable assets (${assets.length})`} />
        {assets.length === 0 ? (
          <EmptyState title="No assets recorded">
            Repositories, components, prompts, datasets, domains — anything you would not have to
            build twice.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {assets.map((asset) => (
              <li key={asset.nodeId} className="px-4 py-2.5">
                <p className="text-sm font-medium text-ink">{asset.name}</p>
                <p className="mt-1 font-mono text-[0.65rem] text-ink-faint">
                  {asset.assetKind} · {asset.reuseReadiness.replace(/_/g, ' ')}
                  {asset.licence ? ` · ${asset.licence}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel>
        <PanelHeader title="Resources" hint="What is actually available to spend." />
        {resources.length === 0 ? (
          <EmptyState title="No resources recorded">
            Without a budget and available time, Radar cannot tell you whether something is
            affordable — only whether it is interesting.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {resources.map((resource) => (
              <li key={resource.nodeId} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
                <span className="text-sm text-ink">{resource.name}</span>
                <span className="font-mono text-xs text-ink-muted">
                  {resource.amount - resource.committed} of {resource.amount} {resource.unit} per{' '}
                  {resource.period}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel>
        <PanelHeader title="Goals" hint="What the next few months are for." />
        {goals.length === 0 ? (
          <EmptyState title="No goals recorded">
            A goal changes what counts as a good opportunity. Wanting revenue quickly and wanting
            the largest long-term market lead to different answers.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {goals.map((goal) => (
              <li key={goal.nodeId} className="px-4 py-2.5">
                <p className="text-sm text-ink">{goal.name}</p>
                <p className="mt-1 font-mono text-[0.65rem] text-ink-faint">
                  {goal.horizon} · priority {goal.priority}
                  {goal.target ? ` · target ${goal.target}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel>
        <PanelHeader
          title="Calibration"
          hint="How well Radar's own estimates have held up"
        />
        <div className="space-y-3 px-4 py-3">
          {calibration.usable ? (
            <>
              <dl className="grid grid-cols-2 gap-3">
                <div>
                  <dt className="font-mono text-[0.6rem] uppercase tracking-wider text-ink-faint">
                    Build estimates
                  </dt>
                  <dd className="font-mono text-lg tabular-nums text-ink">
                    {calibration.buildEstimateRatio === null
                      ? '—'
                      : `${calibration.buildEstimateRatio.toFixed(2)}×`}
                  </dd>
                </div>
                <div>
                  <dt className="font-mono text-[0.6rem] uppercase tracking-wider text-ink-faint">
                    Confidence bias
                  </dt>
                  <dd className="font-mono text-lg tabular-nums text-ink">
                    {calibration.confidenceBias === null
                      ? '—'
                      : `${calibration.confidenceBias > 0 ? '+' : ''}${Math.round(calibration.confidenceBias * 100)}`}
                  </dd>
                </div>
              </dl>
              <ul className="space-y-1 text-sm text-ink-muted">
                {calibration.notes.map((note, index) => (
                  <li key={index}>{note}</li>
                ))}
              </ul>
            </>
          ) : (
            /*
             * The refusal is the feature. An adjustment computed from three
             * projects would distort every estimate afterwards, so it is stated
             * plainly instead of shown as a number nobody should trust.
             */
            <Callout tone="caution" title="Not calibrating yet">
              {calibration.refusal}
            </Callout>
          )}

          {history.length > 0 ? (
            <ul className="divide-y divide-line border-t border-line">
              {history.map((entry) => (
                <li key={entry.id} className="flex items-baseline justify-between gap-3 py-2">
                  <span className="text-sm text-ink-muted">
                    {entry.reason ?? entry.outcome.replace(/_/g, ' ')}
                  </span>
                  <span className="font-mono text-[0.65rem] text-ink-faint">
                    {entry.predictedBuildDays !== null && entry.actualBuildDays !== null
                      ? `${entry.predictedBuildDays}d predicted, ${entry.actualBuildDays}d actual`
                      : entry.outcome.replace(/_/g, ' ')}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-muted">
              No completed work has been recorded yet. Recording outcomes is what turns Radar&rsquo;s
              estimates into something that can be checked.
            </p>
          )}
        </div>
      </Panel>
    </div>
  );
}
