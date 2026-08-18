# The execution boundary

Radar decides what deserves the next unit of effort. Something else builds it.
The Execution Brief is what crosses that line, and the loop is not closed until
an outcome comes back.

## The brief

Assembled entirely from stored records. Nothing in it is generated prose, which
is why the same document can be read by a person, pasted into a ticket, and
posted to an API and mean the same thing.

The order is chosen so that what is unproven appears before what is promising:

1. The readiness verdict, at the top, before anything encouraging.
2. The thesis, customer and problem.
3. **What the evidence actually is** — the three counts, with AI-derived
   mentions called out as counting toward none of them.
4. Strongest supporting evidence, then evidence against.
5. What is not known: critical unknowns, then assumptions, then what is
   established.
6. The case against — the red team's surviving objections, each with what would
   settle it. Objections that cited nothing are excluded: the brief is a
   document of record.
7. What it would take to build, with reuse named and the estimate given as a
   **range**.
8. What was tested, against which thresholds, and what happened.
9. **Do not build yet.** When nothing has been ruled out it says so, because
   unbounded scope is a risk in itself.
10. What would change this decision — the armed re-evaluation triggers.

## Readiness

`assessReadiness` refuses when: nothing has been independently corroborated;
confidence is under 50%; a fatal objection stands unanswered; no experiment has
produced a result; an experiment came back negative; or every experiment was
inconclusive. An inconclusive result is never treated as a pass.

A brief for an unready opportunity is still produced — it is useful for review —
but it says `NOT READY TO BUILD` at the top and the handoff is refused.

## Handing over

Committing work to be built requires an owner. Radar will say plainly that
something is not ready; it will not stop its owner from overruling that, and the
overrule is recorded in the decision log against the reason Radar gave.

The brief is **snapshotted** onto the handoff rather than referenced, so what the
builder was actually given survives every later edit to the opportunity. A test
renames the opportunity afterwards and asserts the stored brief is unchanged.

Delivery, when a target is configured, goes through the same `SafeFetcher` as
everything else — a configured URL is not a reason to relax the SSRF rules, and
a target that would not survive them is treated as absent.

## Feedback

`POST /api/v1/execution/feedback`, bearer-token authenticated and disabled
outright when no token is set. The workspace is derived from the handoff, not
supplied by the caller: a token holder can close the loop on work that was sent
to them and on nothing else.

The predicted figures come from the stored score and from the brief that was
handed over, never from the caller. A builder reporting both the prediction and
the outcome could make the calibration say anything.

An outcome written back becomes execution history, which is what
`docs/MEMORY.md` calibrates against — and calibration still refuses until there
are eight of them.
