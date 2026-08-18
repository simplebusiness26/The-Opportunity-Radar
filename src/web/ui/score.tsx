import { describeConfidenceBand } from '../../domain/scoring/confidence';
import { cx } from './primitives';

/**
 * Score presentation.
 *
 * The one thing this must never do is blend a score with its confidence into a
 * single reassuring number. They are shown side by side, always, because
 * "excellent and unproven" is a real and common state that the owner has to be
 * able to see at a glance.
 */

export function ScorePair({
  attractiveness,
  confidence,
  size = 'normal',
}: {
  attractiveness: number | null;
  confidence: number;
  size?: 'normal' | 'large';
}) {
  const band = describeConfidenceBand(confidence);
  return (
    <div className="flex items-baseline gap-4">
      <div>
        <p className={cx('font-mono tabular-nums text-ink', size === 'large' ? 'text-4xl' : 'text-2xl')}>
          {attractiveness ?? '—'}
        </p>
        <p className="font-mono text-[0.6rem] uppercase tracking-[0.15em] text-ink-faint">Score</p>
      </div>
      <div>
        <p
          className={cx(
            'font-mono tabular-nums',
            size === 'large' ? 'text-4xl' : 'text-2xl',
            confidenceTone(confidence),
          )}
        >
          {Math.round(confidence * 100)}%
        </p>
        <p className="font-mono text-[0.6rem] uppercase tracking-[0.15em] text-ink-faint">
          Confidence · {band.label}
        </p>
      </div>
    </div>
  );
}

export function confidenceTone(confidence: number): string {
  if (confidence < 0.2) return 'text-negative';
  if (confidence < 0.45) return 'text-caution';
  if (confidence < 0.7) return 'text-ink';
  return 'text-positive';
}

/**
 * The three counts, shown together everywhere they appear. Keeping them
 * adjacent is what stops volume being mistaken for corroboration.
 */
export function EvidenceCounts({
  mentions,
  unique,
  independent,
}: {
  mentions: number;
  unique: number;
  independent: number;
}) {
  return (
    <p className="font-mono text-xs text-ink-muted">
      <span className="text-ink-faint">{mentions}</span> mentions
      <span className="mx-1.5 text-line">·</span>
      <span className="text-ink-muted">{unique}</span> unique evidence
      <span className="mx-1.5 text-line">·</span>
      <span className={independent === 0 ? 'text-negative' : 'text-ink'}>{independent}</span>{' '}
      independent {independent === 1 ? 'source' : 'sources'}
    </p>
  );
}

export function DeltaBadge({ delta }: { delta: number }) {
  if (delta === 0) return null;
  const positive = delta > 0;
  return (
    <span
      className={cx(
        'font-mono text-xs tabular-nums',
        positive ? 'text-positive' : 'text-negative',
      )}
    >
      {positive ? '+' : ''}
      {Math.round(delta)}
    </span>
  );
}

export function StateChip({ state }: { state: string }) {
  const tone =
    state === 'rejected' || state === 'archived'
      ? 'border-negative/40 text-negative'
      : state === 'execution' || state === 'validated'
        ? 'border-positive/40 text-positive'
        : state === 'validating' || state === 'investigating'
          ? 'border-accent/40 text-accent'
          : 'border-line text-ink-muted';

  return (
    <span className={cx('rounded-sm border px-1.5 py-0.5 font-mono text-[0.6rem] uppercase tracking-wider', tone)}>
      {state.replace(/_/g, ' ')}
    </span>
  );
}

/**
 * A bar that distinguishes "measured and low" from "not measured". Rendering an
 * unmeasured dimension as an empty bar would read as a bad score.
 */
export function DimensionBar({
  value,
  status,
}: {
  value: number | null;
  status: 'ok' | 'insufficient_evidence' | 'not_applicable';
}) {
  if (status !== 'ok' || value === null) {
    return (
      <div className="h-1.5 w-full rounded-full border border-dashed border-line" title="Not established" />
    );
  }
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-ground">
      <div
        className="h-full rounded-full bg-accent"
        style={{ width: `${Math.round(value * 100)}%` }}
      />
    </div>
  );
}
