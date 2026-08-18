import { redirect } from 'next/navigation';
import { AuthForm } from '../../../src/web/components/auth-form';
import { Panel } from '../../../src/web/ui/primitives';
import { container } from '../../../src/composition/container';
import { readRequestContext } from '../../../src/web/http/context';

export const dynamic = 'force-dynamic';

export default async function SignInPage() {
  const { session } = await readRequestContext();
  if (session) redirect('/');

  // A fresh installation has no account yet; sending the owner to sign-in would
  // be a dead end, so first run goes to setup instead.
  if ((await container().repos.users.count()) === 0) redirect('/setup');

  return (
    <Panel className="p-5">
      <h1 className="mb-5 text-lg font-semibold text-ink">Sign in</h1>
      <AuthForm mode="sign-in" />
    </Panel>
  );
}
