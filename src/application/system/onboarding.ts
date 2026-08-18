import { deriveMode } from '../../domain/config/mode';
import type { Repositories } from '../../ports/repositories/index';

/**
 * The first-run path, derived from what actually exists.
 *
 * Nothing here is a stored "wizard completed" flag. Each step is answered by
 * reading the data, so the checklist is always true: deleting your last
 * capability makes that step incomplete again, which is correct, and no state
 * can drift out of step with reality.
 *
 * The order is deliberate. Recording what you already have comes first, before
 * anything is connected, because that is the half of the picture nobody else
 * has -- and without it Radar ranks opportunities exactly as a stranger would.
 */

export interface OnboardingStep {
  key: string;
  title: string;
  /** Why this matters, in terms of what Radar can then do. */
  why: string;
  done: boolean;
  /** What is there now, stated as a fact rather than a percentage. */
  detail: string;
  href: string;
  /** Whether Radar is usable without it. */
  optional: boolean;
}

export interface OnboardingStatus {
  steps: OnboardingStep[];
  completed: number;
  /** The next thing worth doing, or null when the essentials are all done. */
  next: OnboardingStep | null;
  /** True once every non-optional step is done. */
  ready: boolean;
  mode: string;
}

export async function readOnboarding(
  repos: Repositories,
  workspaceId: string,
): Promise<OnboardingStatus> {
  const [capabilities, assets, resources, goals, signals, opportunities] = await Promise.all([
    repos.graph.listCapabilities(workspaceId),
    repos.graph.listAssets(workspaceId),
    repos.graph.listResources(workspaceId),
    repos.graph.listGoals(workspaceId),
    repos.signals.list(workspaceId, { limit: 1 }),
    repos.opportunities.list(workspaceId, { limit: 1 }),
  ]);

  const [providers, sources, schedules] = await Promise.all([
    repos.ai.countEnabled(workspaceId),
    repos.sources.countEnabled(workspaceId),
    repos.schedules.countEnabled(workspaceId),
  ]);

  const mode = deriveMode({
    enabledProviders: providers,
    enabledSources: sources,
    enabledSchedules: schedules,
  });

  const steps: OnboardingStep[] = [
    {
      key: 'capabilities',
      title: 'Record what you can already build',
      why: 'Until Radar knows this, every opportunity looks the same as it would to a stranger. This is what lets it tell you which one you could ship in a fortnight.',
      done: capabilities.length > 0,
      detail:
        capabilities.length > 0
          ? `${capabilities.length} capability(s) recorded.`
          : 'Nothing recorded, so fit and leverage cannot be scored at all.',
      href: '/intelligence',
      optional: false,
    },
    {
      key: 'assets',
      title: 'Record what you can reuse',
      why: 'A component you already have turns a three-month build into a three-week one, and that difference changes the ranking more than any market signal does.',
      done: assets.length > 0,
      detail:
        assets.length > 0
          ? `${assets.length} reusable asset(s) recorded.`
          : 'Nothing recorded, so every build is costed as if starting from scratch.',
      href: '/intelligence',
      optional: false,
    },
    {
      key: 'resources',
      title: 'Say what you actually have to spend',
      why: 'Allocation answers "where should the next unit of effort go". Without days and money, it has no unit to allocate.',
      done: resources.length > 0,
      detail:
        resources.length > 0
          ? `${resources.length} resource(s) recorded.`
          : 'No time or budget recorded, so nothing can be allocated.',
      href: '/intelligence',
      optional: false,
    },
    {
      key: 'goals',
      title: 'Say what the next few months are for',
      why: 'Wanting revenue quickly and wanting the largest long-term market lead to different answers. Radar cannot pick between them for you.',
      done: goals.length > 0,
      detail: goals.length > 0 ? `${goals.length} goal(s) recorded.` : 'No goals recorded.',
      href: '/intelligence',
      optional: false,
    },
    {
      key: 'evidence',
      title: 'Record some evidence',
      why: 'Radar scores what it can see. Even a handful of observations recorded by hand is enough to run the whole loop.',
      done: signals.total > 0,
      detail: signals.total > 0 ? `${signals.total} signal(s) recorded.` : 'Nothing recorded yet.',
      href: '/signals/new',
      optional: false,
    },
    {
      key: 'opportunity',
      title: 'Frame your first opportunity',
      why: 'An opportunity is the thesis the evidence is being tested against. Scoring, investigation and allocation all hang off it.',
      done: opportunities.length > 0,
      detail: opportunities.length > 0 ? 'At least one exists.' : 'None yet.',
      href: '/opportunities/new',
      optional: false,
    },
    {
      key: 'ai',
      title: 'Connect an AI provider',
      why: 'Investigation, the red team and Ask Radar need one. Everything else — evidence, dedupe, scoring, allocation — works fully without it.',
      done: providers > 0,
      detail:
        providers > 0
          ? `${providers} provider(s) connected.`
          : 'None connected. Radar runs in manual mode, which is a supported way to use it.',
      href: '/settings',
      optional: true,
    },
    {
      key: 'sources',
      title: 'Connect a source',
      why: 'Sources are what make Radar run on its own rather than being fed by hand.',
      done: sources > 0,
      detail:
        sources > 0 ? `${sources} source(s) enabled.` : 'None enabled, so nothing is collected automatically.',
      href: '/sources',
      optional: true,
    },
  ];

  const required = steps.filter((step) => !step.optional);

  return {
    steps,
    completed: steps.filter((step) => step.done).length,
    next: steps.find((step) => !step.done) ?? null,
    ready: required.every((step) => step.done),
    mode: mode.mode,
  };
}
