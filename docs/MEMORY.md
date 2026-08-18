# Memory and the learning loop

Three mechanisms, all of which exist because the expensive failure is not
picking the wrong opportunity once — it is picking it again.

## Re-evaluation triggers

A rejection is a conclusion drawn from the evidence available at the time.
Recording what would overturn it turns the rejection into memory rather than a
dead end.

A trigger holds a predicate — signal types, evidence classes, required phrases,
excluded phrases, a minimum observed monthly spend, whether the evidence must be
able to stand as an independent source. It is evaluated deterministically
against each new signal, so a reopening always names the exact signal that
caused it.

Two rules carry most of the weight:

- **A trigger with no conditions is refused at creation.** One that matched
  everything would reopen every rejected opportunity on the first scan, and the
  failure would look like the feature working.
- **A trigger only sees evidence newer than its arming.** What came before was
  already known when the opportunity was rejected; matching it would reopen the
  opportunity on the very evidence that closed it.

When one fires: the opportunity moves to *reopened*, the transition records the
trigger and signal, the new evidence is attached, and an alert is raised. Radar
proposes triggers after a rejection — derived deterministically from why it was
rejected — but a trigger nobody armed never fires.

## Relationships

Seven kinds, deliberately few: `duplicate_of`, `supersedes`, `variant_of`,
`depends_on`, `competes_with`, `shares_capability`, `learned_from`. A rich
ontology nobody maintains is worse than a short list people use.

A duplicate does not compete for time in the portfolio; nor does a superseded
version. Radar also suggests possible links by keyword overlap and flags when a
new opportunity closely resembles one that was already rejected — *read why
before spending again*. Suggestions are never applied automatically, and the
interface always shows who asserted a link.

## Calibration

Computed from this team's own completed work: the median ratio of actual to
predicted build days, and the gap between predicted confidence and observed
success rate.

**Below eight completed projects it refuses to calibrate**, says how many more
are needed, and Radar continues with unadjusted estimates. An adjustment
computed from three projects would quietly distort every estimate afterwards.

The median rather than the mean, so one project that ran five times over does
not become the system's expectation of every project.

Predictions are read from the stored score and from the brief that was actually
handed over, never accepted from the caller reporting the outcome. A builder
reporting both the prediction and the result could make the calibration say
anything.
