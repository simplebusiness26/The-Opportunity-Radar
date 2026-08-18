/**
 * The Execution Brief.
 *
 * This is the boundary of the product. Radar decides what deserves the next
 * unit of effort; something else builds it. The brief is what crosses that
 * boundary, and it has one job: to give whoever builds this everything they
 * need to build the right thing, including the things they must not build yet.
 *
 * It is assembled from stored records only. Nothing here is generated prose,
 * which is why a brief can be handed to a person or posted to an API and mean
 * the same thing.
 */

export interface BriefEvidence {
  rawMentions: number;
  uniqueEvidence: number;
  independentSources: number;
  /** Included so nobody mistakes model output for corroboration. */
  aiDerivedMentions: number;
  strongest: Array<{ claim: string; evidenceClass: string; mentions: number }>;
  counter: Array<{ claim: string; note: string | null }>;
}

export interface BriefCapability {
  label: string;
  criticality: 'nice_to_have' | 'important' | 'essential';
  /** What we already have that covers it, if anything. */
  coveredBy: string | null;
}

export interface BriefInput {
  reference: number;
  title: string;
  thesis: string;
  state: string;
  typeKey: string;
  targetCustomer: string | null;
  problemStatement: string | null;
  whyNow: string | null;
  demo: boolean;

  attractiveness: number | null;
  confidence: number;
  fit: number | null;
  leverage: number | null;

  evidence: BriefEvidence;

  capabilities: BriefCapability[];
  reusableAssets: string[];
  buildDaysRange: { low: number; high: number } | null;

  knowns: string[];
  assumptions: string[];
  criticalUnknowns: string[];

  objections: Array<{ argument: string; severity: string; disconfirmingTest: string | null }>;

  validation: {
    hypothesis: string;
    experimentType: string;
    successThreshold: string;
    failureThreshold: string;
    doNotBuildYet: string[];
  } | null;

  experiments: Array<{ name: string; state: string; verdict: string | null; conclusion: string | null }>;

  /** What would make us change our mind, still armed. */
  watchingFor: string[];

  allocationRationale: string | null;
  generatedAt: Date;
}

export type ReadinessVerdict =
  | { ready: true; note: string }
  | { ready: false; reason: string; remedy: string };

export interface ExecutionBrief {
  input: BriefInput;
  readiness: ReadinessVerdict;
  /** Stated at the top of the document, before anything encouraging. */
  headline: string;
}

/**
 * Whether this is genuinely ready to be built.
 *
 * Deliberately strict, and deliberately not overridable from inside the brief:
 * the whole point of the boundary is that something leaving it has survived the
 * process rather than skipped it. A brief for an unready opportunity is still
 * produced -- it is useful for review -- but it says so at the top.
 */
export function assessReadiness(input: BriefInput): ReadinessVerdict {
  if (input.evidence.independentSources === 0) {
    return {
      ready: false,
      reason: 'Nothing here has been corroborated by an independent source.',
      remedy: 'Collect evidence from a second, unrelated origin before committing anyone to build.',
    };
  }

  if (input.confidence < 0.5) {
    return {
      ready: false,
      reason: `Confidence is ${Math.round(input.confidence * 100)}%, which is not enough to commit build effort against.`,
      remedy: 'Run the validation plan, or gather corroborating evidence, and re-score.',
    };
  }

  const fatal = input.objections.filter((objection) => objection.severity === 'fatal');
  if (fatal.length > 0) {
    return {
      ready: false,
      reason: `The red team raised ${fatal.length} objection(s) it judged fatal, and none has been answered.`,
      remedy: 'Answer them with evidence, or reject this and record why.',
    };
  }

  const concluded = input.experiments.filter((experiment) => experiment.verdict !== null);
  if (concluded.length === 0) {
    return {
      ready: false,
      reason: 'No experiment has produced a result, so nothing about this has been tested against real people.',
      remedy: 'Run the validation plan first. It exists precisely to make this cheap.',
    };
  }

  const rejected = concluded.filter((experiment) => experiment.verdict === 'rejected');
  if (rejected.length > 0) {
    return {
      ready: false,
      reason: 'An experiment against real people returned a negative result.',
      remedy: 'That is the strongest evidence available. Read it before overriding it.',
    };
  }

  const validated = concluded.filter(
    (experiment) => experiment.verdict === 'validated' || experiment.verdict === 'partially_validated',
  );

  if (validated.length === 0) {
    return {
      ready: false,
      reason: 'Every experiment so far was inconclusive, so nothing has been established either way.',
      remedy: 'Design a sharper test rather than treating an inconclusive result as a pass.',
    };
  }

  return {
    ready: true,
    note: `${validated.length} experiment(s) supported the thesis against real people, and no fatal objection stands.`,
  };
}

export function buildBrief(input: BriefInput): ExecutionBrief {
  const readiness = assessReadiness(input);

  return {
    input,
    readiness,
    headline: readiness.ready
      ? `Ready to build. ${readiness.note}`
      : `NOT READY TO BUILD. ${readiness.reason}`,
  };
}

/**
 * The brief as Markdown.
 *
 * Rendered here rather than in a template so the same document is produced for
 * a person reading it, an export, and an API payload. The order is chosen so
 * that what is unproven appears before what is promising.
 */
export function renderBrief(brief: ExecutionBrief): string {
  const { input } = brief;
  const lines: string[] = [];

  lines.push(`# Execution Brief — #${input.reference} ${input.title}`);
  if (input.demo) lines.push('\n> **DEMO DATA.** This opportunity is seeded sample data, not real evidence.');
  lines.push('');
  lines.push(`> **${brief.headline}**`);
  if (!brief.readiness.ready) lines.push(`>`, `> ${brief.readiness.remedy}`);
  lines.push('');

  lines.push('## The thesis');
  lines.push('');
  lines.push(input.thesis);
  if (input.targetCustomer) lines.push('', `**Customer.** ${input.targetCustomer}`);
  if (input.problemStatement) lines.push('', `**Problem.** ${input.problemStatement}`);
  if (input.whyNow) lines.push('', `**Why now.** ${input.whyNow}`);
  lines.push('');

  lines.push('## What the evidence actually is');
  lines.push('');
  lines.push(
    `${input.evidence.rawMentions} mentions · ${input.evidence.uniqueEvidence} unique evidence · ` +
      `${input.evidence.independentSources} independent sources`,
  );
  if (input.evidence.aiDerivedMentions > 0) {
    lines.push(
      '',
      `${input.evidence.aiDerivedMentions} of the mentions are AI-derived and count toward none of the above.`,
    );
  }
  lines.push('');
  lines.push(
    `Attractiveness ${format(input.attractiveness)} · confidence ${Math.round(input.confidence * 100)}%` +
      ` · fit ${format(input.fit)} · leverage ${format(input.leverage)}`,
  );

  if (input.evidence.strongest.length > 0) {
    lines.push('', '### Strongest supporting evidence', '');
    for (const item of input.evidence.strongest) {
      lines.push(`- ${item.claim} *(${item.evidenceClass}, ${item.mentions} mention(s))*`);
    }
  }

  if (input.evidence.counter.length > 0) {
    lines.push('', '### Evidence against', '');
    for (const item of input.evidence.counter) {
      lines.push(`- ${item.claim}${item.note ? ` — ${item.note}` : ''}`);
    }
  }

  lines.push('', '## What is not known', '');
  if (input.criticalUnknowns.length === 0 && input.assumptions.length === 0) {
    lines.push('Nothing has been recorded as unknown, which usually means nobody has looked.');
  }
  if (input.criticalUnknowns.length > 0) {
    lines.push('**Critical unknowns** — the answers to these would change the decision:', '');
    for (const unknown of input.criticalUnknowns) lines.push(`- ${unknown}`);
    lines.push('');
  }
  if (input.assumptions.length > 0) {
    lines.push('**Assumptions being made**:', '');
    for (const assumption of input.assumptions) lines.push(`- ${assumption}`);
    lines.push('');
  }
  if (input.knowns.length > 0) {
    lines.push('**Established**:', '');
    for (const known of input.knowns) lines.push(`- ${known}`);
    lines.push('');
  }

  if (input.objections.length > 0) {
    lines.push('## The case against', '');
    for (const objection of input.objections) {
      lines.push(`- **${objection.severity}** — ${objection.argument}`);
      if (objection.disconfirmingTest) lines.push(`  - Settle it by: ${objection.disconfirmingTest}`);
    }
    lines.push('');
  }

  lines.push('## What it would take to build', '');
  if (input.capabilities.length === 0) {
    lines.push('No capability requirements have been recorded, so the build estimate is a guess.');
  } else {
    for (const capability of input.capabilities) {
      lines.push(
        `- ${capability.label} *(${capability.criticality})*` +
          (capability.coveredBy ? ` — already covered by ${capability.coveredBy}` : ' — **not covered**'),
      );
    }
  }
  if (input.reusableAssets.length > 0) {
    lines.push('', `**Reusable**: ${input.reusableAssets.join(', ')}.`);
  }
  if (input.buildDaysRange) {
    lines.push(
      '',
      `**Estimate**: ${input.buildDaysRange.low}–${input.buildDaysRange.high} days. A range, not a number, because that is what the evidence supports.`,
    );
  }
  lines.push('');

  if (input.validation) {
    lines.push('## What was tested', '');
    lines.push(`**Hypothesis.** ${input.validation.hypothesis}`);
    lines.push('', `**Method.** ${input.validation.experimentType.replace(/_/g, ' ')}`);
    lines.push('', `**Success was defined beforehand as.** ${input.validation.successThreshold}`);
    lines.push('', `**Failure was defined beforehand as.** ${input.validation.failureThreshold}`);
    lines.push('');
  }

  if (input.experiments.length > 0) {
    lines.push('### Results', '');
    for (const experiment of input.experiments) {
      lines.push(
        `- **${experiment.name}** — ${experiment.state}${experiment.verdict ? `, ${experiment.verdict.replace(/_/g, ' ')}` : ''}` +
          (experiment.conclusion ? `: ${experiment.conclusion}` : ''),
      );
    }
    lines.push('');
  }

  const doNotBuild = input.validation?.doNotBuildYet ?? [];
  lines.push('## Do not build yet', '');
  if (doNotBuild.length === 0) {
    lines.push('Nothing has been ruled out, which means scope is unbounded. That is a risk in itself.');
  } else {
    for (const item of doNotBuild) lines.push(`- ${item}`);
  }
  lines.push('');

  if (input.watchingFor.length > 0) {
    lines.push('## What would change this decision', '');
    for (const item of input.watchingFor) lines.push(`- ${item}`);
    lines.push('');
  }

  if (input.allocationRationale) {
    lines.push('## Why this, now', '', input.allocationRationale, '');
  }

  lines.push('---', '');
  lines.push(
    `Generated by Opportunity Radar from stored records on ${input.generatedAt.toISOString().slice(0, 10)}. ` +
      'Every figure above is arithmetic over recorded evidence; nothing in this document was generated as prose.',
  );

  return lines.join('\n');
}

function format(value: number | null): string {
  return value === null ? 'not scored' : String(Math.round(value));
}
