import type { ReactNode } from 'react';

/**
 * The visual vocabulary. Radar should read as an intelligence terminal: dense
 * where density helps a decision, quiet everywhere else. Colour is reserved for
 * meaning -- state, confidence, direction of change -- and never decoration.
 */

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

export function Panel({
  children,
  className,
  as: Tag = 'section',
}: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'article' | 'aside';
}) {
  return (
    <Tag
      className={cx(
        'rounded-lg border border-line bg-surface',
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function PanelHeader({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
      <div className="min-w-0">
        <h2 className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-ink-faint">{title}</h2>
        {hint ? <p className="mt-1 text-sm text-ink-muted">{hint}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor: string }) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
      {children}
    </label>
  );
}

export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && !error ? <p className="text-xs text-ink-faint">{hint}</p> : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-negative">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const inputClass =
  'w-full rounded-md border border-line bg-ground px-3 py-2.5 text-base text-ink ' +
  'placeholder:text-ink-faint focus:border-accent focus:outline-none ' +
  // 16px minimum keeps iOS from zooming the viewport on focus.
  'text-[16px]';

export function Button({
  children,
  variant = 'primary',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
}) {
  const styles = {
    primary: 'bg-accent text-ground hover:opacity-90',
    secondary: 'border border-line bg-surface-raised text-ink hover:border-accent',
    ghost: 'text-ink-muted hover:text-ink',
    danger: 'border border-negative text-negative hover:bg-negative hover:text-ground',
  }[variant];

  return (
    <button
      {...props}
      className={cx(
        // 44px minimum target: this is used on phones one-handed.
        'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md px-4 text-sm font-medium',
        'transition-opacity disabled:cursor-not-allowed disabled:opacity-50',
        styles,
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Callout({
  tone = 'neutral',
  title,
  children,
}: {
  tone?: 'neutral' | 'positive' | 'caution' | 'negative';
  title?: string;
  children: ReactNode;
}) {
  const styles = {
    neutral: 'border-line text-ink-muted',
    positive: 'border-positive/40 text-positive',
    caution: 'border-caution/40 text-caution',
    negative: 'border-negative/40 text-negative',
  }[tone];

  return (
    <div role={tone === 'negative' ? 'alert' : undefined} className={cx('rounded-md border px-3 py-2.5 text-sm', styles)}>
      {title ? <p className="font-medium">{title}</p> : null}
      <div className={cx(title && 'mt-1', 'text-ink-muted')}>{children}</div>
    </div>
  );
}

/**
 * Every seeded row is flagged in the database, and anything derived from one
 * carries this badge. Demonstration data must never be mistakable for evidence.
 */
/**
 * Marks seeded sample data.
 *
 * Carries an accessible label rather than relying on the uppercase styling: the
 * DOM text is four characters, and "this is not real evidence" is exactly the
 * kind of thing a screen reader must not have to infer from a text transform.
 */
export function DemoBadge() {
  return (
    <span
      role="note"
      aria-label="Demonstration data, not real evidence"
      title="Demonstration data, not real evidence"
      className="rounded-sm border border-caution/50 px-1.5 py-0.5 font-mono text-[0.6rem] uppercase tracking-wider text-caution"
    >
      Demo
    </span>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      <div className="mx-auto mt-2 max-w-md text-sm text-ink-muted">{children}</div>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
