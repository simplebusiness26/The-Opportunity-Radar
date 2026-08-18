import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-8">
        <p className="font-mono text-[0.7rem] uppercase tracking-[0.25em] text-ink-faint">
          Opportunity Radar
        </p>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          Where should we deploy our next unit of effort for the highest expected return?
        </p>
      </div>
      {children}
    </main>
  );
}
