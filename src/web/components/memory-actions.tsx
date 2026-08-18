'use client';

import { useState } from 'react';
import { Button, Callout } from '../ui/primitives';

/**
 * Arming a proposed trigger, and accepting a proposed link.
 *
 * Both are one click and both are explicit. Radar derives the proposals; a
 * person decides which become real, which is why a proposal that nobody armed
 * has no effect on anything.
 */
export function MemoryActions({
  opportunityId,
  proposals,
  suggestions,
  csrfToken,
}: {
  opportunityId: string;
  proposals: Array<{ kind: string; description: string; watching: string; predicate: unknown }>;
  suggestions: Array<{ opportunityId: string; title: string; suggestedKind: string }>;
  csrfToken: string;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (proposals.length === 0 && suggestions.length === 0) return null;

  async function post(path: string, body: unknown, key: string): Promise<void> {
    setPending(key);
    setError(null);

    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-radar-csrf': csrfToken },
      body: JSON.stringify(body),
    });

    if (response.ok) {
      window.location.reload();
      return;
    }

    const payload = (await response.json()) as { error?: { message: string } };
    setError(payload.error?.message ?? 'That did not work.');
    setPending(null);
  }

  return (
    <div className="space-y-3 border-t border-line px-4 py-3">
      {error ? <Callout tone="negative" title={error}>Check and try again.</Callout> : null}

      {proposals.length > 0 ? (
        <div className="space-y-2">
          <p className="font-mono text-[0.6rem] uppercase tracking-wider text-ink-faint">
            Radar suggests watching for
          </p>
          {proposals.map((proposal) => (
            <div key={proposal.kind} className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm text-ink">{proposal.description}</p>
                <p className="text-xs text-ink-muted">Watching for {proposal.watching}.</p>
              </div>
              <Button
                variant="secondary"
                disabled={pending !== null}
                onClick={() =>
                  post(
                    `/api/v1/opportunities/${opportunityId}/triggers`,
                    {
                      kind: proposal.kind,
                      description: proposal.description,
                      predicate: proposal.predicate,
                    },
                    proposal.kind,
                  )
                }
              >
                {pending === proposal.kind ? 'Arming…' : 'Arm'}
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      {suggestions.length > 0 ? (
        <div className="space-y-2 border-t border-line pt-3">
          <p className="font-mono text-[0.6rem] uppercase tracking-wider text-ink-faint">
            Link to a related opportunity
          </p>
          {suggestions.map((suggestion) => (
            <div
              key={suggestion.opportunityId}
              className="flex flex-wrap items-center justify-between gap-2"
            >
              <p className="min-w-0 truncate text-sm text-ink">{suggestion.title}</p>
              <Button
                variant="secondary"
                disabled={pending !== null}
                onClick={() =>
                  post(
                    `/api/v1/opportunities/${opportunityId}/relationships`,
                    { toOpportunityId: suggestion.opportunityId, kind: suggestion.suggestedKind },
                    suggestion.opportunityId,
                  )
                }
              >
                {pending === suggestion.opportunityId ? 'Linking…' : `Link as ${suggestion.suggestedKind.replace(/_/g, ' ')}`}
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
