# Connections required

Radar runs with **no credentials at all**. Everything in this file is optional
and adds capability; nothing here is needed to record evidence, deduplicate it,
score opportunities, allocate effort, or produce the daily brief.

Each entry states the exact credential, where to get it, where to put it, how to
test it, roughly what it costs, and what Radar does without it.

---

## 1. An AI provider — *optional*

**Adds:** investigation, the red team, uncertainty analysis, validation design,
Ask Radar answering in prose.

**Without it:** Radar runs in MANUAL mode. Every one of those features renders a
specific "unavailable because no provider is connected" state. Ask Radar
degrades to search over your own records, clearly labelled as search.

| | |
| --- | --- |
| **Credential** | An API key from one of: OpenAI, Anthropic, Google (Gemini), or any OpenAI-compatible endpoint |
| **Where to get it** | OpenAI: platform.openai.com → API keys. Anthropic: console.anthropic.com → API keys. Google: aistudio.google.com → Get API key |
| **Where to enter it** | Settings → AI. Stored encrypted with `RADAR_SECRET_KEY`, never logged. For headless deployments set `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` or `GEMINI_API_KEY` instead |
| **How to test it** | Settings → AI shows a health check per provider. Then open an opportunity with enough evidence and press **Investigate**; the run appears in the investigation log with its cost |
| **Cost** | Set by you. Configure model prices in Settings → AI (Radar ships no guesses) and set a monthly budget. A full six-role investigation is capped at about $3.50 by the per-role ceilings. Typical spend depends entirely on how many opportunities clear the depth gate |
| **Also do** | Set a monthly budget *before* connecting. The degradation ladder is only meaningful against a limit that exists |

---

## 2. Sources — *optional, several are credential-free*

**Adds:** Radar collecting evidence on its own rather than being fed by hand.
With a provider *and* a source *and* a schedule, it reaches AUTONOMOUS mode.

**Without any:** you record evidence through Signals → Record evidence. The
entire loop works this way; it is simply manual.

### 2a. Hacker News — **no credential**

| | |
| --- | --- |
| **Credential** | None. The Firebase API is public |
| **Where to enter it** | Sources → Add source → Hacker News, then a query |
| **How to test it** | Press **Scan now**; the source card shows items seen, new evidence and duplicates |
| **Cost** | Free |
| **Terms** | Public API, no key. Radar identifies itself and rate-limits itself |

### 2b. RSS / Atom — **no credential**

| | |
| --- | --- |
| **Credential** | None. Just the feed URL |
| **Where to enter it** | Sources → Add source → RSS |
| **How to test it** | **Scan now** |
| **Cost** | Free |
| **Terms** | `robots.txt` is fetched and respected, and the decision is recorded per fetch |

### 2c. GitHub — *optional token*

| | |
| --- | --- |
| **Credential** | A fine-grained personal access token with **public read** scope only |
| **Where to get it** | github.com → Settings → Developer settings → Personal access tokens |
| **Where to enter it** | Sources → Add source → GitHub |
| **How to test it** | **Scan now**. Without a token you get 60 requests/hour; with one, 5,000 |
| **Cost** | Free |
| **Not built** | The GitHub *App* install flow. The connector and PAT paths are complete; see `ROADMAP.md` |

### 2d. Reddit — *credential required*

| | |
| --- | --- |
| **Credential** | A script-type app: client id and client secret |
| **Where to get it** | reddit.com/prefs/apps → create app → type "script" |
| **Where to enter it** | Sources → Add source → Reddit |
| **How to test it** | **Scan now**. The source reports `not_configured` rather than failing until both values are present |
| **Cost** | Free within the published rate limits |
| **Terms** | Radar uses the official OAuth API. It does not scrape HTML, and it does not exceed the documented limits |

### 2e. Job boards — **no credential**

| | |
| --- | --- |
| **Credential** | None for the feeds Radar supports |
| **Where to enter it** | Sources → Add source → Job board |
| **Cost** | Free |
| **Terms** | Only endpoints that permit automated access are used. Radar deliberately does not implement scraping that a site's terms forbid, even though it would raise the source count |

---

## 3. A delivery target for handoffs — *optional*

**Adds:** an Execution Brief being POSTed to your build system when you hand
work over.

**Without it:** the brief is exported as Markdown and you send it yourself.
That is a complete outcome, not a degraded one.

| | |
| --- | --- |
| **Credential** | An https URL, and optionally a bearer token the receiving system expects |
| **Where to enter it** | Settings → Execution, or `POST /api/v1/settings/factory` |
| **How to test it** | Hand over an opportunity; the handoff row shows `delivered` or the exact failure |
| **Cost** | None from Radar |
| **Note** | The URL goes through the same SSRF rules as every other outbound request. A private or link-local address will be refused |

---

## 4. Execution feedback — *optional*

**Adds:** whoever built the work reporting the outcome back, which is what
calibration learns from.

**Without it:** record outcomes yourself under Our capability → Calibration.

| | |
| --- | --- |
| **Credential** | `RADAR_FEEDBACK_TOKEN` — any value of 16+ characters that you generate and give to the receiving system |
| **Where to enter it** | Environment variable on the server |
| **How to test it** | `curl -X POST https://your-host/api/v1/execution/feedback -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"handoffId":"…","status":"completed","outcome":"shipped_and_used","actualBuildDays":18}'` |
| **Cost** | None |
| **Note** | With no token set the endpoint is disabled outright rather than left open |

---

## 5. Scheduler token — *required only for serverless deployment*

| | |
| --- | --- |
| **Credential** | `RADAR_TICK_TOKEN` — 16+ characters that you generate |
| **Where to enter it** | Environment variable, and in your cron job's Authorization header |
| **How to test it** | `curl -X POST https://your-host/api/v1/system/tick -H "Authorization: Bearer $TOKEN"` returns what ran |
| **Cost** | None |
| **Not needed if** | You run `npm run worker` as a long-running process |

---

## Not built, and why

Email and Slack notification *delivery* are not implemented. Alerts are raised
and shown in the interface; delivering them would need credentials nobody has
supplied and an integration nobody has tested, and a half-built notifier that
silently drops alerts is worse than none. See `ROADMAP.md`.
