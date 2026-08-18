'use client';

import { useState } from 'react';
import { SIGNAL_TYPES, SIGNAL_TYPE_KEYS } from '../../domain/taxonomy/signal-types';
import { EVIDENCE_CLASSES, EVIDENCE_CLASS_KEYS } from '../../domain/taxonomy/evidence-class';
import { Button, Callout, Field, inputClass } from '../ui/primitives';

/**
 * Recording evidence by hand.
 *
 * The two classification questions carry their real definitions inline, because
 * whether something is a complaint or a receipt, and whether it came from a
 * customer or a model, determines how much weight it can ever carry.
 */
export function SignalForm({ csrfToken }: { csrfToken: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ outcome: string; explanation: string } | null>(null);
  const [signalType, setSignalType] = useState<string>('pain');
  const [evidenceClass, setEvidenceClass] = useState<string>('community');

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setResult(null);

    // Captured before the first await: React clears `currentTarget` once the
    // handler yields, so reaching for it afterwards throws and the failure
    // surfaces to the user as a false "could not be reached" error.
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const monthly = form.get('monthlyAmount');

    try {
      const response = await fetch('/api/v1/signals', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-radar-csrf': csrfToken },
        body: JSON.stringify({
          title: form.get('title'),
          bodyText: form.get('bodyText'),
          url: form.get('url') || undefined,
          sourceLabel: form.get('sourceLabel') || undefined,
          signalTypeKey: signalType,
          evidenceClass,
          painPoint: form.get('painPoint') || undefined,
          segment: form.get('segment') || undefined,
          monetaryEvidence: monthly ? { monthlyAmount: Number(monthly) } : undefined,
        }),
      });

      const body = (await response.json()) as {
        data?: { outcome: string; explanation: string };
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

      setResult(body.data ?? null);
      formElement.reset();
    } catch {
      setError('Radar could not be reached.');
    } finally {
      setPending(false);
    }
  }

  const type = SIGNAL_TYPES[signalType as keyof typeof SIGNAL_TYPES];
  const evidence = EVIDENCE_CLASSES[evidenceClass as keyof typeof EVIDENCE_CLASSES];

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {error ? <Callout tone="negative" title="Could not record this">{error}</Callout> : null}
      {result ? (
        <Callout
          tone={result.outcome === 'new_evidence' ? 'positive' : 'caution'}
          title={result.outcome === 'new_evidence' ? 'Recorded as new evidence' : 'Matched existing evidence'}
        >
          {result.explanation}
        </Callout>
      ) : null}

      <Field id="title" label="What was observed" hint="A short description you would recognise later.">
        <input id="title" name="title" required maxLength={300} className={inputClass} />
      </Field>

      <Field
        id="bodyText"
        label="The evidence itself"
        hint="Paste what was actually said or written. This is what Radar compares against everything else."
      >
        <textarea id="bodyText" name="bodyText" required rows={6} className={inputClass} />
      </Field>

      <Field id="signalTypeKey" label="What kind of signal is this?" hint={type?.example}>
        <select
          id="signalTypeKey"
          name="signalTypeKey"
          value={signalType}
          onChange={(event) => setSignalType(event.target.value)}
          className={inputClass}
        >
          {SIGNAL_TYPE_KEYS.map((key) => (
            <option key={key} value={key}>
              {SIGNAL_TYPES[key].label} — {SIGNAL_TYPES[key].description}
            </option>
          ))}
        </select>
      </Field>

      <Field
        id="evidenceClass"
        label="Where did it come from?"
        hint={evidence?.description}
      >
        <select
          id="evidenceClass"
          name="evidenceClass"
          value={evidenceClass}
          onChange={(event) => setEvidenceClass(event.target.value)}
          className={inputClass}
        >
          {EVIDENCE_CLASS_KEYS.map((key) => (
            <option key={key} value={key}>
              {EVIDENCE_CLASSES[key].label}
            </option>
          ))}
        </select>
      </Field>

      <Field
        id="url"
        label="Link"
        hint="Optional. Used to recognise the same item arriving again from somewhere else."
      >
        <input id="url" name="url" type="url" inputMode="url" className={inputClass} />
      </Field>

      <Field
        id="sourceLabel"
        label="Who this came from"
        hint="Only needed when there is no link. Two entries naming the same source count as one source."
      >
        <input id="sourceLabel" name="sourceLabel" maxLength={200} className={inputClass} />
      </Field>

      <Field id="segment" label="Who has this problem" hint="Optional. e.g. independent restaurants.">
        <input id="segment" name="segment" maxLength={200} className={inputClass} />
      </Field>

      <Field
        id="monthlyAmount"
        label="Amount they pay per month"
        hint="Only if a specific figure was mentioned. Evidence that money changes hands is worth far more than a complaint."
      >
        <input
          id="monthlyAmount"
          name="monthlyAmount"
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          className={inputClass}
        />
      </Field>

      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? 'Recording…' : 'Record evidence'}
      </Button>
    </form>
  );
}
