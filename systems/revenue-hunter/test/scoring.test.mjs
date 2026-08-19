import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreProspect, inferOpportunitySignals, chooseBestFinding, priceOffer } from '../src/scoring.mjs';

test('score is bounded and deterministic', () => {
  const a = scoreProspect({pain:90,buyerClarity:80,speedToCash:90,deliveryEase:80,evidence:90,margin:80,contactability:70});
  assert.equal(a.total, 84.2);
});

test('detects conversion gaps', () => {
  const r = inferOpportunitySignals({markdown:'Welcome to Acme. Call us.', links:['tel:0123'], website:'https://acme.test'});
  assert.ok(r.findings.some(x => x.code === 'NO_QUOTE_FLOW'));
  assert.ok(r.findings.some(x => x.code === 'NO_BOOKING_FLOW'));
  assert.equal(r.flags.hasHttps, true);
});

test('best finding is highest severity', () => {
  assert.equal(chooseBestFinding([{code:'A',severity:10},{code:'B',severity:90}]).code, 'B');
});

test('offer stays within guardrails', () => {
  assert.ok(priceOffer({score:95,severity:95,deliveryEase:90}) <= 1250);
  assert.ok(priceOffer({score:1,severity:1,deliveryEase:1}) >= 250);
});
