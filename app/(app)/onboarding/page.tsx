import Link from 'next/link';
import { requireWorkspacePage } from '../../../src/web/http/context';
import { container } from '../../../src/composition/container';
import { readOnboarding } from '../../../src/application/system/onboarding';
import { Callout, Panel, PanelHeader } from '../../../src/web/ui/primitives';

export const dynamic = 'force-dynamic';

export default async function OnboardingPage() {
  const { ctx } = await requireWorkspacePage('workspace.read');
  const c = container();
  const onboarding = await readOnboarding(c.repos, ctx.workspaceId);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-ink">Setting Radar up</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Each step below is answered by reading your data, not by ticking a box. Remove something
          and its step becomes incomplete again, which is how it should be.
        </p>
      </div>

      {onboarding.ready ? (
        <Callout tone="positive" title="Radar has what it needs">
          The essentials are recorded. Anything still marked optional makes Radar more autonomous;
          none of it is required for the loop to work.
        </Callout>
      ) : (
        <Callout tone="caution" title={`Next: ${onboarding.next?.title ?? 'nothing'}`}>
          {onboarding.next?.why}
        </Callout>
      )}

      <Panel>
        <PanelHeader
          title="Steps"
          hint={`${onboarding.completed} of ${onboarding.steps.length} done · ${onboarding.mode.replace('_', ' ')} mode`}
        />
        <ol className="divide-y divide-line">
          {onboarding.steps.map((step, index) => (
            <li key={step.key} className="px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex items-baseline gap-2">
                  <span
                    className={`font-mono text-xs tabular-nums ${step.done ? 'text-positive' : 'text-ink-faint'}`}
                  >
                    {step.done ? '✓' : index + 1}
                  </span>
                  <Link href={step.href} className="text-sm text-ink hover:underline">
                    {step.title}
                  </Link>
                </div>
                {step.optional ? (
                  <span className="font-mono text-[0.6rem] uppercase tracking-wider text-ink-faint">
                    optional
                  </span>
                ) : null}
              </div>
              <p className="mt-1 pl-6 text-xs leading-relaxed text-ink-muted">{step.why}</p>
              <p className="mt-1 pl-6 font-mono text-[0.65rem] text-ink-faint">{step.detail}</p>
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}
