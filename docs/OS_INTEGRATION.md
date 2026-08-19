# Operating System integration

Opportunity Radar is the intelligence layer in the shared stack.

Its authority stops at recommendation and handoff. It must not dispatch directly to an execution engine when the Operating System is present.

Configure Radar's execution delivery target to the Operating System endpoint:

`POST https://<operating-system-host>/api/integrations/radar/handoffs`

Send the OS Radar ingress bearer token with the request. The OS stores the original execution brief, applies approval policy, and only then creates a normalized AI Factory work order.

Execution outcomes return from AI Factory to the OS first. The OS records them as operating evidence and then forwards calibration feedback to Radar through Radar's existing execution feedback endpoint when configured.

Canonical flow:

`Radar -> Operating System -> AI Factory -> Operating System -> Radar`
