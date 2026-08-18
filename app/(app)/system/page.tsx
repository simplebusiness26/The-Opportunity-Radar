import { requireWorkspacePage } from '../../../src/web/http/context';
import { container } from '../../../src/composition/container';
import { readMachineStatus } from '../../../src/application/system/machine-status';
import { Callout, Panel, PanelHeader } from '../../../src/web/ui/primitives';

export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<string, string> = {
  complete: 'text-positive',
  running: 'text-accent',
  queued: 'text-ink-muted',
  retrying: 'text-caution',
  blocked: 'text-caution',
  failed: 'text-negative',
  cancelled: 'text-ink-faint',
};

export default async function SystemPage() {
  const { ctx } = await requireWorkspacePage('workspace.read');
  const c = container();
  const status = await readMachineStatus({ repos: c.repos, clock: c.clock }, ctx);

  const stalled =
    status.jobs.oldestRunnableAgeSeconds !== null && status.jobs.oldestRunnableAgeSeconds > 900;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-ink">Machine</h1>
        <p className="mt-1 text-sm text-ink-muted">
          What ran, what is waiting, and what is stopping it. Nothing here is estimated.
        </p>
      </div>

      <Panel>
        <PanelHeader title="Operating mode" hint={status.mode.mode.replace('_', ' ')} />
        <div className="space-y-3 px-4 py-3">
          <p className="text-sm text-ink-muted">
            The mode is derived from what is actually connected, never declared.
          </p>
          {status.missing.length > 0 ? (
            <Callout tone="caution" title="Not yet running unattended">
              <ul className="mt-1 space-y-1">
                {status.missing.map((item) => (
                  <li key={item}>· {item}</li>
                ))}
              </ul>
            </Callout>
          ) : (
            <Callout tone="positive" title="Running unattended">
              Sources, schedules and a provider are all connected.
            </Callout>
          )}
        </div>
      </Panel>

      {stalled ? (
        <Callout tone="negative" title="Work is queued but nothing is running it">
          The oldest runnable job has been waiting{' '}
          {Math.round((status.jobs.oldestRunnableAgeSeconds ?? 0) / 60)} minutes. Start the worker
          with <code className="font-mono">npm run worker</code>, or point a scheduler at{' '}
          <code className="font-mono">POST /api/v1/system/tick</code>.
        </Callout>
      ) : null}

      <Panel>
        <PanelHeader title="Queue" />
        <div className="scroll-x px-4 py-3">
          <div className="flex min-w-max gap-4">
            {Object.entries(status.jobs.counts).map(([state, count]) => (
              <div key={state}>
                <p className={`font-mono text-lg ${STATUS_TONE[state] ?? 'text-ink'}`}>{count}</p>
                <p className="font-mono text-[0.65rem] uppercase tracking-wider text-ink-faint">
                  {state}
                </p>
              </div>
            ))}
          </div>
        </div>
      </Panel>

      {status.jobs.blocked.length > 0 ? (
        <Panel>
          <PanelHeader
            title={`${status.jobs.blocked.length} held, waiting for you`}
            hint="Not failures — these resume as soon as the missing piece is connected."
          />
          <ul className="divide-y divide-line">
            {status.jobs.blocked.map((job) => (
              <li key={job.id} className="px-4 py-2.5">
                <p className="font-mono text-xs text-ink">{job.kind}</p>
                <p className="mt-1 text-sm text-ink-muted">{job.lastError}</p>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel>
        <PanelHeader title="Schedules" hint={`${status.schedules.length} configured`} />
        <ul className="divide-y divide-line">
          {status.schedules.map((schedule) => (
            <li key={schedule.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5">
              <div className="min-w-0">
                <p className="font-mono text-xs text-ink">{schedule.key}</p>
                <p className="font-mono text-[0.65rem] text-ink-faint">{schedule.cron}</p>
              </div>
              <p className="font-mono text-[0.65rem] text-ink-faint">
                {schedule.enabled ? (
                  schedule.nextDueAt ? (
                    <>next {schedule.nextDueAt.toISOString().slice(0, 16).replace('T', ' ')}</>
                  ) : (
                    'due now'
                  )
                ) : (
                  <span className="text-ink-faint">disabled</span>
                )}
              </p>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel>
        <PanelHeader title="Last 24 hours" />
        {status.throughput.length === 0 ? (
          <p className="px-4 py-3 text-sm text-ink-muted">
            No processing runs recorded. With no sources connected there is nothing to scan, which
            is the expected state rather than a fault.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {status.throughput.map((entry) => (
              <li key={entry.kind} className="px-4 py-2.5">
                <p className="font-mono text-xs text-ink">{entry.kind}</p>
                <p className="mt-1 font-mono text-[0.65rem] text-ink-faint">
                  {entry.runs} runs · {entry.itemsSeen} seen · {entry.itemsRetained} retained ·{' '}
                  {entry.duplicatesDropped} folded as duplicates
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel>
        <PanelHeader title="Recent jobs" />
        {status.jobs.recent.length === 0 ? (
          <p className="px-4 py-3 text-sm text-ink-muted">Nothing has run yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {status.jobs.recent.map((job) => (
              <li key={job.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2">
                <p className="font-mono text-xs text-ink">{job.kind}</p>
                <p className={`font-mono text-[0.65rem] ${STATUS_TONE[job.status] ?? 'text-ink-faint'}`}>
                  {job.status}
                  {job.attempts > 1 ? ` · attempt ${job.attempts}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
