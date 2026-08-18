import { redirect } from 'next/navigation';
import { readRequestContext } from '../src/web/http/context';

export const dynamic = 'force-dynamic';

/**
 * The root is a router, not a screen: an unauthenticated visitor is sent to
 * setup or sign-in, and everyone else lands on the dashboard.
 */
export default async function RootPage() {
  const { session, ctx } = await readRequestContext();
  if (!session) redirect('/sign-in');
  if (!ctx) redirect('/setup');
  redirect('/dashboard');
}
