import fs from 'node:fs/promises';
import { inferOpportunitySignals, chooseBestFinding, scoreProspect, priceOffer } from '../src/scoring.mjs';

const fixtures = JSON.parse(await fs.readFile(new URL('../fixtures/demo-prospects.json', import.meta.url), 'utf8'));

function estimateInputs(prospect, best, inspection) {
  const evidenceCount = inspection.findings.length;
  return {
    pain: best.severity,
    buyerClarity: prospect.phone || prospect.website ? 78 : 45,
    speedToCash: best.severity >= 75 ? 82 : 68,
    deliveryEase: ['NO_QUOTE_FLOW','NO_BOOKING_FLOW','NO_STRUCTURED_FORM','WEAK_CTA'].includes(best.code) ? 84 : 64,
    evidence: Math.min(95, 48 + evidenceCount * 7),
    margin: 78,
    contactability: prospect.website ? 72 : (prospect.phone ? 60 : 35)
  };
}

const results = fixtures.map((prospect) => {
  const inspection = inferOpportunitySignals({
    markdown: prospect.inspection.markdown,
    links: prospect.inspection.links,
    flags: prospect.inspection.flags,
    website: prospect.website
  });
  const best = chooseBestFinding(inspection.findings);
  const scoring = scoreProspect(estimateInputs(prospect, best, inspection));
  return {
    business: prospect.name,
    category: prospect.category,
    score: scoring.total,
    problem: best.title,
    solution: best.solution,
    indicativePriceGbp: priceOffer({ score: scoring.total, severity: best.severity, deliveryEase: scoring.components.deliveryEase })
  };
}).sort((a,b) => b.score - a.score);

console.log(JSON.stringify({ mode: 'offline-demo', generatedAt: new Date().toISOString(), results }, null, 2));
