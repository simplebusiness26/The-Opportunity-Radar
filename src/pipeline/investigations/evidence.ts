import { untrustedBlock, type UntrustedBlock } from '../../domain/types/untrusted';
import { EVIDENCE_CLASSES } from '../../domain/taxonomy/evidence-class';
import type { Repositories } from '../../ports/repositories/index';

/**
 * The evidence an investigation is allowed to reason about.
 *
 * Two things are load-bearing here. First, every block is marked untrusted, so
 * it can only reach the model through the assembler that wraps and neutralises
 * it -- fetched forum posts are exactly where an injection attempt would live.
 * Second, the block ids are evidence unit ids, which is what makes a citation
 * checkable: a claim naming an id that was never supplied is discarded by the
 * projector rather than stored.
 */

export interface EvidenceBriefing {
  blocks: UntrustedBlock[];
  /** Ids the model may cite. Anything else is a fabrication. */
  suppliedIds: string[];
  /** How many pieces are attached in total, against how many were shown. */
  totalAttached: number;
  shown: number;
  /** Attached as arguing against the thesis. */
  againstCount: number;
  /** Evidence that may count toward independence, i.e. not AI-derived. */
  independentCount: number;
  /** Whether any evidence records money actually changing hands. */
  spendingObserved: boolean;
  observedMonthlyAmounts: number[];
}

/** Enough for a role to reason from, without paying to send the whole corpus. */
const MAX_BLOCKS = 60;
const MAX_BLOCK_CHARACTERS = 4_000;

export async function gatherEvidence(
  repos: Repositories,
  workspaceId: string,
  opportunityId: string,
): Promise<EvidenceBriefing> {
  const attached = await repos.opportunities.evidenceFor(opportunityId);
  if (attached.length === 0) {
    return {
      blocks: [],
      suppliedIds: [],
      totalAttached: 0,
      shown: 0,
      againstCount: 0,
      independentCount: 0,
      spendingObserved: false,
      observedMonthlyAmounts: [],
    };
  }

  const stanceById = new Map(attached.map((row) => [row.evidenceUnitId, row.stance]));
  const units = await repos.evidence.listByIds(
    workspaceId,
    attached.map((row) => row.evidenceUnitId),
  );

  // Strongest first, so the cap drops the weakest evidence rather than an
  // arbitrary slice. Counter-evidence is never dropped: an investigation that
  // sees only the supporting half of the picture is worse than no
  // investigation at all.
  const ordered = [...units].sort((a, b) => {
    const aAgainst = stanceById.get(a.id) === 'against' ? 1 : 0;
    const bAgainst = stanceById.get(b.id) === 'against' ? 1 : 0;
    if (aAgainst !== bAgainst) return bAgainst - aAgainst;
    return b.effectiveStrength - a.effectiveStrength;
  });

  const shown = ordered.slice(0, MAX_BLOCKS);
  const blocks: UntrustedBlock[] = [];
  const observedMonthlyAmounts: number[] = [];
  let independentCount = 0;

  for (const unit of shown) {
    if (EVIDENCE_CLASSES[unit.evidenceClass]?.countsAsIndependent) independentCount += 1;

    const signal = unit.representativeSignalId
      ? await repos.signals.findById(workspaceId, unit.representativeSignalId)
      : null;

    const monthly = signal?.monetaryEvidence?.monthlyAmount;
    if (typeof monthly === 'number' && monthly > 0) observedMonthlyAmounts.push(monthly);

    const stance = stanceById.get(unit.id) === 'against' ? 'against the thesis' : 'for the thesis';

    const body = [
      `Claim: ${unit.canonicalClaim}`,
      `Evidence class: ${EVIDENCE_CLASSES[unit.evidenceClass]?.label ?? unit.evidenceClass}`,
      `Signal type: ${unit.signalTypeKey}`,
      `Attached: ${stance}`,
      `Mentions: ${unit.mentionCount}, independent sources: ${unit.independentSourceCount}`,
      signal?.title ? `Title: ${signal.title}` : null,
      typeof monthly === 'number' && monthly > 0
        ? `Recorded spend: ${monthly} ${signal?.monetaryEvidence?.currency ?? ''} per month`.trim()
        : null,
      signal?.bodyText ? `\n${signal.bodyText}` : null,
    ]
      .filter((line): line is string => line !== null)
      .join('\n')
      .slice(0, MAX_BLOCK_CHARACTERS);

    blocks.push(
      untrustedBlock(unit.id, body, {
        origin: signal?.canonicalUrl ?? signal?.url ?? `evidence:${unit.id}`,
        kind: unit.evidenceClass === 'ai_derived' ? 'ai_output' : 'source_payload',
        fetchedAt: unit.lastSeenAt.toISOString(),
      }),
    );
  }

  return {
    blocks,
    suppliedIds: blocks.map((block) => block.id),
    totalAttached: attached.length,
    shown: blocks.length,
    againstCount: attached.filter((row) => row.stance === 'against').length,
    independentCount,
    spendingObserved: observedMonthlyAmounts.length > 0,
    observedMonthlyAmounts,
  };
}
