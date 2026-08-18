'use client';

import { useState } from 'react';
import { Button, Callout, Field, inputClass, Panel, PanelHeader } from '../ui/primitives';

const KINDS = [
  ['openai', 'OpenAI'],
  ['anthropic', 'Anthropic'],
  ['gemini', 'Google Gemini'],
  ['openai_compatible', 'OpenAI-compatible endpoint'],
] as const;

/**
 * Connects a provider.
 *
 * Prices are asked for rather than assumed. Radar will not display a cost it
 * invented, so an unpriced model simply reports its spend as unknown -- which
 * is the honest outcome, and better than a plausible wrong number.
 */
export function ProviderForm({ csrfToken }: { csrfToken: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setPending(true);
    setError(null);

    const modelKey = String(form.get('modelKey') ?? '').trim();

    try {
      const response = await fetch('/api/v1/settings/ai', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-radar-csrf': csrfToken },
        body: JSON.stringify({
          kind: form.get('kind'),
          label: form.get('label'),
          apiKey: form.get('apiKey'),
          baseUrl: form.get('baseUrl') || undefined,
          models: modelKey
            ? [
                {
                  modelKey,
                  label: modelKey,
                  inputCostPerMtok: numberOrNull(form.get('inputCost')),
                  outputCostPerMtok: numberOrNull(form.get('outputCost')),
                },
              ]
            : [],
        }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: { message: string } };
        setError(payload.error?.message ?? 'That did not work.');
        return;
      }

      formElement.reset();
      window.location.reload();
    } catch {
      setError('Radar could not be reached.');
    } finally {
      setPending(false);
    }
  }

  return (
    <Panel>
      <PanelHeader title="Connect a provider" />
      <form onSubmit={submit} className="space-y-4 px-4 py-4">
        {error ? <Callout tone="negative" title={error}>Check the details and try again.</Callout> : null}

        <Field id="kind" label="Provider">
          <select id="kind" name="kind" defaultValue="openai" className={inputClass}>
            {KINDS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>

        <Field id="label" label="Name it" hint="How it appears in routing and the ledger.">
          <input id="label" name="label" required maxLength={80} className={inputClass} />
        </Field>

        <Field
          id="apiKey"
          label="API key"
          hint="Encrypted before storage. Radar will not show it again."
        >
          <input id="apiKey" name="apiKey" type="password" required className={inputClass} />
        </Field>

        <Field id="baseUrl" label="Base URL" hint="Only for self-hosted or gateway endpoints.">
          <input id="baseUrl" name="baseUrl" type="url" className={inputClass} />
        </Field>

        <Field id="modelKey" label="A model to add" hint="For example gpt-4o-mini or claude-haiku-4-5.">
          <input id="modelKey" name="modelKey" maxLength={120} className={inputClass} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field
            id="inputCost"
            label="Input $/M tokens"
            hint="From the provider's pricing page."
          >
            <input id="inputCost" name="inputCost" type="number" step="0.01" min="0" className={inputClass} />
          </Field>
          <Field id="outputCost" label="Output $/M tokens">
            <input id="outputCost" name="outputCost" type="number" step="0.01" min="0" className={inputClass} />
          </Field>
        </div>

        <p className="text-xs text-ink-faint">
          Leave the prices blank if you do not know them. Radar will track token usage and report
          the cost as unknown rather than estimating one.
        </p>

        <Button type="submit" disabled={pending}>
          {pending ? 'Connecting…' : 'Connect provider'}
        </Button>
      </form>
    </Panel>
  );
}

function numberOrNull(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}
