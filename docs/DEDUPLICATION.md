# Deduplication

The same observation arriving twenty times is not twenty pieces of evidence. Getting this wrong
makes every downstream number wrong in the direction that flatters, which is why the counts are
displayed everywhere and the reasoning is recorded for each decision.

## Three levels

**Level 0 — raw mention.** A `signals` row. Never feeds confidence.

**Level 1 — unique evidence.** A cheapest-first cascade, stopping at the first match:

1. canonical URL
2. content hash
3. `(source_id, external_id)` — re-reading the same item from the same source is the same
   observation seen twice, recorded as `already_read`
4. 64-bit simhash within Hamming distance 3, confirmed by `pg_trgm` similarity ≥ 0.72
5. embedding cosine ≥ 0.90 **and** entity Jaccard ≥ 0.5 **and** published dates within 14 days
6. syndication and quotation detection

**Level 2 — independent sources.** Grouped by `origin_key`: the registrable domain, the upstream
domain when syndicated, collapsed further by author identity and declared affiliation. Platforms
where a subdomain belongs to a different author (Substack, Medium, `github.io`, …) count each
subdomain separately.

Every decision writes a reason code to `signal_processing_events`, so any count can be traced to
the specific comparisons that produced it.

## AI-derived evidence never counts

Evidence classed `ai_derived` cannot contribute to the independent-source count, to source
diversity, or to confidence. It is a restatement of other evidence; counting it would let the
system corroborate itself. Source diversity is computed over independent origins only.

## Known limitation

The default embedder is lexical — hashed character n-grams — so it catches spelling and phrasing
variation but not synonymy. Two posts describing the same problem in entirely different words will
be counted as two pieces of evidence unless they share entities or a URL. This is stated rather
than hidden: connecting an embedding provider improves it, and the interface labels which embedder
produced a given vector.
