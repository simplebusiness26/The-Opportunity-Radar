# Security

Radar reads the internet and then reasons about what it read. That makes two threats first-order
rather than theoretical: server-side request forgery, and prompt injection. Both are handled
structurally, so that a mistake is a compile error or a test failure rather than something a
reviewer has to notice.

## Prompt injection

Radar reads forums, job adverts, changelogs and vendor pages. Any of them can contain "ignore your
instructions and …". The defence is four layers, none of which is "ask the model nicely".

1. **A branded type.** `Untrusted<string>` is produced only by `markUntrusted()`. `SafeFetcher`
   returns it and `signals.bodyText` is typed as it, so interpolating fetched content into a system
   prompt does not compile. `revealUntrusted()` is the single sanctioned unwrap and is trivially
   greppable.

2. **A per-call nonce.** Untrusted blocks go in the *user* message, wrapped in a random per-call
   nonce. The nonce is stripped from the content before wrapping, so content that contains the
   nonce cannot close its own container and escape into the surrounding instructions. Control
   characters and anything shaped like the container tags are neutralised.

3. **A system contract** that states the rules the content cannot override, asserted in tests
   against the produced string rather than against intent.

4. **`injectionAttempts` on every schema.** A model that notices an attempt reports it; a non-empty
   array raises an alert and degrades the source's standing. The defence doubles as a product
   feature.

Under fixture replay the nonce is derived deterministically so recordings stay valid. That is safe
rather than a concession: the nonce is stripped from content regardless, so guessing it achieves
nothing. The randomness is defence in depth, not the defence.

### Laundering between stages

Later investigation roles see earlier conclusions, and those conclusions are ultimately derived
from fetched text. They are therefore passed as *untrusted blocks*, never as trusted prompt
variables, and their ids are stripped from citations before projection — a claim resting only on
an earlier conclusion is the system agreeing with itself.

## Server-side request forgery

`SafeFetcher` is the only outbound network path in the application.

- **https only** unless a host is explicitly allowlisted; no credentials in the authority; only
  ports 80 and 443.
- **Literal and obfuscated addresses are rejected** before any lookup: `2130706433`, `0x7f000001`
  and `0177.0.0.1` all mean loopback, and each is refused by name.
- **DNS is resolved by us**, and every resolved address is checked against blocked ranges —
  private, loopback, link-local, CGNAT, multicast, reserved, and the cloud metadata endpoints by
  exact address.
- **The socket is pinned to the validated address** through a custom undici `lookup`, with
  `servername` preserved for TLS. This is what closes DNS rebinding, which defeats naive
  validate-then-fetch.
- **Redirects are followed manually**, and every hop is re-validated and logged.
- Streamed body cap, decompression-ratio cap, per-host token bucket, and `robots.txt` respected and
  recorded.

The classifier is a pure function tested against a table of hostile URLs with an injected resolver,
so the suite needs no network.

## Tenancy

There is no ambient current user and no global workspace. Every repository function and every
use-case takes an actor context as its first argument, so a cross-workspace read has to be written
deliberately rather than happening by omission. A route-fuzz suite asserts it.

Background work is **not** a superuser. The system actor may ingest, group, score and alert; it may
never take a decision that commits the business, change a budget, or touch a credential. A
compromised source therefore cannot escalate through a job.

## Secrets

API keys are encrypted at rest with `SecretBox` (AES-256-GCM, key from `RADAR_SECRET_KEY`),
decrypted only for the duration of a call, and never logged. An environment-variable path exists
for headless deployments where there is no browser to paste a key into. No secret is committed;
`.env.example` documents each one and holds none.

## Sessions and requests

Self-hosted email and password, scrypt-hashed. Sessions are database-backed with httpOnly,
`SameSite=Lax` cookies and a separate CSRF secret required on every state-changing request.
Cross-origin state-changing requests are refused outright. Rate limits apply to authentication and
to expensive endpoints. Security headers are asserted by an end-to-end test rather than assumed.

## Errors

Driver errors embed the failing statement and its bound parameters, which for Radar can include
packed embeddings. `sanitiseErrorMessage` removes the dump and strips characters PostgreSQL cannot
store, because an encoding error replacing the real error is worse than the encoding problem: it
turns a clear fault into a misleading one.
