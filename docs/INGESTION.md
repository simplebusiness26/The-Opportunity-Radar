# Ingestion

Every source implements one interface, and every outbound request goes through
one fetcher. Adding a source is a file, not an exception.

## The pipeline, in order

1. **Fetch** — through `SafeFetcher` only. See `docs/SECURITY.md` for the URL,
   address, pinning and redirect rules.
2. **Parse** — the adapter turns the payload into candidate signals. It is given
   untrusted text and returns untrusted text; nothing is trusted by virtue of
   having been parsed.
3. **Classify** — signal type and evidence class, from the source's own
   semantics where it has them and from deterministic detection otherwise.
4. **Extract** — entities, monetary evidence, canonical URL, origin key, author
   identity, content hash, simhash, embedding.
5. **Deduplicate** — the cascade in `docs/DEDUPLICATION.md`.
6. **Record** — the signal, its mentions, and a processing event for every
   decision made about it.

Re-reading an item Radar has already seen is recorded as `already_read`. It is
the same observation seen twice, not new evidence, and the run reports it as
such.

## What each run reports

Items seen, items that became new evidence, and duplicates. A scan that fetches
two hundred items and learns nothing says exactly that. A source that reports
two hundred signals from two hundred items is either lying or misconfigured.

## Adapters

| Adapter | Credential | Notes |
| --- | --- | --- |
| Hacker News | none | Public Firebase API |
| RSS / Atom | none | Any feed URL; `robots.txt` respected |
| GitHub | optional PAT | 60 requests/hour without, 5,000 with |
| Reddit | client id + secret | Official OAuth API; never HTML scraping |
| Job boards | none | Only endpoints that permit automated access |

A source missing its credential reports `not_configured` — a distinct state from
`failing`. It is waiting for the owner, and the interface says so rather than
showing an error implying something is broken.

## What Radar will not do

It does not scrape sites whose terms forbid it, does not ignore `robots.txt`,
and does not exceed documented rate limits. Implementing questionable scraping
would raise the source count and lower the trustworthiness of every number
derived from it, which is the opposite of the point.

## Source health

Every fetch records its outcome, its hops and its robots decision. Repeated
injection attempts found in a source's content degrade its standing and raise an
alert. Feeding source health into confidence is listed in `ROADMAP.md`; today it
is observable but not yet weighted.

## Testing without a network

`RecordedFetcher` replays `fixtures/sources/**`. Every adapter passes the same
shared contract test against recorded payloads, so adding an adapter means
adding a fixture, not adding a mock.
