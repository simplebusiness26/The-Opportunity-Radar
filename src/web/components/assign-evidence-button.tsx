'use client';

import { useState } from 'react';
import { Button } from '../ui/primitives';

/**
 * Runs the grouping pass over evidence that is not yet in a problem.
 *
 * The result is reported literally, including how much stayed unassigned,
 * because "nothing matched" is a real and useful answer rather than a failure
 * to hide.
 */
export function AssignEvidenceButton({
  pending,
  csrfToken,
}: {
  pending: number;
  csrfToken: string;
}) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setResult(null);
    try {
      const response = await fetch('/api/v1/clusters/assign', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-radar-csrf': csrfToken },
        body: JSON.stringify({}),
      });
      const payload = (await response.json()) as {
        data?: { assigned: number; unassigned: number };
        error?: { message: string };
      };

      if (!response.ok) {
        setResult(payload.error?.message ?? 'That did not work.');
        return;
      }

      const assigned = payload.data?.assigned ?? 0;
      const unassigned = payload.data?.unassigned ?? 0;
      setResult(
        assigned === 0
          ? `Nothing matched an existing problem. ${unassigned} left unassigned.`
          : `Grouped ${assigned}. ${unassigned} still unassigned.`,
      );
      if (assigned > 0) window.location.reload();
    } finally {
      setRunning(false);
    }
  }

  if (pending === 0) return null;

  return (
    <div className="text-right">
      <Button variant="secondary" onClick={run} disabled={running}>
        {running ? 'Grouping…' : `Group ${pending} loose ${pending === 1 ? 'piece' : 'pieces'}`}
      </Button>
      {result ? <p className="mt-1.5 text-xs text-ink-muted">{result}</p> : null}
    </div>
  );
}
