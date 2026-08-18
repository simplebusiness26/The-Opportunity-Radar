'use client';

import { useMemo, useState } from 'react';
import { Button, Callout, Field, inputClass, Panel, PanelHeader } from '../ui/primitives';
import type { SourceManifest } from '../../ports/source-adapter';

/**
 * Adds a source.
 *
 * The form is rendered from the adapter's own manifest rather than hardcoded,
 * so a new adapter gains a working configuration screen without any change
 * here -- and the hints the owner reads are the ones the adapter author wrote.
 */
export function SourceForm({
  csrfToken,
  manifests,
}: {
  csrfToken: string;
  manifests: SourceManifest[];
}) {
  const [adapterKey, setAdapterKey] = useState(manifests[0]?.adapterKey ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const manifest = useMemo(
    () => manifests.find((entry) => entry.adapterKey === adapterKey),
    [manifests, adapterKey],
  );

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setPending(true);
    setError(null);
    setWarning(null);

    const config: Record<string, string> = {};
    for (const field of manifest?.configFields ?? []) {
      const value = String(form.get(`config.${field.key}`) ?? '').trim();
      if (value) config[field.key] = value;
    }

    try {
      const response = await fetch('/api/v1/sources', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-radar-csrf': csrfToken },
        body: JSON.stringify({ adapterKey, name: form.get('name'), config }),
      });

      const payload = (await response.json()) as {
        data?: { configWarning: string | null };
        error?: { message: string };
      };

      if (!response.ok) {
        setError(payload.error?.message ?? 'That did not work.');
        return;
      }

      if (payload.data?.configWarning) {
        setWarning(payload.data.configWarning);
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
      <PanelHeader title="Add a source" />
      <form onSubmit={submit} className="space-y-4 px-4 py-4">
        {error ? <Callout tone="negative" title={error}>Check the details and try again.</Callout> : null}
        {warning ? (
          <Callout tone="caution" title="Added, but it cannot run yet">
            {warning}
          </Callout>
        ) : null}

        <Field id="adapterKey" label="Kind of source">
          <select
            id="adapterKey"
            name="adapterKey"
            value={adapterKey}
            onChange={(event) => setAdapterKey(event.target.value)}
            className={inputClass}
          >
            {manifests.map((entry) => (
              <option key={entry.adapterKey} value={entry.adapterKey}>
                {entry.name}
              </option>
            ))}
          </select>
        </Field>

        {manifest ? (
          <>
            <p className="text-sm text-ink-muted">{manifest.description}</p>
            <p className="text-xs text-ink-faint">
              {manifest.termsPolicy} {manifest.costNote}
            </p>

            <Field id="name" label="Name it" hint="How it appears in the sources list.">
              <input id="name" name="name" required maxLength={120} className={inputClass} />
            </Field>

            {manifest.configFields.map((field) => (
              <Field
                key={field.key}
                id={`config.${field.key}`}
                label={field.required ? field.label : `${field.label} (optional)`}
                hint={field.hint}
              >
                <input
                  id={`config.${field.key}`}
                  name={`config.${field.key}`}
                  type={field.secret ? 'password' : 'text'}
                  required={field.required}
                  placeholder={field.placeholder}
                  className={inputClass}
                />
              </Field>
            ))}

            {manifest.credentialsUrl ? (
              <p className="text-xs text-ink-faint">
                Credentials come from{' '}
                <a
                  href={manifest.credentialsUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-accent hover:underline"
                >
                  {new URL(manifest.credentialsUrl).host}
                </a>
                .
              </p>
            ) : null}
          </>
        ) : null}

        <Button type="submit" disabled={pending}>
          {pending ? 'Adding…' : 'Add source'}
        </Button>
      </form>
    </Panel>
  );
}
