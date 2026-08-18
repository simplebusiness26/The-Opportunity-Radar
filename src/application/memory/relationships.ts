import { z } from 'zod';
import {
  RELATIONSHIP_KEYS,
  RELATIONSHIP_KINDS,
  isSuppressedBy,
  keywordsFor,
  type RelationshipKind,
} from '../../domain/memory/relationships';
import { errors } from '../../domain/types/errors';
import { actorKind, actorUserId, type ActorCtx } from '../../domain/types/identity';
import { can } from '../../domain/types/permissions';
import type { Repositories } from '../../ports/repositories/index';
import type { MemoryDeps } from './triggers';

/**
 * Linking opportunities to each other.
 *
 * The links are asserted by people or proposed by deterministic matching, and
 * the interface always shows which. A relationship Radar guessed at and a
 * relationship the owner stated must never be indistinguishable.
 */

export const linkInput = z.object({
  toOpportunityId: z.string().uuid(),
  kind: z.enum(RELATIONSHIP_KEYS as [RelationshipKind, ...RelationshipKind[]]),
  note: z.string().trim().max(1000).nullable().optional(),
});

export async function linkOpportunities(
  deps: MemoryDeps,
  ctx: ActorCtx,
  fromOpportunityId: string,
  input: z.infer<typeof linkInput>,
): Promise<void> {
  if (!can(ctx, 'opportunities.write')) {
    throw errors.forbidden('opportunities.write_denied', 'Your role cannot link opportunities.');
  }
  const parsed = linkInput.parse(input);

  if (parsed.toOpportunityId === fromOpportunityId) {
    throw errors.preconditionFailed(
      'relationship.self',
      'An opportunity cannot be related to itself.',
      'Choose a different opportunity.',
    );
  }

  const [from, to] = await Promise.all([
    deps.repos.opportunities.findById(ctx.workspaceId, fromOpportunityId),
    deps.repos.opportunities.findById(ctx.workspaceId, parsed.toOpportunityId),
  ]);
  if (!from || !to) throw errors.notFound('Opportunity');

  await deps.repos.relationships.link(ctx.workspaceId, {
    fromOpportunityId,
    toOpportunityId: parsed.toOpportunityId,
    kind: parsed.kind,
    note: parsed.note ?? null,
    assertedBy: actorKind(ctx),
    createdByUserId: actorUserId(ctx),
  });

  // Symmetric kinds are stored both ways, so neither page has to know it is
  // the far end of somebody else's link.
  if (RELATIONSHIP_KINDS[parsed.kind].symmetric) {
    await deps.repos.relationships.link(ctx.workspaceId, {
      fromOpportunityId: parsed.toOpportunityId,
      toOpportunityId: fromOpportunityId,
      kind: parsed.kind,
      note: parsed.note ?? null,
      assertedBy: actorKind(ctx),
      createdByUserId: actorUserId(ctx),
    });
  }

  await deps.repos.audit.record(ctx, {
    action: 'opportunity.linked',
    entityType: 'opportunity',
    entityId: fromOpportunityId,
    after: { kind: parsed.kind, to: parsed.toOpportunityId },
  });
}

export async function unlinkOpportunities(
  deps: MemoryDeps,
  ctx: ActorCtx,
  relationshipId: string,
): Promise<void> {
  if (!can(ctx, 'opportunities.write')) {
    throw errors.forbidden('opportunities.write_denied', 'Your role cannot change links.');
  }
  await deps.repos.relationships.unlink(ctx.workspaceId, relationshipId);
}

export interface RelatedOpportunity {
  relationshipId: string;
  kind: RelationshipKind;
  label: string;
  meaning: string;
  direction: 'from' | 'to';
  assertedBy: string;
  note: string | null;
  opportunityId: string;
  title: string;
  reference: number;
  state: string;
}

export interface RelationshipView {
  related: RelatedOpportunity[];
  /** Whether this should be worked on as its own line of work. */
  suppressed: boolean;
  suppressionReason: string | null;
}

export async function readRelationships(
  repos: Repositories,
  ctx: ActorCtx,
  opportunityId: string,
): Promise<RelationshipView> {
  if (!can(ctx, 'opportunities.read')) throw errors.forbidden('opportunities.read');

  const rows = await repos.relationships.listFor(ctx.workspaceId, opportunityId);

  const related = rows.map((row) => {
    const definition = RELATIONSHIP_KINDS[row.kind];
    return {
      relationshipId: row.id,
      kind: row.kind,
      label: row.direction === 'from' ? definition.label : definition.inverseLabel,
      meaning: definition.meaning,
      direction: row.direction,
      assertedBy: row.assertedBy,
      note: row.note,
      opportunityId: row.direction === 'from' ? row.toOpportunityId : row.fromOpportunityId,
      title: row.otherTitle,
      reference: row.otherReference,
      state: row.otherState,
    };
  });

  const suppression = isSuppressedBy(
    rows.map((row) => ({ kind: row.kind, direction: row.direction })),
  );

  return { related, suppressed: suppression.suppressed, suppressionReason: suppression.reason };
}

export interface RelationshipSuggestion {
  opportunityId: string;
  title: string;
  reference: number;
  state: string;
  overlap: number;
  reason: string;
  suggestedKind: RelationshipKind;
}

/**
 * Opportunities that look like this one.
 *
 * Deterministic keyword overlap, never applied automatically. It exists so a
 * person notices they are about to investigate something they already rejected,
 * which is the failure this whole section of the product is here to prevent.
 */
export async function suggestRelationships(
  repos: Repositories,
  ctx: ActorCtx,
  opportunityId: string,
  options: { minimumOverlap?: number } = {},
): Promise<RelationshipSuggestion[]> {
  if (!can(ctx, 'opportunities.read')) throw errors.forbidden('opportunities.read');

  const subject = await repos.opportunities.findById(ctx.workspaceId, opportunityId);
  if (!subject) throw errors.notFound('Opportunity');

  const minimum = options.minimumOverlap ?? 0.5;
  const subjectWords = new Set(
    keywordsFor(`${subject.title} ${subject.thesis} ${subject.problemStatement ?? ''}`, 12),
  );
  if (subjectWords.size === 0) return [];

  const existing = await repos.relationships.listFor(ctx.workspaceId, opportunityId);
  const alreadyLinked = new Set(
    existing.flatMap((row) => [row.fromOpportunityId, row.toOpportunityId]),
  );

  const others = await repos.opportunities.list(ctx.workspaceId, { limit: 200 });
  const suggestions: RelationshipSuggestion[] = [];

  for (const other of others) {
    if (other.id === opportunityId || alreadyLinked.has(other.id)) continue;

    const otherWords = new Set(
      keywordsFor(`${other.title} ${other.thesis} ${other.problemStatement ?? ''}`, 12),
    );
    if (otherWords.size === 0) continue;

    let shared = 0;
    for (const word of subjectWords) if (otherWords.has(word)) shared += 1;
    const overlap = shared / Math.min(subjectWords.size, otherWords.size);
    if (overlap < minimum) continue;

    suggestions.push({
      opportunityId: other.id,
      title: other.title,
      reference: other.reference,
      state: other.state,
      overlap: Number(overlap.toFixed(2)),
      reason:
        other.state === 'rejected'
          ? `Shares ${shared} of its defining words with this, and was rejected. Read why before spending again.`
          : `Shares ${shared} of its defining words with this.`,
      suggestedKind: other.state === 'rejected' ? 'learned_from' : 'variant_of',
    });
  }

  return suggestions.sort((a, b) => b.overlap - a.overlap).slice(0, 8);
}
