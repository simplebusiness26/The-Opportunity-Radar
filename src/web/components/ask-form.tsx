'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button, Callout, Field, inputClass, Panel, PanelHeader } from '../ui/primitives';

/**
 * Asking, and reading the answer with its citations attached.
 *
 * Every claim shows the records it rests on as links, so checking a claim is
 * one click rather than an act of faith. A refusal is displayed as prominently
 * as an answer would be, because being told "the records do not say" is the
 * useful outcome when it is the true one.
 */

interface AskSource {
  id: string;
  kind: string;
  title: string;
  href: string | null;
  score: number;
}

interface AskResult {
  answered: boolean;
  refusal: string | null;
  remedy: string | null;
  summary: string | null;
  claims: Array<{ statement: string; sources: AskSource[] }>;
  suggestedNextStep: string | null;
  sources: AskSource[];
  mode: 'answered' | 'refused' | 'search_only';
  droppedClaims: number;
}

export function AskForm({ csrfToken, aiConfigured }: { csrfToken: string; aiConfigured: boolean }) {
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AskResult | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    setResult(null);

    const response = await fetch('/api/v1/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-radar-csrf': csrfToken },
      body: JSON.stringify({ question }),
    });

    if (response.ok) {
      const payload = (await response.json()) as { data?: AskResult };
      if (payload.data) setResult(payload.data);
    } else {
      const payload = (await response.json()) as { error?: { message: string } };
      setError(payload.error?.message ?? 'That did not work.');
    }

    setPending(false);
  }

  return (
    <div className="space-y-4">
      <Panel>
        <form onSubmit={submit} className="space-y-3 px-4 py-3">
          <Field id="question" label="Your question">
            <input
              id="question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              className={inputClass}
              placeholder="Why did we reject the deposit automation idea?"
              maxLength={500}
            />
          </Field>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={pending || question.trim().length < 3}>
              {pending ? 'Looking…' : 'Ask'}
            </Button>
            {!aiConfigured ? (
              <span className="text-xs text-ink-muted">
                Without an AI provider this searches your records rather than answering in prose.
              </span>
            ) : null}
          </div>
        </form>
      </Panel>

      {error ? <Callout tone="negative" title={error}>Try again.</Callout> : null}

      {result ? (
        <>
          {result.answered ? (
            <Panel>
              <PanelHeader title="Answer" hint="Every claim cites the record it came from" />
              <div className="space-y-3 px-4 py-3">
                {result.summary ? <p className="text-sm text-ink">{result.summary}</p> : null}

                <ul className="space-y-3">
                  {result.claims.map((claim, index) => (
                    <li key={index} className="border-l-2 border-line pl-3">
                      <p className="text-sm text-ink-muted">{claim.statement}</p>
                      <p className="mt-1 flex flex-wrap gap-2">
                        {claim.sources.map((source) => (
                          <SourceLink key={source.id} source={source} />
                        ))}
                      </p>
                    </li>
                  ))}
                </ul>

                {result.suggestedNextStep ? (
                  <p className="border-t border-line pt-3 text-sm text-ink">
                    <span className="text-ink-faint">Next: </span>
                    {result.suggestedNextStep}
                  </p>
                ) : null}

                {result.droppedClaims > 0 ? (
                  <p className="font-mono text-[0.65rem] text-caution">
                    {result.droppedClaims} statement(s) were discarded for citing nothing in this
                    workspace.
                  </p>
                ) : null}
              </div>
            </Panel>
          ) : (
            <Callout
              tone={result.mode === 'search_only' ? 'neutral' : 'caution'}
              title={result.refusal ?? 'No answer'}
            >
              {result.remedy}
            </Callout>
          )}

          <Panel>
            <PanelHeader
              title="Records that bear on this"
              hint={`${result.sources.length} found`}
            />
            {result.sources.length === 0 ? (
              <p className="px-4 py-4 text-sm text-ink-muted">
                Nothing in this workspace matched. Radar has no other source to draw on.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {result.sources.map((source) => (
                  <li key={source.id} className="px-4 py-2.5">
                    <SourceLink source={source} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      ) : null}
    </div>
  );
}

function SourceLink({ source }: { source: AskSource }) {
  const label = (
    <>
      <span className="font-mono text-[0.6rem] uppercase tracking-wider text-ink-faint">
        {source.kind}
      </span>{' '}
      <span className="text-sm text-ink">{source.title}</span>
    </>
  );

  return source.href ? (
    <Link href={source.href} className="hover:underline">
      {label}
    </Link>
  ) : (
    <span>{label}</span>
  );
}
