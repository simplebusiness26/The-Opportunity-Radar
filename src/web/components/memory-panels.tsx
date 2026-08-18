import Link from 'next/link';
import type { RelationshipView } from '../../application/memory/relationships';
import type { RelationshipSuggestion } from '../../application/memory/relationships';
import type { TriggerRow } from '../../ports/repositories/memory';
import { Callout, Panel, PanelHeader } from '../ui/primitives';
import { StateChip } from '../ui/score';
import { MemoryActions } from './memory-actions';

/**
 * The memory: what this opportunity is related to, and what would change our
 * mind about it.
 *
 * Both are shown with who asserted them. A link Radar guessed at and a link the
 * owner stated must never look the same.
 */
export function MemoryPanels({
  opportunityId,
  relationships,
  suggestions,
  triggers,
  proposals,
  state,
  csrfToken,
}: {
  opportunityId: string;
  relationships: RelationshipView;
  suggestions: RelationshipSuggestion[];
  triggers: Array<TriggerRow & { watching: string }>;
  proposals: Array<{ kind: string; description: string; watching: string; predicate: unknown }>;
  state: string;
  csrfToken: string;
}) {
  const armedKinds = new Set(triggers.map((trigger) => trigger.kind));
  const unarmed = proposals.filter((proposal) => !armedKinds.has(proposal.kind));
  const closed = state === 'rejected' || state === 'archived';

  return (
    <>
      {relationships.suppressed ? (
        <Callout tone="caution" title="Not counted as its own line of work">
          This is {relationships.suppressionReason}, so it does not compete for time in the
          portfolio. Unlink it if that is wrong.
        </Callout>
      ) : null}

      <Panel>
        <PanelHeader
          title="Related opportunities"
          hint={relationships.related.length > 0 ? `${relationships.related.length} linked` : undefined}
        />

        {relationships.related.length === 0 ? (
          <p className="px-4 py-4 text-sm text-ink-muted">Nothing is linked to this yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {relationships.related.map((relation) => (
              <li key={relation.relationshipId} className="px-4 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[0.6rem] uppercase tracking-wider text-ink-faint">
                    {relation.label}
                  </span>
                  <StateChip state={relation.state} />
                  <span className="font-mono text-[0.6rem] text-ink-faint">
                    asserted by {relation.assertedBy}
                  </span>
                </div>
                <Link
                  href={`/opportunities/${relation.opportunityId}`}
                  className="mt-1 block text-sm text-ink hover:underline"
                >
                  #{relation.reference} {relation.title}
                </Link>
                {relation.note ? <p className="mt-1 text-xs text-ink-muted">{relation.note}</p> : null}
              </li>
            ))}
          </ul>
        )}

        {suggestions.length > 0 ? (
          <div className="border-t border-line px-4 py-3">
            <p className="font-mono text-[0.6rem] uppercase tracking-wider text-ink-faint">
              Possibly related
            </p>
            <ul className="mt-2 space-y-2">
              {suggestions.map((suggestion) => (
                <li key={suggestion.opportunityId} className="text-sm">
                  <Link
                    href={`/opportunities/${suggestion.opportunityId}`}
                    className="text-ink hover:underline"
                  >
                    #{suggestion.reference} {suggestion.title}
                  </Link>
                  <p className="text-xs text-ink-muted">{suggestion.reason}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Panel>

      <Panel>
        <PanelHeader
          title="What would change our mind"
          hint={
            triggers.length > 0
              ? `${triggers.filter((trigger) => trigger.active).length} armed`
              : 'Nothing is being watched for'
          }
        />

        {triggers.length === 0 ? (
          <p className="px-4 py-4 text-sm text-ink-muted">
            {closed
              ? 'Nothing is being watched for, so if the world changes this will simply be forgotten.'
              : 'Triggers are most useful once an opportunity has been rejected. Radar will propose them then.'}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {triggers.map((trigger) => (
              <li key={trigger.id} className="px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm text-ink">{trigger.description}</p>
                  <span className="font-mono text-[0.6rem] uppercase tracking-wider text-ink-faint">
                    {trigger.firedAt ? 'fired' : trigger.active ? 'watching' : 'off'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-ink-muted">Watching for {trigger.watching}.</p>
                <p className="mt-1 font-mono text-[0.65rem] text-ink-faint">
                  {trigger.firedAt
                    ? `Fired ${trigger.firedAt.toISOString().slice(0, 10)}`
                    : `Checked ${trigger.checkCount} time(s) without a match`}
                </p>
              </li>
            ))}
          </ul>
        )}

        <MemoryActions
          opportunityId={opportunityId}
          proposals={unarmed}
          suggestions={suggestions}
          csrfToken={csrfToken}
        />
      </Panel>
    </>
  );
}
