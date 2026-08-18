import Link from 'next/link';
import { requireWorkspacePage } from '../../../src/web/http/context';
import { container } from '../../../src/composition/container';
import { readBudgetStatus } from '../../../src/pipeline/ai-gateway';
import { forecastSpend, periodKeys } from '../../../src/domain/budget/index';
import { readModeStatus } from '../../../src/application/system/mode';
import { Callout, EmptyState, Panel, PanelHeader } from '../../../src/web/ui/primitives';
import { ProviderForm } from '../../../src/web/components/provider-form';
import { BudgetForm } from '../../../src/web/components/budget-form';

export const dynamic = 'force-dynamic';

const ROLE_LABELS: Record<string, string> = {
  cheap_extraction: 'Cheap extraction',
  classification: 'Classification',
  research: 'Research',
  reasoning: 'Reasoning',
  high_value_decision: 'High-value decisions',
  embedding: 'Embeddings',
};

export default async function SettingsPage() {
  const { ctx, session } = await requireWorkspacePage('workspace.read');
  const c = container();
  const now = c.clock.now();
  const keys = periodKeys(now);

  const [mode, providers, models, routes, budgets, ledger, status, spend] = await Promise.all([
    readModeStatus(c.repos, ctx.workspaceId),
    c.repos.ai.listProviders(ctx.workspaceId),
    c.repos.ai.listModels(ctx.workspaceId),
    c.repos.ai.routes(ctx.workspaceId),
    c.repos.budgets.listBudgets(ctx.workspaceId),
    c.repos.budgets.ledger(ctx.workspaceId, [keys.daily, keys.monthly]),
    readBudgetStatus({ repos: c.repos }, ctx.workspaceId, now),
    c.repos.ai.spendSummary(ctx.workspaceId, new Date(now.getTime() - 30 * 86_400_000)),
  ]);

  const monthly = ledger.find((row) => row.periodKey === keys.monthly);
  const daysInPeriod = new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 0).getUTCDate();
  const forecast = forecastSpend({
    spentUsd: monthly?.spentUsd ?? 0,
    daysElapsed: now.getUTCDate(),
    daysInPeriod,
  });

  const totalSpend = spend.reduce((sum, entry) => sum + entry.costUsd, 0);
  const canConfigure = ctx.role === 'owner' || ctx.role === 'admin';

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-ink">Settings</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Radar runs in <strong className="text-ink">{mode.mode.replace('_', ' ')}</strong> mode.
          Everything here is optional: the product works without any of it, and says what it
          cannot do rather than pretending.
        </p>
      </div>

      {mode.missingForNext.length > 0 ? (
        <Callout tone="neutral" title={`To reach ${mode.nextMode?.replace('_', ' ')} mode`}>
          <ul className="space-y-1">
            {mode.missingForNext.map((item) => (
              <li key={item}>· {item}</li>
            ))}
          </ul>
        </Callout>
      ) : null}

      <Panel>
        <PanelHeader
          title="AI providers"
          hint="Credentials are encrypted before they are stored and never shown again."
        />
        {providers.length === 0 ? (
          <EmptyState title="No provider connected">
            Radar works without one: signals, evidence, clustering, scoring and allocation are all
            deterministic. A provider adds extraction, research synthesis and red-teaming.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {providers.map((provider) => (
              <li key={provider.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-ink">{provider.label}</p>
                  <p className="font-mono text-[0.65rem] text-ink-faint">
                    {provider.kind}
                    {provider.secretId ? ' · credential stored' : ' · no credential'}
                  </p>
                </div>
                <span
                  className={`font-mono text-[0.6rem] uppercase tracking-wider ${
                    provider.enabled ? 'text-positive' : 'text-ink-faint'
                  }`}
                >
                  {provider.enabled ? 'enabled' : 'disabled'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {canConfigure ? <ProviderForm csrfToken={session?.csrfSecret ?? ''} /> : null}

      <Panel>
        <PanelHeader
          title="Model routing"
          hint="Cheap work goes to a cheap model; the expensive one is kept for rare decisions."
        />
        {models.length === 0 ? (
          <p className="px-4 py-3 text-sm text-ink-muted">
            Connect a provider and add its models to configure routing.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {Object.keys(ROLE_LABELS).map((role) => {
              const route = routes.find((entry) => entry.role === role);
              const model = models.find((entry) => entry.id === route?.primaryModelId);
              return (
                <li key={role} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5">
                  <span className="text-sm text-ink">{ROLE_LABELS[role]}</span>
                  <span className="font-mono text-xs text-ink-muted">
                    {model ? model.label : <span className="text-ink-faint">not assigned</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel>
        <PanelHeader title="Spending" hint={status.explanation} />
        <div className="scroll-x px-4 py-3">
          <div className="flex min-w-max gap-5">
            <Stat label="this month" value={`$${(monthly?.spentUsd ?? 0).toFixed(2)}`} />
            <Stat
              label="limit"
              value={
                budgets.find((budget) => budget.period === 'monthly')
                  ? `$${budgets.find((budget) => budget.period === 'monthly')!.limitUsd.toFixed(2)}`
                  : 'none set'
              }
            />
            <Stat
              label="forecast"
              value={forecast ? `$${forecast.projectedUsd[0]}–${forecast.projectedUsd[1]}` : '—'}
            />
            <Stat label="last 30 days" value={`$${totalSpend.toFixed(2)}`} />
          </div>
        </div>
        {forecast ? (
          <p className="px-4 pb-3 text-xs text-ink-faint">
            {forecast.basis} Costs are calculated from the prices you entered, not from a bill.
          </p>
        ) : null}
      </Panel>

      {canConfigure ? (
        <BudgetForm
          csrfToken={session?.csrfSecret ?? ''}
          current={budgets.find((budget) => budget.period === 'monthly')?.limitUsd ?? null}
        />
      ) : null}

      {spend.length > 0 ? (
        <Panel>
          <PanelHeader title="Where the money went" hint="Last 30 days, by role." />
          <ul className="divide-y divide-line">
            {spend.map((entry) => (
              <li key={entry.role} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
                <span className="text-sm text-ink">{ROLE_LABELS[entry.role] ?? entry.role}</span>
                <span className="font-mono text-xs text-ink-muted">
                  {entry.calls} calls · ${entry.costUsd.toFixed(4)}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel>
        <PanelHeader title="Elsewhere" />
        <div className="flex flex-wrap gap-x-4 gap-y-2 px-4 py-3">
          <Link href="/system" className="text-sm text-accent hover:underline">
            Machine status →
          </Link>
          <Link href="/intelligence" className="text-sm text-accent hover:underline">
            Our capability →
          </Link>
        </div>
      </Panel>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-mono text-lg tabular-nums text-ink">{value}</p>
      <p className="font-mono text-[0.6rem] uppercase tracking-wider text-ink-faint">{label}</p>
    </div>
  );
}
