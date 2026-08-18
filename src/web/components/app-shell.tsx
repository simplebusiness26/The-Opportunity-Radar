import type { ReactNode } from 'react';
import Link from 'next/link';
import { MODE_LABELS, type OperatingMode } from '../../domain/config/mode';
import type { MemberRole } from '../../domain/types/identity';
import { cx } from '../ui/primitives';

/**
 * Navigation is a bottom bar on phones and a sidebar on wide screens. Radar is
 * meant to be operated one-handed from a phone, so the primary destinations sit
 * within thumb reach rather than behind a hamburger.
 */
const NAV = [
  { href: '/dashboard', label: 'Radar', short: 'Radar' },
  { href: '/opportunities', label: 'Opportunities', short: 'Opps' },
  { href: '/clusters', label: 'Problems', short: 'Problems' },
  { href: '/signals', label: 'Signals', short: 'Signals' },
  { href: '/intelligence', label: 'Our capability', short: 'Us' },
  { href: '/system', label: 'Machine', short: 'Machine' },
] as const;

export function AppShell({
  children,
  workspaceName,
  role,
  mode,
}: {
  children: ReactNode;
  workspaceName: string;
  role: MemberRole;
  mode: OperatingMode;
}) {
  return (
    <div className="min-h-dvh md:flex">
      <aside className="hidden w-56 shrink-0 border-r border-line px-3 py-5 md:block">
        <div className="px-2">
          <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-ink-faint">Radar</p>
          <p className="mt-1 truncate text-sm font-medium text-ink">{workspaceName}</p>
          <ModeChip mode={mode} />
        </div>
        <nav className="mt-6 space-y-0.5">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-md px-2 py-2 text-sm text-ink-muted hover:bg-surface hover:text-ink"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-6 border-t border-line px-2 pt-4">
          <p className="text-xs text-ink-faint">Signed in as {role}</p>
          <Link href="/settings" className="mt-2 block text-sm text-ink-muted hover:text-ink">
            Settings
          </Link>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 md:hidden">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink">{workspaceName}</p>
            <ModeChip mode={mode} />
          </div>
          <Link href="/settings" className="text-sm text-ink-muted">
            Settings
          </Link>
        </header>

        {/* Bottom padding clears the fixed mobile nav and the home indicator. */}
        <main className="min-w-0 flex-1 px-4 pb-24 pt-4 md:px-6 md:pb-10">{children}</main>

        {/*
          Columns are derived from the destinations rather than hardcoded: a
          fixed count silently wraps to a second row when a destination is
          added, and the taller bar then covers the bottom of every page.
        */}
        <nav
          aria-label="Primary"
          style={{ gridTemplateColumns: `repeat(${NAV.length}, minmax(0, 1fr))` }}
          className="fixed inset-x-0 bottom-0 z-10 grid border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
        >
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cx(
                'flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-1',
                'text-center text-[0.65rem] leading-tight text-ink-muted active:text-ink',
              )}
            >
              {item.short}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}

function ModeChip({ mode }: { mode: OperatingMode }) {
  const tone =
    mode === 'autonomous' ? 'text-positive' : mode === 'ai_assisted' ? 'text-accent' : 'text-ink-faint';
  return (
    <p className={cx('mt-1 font-mono text-[0.65rem] uppercase tracking-[0.15em]', tone)}>
      {MODE_LABELS[mode]} mode
    </p>
  );
}
