import { redirect } from 'next/navigation';
import { AuthForm } from '../../../src/web/components/auth-form';
import { Callout, Panel } from '../../../src/web/ui/primitives';
import { container } from '../../../src/composition/container';
import { readRequestContext } from '../../../src/web/http/context';

export const dynamic = 'force-dynamic';

export default async function SetupPage() {
  const c = container();
  const { session } = await readRequestContext();
  if (session) redirect('/');

  const existingUsers = await c.repos.users.count();
  if (existingUsers > 0 && c.singleOwner) redirect('/sign-in');

  return (
    <div className="space-y-4">
      <Panel className="p-5">
        <h1 className="text-lg font-semibold text-ink">Create your workspace</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          Radar works from the moment you sign in. No external service is required: you can enter
          evidence, build opportunities and rank them with deterministic scoring straight away.
          Connecting an AI provider and intelligence sources comes later, and Radar will tell you
          exactly what each one unlocks.
        </p>
        <div className="mt-5">
          <AuthForm mode="setup" workspaceSuggestion="My Workspace" />
        </div>
      </Panel>

      {!c.env.RADAR_SECRET_KEY ? (
        <Callout tone="caution" title="Credential storage is not configured yet">
          Radar will run, but it cannot store provider API keys until{' '}
          <code className="font-mono text-xs">RADAR_SECRET_KEY</code> is set. Generate one with{' '}
          <code className="font-mono text-xs">
            node -e &quot;console.log(require(&apos;crypto&apos;).randomBytes(32).toString(&apos;base64&apos;))&quot;
          </code>{' '}
          and add it to <code className="font-mono text-xs">.env</code>.
        </Callout>
      ) : null}
    </div>
  );
}
