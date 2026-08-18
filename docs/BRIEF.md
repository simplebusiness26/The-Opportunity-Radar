# The daily brief

Every morning Radar writes what changed and why. **It needs no AI at all** —
the brief is a query over `score_deltas`, which is the point.

## What it contains

**What changed.** Opportunities whose scores moved, each with the composite that
moved and the dimensions that drove it, computed by diffing dimension
contributions. Not "attractiveness rose"; *"attractiveness rose because two more
independent sources corroborated the spending evidence"*.

**What was learned.** New evidence, folded duplicates, clusters that grew or
went quiet. The three counts, so growth in mentions is never mistaken for growth
in evidence.

**What is waiting for you.** Investigations that stopped and what they need,
opportunities recommended for rejection, triggers that fired, experiments due a
verdict.

**The best move.** The top allocation with its rationale — or the sentence that
says nothing warrants action, with the cheapest actions that would resolve the
most uncertainty.

## On a quiet day it says so

A brief that manufactures a narrative from a day when nothing happened teaches
you to stop reading it. When nothing moved, the brief says nothing moved, and
lists what it checked.

## Why no model writes it

Three reasons, in order of weight:

1. **It would be unfalsifiable.** A generated paragraph reads as insight whether
   or not the underlying numbers moved. A diff cannot.
2. **It would cost money every morning** for prose that adds nothing to a table.
3. **It would break at a hard budget stop**, which is precisely when you most
   want to know what is going on.

`score_deltas.top_drivers` exists so this is a query rather than a summary.

## Changes since last visit

Separate from the brief, and computed per person: what has changed since *you*
last looked, so someone returning after a week is not shown the same list as
someone who was here an hour ago.
