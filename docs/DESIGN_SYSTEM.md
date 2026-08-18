# Interface

Radar is a decision instrument, not a dashboard. The design follows from that.

## Principles

**Every number carries its provenance.** A score shows its dimensions; a
dimension shows what produced it; a claim shows the evidence it cites. Anything
that cannot be traced is not shown.

**Gaps are as visible as findings.** "What has not been established" appears
next to the score, not behind a tab. A dashed bar means *nothing established
this*, and it is visually distinct from a low value.

**Refusals are rendered like answers.** `NO HIGH-CONFIDENCE OPPORTUNITY
CURRENTLY WARRANTS ACTION` is displayed as prominently as a recommendation would
be. Being told there is nothing worth doing is the useful outcome when it is the
true one.

**Nothing is fake.** No skeleton screens standing in for data that will never
arrive, no zeros dressed as metrics, no eternal spinner. A feature that needs a
provider says so, in a sentence, with what to do about it.

**DEMO is unmistakable.** Any seeded object carries a badge wherever it appears.

## Mobile-first

The interface is built for a phone and scales up. Five primary destinations in
the bottom navigation, the rest behind *More*; the count is capped and asserted
by an end-to-end test, because a sixth item once wrapped the bar onto two rows
and covered the page content.

The page never scrolls sideways. Wide content — tables, long claims — scrolls
inside its own container. There is a test for that too.

## PWA

Installable, with a manifest, icons, and a shell-only service worker. The
offline page says what is unavailable rather than pretending to have cached
data it does not have.

## Type and colour

A single type scale, tabular numerals for anything comparable, and a monospace
face for identifiers, counts and timestamps — the things you scan rather than
read.

Colour carries exactly four meanings: positive, caution, negative, and neutral.
Nothing else is coloured, so the colours that appear mean something.

## Vocabulary

The interface uses the product's words, not the database's: *problems* rather
than clusters, *our capability* rather than the intelligence graph, *the
machine* rather than the job queue. The one place jargon survives is where it is
load-bearing and worth teaching: `mentions · unique evidence · independent
sources`.
