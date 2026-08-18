'use client';

import { useState } from 'react';
import { Button, Callout, Field, inputClass, Panel, PanelHeader } from '../ui/primitives';

const MATURITIES = [
  ['experimental', 'Experimental — a prototype exists'],
  ['working', 'Working — used in something real'],
  ['production', 'Production — running and depended on'],
  ['battle_tested', 'Battle-tested — survived real load'],
] as const;

/**
 * Records a capability.
 *
 * The wording is resolved against a shared vocabulary on the server. When it
 * will not resolve, the form says so plainly rather than accepting it silently:
 * an unrecognised capability is stored but cannot participate in leverage
 * matching, and the owner needs to know that.
 */
export function CapabilityForm({ csrfToken }: { csrfToken: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setPending(true);
    setError(null);
    setWarning(null);
    setSaved(false);

    try {
      const response = await fetch('/api/v1/intelligence/capabilities', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-radar-csrf': csrfToken },
        body: JSON.stringify({
          name: form.get('name'),
          capability: form.get('capability'),
          maturity: form.get('maturity'),
          evidenceStrength: Number(form.get('evidenceStrength') ?? 0.6),
          notes: form.get('notes') || undefined,
          providedBy: String(form.get('providedBy') ?? '')
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
        }),
      });

      const payload = (await response.json()) as {
        data?: { unresolvedWarning: string | null };
        error?: { message: string };
      };

      if (!response.ok) {
        setError(payload.error?.message ?? 'That did not work.');
        return;
      }

      setSaved(true);
      setWarning(payload.data?.unresolvedWarning ?? null);
      formElement.reset();
      if (!payload.data?.unresolvedWarning) window.location.reload();
    } catch {
      setError('Radar could not be reached.');
    } finally {
      setPending(false);
    }
  }

  return (
    <Panel>
      <PanelHeader title="Record a capability" hint="Something this team can already do." />
      <form onSubmit={submit} className="space-y-4 px-4 py-4">
        {error ? <Callout tone="negative" title={error}>Check the details and try again.</Callout> : null}
        {saved && warning ? (
          <Callout tone="caution" title="Recorded, with a caveat">
            {warning}
          </Callout>
        ) : null}

        <Field id="name" label="What is it called" hint="Your name for it, e.g. “Radar auth stack”.">
          <input id="name" name="name" required maxLength={160} className={inputClass} />
        </Field>

        <Field
          id="capability"
          label="What can it do"
          hint="Plain words — “payments”, “multi-tenant workspaces”, “LLM workflows”."
        >
          <input id="capability" name="capability" required maxLength={160} className={inputClass} />
        </Field>

        <Field id="maturity" label="How proven is it">
          <select id="maturity" name="maturity" defaultValue="working" className={inputClass}>
            {MATURITIES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>

        <Field
          id="providedBy"
          label="Which assets provide it"
          hint="Comma separated. Named back to you when Radar explains an advantage."
        >
          <input id="providedBy" name="providedBy" maxLength={500} className={inputClass} />
        </Field>

        <Field id="notes" label="Anything worth noting">
          <textarea id="notes" name="notes" rows={2} maxLength={2000} className={inputClass} />
        </Field>

        <Button type="submit" disabled={pending}>
          {pending ? 'Recording…' : 'Record capability'}
        </Button>
      </form>
    </Panel>
  );
}
