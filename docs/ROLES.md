# Permissions

Four roles, named after what a person does rather than after tables.

| | Viewer | Analyst | Admin | Owner |
| --- | :-: | :-: | :-: | :-: |
| Read the workspace, signals, opportunities, capability | ● | ● | ● | ● |
| Record evidence, cluster, edit opportunities, run experiments | | ● | ● | ● |
| Configure scoring weights, sources, AI, operate the machine, read the audit log | | | ● | ● |
| Manage the workspace and its members | | | | ● |
| **Decide**: reject, commit to execution, archive | | | | ● |
| **Spend**: set budgets | | | | ● |
| Store credentials | | | ● | ● |

The two rows that matter are the last two an owner has to themselves. An admin
runs the machine; only an owner takes the decisions that commit the business.

## The system actor is not a superuser

Background work runs as `system` or `job`, and holds a deliberately narrow set:
read the workspace, read and write signals, cluster, read and write
opportunities and internal intelligence, operate jobs.

It cannot decide, cannot change a budget, and cannot touch a credential. A
compromised source therefore cannot escalate through a job — the worst it can do
is add evidence that a person will see, attributed to it.

This is why an investigation that concludes an idea is dead raises an alert and
moves the opportunity back to *watching* rather than rejecting it, and why
handing work over to be built requires a person.

## Where this is enforced

`can(ctx, permission)` in the domain, called at the top of every use-case, with
the actor context passed explicitly from the route or the job. There is no
ambient user. A test enumerates every mutating use-case and asserts each one
checks a permission and writes an audit row.
