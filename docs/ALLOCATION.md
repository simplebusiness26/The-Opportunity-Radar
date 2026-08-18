# Allocation

The question the product exists to answer is *where should the next unit of
effort go*, and this is the part that answers it.

## Expected value

```
expectedValue   = attractiveness × confidence × fit
returnPerDay    = expectedValue ÷ estimated days
```

Confidence is a **multiplier**, not a weight inside attractiveness. A thrilling
opportunity nobody has corroborated is worth less than a good one that is well
evidenced, and this is where that judgement is made — visibly, in one line of
arithmetic, rather than buried in a composite.

Days come from the leveraged build estimate, which is a range. Allocation uses
the pessimistic end, because a plan built on the optimistic end is not a plan.

## The policy

```
minimumReturnPerDay      = 4
minimumConfidenceToBuild = 0.5
```

Below the confidence floor an opportunity cannot be allocated build effort at
all, however attractive it looks. It can be allocated *validation* effort, which
is cheaper and is the correct response to not knowing.

Below the return floor nothing is recommended. That is what produces:

```
NO HIGH-CONFIDENCE OPPORTUNITY CURRENTLY WARRANTS ACTION
```

rendered exactly like that, alongside the cheapest actions that would resolve
the most uncertainty — ranked by value of information, not by what is easiest to
do.

## What is excluded

- Opportunities suppressed by a relationship: a duplicate does not compete with
  the thing it duplicates, and a superseded version does not compete with the
  version that superseded it. Otherwise the same idea claims the same days
  twice.
- Opportunities in terminal states.
- Anything whose required resources do not exist. If no time is recorded,
  allocation says it has no unit to allocate rather than inventing one.

## The rationale

Every ranked entry carries a sentence naming what produced it: the specific
reusable assets, the specific gap, the days available against the days needed.
"Ranked first" with no reason is a horoscope.

## Scenarios

Parameter sweeps, not simulation. Change the available days or the budget and
see how the ranking changes. Radar does not run Monte Carlo over distributions
nobody has estimated — that would produce confident-looking numbers from
invented inputs. See `ROADMAP.md`.
