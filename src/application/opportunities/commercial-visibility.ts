import type { OpportunityRow } from '../../ports/repositories/opportunities';

interface CommercialQualificationNote {
  eligible?: boolean;
}

/**
 * Manual opportunities are always owner-visible. Machine-created opportunities
 * must have passed the commercial qualification gate before they appear in the
 * owner-facing Opportunity feed.
 *
 * Legacy auto-framed rows have no qualification note, so they are deliberately
 * hidden until the scheduler re-evaluates them. Their evidence is preserved.
 */
export function isOwnerFacingOpportunity(opportunity: OpportunityRow): boolean {
  if (opportunity.createdBy !== 'auto') return true;
  const raw = opportunity.notes?.commercialQualification;
  if (!raw || typeof raw !== 'object') return false;
  return (raw as CommercialQualificationNote).eligible === true;
}
