import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { readRequestContext } from '../../src/web/http/context';
import { readModeStatus } from '../../src/application/system/mode';
import { container } from '../../src/composition/container';
import { AppShell } from '../../src/web/components/app-shell';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { session, ctx } = await readRequestContext();
  if (!session) redirect('/sign-in');
  if (!ctx) redirect('/setup');

  const mode = await readModeStatus(container().repos);
  const workspace = session.memberships.find((m) => m.workspaceId === ctx.workspaceId);

  return (
    <AppShell
      workspaceName={workspace?.workspaceName ?? 'Workspace'}
      role={ctx.role}
      mode={mode.mode}
    >
      {children}
    </AppShell>
  );
}
