'use client';

import { useState } from 'react';
import { OPPORTUNITY_TYPES, OPPORTUNITY_TYPE_KEYS } from '../../domain/taxonomy/opportunity-types';
import { Button, Callout, Field, inputClass } from '../ui/primitives';

export function OpportunityForm({ csrfToken }: { csrfToken: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typeKey, setTypeKey] = useState<string>('new_product');

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/v1/opportunities', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-radar-csrf': csrfToken },
        body: JSON.stringify({
          title: form.get('title'),
          thesis: form.get('thesis'),
          typeKey,
          targetCustomer: form.get('targetCustomer') || undefined,
          problemStatement: form.get('problemStatement') || undefined,
          whyNow: form.get('whyNow') || undefined,
        }),
      });

      const body = (await response.json()) as {
        data?: { opportunity: { id: string } };
        error?: { message: string; details?: Array<{ path: string; message: string }> };
      };

      if (!response.ok) {
        setError(
          body.error?.details?.map((d) => `${d.path}: ${d.message}`).join('; ') ??
            body.error?.message ??
            'That did not work.',
        );
        return;
      }

      window.location.assign(`/opportunities/${body.data!.opportunity.id}`);
    } catch {
      setError('Radar could not be reached.');
    } finally {
      setPending(false);
    }
  }

  const type = OPPORTUNITY_TYPES[typeKey as keyof typeof OPPORTUNITY_TYPES];

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {error ? <Callout tone="negative" title="Could not create this">{error}</Callout> : null}

      <Field id="title" label="Title">
        <input id="title" name="title" required maxLength={200} className={inputClass} />
      </Field>

      <Field
        id="thesis"
        label="Thesis"
        hint="What you believe, and why. State it so that it could turn out to be wrong."
      >
        <textarea id="thesis" name="thesis" required rows={4} className={inputClass} />
      </Field>

      <Field
        id="typeKey"
        label="What kind of move is this?"
        hint={type?.description}
      >
        <select
          id="typeKey"
          name="typeKey"
          value={typeKey}
          onChange={(event) => setTypeKey(event.target.value)}
          className={inputClass}
        >
          {OPPORTUNITY_TYPE_KEYS.map((key) => (
            <option key={key} value={key}>
              {OPPORTUNITY_TYPES[key].label}
            </option>
          ))}
        </select>
      </Field>

      <Field id="targetCustomer" label="Who specifically" hint="A vague customer is a warning sign.">
        <input id="targetCustomer" name="targetCustomer" maxLength={300} className={inputClass} />
      </Field>

      <Field id="problemStatement" label="The problem, in their words">
        <textarea id="problemStatement" name="problemStatement" rows={3} className={inputClass} />
      </Field>

      <Field id="whyNow" label="Why now" hint="What changed. If nothing changed, that is worth knowing too.">
        <textarea id="whyNow" name="whyNow" rows={3} className={inputClass} />
      </Field>

      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? 'Creating…' : 'Create opportunity'}
      </Button>
    </form>
  );
}
