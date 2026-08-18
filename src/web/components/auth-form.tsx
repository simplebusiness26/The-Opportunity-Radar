'use client';

import { useState } from 'react';
import { Button, Callout, Field, inputClass } from '../ui/primitives';

interface FieldError {
  path: string;
  message: string;
}

/**
 * Sign-in and first-run setup share one component because they differ only in
 * which fields they collect and which endpoint they post to.
 */
export function AuthForm({
  mode,
  workspaceSuggestion,
}: {
  mode: 'sign-in' | 'setup';
  workspaceSuggestion?: string;
}) {
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [remedy, setRemedy] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);

  const errorFor = (path: string) => fieldErrors.find((e) => e.path === path)?.message;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setFormError(null);
    setRemedy(null);
    setFieldErrors([]);

    const form = new FormData(event.currentTarget);
    const payload =
      mode === 'setup'
        ? {
            email: String(form.get('email') ?? ''),
            password: String(form.get('password') ?? ''),
            displayName: String(form.get('displayName') ?? ''),
            workspaceName: String(form.get('workspaceName') ?? ''),
          }
        : {
            email: String(form.get('email') ?? ''),
            password: String(form.get('password') ?? ''),
          };

    try {
      const response = await fetch(`/api/v1/auth/${mode === 'setup' ? 'sign-up' : 'sign-in'}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const body = (await response.json()) as {
        error?: { message: string; remedy?: string; details?: FieldError[] };
      };

      if (!response.ok) {
        setFormError(body.error?.message ?? 'That did not work.');
        setRemedy(body.error?.remedy ?? null);
        if (Array.isArray(body.error?.details)) setFieldErrors(body.error.details);
        return;
      }

      window.location.assign('/');
    } catch {
      setFormError('Radar could not be reached. Check that the server is running.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {formError ? (
        <Callout tone="negative" title={formError}>
          {remedy ?? 'Check the details below and try again.'}
        </Callout>
      ) : null}

      {mode === 'setup' ? (
        <>
          <Field id="displayName" label="Your name" error={errorFor('displayName')}>
            <input
              id="displayName"
              name="displayName"
              autoComplete="name"
              required
              className={inputClass}
            />
          </Field>
          <Field
            id="workspaceName"
            label="Workspace name"
            hint="What you are running. You can change this later."
            error={errorFor('workspaceName')}
          >
            <input
              id="workspaceName"
              name="workspaceName"
              defaultValue={workspaceSuggestion}
              required
              className={inputClass}
            />
          </Field>
        </>
      ) : null}

      <Field id="email" label="Email" error={errorFor('email')}>
        <input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete={mode === 'setup' ? 'email' : 'username'}
          autoCapitalize="none"
          spellCheck={false}
          required
          className={inputClass}
        />
      </Field>

      <Field
        id="password"
        label="Password"
        hint={mode === 'setup' ? 'At least 12 characters. Length matters more than symbols.' : undefined}
        error={errorFor('password')}
      >
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
          required
          minLength={mode === 'setup' ? 12 : 1}
          className={inputClass}
        />
      </Field>

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Working…' : mode === 'setup' ? 'Create workspace' : 'Sign in'}
      </Button>
    </form>
  );
}
