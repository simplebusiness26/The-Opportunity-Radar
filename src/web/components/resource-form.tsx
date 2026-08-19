'use client';

import { useState } from 'react';
import { Button, Callout, Field, inputClass, Panel, PanelHeader } from '../ui/primitives';

async function saveResource(
  csrfToken: string,
  input: {
    name: string;
    resourceKind: 'time' | 'budget';
    amount: number;
    unit: string;
    period: 'week' | 'month';
    committed: number;
  },
): Promise<void> {
  const response = await fetch('/api/v1/intelligence/resources', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-radar-csrf': csrfToken },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null;
    throw new Error(payload?.error?.message ?? 'Radar could not save that resource.');
  }
}

export function ResourceForm({
  csrfToken,
  currentDaysPerWeek,
  currentBudgetGbp,
}: {
  csrfToken: string;
  currentDaysPerWeek: number | null;
  currentBudgetGbp: number | null;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const daysPerWeek = Number(form.get('daysPerWeek'));
    const budgetGbp = Number(form.get('budgetGbp'));

    setPending(true);
    setError(null);

    try {
      if (!Number.isFinite(daysPerWeek) || daysPerWeek < 0 || daysPerWeek > 7) {
        throw new Error('Days available must be between 0 and 7.');
      }
      if (!Number.isFinite(budgetGbp) || budgetGbp < 0) {
        throw new Error('Monthly cash budget cannot be negative.');
      }

      await saveResource(csrfToken, {
        name: 'Owner time capacity',
        resourceKind: 'time',
        amount: daysPerWeek,
        unit: 'days',
        period: 'week',
        committed: 0,
      });
      await saveResource(csrfToken, {
        name: 'Owner cash budget',
        resourceKind: 'budget',
        amount: budgetGbp,
        unit: 'GBP',
        period: 'month',
        committed: 0,
      });

      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Radar could not save your resources.');
    } finally {
      setPending(false);
    }
  }

  return (
    <Panel>
      <PanelHeader
        title="Set current capacity"
        hint="Your real position now. Higher-budget possibilities are analysed separately."
      />
      <form onSubmit={submit} className="space-y-4 px-4 py-4">
        {error ? (
          <Callout tone="negative" title="Could not save capacity">
            {error}
          </Callout>
        ) : null}

        <Field
          id="daysPerWeek"
          label="Days available per week"
          hint="A ceiling, not a quota. Radar should use less when less is enough."
        >
          <input
            id="daysPerWeek"
            name="daysPerWeek"
            type="number"
            min="0"
            max="7"
            step="0.5"
            required
            defaultValue={currentDaysPerWeek ?? ''}
            placeholder="7"
            className={inputClass}
          />
        </Field>

        <Field
          id="budgetGbp"
          label="Current monthly cash budget (£)"
          hint="Put 0 if there is no committed cash budget right now. Radar can still show what more money would unlock."
        >
          <input
            id="budgetGbp"
            name="budgetGbp"
            type="number"
            min="0"
            step="1"
            required
            defaultValue={currentBudgetGbp ?? ''}
            placeholder="0"
            className={inputClass}
          />
        </Field>

        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save current capacity'}
        </Button>
      </form>
    </Panel>
  );
}
